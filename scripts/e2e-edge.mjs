// E2E do lado Worker do edge (fila idempotente, eventos, alertas) contra `wrangler dev --test-scheduled`.
// Uso: npx wrangler dev --test-scheduled  →  node scripts/e2e-edge.mjs [http://127.0.0.1:8787]

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const BASE = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:8787";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "local-admin-token";
const RUN = Math.random().toString(36).slice(2, 7);

let failures = 0;
function check(label, ok, extra = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

async function call(path, { method = "GET", body, headers = {}, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      connection: "close",
      ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const A = (path, opts = {}) =>
  call(`/admin${path}`, { ...opts, headers: { authorization: `Bearer ${ADMIN_TOKEN}`, ...opts.headers } });

function sql(command) {
  execSync(`npx wrangler d1 execute replay-db --local --command "${command}"`, { stdio: "ignore", shell: true });
}

const cron = (expr) => call(`/__scheduled?cron=${encodeURIComponent(expr).replace(/%20/g, "+")}`);

/* ------------------------------------------------------------------ setup */

const venue = await A("/venues", { method: "POST", body: { name: `E2E Edge ${RUN}`, status: "active" } });
const venueId = venue.json.id;
const court = await A(`/venues/${venueId}/courts`, { method: "POST", body: { name: "Quadra 1" } });
const courtKey = court.json.public_key;
const mkDevice = async (name) => {
  const d = await A("/devices", { method: "POST", body: { venue_id: venueId, name } });
  return { id: d.json.id, H: { authorization: `Bearer ${d.json.token}` } };
};
const dev = await mkDevice("Pi E2E");
const other = await mkDevice("Pi outro");
check("setup arena/quadra/devices", Boolean(venueId && courtKey && dev.id && other.id));

/* ------------------------------------------------------- fila idempotente */

const clipId = randomUUID();
const recordedAt = new Date(Date.now() - 2 * 3600_000).toISOString();
const slot1 = await call("/edge/clips/upload-slot", {
  method: "POST",
  headers: dev.H,
  body: { court_key: courtKey, clip_id: clipId, recorded_at: recordedAt },
});
check("slot com clip_id do Pi", slot1.status === 200 && slot1.json.clip_id === clipId && slot1.json.status === "pending");
const slot2 = await call("/edge/clips/upload-slot", {
  method: "POST",
  headers: dev.H,
  body: { court_key: courtKey, clip_id: clipId, recorded_at: recordedAt },
});
check("slot repetido (retry) → 200 mesmo clip", slot2.status === 200 && slot2.json.clip_id === clipId);

const stolen = await call("/edge/clips/upload-slot", {
  method: "POST",
  headers: other.H,
  body: { court_key: courtKey, clip_id: clipId },
});
check("clip_id de outro device → 409", stolen.status === 409 && stolen.json.error === "clip_id_taken");
const badId = await call("/edge/clips/upload-slot", {
  method: "POST",
  headers: dev.H,
  body: { court_key: courtKey, clip_id: "../../x" },
});
check("clip_id inválido → 400", badId.status === 400);

const put = (id) =>
  call(`/edge/clips/${id}/content`, {
    method: "PUT",
    headers: { ...dev.H, "content-type": "video/mp4" },
    raw: new Uint8Array(1024),
  });
const put1 = await put(clipId);
check("upload", put1.status === 200 && put1.json.status === "ready");
const put2 = await put(clipId);
check("upload repetido → 409 (Pi trata como sucesso)", put2.status === 409);
const slot3 = await call("/edge/clips/upload-slot", {
  method: "POST",
  headers: dev.H,
  body: { court_key: courtKey, clip_id: clipId, recorded_at: recordedAt },
});
check("slot depois de pronto informa status ready", slot3.status === 200 && slot3.json.status === "ready");

/** Data/hora BRT como a API pública mostra. */
const brt = (ms) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
const shown = (j) => `${j.date_local} ${j.time_local}`;

const detail = await call(`/api/clips/${clipId}`);
check("hora na galeria = hora do lance (não do upload)", shown(detail.json) === brt(Date.parse(recordedAt)), shown(detail.json));

const oldId = randomUUID();
await call("/edge/clips/upload-slot", {
  method: "POST",
  headers: dev.H,
  body: { court_key: courtKey, clip_id: oldId, recorded_at: new Date(Date.now() - 48 * 3600_000).toISOString() },
});
await put(oldId);
const old = await call(`/api/clips/${oldId}`);
const nowShown = [brt(Date.now()), brt(Date.now() - 60_000)];
check("recorded_at > 24h é ignorado (usa agora)", nowShown.includes(shown(old.json)), shown(old.json));

/* ---------------------------------------------------------------- eventos */

const now = Date.now();
const ev = (type, agoSec, detail = null) => ({ type, detail, at: new Date(now - agoSec * 1000).toISOString() });
const hb = (extra = {}) =>
  call("/edge/heartbeat", {
    method: "POST",
    headers: dev.H,
    body: { agent_version: "0.4.0", buffer_alive: true, queue_len: 0, button_alive: true, ...extra },
  });

const hb1 = await hb({
  events: [
    ev("boot", 600, "0.4.0"),
    ev("press", 500, "button"),
    ev("clip_ok", 490),
    ev("press", 300, "button"),
    ev("clip_fail", 290, "buffer ainda frio"),
    ev("press", 100, "button"),
    ev("clip_ok", 90),
    { type: "hack", at: new Date().toISOString() },
    { type: "press", at: "2001-01-01T00:00:00Z" },
  ],
});
check("heartbeat grava só eventos válidos", hb1.status === 200 && hb1.json.events === 7, JSON.stringify(hb1.json));

const devs = await A(`/devices?venue=${venueId}`);
const d0 = devs.json.devices.find((d) => d.id === dev.id);
check("painel: apertos/clips 7d", d0?.press_7d === 3 && d0?.clip_ok_7d === 2 && d0?.clip_fail_7d === 1, JSON.stringify(d0));
check("last_payload sem a lista de eventos", d0 && !("events" in (d0.last_payload ?? {})));

const evs = await A(`/devices/${dev.id}/events`);
check("linha do tempo do device", evs.status === 200 && evs.json.events?.length === 7 && evs.json.events[0].type === "clip_ok");

/* ---------------------------------------------------------------- alertas */

await hb({ button_alive: false, queue_len: 5 });
const run1 = await cron("*/5 * * * *");
check("cron de alertas roda", run1.status === 200);
const a1 = await A(`/devices/${dev.id}/events`);
const openKinds = a1.json.alerts.filter((a) => !a.resolved_at).map((a) => a.kind).sort();
check("abre alertas botão e fila", JSON.stringify(openKinds) === '["button","queue"]', JSON.stringify(openKinds));

await cron("*/5 * * * *");
const a2 = await A(`/devices/${dev.id}/events`);
check("segundo cron não duplica", a2.json.alerts.length === 2);

await hb();
await cron("*/5 * * * *");
const a3 = await A(`/devices/${dev.id}/events`);
check("estado bom resolve os alertas", a3.json.alerts.every((a) => a.resolved_at), JSON.stringify(a3.json.alerts));

sql(`UPDATE devices SET last_seen_at = datetime('now', '-20 minutes') WHERE id = '${dev.id}'`);
await cron("*/5 * * * *");
const a4 = await A(`/devices/${dev.id}/events`);
const off = a4.json.alerts.find((a) => a.kind === "offline");
check("device sem sinal há 20 min → alerta offline", off && !off.resolved_at, off?.detail);

await hb();
await cron("*/5 * * * *");
const a5 = await A(`/devices/${dev.id}/events`);
check("voltou → offline resolvido", a5.json.alerts.find((a) => a.kind === "offline")?.resolved_at);

await A(`/devices/${other.id}/revoke`, { method: "POST", body: {} });
const daily = await cron("0 9 * * *");
check("cron diário (retenção, faturas, resumo) roda", daily.status === 200);

console.log(failures ? `\n${failures} falha(s)` : "\ntudo ok");
process.exit(failures ? 1 : 0);
