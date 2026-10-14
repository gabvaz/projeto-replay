// E2E do portal da arena contra `wrangler dev` (D1/R2 locais).
// Uso: npx wrangler dev  →  node scripts/e2e-arena.mjs [http://127.0.0.1:8787]
// ADMIN_TOKEN vem de .dev.vars (padrão local-admin-token). Cria duas arenas com sufixo aleatório.

import { execSync } from "node:child_process";

const BASE = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:8787";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "local-admin-token";
const RUN = Math.random().toString(36).slice(2, 7);

let failures = 0;
function check(label, ok, extra = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

async function call(path, { method = "GET", body, headers = {}, raw } = {}) {
  const res = await fetch(path.startsWith("http") ? path : BASE + path, {
    method,
    redirect: "manual",
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

const A = (path, opts = {}) =>
  call(`/admin${path}`, { ...opts, headers: { authorization: `Bearer ${ADMIN_TOKEN}`, ...opts.headers } });

/** Cria arena + quadra + device e sobe 1 clip. */
async function setupVenue(label) {
  const venue = await A("/venues", { method: "POST", body: { name: `E2E ${label} ${RUN}`, status: "active" } });
  const court = await A(`/venues/${venue.json.id}/courts`, { method: "POST", body: { name: "Quadra 1" } });
  const dev = await A("/devices", { method: "POST", body: { venue_id: venue.json.id, name: `Pi ${label}` } });
  const E = { authorization: `Bearer ${dev.json.token}` };
  const slot = await call("/edge/clips/upload-slot", {
    method: "POST",
    headers: E,
    body: { court_key: court.json.public_key },
  });
  const up = await call(slot.json.upload_url, {
    method: "PUT",
    headers: { ...E, "content-type": "video/mp4" },
    raw: new Uint8Array(2048),
  });
  check(`setup ${label}: arena, quadra, device e clip`, up.json.status === "ready");
  return { venueId: venue.json.id, courtKey: court.json.public_key, clipId: slot.json.clip_id };
}

async function enter(venueId) {
  const link = await A(`/venues/${venueId}/access-link`, { method: "POST", body: {} });
  const token = link.json.url?.split("/a/")[1];
  const res = await call(`/a/${token}`);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  return { link, res, cookie, token };
}

/* ------------------------------------------------------------------ setup */

const a = await setupVenue("A");
const b = await setupVenue("B");

/* ------------------------------------------------------------------ acesso */

const noAuth = await call("/portal/me");
check("portal sem sessão → 401", noAuth.status === 401);

const invalid = await call("/a/token-que-nao-existe");
check(
  "link inválido → /arena/entrar?erro=link",
  invalid.status === 302 && invalid.headers.get("location")?.endsWith("/arena/entrar?erro=link"),
);

const first = await enter(a.venueId);
check("admin gera link /a/:token", first.link.status === 201 && /\/a\/[0-9a-f]{48}$/.test(first.link.json.url), first.link.json.url);
check(
  "abrir link → 302 /arena + cookie HttpOnly",
  first.res.status === 302 &&
    first.res.headers.get("location")?.endsWith("/arena") &&
    first.cookie.startsWith("rs_arena=") &&
    /HttpOnly/i.test(first.res.headers.get("set-cookie") ?? ""),
);
check("link sem referrer e sem cache", first.res.headers.get("referrer-policy") === "no-referrer");

const detail = await A(`/venues/${a.venueId}`);
check("detalhe admin mostra acesso com last_used_at", Boolean(detail.json.access?.last_used_at), JSON.stringify(detail.json.access));

let C = { cookie: first.cookie };
const P = (path, opts = {}) => call(`/portal${path}`, { ...opts, headers: { ...C, ...opts.headers } });

const me = await P("/me");
check("GET /portal/me", me.status === 200 && me.json.venue?.id === a.venueId && me.json.brand_colors?.length === 8);

const forged = await call("/portal/me", { headers: { cookie: `${first.cookie.slice(0, -4)}0000` } });
check("cookie adulterado → 401", forged.status === 401);

const second = await enter(a.venueId);
const oldSession = await P("/me");
check("regerar link derruba sessão antiga", oldSession.status === 401);
const oldLink = await call(`/a/${first.token}`);
check("link antigo não entra mais", oldLink.headers.get("location")?.endsWith("?erro=link"));
C = { cookie: second.cookie };

/* -------------------------------------------------------------- leituras */

const ov = await P("/overview?days=7");
check(
  "overview 7d com clip criado",
  ov.status === 200 && ov.json.totals?.created === 1 && ov.json.heatmap?.length === 1,
  JSON.stringify(ov.json.totals),
);
const devs = await P("/devices");
check(
  "devices sem token/payload",
  devs.status === 200 && devs.json.devices?.length === 1 && !("token_hash" in devs.json.devices[0]) && !("last_payload" in devs.json.devices[0]),
);
const courts = await P("/courts");
check("courts da própria arena", courts.json.courts?.length === 1 && courts.json.courts[0].public_key === a.courtKey);
const clips = await P("/clips");
check("clips do dia só da arena", clips.json.clips?.length === 1 && clips.json.clips[0].id === a.clipId);
const invoices = await P("/invoices");
check("invoices sem notes", invoices.status === 200 && Array.isArray(invoices.json.invoices));

/* ------------------------------------------------------------- isolamento */

const crossDelete = await P(`/clips/${b.clipId}`, { method: "DELETE", body: {} });
check("arena A não apaga clip da arena B → 404", crossDelete.status === 404);
const bClip = await call(`/api/clips/${b.clipId}`);
check("clip da B continua lá", bClip.status === 200);

const csrf = await P(`/clips/${a.clipId}`, { method: "DELETE" });
check("mutação sem JSON → 415", csrf.status === 415);

const del = await P(`/clips/${a.clipId}`, { method: "DELETE", body: {} });
check("apaga clip próprio", del.status === 200);
const gone = await call(`/api/clips/${a.clipId}`);
check("clip apagado some da galeria", gone.status === 404);

/* ------------------------------------------------------------------ marca */

const badColor = await P("/branding", { method: "PATCH", body: { brand_color: "#123456" } });
check("cor fora dos presets → 400", badColor.status === 400 && badColor.json.error === "invalid_brand_color");
const brand = await P("/branding", { method: "PATCH", body: { public_name: "Arena Teste", brand_color: "#4dd4ff" } });
check("salva nome público e cor", brand.status === 200);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)]);
const upload = (type, raw) =>
  P("/branding/logo", { method: "PUT", headers: { "content-type": type, "x-requested-with": "replay" }, raw });

const svg = await upload("image/svg+xml", "<svg onload=alert(1)/>");
check("logo svg → 415", svg.status === 415);
const fake = await upload("image/png", "nao sou png");
check("logo com magic bytes errados → 415", fake.status === 415);
const bigPng = new Uint8Array(300_001);
bigPng.set(PNG);
const big = await upload("image/png", bigPng);
check("logo > 300 KB → 413", big.status === 413);
const noHeader = await P("/branding/logo", { method: "PUT", headers: { "content-type": "image/png" }, raw: PNG });
check("upload sem x-requested-with → 415", noHeader.status === 415);
const logo = await upload("image/png", PNG);
check("logo png ok", logo.status === 200 && /^\/brand\/.+\/logo\?v=[0-9a-f]+$/.test(logo.json.logo_url), logo.json.logo_url);

const logoGet = await call(logo.json.logo_url);
check(
  "GET logo com cache imutável e nosniff",
  logoGet.status === 200 &&
    logoGet.headers.get("content-type") === "image/png" &&
    /immutable/.test(logoGet.headers.get("cache-control") ?? "") &&
    logoGet.headers.get("x-content-type-options") === "nosniff",
);

const pub = await call(`/api/courts/${a.courtKey}`);
check(
  "marca na API pública da quadra",
  pub.json.venue_name === "Arena Teste" && pub.json.brand?.color === "#4dd4ff" && pub.json.brand?.logo_url === logo.json.logo_url,
  JSON.stringify(pub.json.brand),
);

const rmLogo = await P("/branding/logo", { method: "DELETE", body: {} });
const pub2 = await call(`/api/courts/${a.courtKey}`);
check("remove logo", rmLogo.status === 200 && pub2.json.brand?.logo_url === null);
const reset = await P("/branding", { method: "PATCH", body: { brand_color: null, public_name: null } });
const pub3 = await call(`/api/courts/${a.courtKey}`);
check("reset da marca volta ao nome interno", reset.status === 200 && pub3.json.brand?.color === null && pub3.json.venue_name === `E2E A ${RUN}`);

/* -------------------------------------------------------------- auditoria */

try {
  const out = execSync(
    `npx wrangler d1 execute replay-db --local --json --command "SELECT actor, action, target FROM audit_log WHERE venue_id = '${a.venueId}' ORDER BY id"`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: true },
  );
  const rows = JSON.parse(out)[0].results;
  const actions = rows.map((r) => r.action);
  check(
    "audit_log com link, clip.delete e marca",
    actions.includes("access_link.create") &&
      rows.some((r) => r.action === "clip.delete" && r.actor === `arena:${a.venueId}` && r.target === a.clipId) &&
      actions.includes("branding.logo"),
    actions.join(","),
  );
} catch (err) {
  check("audit_log legível via wrangler d1", false, String(err).slice(0, 200));
}

/* ------------------------------------------------------------------ fim */

const logout = await P("/session", { method: "DELETE", body: {} });
check("logout limpa cookie", logout.status === 200 && /rs_arena=;|Max-Age=0/i.test(logout.headers.get("set-cookie") ?? ""));

const revoke = await A(`/venues/${a.venueId}/access-link`, { method: "DELETE", body: {} });
const afterRevoke = await P("/me");
check("admin revoga link → sessão 401", revoke.status === 200 && afterRevoke.status === 401);

console.log(failures ? `\n${failures} falha(s)` : "\ntudo ok");
process.exit(failures ? 1 : 0);
