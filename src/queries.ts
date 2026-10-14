import type { Context } from "hono";
import { brtDayStartUtc, deviceOfflineSec, randomHex, todayBrt, type Bindings, type Env } from "./lib";

/** Helpers e queries usados pelo painel admin e pelo portal da arena. */

export type Row = Record<string, unknown>;

const HOT_TEMP_C = 75;

export async function readBody<T>(c: Context<Env>): Promise<Partial<T>> {
  return c.req.json<Partial<T>>().catch((): Partial<T> => ({}));
}

export function text(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

export function cents(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function isDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return list.includes(v as T) ? (v as T) : null;
}

export function offlineWindow(env: Bindings): string {
  return `-${deviceOfflineSec(env)} seconds`;
}

export function addMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function parsePayload(raw: unknown): Row | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as Row;
  } catch {
    return null;
  }
}

/** Anomalias do heartbeat que viram alerta no painel (e forçam histórico no D1). */
export function payloadIssues(p: Row | null): string[] {
  if (!p) return [];
  const issues: string[] = [];
  if (typeof p.temp_c === "number" && p.temp_c >= HOT_TEMP_C) issues.push(`temp ${p.temp_c.toFixed(0)}°C`);
  if (typeof p.throttled === "string" && !/^0x0$|^0$/.test(p.throttled)) {
    issues.push(`throttled ${p.throttled}`);
  }
  if (p.buffer_alive === false) issues.push("buffer parado");
  return issues;
}

export function withDeviceStatus(d: Row): Row {
  const payload = parsePayload(d.last_payload);
  return { ...d, online: Boolean(d.online), last_payload: payload, issues: payloadIssues(payload) };
}

export function withInvoiceStatus(i: Row): Row {
  const overdue = i.status === "open" && String(i.due_date) < todayBrt();
  return { ...i, overdue };
}

export const byType = (rows: Row[]) =>
  Object.fromEntries(rows.map((r) => [String(r.type), Number(r.n)])) as Record<string, number>;

/** Início (UTC) da janela de `days` dias em BRT terminando hoje. */
export function seriesStartUtc(days = 30): string {
  const today = todayBrt();
  return brtDayStartUtc(
    new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10),
  );
}

/* ------------------------------------------------------------------ marca */

/** Mesma lista do CHECK da migração 0006. */
export const BRAND_COLORS = [
  "#d7ff3a",
  "#ffd23f",
  "#ff9f43",
  "#ff7a7a",
  "#ff7ac0",
  "#b99aff",
  "#4dd4ff",
  "#3ee6a0",
] as const;

export type Brand = { name: string; color: string | null; logo_url: string | null };

/** `logo_key` termina num sufixo aleatório por upload: vira o ?v= (cache imutável). */
export function brandOf(v: Row): Brand {
  const logoKey = typeof v.logo_key === "string" ? v.logo_key : null;
  return {
    name: String(v.public_name || v.name),
    color: typeof v.brand_color === "string" ? v.brand_color : null,
    logo_url: logoKey ? `/brand/${v.id}/logo?v=${logoKey.split("-").pop()}` : null,
  };
}

/* ------------------------------------------------- statements por arena */

export const courtsStmt = (db: D1Database, venueId: string) =>
  db
    .prepare(
      `SELECT co.id, co.name, co.public_key, co.created_at,
         (SELECT COUNT(*) FROM clip_events e WHERE e.court_id = co.id AND e.type = 'created'
            AND e.created_at >= datetime('now', '-7 days')) AS clips_7d,
         (SELECT COUNT(*) FROM clips cl WHERE cl.court_id = co.id AND cl.status = 'ready'
            AND cl.expires_at > datetime('now')) AS clips_live,
         (SELECT MAX(cl.created_at) FROM clips cl WHERE cl.court_id = co.id AND cl.status = 'ready') AS last_clip_at
       FROM courts co WHERE co.venue_id = ? ORDER BY co.name`,
    )
    .bind(venueId);

export const devicesStmt = (db: D1Database, env: Bindings, venueId: string) =>
  db
    .prepare(
      `SELECT id, kind, name, agent_version, last_seen_at, last_payload, revoked_at, created_at,
              CASE WHEN last_seen_at > datetime('now', ?) THEN 1 ELSE 0 END AS online
       FROM devices WHERE venue_id = ? ORDER BY revoked_at IS NOT NULL, name`,
    )
    .bind(offlineWindow(env), venueId);

export const invoicesStmt = (db: D1Database, venueId: string) =>
  db.prepare("SELECT * FROM invoices WHERE venue_id = ? ORDER BY period DESC LIMIT 24").bind(venueId);

export const activeContractStmt = (db: D1Database, venueId: string) =>
  db
    .prepare(
      `SELECT * FROM contracts WHERE venue_id = ? AND (end_date IS NULL OR end_date >= ?)
       ORDER BY start_date DESC LIMIT 1`,
    )
    .bind(venueId, todayBrt());

export const totalsStmt = (db: D1Database, venueId: string, days = 30) =>
  db
    .prepare(
      `SELECT type, COUNT(*) AS n FROM clip_events
       WHERE venue_id = ? AND created_at >= datetime('now', ?) GROUP BY type`,
    )
    .bind(venueId, `-${days} days`);

export const seriesStmt = (db: D1Database, venueId: string, days = 30) =>
  db
    .prepare(
      `SELECT date(created_at, '-3 hours') AS day,
              SUM(type = 'created') AS clips, SUM(type = 'view') AS views,
              SUM(type = 'download') AS downloads, SUM(type = 'share') AS shares
       FROM clip_events WHERE venue_id = ? AND created_at >= ? GROUP BY day ORDER BY day`,
    )
    .bind(venueId, seriesStartUtc(days));

/** Clips de um dia (BRT). `venueId` null = todas as arenas (admin). */
export async function clipsForDay(
  db: D1Database,
  date: string,
  venueId: string | null,
  courtId: string | null = null,
): Promise<Row[]> {
  const start = brtDayStartUtc(date);
  const { results } = await db
    .prepare(
      `SELECT cl.id, cl.status, cl.bytes, cl.thumb_key, cl.expires_at, co.id AS court_id,
              co.name AS court_name, co.public_key AS court_key, v.name AS venue_name,
              strftime('%H:%M', cl.created_at, '-3 hours') AS time_local,
              (SELECT COUNT(*) FROM clip_events e WHERE e.clip_id = cl.id AND e.type = 'view') AS views,
              (SELECT COUNT(*) FROM clip_events e WHERE e.clip_id = cl.id AND e.type = 'download') AS downloads
       FROM clips cl
       JOIN courts co ON co.id = cl.court_id
       JOIN venues v ON v.id = co.venue_id
       WHERE (? IS NULL OR co.venue_id = ?) AND (? IS NULL OR co.id = ?)
         AND cl.created_at >= ? AND cl.created_at < datetime(?, '+1 day')
       ORDER BY cl.created_at DESC
       LIMIT 300`,
    )
    .bind(venueId, venueId, courtId, courtId, start, start)
    .all<Row>();
  return results.map(({ thumb_key, ...clip }) => ({
    ...clip,
    thumb_url: thumb_key ? `/clips/${clip.id}/thumb.jpg` : null,
    play_url: `/clips/${clip.id}`,
  }));
}

/** Apaga vídeo + miniatura no R2 e a linha no D1. `venueId` restringe à arena (portal). */
export async function deleteClip(env: Bindings, clipId: string, venueId: string | null = null): Promise<boolean> {
  const clip = await env.DB.prepare(
    `SELECT cl.object_key, cl.thumb_key FROM clips cl JOIN courts co ON co.id = cl.court_id
     WHERE cl.id = ? AND (? IS NULL OR co.venue_id = ?)`,
  )
    .bind(clipId, venueId, venueId)
    .first<{ object_key: string; thumb_key: string | null }>();
  if (!clip) return false;
  await env.CLIPS.delete(clip.thumb_key ? [clip.object_key, clip.thumb_key] : [clip.object_key]);
  await env.DB.prepare("DELETE FROM clips WHERE id = ?").bind(clipId).run();
  return true;
}

export function audit(
  db: D1Database,
  actor: string,
  action: string,
  target: string | null,
  venueId: string | null,
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO audit_log (actor, action, target, venue_id) VALUES (?, ?, ?, ?)")
    .bind(actor, action, target, venueId);
}

/* ---------------------------------------------------------------- faturas */

/**
 * Gera faturas de contratos ativos até o mês corrente (BRT). Idempotente:
 * só tenta meses depois do último já gerado e pula meses que a arena já tem fatura
 * (ex.: paga no contrato anterior); UNIQUE(venue_id, period) segura corrida.
 * Retorna o venue_id de cada fatura nova.
 */
export async function ensureInvoices(db: D1Database): Promise<string[]> {
  const current = todayBrt().slice(0, 7);
  const { results } = await db
    .prepare(
      `SELECT c.id, c.venue_id, c.monthly_cents, c.due_day, c.start_date, c.end_date,
              (SELECT MAX(period) FROM invoices i WHERE i.contract_id = c.id) AS last_period
       FROM contracts c
       WHERE c.end_date IS NULL OR c.end_date >= c.start_date
       ORDER BY c.start_date DESC`,
    )
    .all<{
      id: string;
      venue_id: string;
      monthly_cents: number;
      due_day: number;
      start_date: string;
      end_date: string | null;
      last_period: string | null;
    }>();

  const pending = results
    .map((c) => ({
      ...c,
      first: c.last_period ? addMonth(c.last_period) : c.start_date.slice(0, 7),
      last: c.end_date && c.end_date.slice(0, 7) < current ? c.end_date.slice(0, 7) : current,
    }))
    .filter((c) => c.first <= c.last);
  if (!pending.length) return [];

  const venueIds = [...new Set(pending.map((c) => c.venue_id))].slice(0, 90);
  const minPeriod = pending.reduce((m, c) => (c.first < m ? c.first : m), current);
  const existing = await db
    .prepare(
      `SELECT venue_id, period FROM invoices
       WHERE period >= ? AND venue_id IN (${venueIds.map(() => "?").join(",")})`,
    )
    .bind(minPeriod, ...venueIds)
    .all<{ venue_id: string; period: string }>();
  const taken = new Set(existing.results.map((r) => `${r.venue_id}|${r.period}`));

  const stmts: D1PreparedStatement[] = [];
  const generated: string[] = [];
  for (const c of pending) {
    if (!venueIds.includes(c.venue_id)) continue;
    let period = c.first;
    for (let guard = 0; period <= c.last && guard < 120; guard++, period = addMonth(period)) {
      const key = `${c.venue_id}|${period}`;
      if (taken.has(key)) continue;
      taken.add(key);
      generated.push(c.venue_id);
      stmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO invoices (id, venue_id, contract_id, period, amount_cents, due_date)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            `inv_${randomHex(8)}`,
            c.venue_id,
            c.id,
            period,
            c.monthly_cents,
            `${period}-${String(c.due_day).padStart(2, "0")}`,
          ),
      );
    }
  }
  if (stmts.length) await db.batch(stmts);
  return generated;
}
