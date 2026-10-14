import { BRT_OFFSET_MS, type Bindings } from "./lib";
import { ensureInvoices, parsePayload, payloadIssueList, type Row } from "./queries";

/** Rotinas do cron: alertas (5 min) e manutenção + resumo (diário). */

export const CRON_ALERTS = "*/5 * * * *";
export const CRON_DAILY = "0 9 * * *";

/** Offline só vira alerta depois disso (o painel usa DEVICE_OFFLINE_SEC, bem mais curto). */
const ALERT_OFFLINE_MIN = 10;
const EVENTS_KEEP_DAYS = 90;

type Condition = { deviceId: string; kind: string; detail: string };
type AlertRow = {
  id: number;
  device_id: string;
  kind: string;
  detail: string | null;
  opened_at: string;
  resolved_at: string | null;
  notified_open: number;
  device_name: string;
  venue_name: string;
};

/** "2026-10-14 13:55:00" (UTC) → "14/10 10:55" (BRT). */
function brt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(Date.parse(`${ts.replace(" ", "T")}Z`) - BRT_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Sem binding/destino configurado, o "envio" é o log (e o alerta não fica pendente pra sempre). */
async function sendMail(env: Bindings, subject: string, text: string): Promise<boolean> {
  const to = env.ALERT_EMAIL_TO?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (!env.EMAIL || !to.length || !env.ALERT_EMAIL_FROM) {
    console.log(JSON.stringify({ event: "email_skipped", subject, text }));
    return true;
  }
  try {
    await env.EMAIL.send({
      to,
      from: { email: env.ALERT_EMAIL_FROM, name: "Replay" },
      subject,
      text,
    });
    return true;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error(JSON.stringify({ event: "email_failed", code: e.code, message: e.message, subject }));
    return false;
  }
}

/** Abre/fecha alertas comparando o estado atual com os abertos; e-mail só na mudança. */
export async function runAlerts(env: Bindings): Promise<{ opened: number; resolved: number; mailed: boolean }> {
  const db = env.DB;
  const { results: devices } = await db
    .prepare(
      `SELECT d.id, d.last_seen_at, d.last_payload,
              d.last_seen_at > datetime('now', ?) AS online
       FROM devices d JOIN venues v ON v.id = d.venue_id
       WHERE d.revoked_at IS NULL AND d.last_seen_at IS NOT NULL
         AND v.status IN ('onboarding', 'active')`,
    )
    .bind(`-${ALERT_OFFLINE_MIN} minutes`)
    .all<Row>();

  const current = new Map<string, Condition>();
  const watched = new Set<string>();
  const offline = new Set<string>();
  for (const d of devices) {
    const id = String(d.id);
    watched.add(id);
    if (!d.online) {
      offline.add(id);
      current.set(`${id}|offline`, { deviceId: id, kind: "offline", detail: `sem sinal desde ${brt(String(d.last_seen_at))}` });
      continue;
    }
    for (const issue of payloadIssueList(parsePayload(d.last_payload))) {
      current.set(`${id}|${issue.code}`, { deviceId: id, kind: issue.code, detail: issue.text });
    }
  }

  const { results: open } = await db
    .prepare("SELECT id, device_id, kind FROM alerts WHERE resolved_at IS NULL")
    .all<{ id: number; device_id: string; kind: string }>();
  const openKeys = new Set(open.map((a) => `${a.device_id}|${a.kind}`));

  const stmts: D1PreparedStatement[] = [];
  let opened = 0;
  for (const [key, cond] of current) {
    if (openKeys.has(key)) continue;
    opened += 1;
    stmts.push(
      db
        .prepare("INSERT OR IGNORE INTO alerts (device_id, kind, detail) VALUES (?, ?, ?)")
        .bind(cond.deviceId, cond.kind, cond.detail),
    );
  }
  let resolved = 0;
  for (const a of open) {
    if (!watched.has(a.device_id)) {
      // Device revogado / arena pausada: fecha sem avisar.
      stmts.push(
        db
          .prepare("UPDATE alerts SET resolved_at = datetime('now'), notified_close = 1 WHERE id = ?")
          .bind(a.id),
      );
      continue;
    }
    // Offline: não dá pra saber se temperatura/fila melhoraram; mantém aberto.
    if (offline.has(a.device_id) && a.kind !== "offline") continue;
    if (current.has(`${a.device_id}|${a.kind}`)) continue;
    resolved += 1;
    stmts.push(db.prepare("UPDATE alerts SET resolved_at = datetime('now') WHERE id = ?").bind(a.id));
  }
  if (stmts.length) await db.batch(stmts);

  const mailed = await notifyPending(env);
  return { opened, resolved, mailed };
}

/** Manda o que ainda não foi avisado (inclusive sobras de um envio que falhou). */
async function notifyPending(env: Bindings): Promise<boolean> {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.device_id, a.kind, a.detail, a.opened_at, a.resolved_at, a.notified_open,
            d.name AS device_name, v.name AS venue_name
     FROM alerts a JOIN devices d ON d.id = a.device_id JOIN venues v ON v.id = d.venue_id
     WHERE a.notified_open = 0 OR (a.resolved_at IS NOT NULL AND a.notified_close = 0)
     ORDER BY a.opened_at`,
  ).all<AlertRow>();
  if (!results.length) return false;

  // Abriu e fechou antes de qualquer aviso: não incomoda ninguém.
  const silent = results.filter((a) => !a.notified_open && a.resolved_at);
  const openedNow = results.filter((a) => !a.notified_open && !a.resolved_at);
  const closedNow = results.filter((a) => a.notified_open && a.resolved_at);

  let ok = true;
  if (openedNow.length || closedNow.length) {
    const line = (a: AlertRow) => `${a.venue_name} · ${a.device_name} · ${a.detail ?? a.kind}`;
    const parts = [
      ...openedNow.map((a) => `PROBLEMA  ${line(a)} (desde ${brt(a.opened_at)})`),
      ...closedNow.map((a) => `RESOLVIDO ${line(a)} (${brt(a.opened_at)} → ${brt(a.resolved_at)})`),
    ];
    const venues = (rows: AlertRow[]) => [...new Set(rows.map((a) => a.venue_name))].join(", ");
    const subject = openedNow.length
      ? `[Replay] ${openedNow.length} problema(s): ${venues(openedNow)}`.slice(0, 150)
      : `[Replay] resolvido: ${venues(closedNow)}`.slice(0, 150);
    ok = await sendMail(env, subject, `${parts.join("\n")}\n\nPainel: ${env.APP_URL ?? ""}/painel/dispositivos\n`);
  }
  if (!ok) return false;

  const ids = (rows: AlertRow[]) => rows.map((a) => a.id);
  const stmts: D1PreparedStatement[] = [];
  for (const id of [...ids(silent), ...ids(openedNow), ...ids(closedNow)]) {
    stmts.push(
      env.DB.prepare(
        `UPDATE alerts SET notified_open = 1,
           notified_close = CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE notified_close END
         WHERE id = ?`,
      ).bind(id),
    );
  }
  await env.DB.batch(stmts);
  return openedNow.length + closedNow.length > 0;
}

/** Retenção: apaga clips expirados (R2 + D1), pendentes órfãos e heartbeats antigos. */
export async function purgeExpired(env: Bindings): Promise<{ clips: number }> {
  let total = 0;
  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT id, object_key, thumb_key FROM clips
       WHERE expires_at <= datetime('now')
          OR (status = 'pending' AND created_at <= datetime('now', '-1 day'))
       LIMIT 100`,
    ).all<{ id: string; object_key: string; thumb_key: string | null }>();
    if (!results.length) break;

    const keys = results.flatMap((r) => (r.thumb_key ? [r.object_key, r.thumb_key] : [r.object_key]));
    await env.CLIPS.delete(keys);
    const placeholders = results.map(() => "?").join(",");
    await env.DB.prepare(`DELETE FROM clips WHERE id IN (${placeholders})`)
      .bind(...results.map((r) => r.id))
      .run();
    total += results.length;
    if (results.length < 100) break;
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM heartbeats WHERE created_at <= datetime('now', '-7 days')"),
    env.DB.prepare("DELETE FROM device_events WHERE created_at <= datetime('now', ?)").bind(
      `-${EVENTS_KEEP_DAYS} days`,
    ),
    env.DB.prepare(
      "DELETE FROM alerts WHERE resolved_at IS NOT NULL AND resolved_at <= datetime('now', ?)",
    ).bind(`-${EVENTS_KEEP_DAYS} days`),
  ]);
  return { clips: total };
}

/** Resumo das últimas 24h por equipamento: o número que importa no piloto é apertos → clips. */
async function dailySummary(env: Bindings): Promise<boolean> {
  const db = env.DB;
  const [events, views, open] = await db.batch([
    db.prepare(
      `SELECT d.id, d.name, v.name AS venue_name, d.last_seen_at,
              COALESCE(SUM(e.type = 'press'), 0) AS press,
              COALESCE(SUM(e.type = 'clip_ok'), 0) AS clip_ok,
              COALESCE(SUM(e.type = 'clip_fail'), 0) AS clip_fail,
              COALESCE(SUM(e.type = 'ffmpeg_restart'), 0) AS restarts,
              COALESCE(SUM(e.type = 'boot'), 0) AS boots,
              COALESCE(SUM(e.type = 'queue_drop'), 0) AS drops
       FROM devices d JOIN venues v ON v.id = d.venue_id
       LEFT JOIN device_events e ON e.device_id = d.id AND e.created_at > datetime('now', '-1 day')
       WHERE d.revoked_at IS NULL AND d.last_seen_at IS NOT NULL AND v.status IN ('onboarding', 'active')
       GROUP BY d.id ORDER BY v.name, d.name`,
    ),
    db.prepare(
      `SELECT v.name AS venue_name, COUNT(*) AS n FROM clip_events e JOIN venues v ON v.id = e.venue_id
       WHERE e.type = 'view' AND e.created_at > datetime('now', '-1 day')
       GROUP BY v.id ORDER BY n DESC`,
    ),
    db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL"),
  ]);
  const rows = events.results as Row[];
  if (!rows.length) return false;

  const lines = rows.map((r) => {
    const press = Number(r.press);
    const rate = press ? `${Math.round((Number(r.clip_ok) / press) * 100)}%` : "—";
    return [
      `${r.venue_name} · ${r.name}`,
      `  apertos ${press} · clips ${r.clip_ok} (${rate}) · falhas ${r.clip_fail}`,
      `  reinícios câmera ${r.restarts} · boots ${r.boots} · descartes fila ${r.drops}`,
      `  último sinal ${brt(String(r.last_seen_at ?? ""))}`,
    ].join("\n");
  });
  const viewLines = (views.results as Row[]).map((r) => `  ${r.venue_name}: ${r.n} views`);
  const openCount = Number((open.results[0] as Row)?.n ?? 0);
  const text = [
    ...lines,
    "",
    "Views (24h):",
    ...(viewLines.length ? viewLines : ["  nenhuma"]),
    "",
    `Alertas abertos: ${openCount}`,
  ].join("\n");
  const today = brt(new Date().toISOString().slice(0, 19).replace("T", " ")).slice(0, 5);
  return sendMail(env, `[Replay] resumo ${today}${openCount ? ` · ${openCount} alerta(s)` : ""}`, text);
}

export async function runDaily(env: Bindings): Promise<Row> {
  const purge = await purgeExpired(env);
  const invoices = (await ensureInvoices(env.DB)).length;
  const mailed = await dailySummary(env);
  return { ...purge, invoices, mailed };
}
