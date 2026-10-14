// E2E do painel contra `wrangler dev` (D1/R2 locais).
// Uso: npx wrangler dev  →  node scripts/e2e-admin.mjs [http://127.0.0.1:8787]
// ADMIN_TOKEN vem de .dev.vars (padrão local-admin-token). Cria dados com sufixo aleatório.

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
  return { status: res.status, json, headers: res.headers };
}

/* ------------------------------------------------------------------ sessão */

const bad = await call("/admin/session", { method: "POST", body: { token: "errado" } });
check("login com token errado → 401", bad.status === 401);

const noAuth = await call("/admin/overview");
check("overview sem sessão → 401", noAuth.status === 401);

const login = await call("/admin/session", { method: "POST", body: { token: ADMIN_TOKEN } });
const setCookie = login.headers.get("set-cookie") ?? "";
const cookie = setCookie.split(";")[0];
check("login → 200 + cookie HttpOnly", login.status === 200 && /HttpOnly/i.test(setCookie) && cookie.startsWith("rs_admin="));

const C = { cookie };
const session = await call("/admin/session", { headers: C });
check("GET /session com cookie", session.status === 200 && session.json.exp > Date.now() / 1000);

const csrf = await call("/admin/venues", { method: "POST", headers: { ...C, "content-type": "text/plain" }, raw: "{}" });
check("mutação com cookie sem JSON → 415", csrf.status === 415);

const forged = await call("/admin/overview", { headers: { cookie: `${cookie.slice(0, -4)}0000` } });
check("cookie adulterado → 401", forged.status === 401);

const A = (path, opts = {}) => call(`/admin${path}`, { ...opts, headers: { ...C, ...opts.headers } });

/* ------------------------------------------------------------ arena/quadra */

const venue = await A("/venues", { method: "POST", body: { name: `E2E Arena ${RUN}`, city: "Recife/PE", status: "active" } });
check("cria arena", venue.status === 201 && venue.json.id);
const venueId = venue.json.id;

const patch = await A(`/venues/${venueId}`, { method: "PATCH", body: { contact_name: "Fulano", status: "paused" } });
check("edita arena", patch.status === 200);

const court = await A(`/venues/${venueId}/courts`, { method: "POST", body: { name: "Quadra 1" } });
check("cria quadra com public_key automático", court.status === 201 && /^[a-z0-9-]+$/.test(court.json.public_key), court.json.public_key);
const courtKey = court.json.public_key;

const dupKey = await A(`/venues/${venueId}/courts`, { method: "POST", body: { name: "Quadra 2", public_key: courtKey } });
check("public_key repetido → 409", dupKey.status === 409 && dupKey.json.error === "public_key_taken");

const badKey = await A(`/venues/${venueId}/courts`, { method: "POST", body: { name: "Quadra 2", public_key: "A B" } });
check("public_key inválido → 400", badKey.status === 400);

/* ------------------------------------------------------------ dispositivos */

const dev = await A("/devices", { method: "POST", body: { venue_id: venueId, name: "Pi E2E" } });
check("cria dispositivo com token", dev.status === 201 && typeof dev.json.token === "string");
const E = { authorization: `Bearer ${dev.json.token}` };

const hb1 = await call("/edge/heartbeat", { method: "POST", headers: E, body: { agent_version: "e2e-1", temp_c: 50, throttled: "0x0", buffer_alive: true } });
check("1º heartbeat grava histórico", hb1.status === 200 && hb1.json.history === true);
const hb2 = await call("/edge/heartbeat", { method: "POST", headers: E, body: { agent_version: "e2e-1", temp_c: 51, throttled: "0x0", buffer_alive: true } });
check("2º heartbeat igual não grava histórico", hb2.status === 200 && hb2.json.history === false);
const hb3 = await call("/edge/heartbeat", { method: "POST", headers: E, body: { agent_version: "e2e-1", temp_c: 82, throttled: "0x0", buffer_alive: true } });
check("heartbeat com anomalia (82 °C) grava histórico", hb3.status === 200 && hb3.json.history === true);
const hb4 = await call("/edge/heartbeat", { method: "POST", headers: E, body: { agent_version: "e2e-2", temp_c: 50, throttled: "0x0", buffer_alive: true } });
check("heartbeat com versão nova grava histórico", hb4.json.history === true);

const devs = await A(`/devices?venue=${venueId}`);
const d0 = devs.json.devices?.[0];
check("device online com payload", d0?.online === true && d0?.last_payload?.agent_version === "e2e-2");

/* ------------------------------------------------------- upload → created */

const slot = await call("/edge/clips/upload-slot", { method: "POST", headers: E, body: { court_key: courtKey } });
check("upload-slot", slot.status === 200 && slot.json.clip_id);
const up = await call(slot.json.upload_url, {
  method: "PUT",
  headers: { ...E, "content-type": "video/mp4" },
  raw: new Uint8Array(2048),
});
check("upload do conteúdo", up.status === 200 && up.json.status === "ready");

const detail = await A(`/venues/${venueId}`);
check("evento created conta no detalhe", detail.json.totals30?.created === 1, JSON.stringify(detail.json.totals30));
check("quadra com clips_7d = 1", detail.json.courts?.[0]?.clips_7d === 1);

const clips = await A(`/clips?venue=${venueId}`);
check("lista clips do dia", clips.json.clips?.length === 1);
const delClip = await A(`/clips/${slot.json.clip_id}`, { method: "DELETE", body: {} });
check("apaga clip", delClip.status === 200);

/* ----------------------------------------------------------- equipamentos */

const serial = `E2E-${RUN}`;
const eq = await A("/equipment", { method: "POST", body: { kind: "camera", model: "Tapo C320WS", serial, cost_cents: 28990, venue_id: venueId, event_note: "instalação" } });
check("cria equipamento já cedido", eq.status === 201);
const dupSerial = await A("/equipment", { method: "POST", body: { kind: "camera", serial } });
check("série repetida → 409", dupSerial.status === 409);

const ret = await A(`/equipment/${eq.json.id}`, { method: "PATCH", body: { venue_id: null } });
check("devolve ao estoque → evento returned", ret.status === 200 && ret.json.events?.includes("returned"));
const eqList = await A(`/equipment?status=stock`);
check("equipamento volta como estoque", eqList.json.equipment?.some((e) => e.id === eq.json.id && e.venue_id === null));
const maint = await A(`/equipment/${eq.json.id}`, { method: "PATCH", body: { status: "maintenance", event_note: "fonte queimada" } });
check("manutenção → evento", maint.json.events?.includes("maintenance"));
const evs = await A(`/equipment/${eq.json.id}/events`);
check("histórico com 3 eventos", evs.json.events?.length === 3, evs.json.events?.map((e) => e.type).join(","));

/* ------------------------------------------------------------- financeiro */

const now = new Date(Date.now() - 3 * 3600_000);
const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)).toISOString().slice(0, 10);

const contract = await A(`/venues/${venueId}/contract`, { method: "PUT", body: { monthly_cents: 35000, due_day: 10, start_date: startMonth } });
check("contrato retroativo gera 4 faturas", contract.status === 200 && contract.json.generated === 4, JSON.stringify(contract.json));

const again = await A(`/invoices?venue=${venueId}`);
check("GET /invoices não duplica", again.json.invoices?.length === 4);
const overdue = await A(`/invoices?venue=${venueId}&status=overdue`);
check("faturas passadas em atraso", overdue.json.invoices?.length >= 3);

const [inv1, inv2] = overdue.json.invoices.slice().sort((a, b) => a.period.localeCompare(b.period));
const pay = await A(`/invoices/${inv1.id}/pay`, { method: "POST", body: { method: "pix" } });
check("dá baixa", pay.status === 200);
const payAgain = await A(`/invoices/${inv1.id}/pay`, { method: "POST", body: {} });
check("baixa dupla → 409", payAgain.status === 409);
const voided = await A(`/invoices/${inv2.id}/void`, { method: "POST", body: {} });
check("anula", voided.status === 200);
const reopen = await A(`/invoices/${inv2.id}/reopen`, { method: "POST", body: {} });
check("reabre", reopen.status === 200);

const raise = await A(`/venues/${venueId}/contract`, { method: "PUT", body: { monthly_cents: 40000, due_day: 5, start_date: now.toISOString().slice(0, 8) + "01" } });
const afterRaise = await A(`/invoices?venue=${venueId}`);
const current = afterRaise.json.invoices?.find((i) => i.period === now.toISOString().slice(0, 7));
check(
  "reajuste refaz fatura do mês",
  raise.status === 200 && current?.amount_cents === 40000 && afterRaise.json.invoices.length === 4,
  JSON.stringify({ raise: raise.json, invoices: afterRaise.json.invoices?.map((i) => [i.period, i.amount_cents, i.status]) }),
);

const venues = await A("/venues");
const row = venues.json.venues?.find((v) => v.id === venueId);
check("lista de arenas com mensalidade e atraso", row?.monthly_cents === 40000 && row?.overdue_count >= 1, JSON.stringify(row));

await A(`/invoices/${current.id}/pay`, { method: "POST", body: {} });
const raise2 = await A(`/venues/${venueId}/contract`, { method: "PUT", body: { monthly_cents: 45000, due_day: 5, start_date: now.toISOString().slice(0, 8) + "01" } });
const afterRaise2 = await A(`/invoices?venue=${venueId}`);
const current2 = afterRaise2.json.invoices?.find((i) => i.period === current.period);
check(
  "reajuste com mês já pago mantém a fatura paga",
  raise2.json.generated === 0 && current2?.status === "paid" && current2.amount_cents === 40000 && afterRaise2.json.invoices.length === 4,
  JSON.stringify(raise2.json),
);

const end = await A(`/venues/${venueId}/contract`, { method: "DELETE", body: {} });
check("encerra contrato", end.status === 200);

/* --------------------------------------------------------------- overview */

const ov = await A("/overview");
check(
  "overview com KPIs, série e alertas",
  ov.status === 200 && Array.isArray(ov.json.series) && ov.json.alerts?.some((a) => a.venue_id === venueId),
);

/* ------------------------------------------------------------------ fim */

const revoke = await A(`/devices/${dev.json.id}/revoke`, { method: "POST", body: {} });
const revoked = await call("/edge/heartbeat", { method: "POST", headers: E, body: {} });
check("revoga device → edge 401", revoke.status === 200 && revoked.status === 401);

const logout = await call("/admin/session", { method: "DELETE", headers: C, body: {} });
check("logout limpa cookie", logout.status === 200 && /rs_admin=;|Max-Age=0/i.test(logout.headers.get("set-cookie") ?? ""));

console.log(failures ? `\n${failures} falha(s)` : "\ntudo ok");
process.exit(failures ? 1 : 0);
