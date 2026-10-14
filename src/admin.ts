import { Hono } from "hono";
import { checkAdminToken, endSession, startSession } from "./auth";
import {
  activeContractStmt,
  audit,
  byType,
  cents,
  clipsForDay,
  courtsStmt,
  deleteClip,
  devicesStmt,
  ensureInvoices,
  invoicesStmt,
  isDate,
  oneOf,
  offlineWindow,
  readBody,
  seriesStartUtc,
  seriesStmt,
  text,
  totalsStmt,
  withDeviceStatus,
  withInvoiceStatus,
  type Row,
} from "./queries";
import { brtDayStartUtc, randomHex, sha256Hex, todayBrt, type Env } from "./lib";

export { ensureInvoices, payloadIssues } from "./queries";

export const admin = new Hono<Env>();

const VENUE_STATUS = ["onboarding", "active", "paused", "churned"] as const;
const EQUIPMENT_KINDS = ["camera", "pi", "switch", "esp32", "button", "adapter", "other"] as const;
const EQUIPMENT_STATUS = ["stock", "installed", "maintenance", "lost", "retired"] as const;

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 14);
}

/* ---------------------------------------------------------------- sessão */

admin.post("/session", async (c) => {
  if (!c.req.header("content-type")?.includes("application/json")) {
    return c.json({ error: "json_required" }, 415);
  }
  const body = await readBody<{ token: string }>(c);
  if (typeof body.token !== "string" || !(await checkAdminToken(c.env, body.token))) {
    return c.json({ error: "invalid_token" }, 401);
  }
  const exp = await startSession(c);
  return c.json({ ok: true, exp });
});

admin.get("/session", (c) => c.json({ ok: true, exp: c.get("sessionExp") ?? null }));

admin.delete("/session", (c) => {
  endSession(c);
  return c.json({ ok: true });
});

/* -------------------------------------------------------------- overview */

admin.get("/overview", async (c) => {
  await ensureInvoices(c.env.DB);
  const db = c.env.DB;
  const today = todayBrt();
  const todayStart = brtDayStartUtc(today);
  const seriesStart = seriesStartUtc(30);
  const offline = offlineWindow(c.env);

  const [venues, devices, events30, eventsToday, created7, uniques, series, mrr, invoices, alertsDev, overdueList, top] =
    await db.batch([
      db.prepare("SELECT status, COUNT(*) AS n FROM venues GROUP BY status"),
      db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN d.last_seen_at > datetime('now', ?) THEN 1 ELSE 0 END) AS online
           FROM devices d JOIN venues v ON v.id = d.venue_id
           WHERE d.revoked_at IS NULL AND v.status IN ('active', 'onboarding')`,
        )
        .bind(offline),
      db
        .prepare(
          `SELECT type, COUNT(*) AS n FROM clip_events
           WHERE created_at >= datetime('now', '-30 days') GROUP BY type`,
        ),
      db
        .prepare("SELECT type, COUNT(*) AS n FROM clip_events WHERE created_at >= ? GROUP BY type")
        .bind(todayStart),
      db.prepare(
        `SELECT COUNT(*) AS n FROM clip_events
         WHERE type = 'created' AND created_at >= datetime('now', '-7 days')`,
      ),
      db.prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT DISTINCT date(created_at, '-3 hours'), ip_hash FROM clip_events
           WHERE type != 'created' AND ip_hash IS NOT NULL
             AND created_at >= datetime('now', '-30 days'))`,
      ),
      db
        .prepare(
          `SELECT date(created_at, '-3 hours') AS day,
                  SUM(type = 'created') AS clips, SUM(type = 'view') AS views,
                  SUM(type = 'download') AS downloads, SUM(type = 'share') AS shares
           FROM clip_events WHERE created_at >= ? GROUP BY day ORDER BY day`,
        )
        .bind(seriesStart),
      db
        .prepare(
          `SELECT COALESCE(SUM(c.monthly_cents), 0) AS cents, COUNT(*) AS n
           FROM contracts c JOIN venues v ON v.id = c.venue_id
           WHERE v.status = 'active' AND c.start_date <= ? AND (c.end_date IS NULL OR c.end_date >= ?)`,
        )
        .bind(today, today),
      db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN status = 'open' THEN amount_cents END), 0) AS open_cents,
             COALESCE(SUM(CASE WHEN status = 'open' AND due_date < ? THEN amount_cents END), 0) AS overdue_cents,
             COALESCE(SUM(CASE WHEN status = 'open' AND due_date < ? THEN 1 END), 0) AS overdue_count,
             COALESCE(SUM(CASE WHEN status = 'paid' AND period = ? THEN amount_cents END), 0) AS paid_month_cents,
             COALESCE(SUM(CASE WHEN status != 'void' AND period = ? THEN amount_cents END), 0) AS due_month_cents
           FROM invoices`,
        )
        .bind(today, today, today.slice(0, 7), today.slice(0, 7)),
      db
        .prepare(
          `SELECT d.id, d.name, d.venue_id, v.name AS venue_name, d.last_seen_at, d.last_payload,
                  CASE WHEN d.last_seen_at > datetime('now', ?) THEN 1 ELSE 0 END AS online
           FROM devices d JOIN venues v ON v.id = d.venue_id
           WHERE d.revoked_at IS NULL AND v.status IN ('active', 'onboarding')`,
        )
        .bind(offline),
      db
        .prepare(
          `SELECT i.id, i.venue_id, v.name AS venue_name, i.period, i.amount_cents, i.due_date
           FROM invoices i JOIN venues v ON v.id = i.venue_id
           WHERE i.status = 'open' AND i.due_date < ? ORDER BY i.due_date LIMIT 20`,
        )
        .bind(today),
      db.prepare(
        `SELECT e.venue_id, v.name AS venue_name,
                SUM(e.type = 'created') AS clips, SUM(e.type = 'view') AS views,
                SUM(e.type = 'download') AS downloads, SUM(e.type = 'share') AS shares
         FROM clip_events e JOIN venues v ON v.id = e.venue_id
         WHERE e.created_at >= datetime('now', '-30 days')
         GROUP BY e.venue_id ORDER BY clips DESC LIMIT 10`,
      ),
    ]);

  const ev30 = byType(events30.results as Row[]);
  const evToday = byType(eventsToday.results as Row[]);
  const dev = (devices.results[0] ?? {}) as Row;

  const alerts: Row[] = [];
  for (const d of (alertsDev.results as Row[]).map(withDeviceStatus)) {
    if (!d.online) {
      alerts.push({ kind: "device_offline", severity: "high", venue_id: d.venue_id, venue_name: d.venue_name, device: d.name, since: d.last_seen_at });
    }
    for (const issue of d.issues as string[]) {
      alerts.push({ kind: "device_health", severity: "medium", venue_id: d.venue_id, venue_name: d.venue_name, device: d.name, detail: issue });
    }
  }
  for (const i of overdueList.results as Row[]) {
    alerts.push({ kind: "invoice_overdue", severity: "medium", venue_id: i.venue_id, venue_name: i.venue_name, period: i.period, amount_cents: i.amount_cents, due_date: i.due_date });
  }

  return c.json({
    today,
    venues: Object.fromEntries((venues.results as Row[]).map((r) => [String(r.status), Number(r.n)])),
    devices: { total: Number(dev.total ?? 0), online: Number(dev.online ?? 0) },
    clips: { today: evToday.created ?? 0, d7: Number((created7.results[0] as Row)?.n ?? 0), d30: ev30.created ?? 0 },
    engagement30: {
      views: ev30.view ?? 0,
      downloads: ev30.download ?? 0,
      shares: ev30.share ?? 0,
      unique_daily_visitors: Number((uniques.results[0] as Row)?.n ?? 0),
    },
    series: series.results,
    finance: { mrr_cents: Number((mrr.results[0] as Row)?.cents ?? 0), contracts: Number((mrr.results[0] as Row)?.n ?? 0), ...(invoices.results[0] as Row) },
    alerts,
    top_venues: top.results,
  });
});

/* ---------------------------------------------------------------- arenas */

admin.get("/venues", async (c) => {
  const today = todayBrt();
  const { results } = await c.env.DB.prepare(
    `SELECT v.*,
       (SELECT COUNT(*) FROM courts co WHERE co.venue_id = v.id) AS courts,
       (SELECT COUNT(*) FROM devices d WHERE d.venue_id = v.id AND d.revoked_at IS NULL) AS devices,
       (SELECT COUNT(*) FROM devices d WHERE d.venue_id = v.id AND d.revoked_at IS NULL
          AND d.last_seen_at > datetime('now', ?)) AS devices_online,
       (SELECT COUNT(*) FROM clip_events e WHERE e.venue_id = v.id AND e.type = 'created'
          AND e.created_at >= datetime('now', '-7 days')) AS clips_7d,
       (SELECT COUNT(*) FROM clip_events e WHERE e.venue_id = v.id AND e.type = 'view'
          AND e.created_at >= datetime('now', '-7 days')) AS views_7d,
       (SELECT monthly_cents FROM contracts ct WHERE ct.venue_id = v.id
          AND (ct.end_date IS NULL OR ct.end_date >= ?) ORDER BY ct.start_date DESC LIMIT 1) AS monthly_cents,
       (SELECT COUNT(*) FROM invoices i WHERE i.venue_id = v.id AND i.status = 'open'
          AND i.due_date < ?) AS overdue_count,
       (SELECT COUNT(*) FROM equipment eq WHERE eq.venue_id = v.id) AS equipment
     FROM venues v ORDER BY v.name`,
  )
    .bind(offlineWindow(c.env), today, today)
    .all();
  return c.json({ venues: results });
});

type VenueBody = {
  name: string;
  city: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  status: string;
  notes: string;
};

admin.post("/venues", async (c) => {
  const body = await readBody<VenueBody>(c);
  const name = text(body.name, 80);
  if (!name) return c.json({ error: "name_required" }, 400);
  const id = `v_${randomHex(6)}`;
  await c.env.DB.prepare(
    `INSERT INTO venues (id, name, city, contact_name, contact_phone, contact_email, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      name,
      text(body.city, 80),
      text(body.contact_name, 80),
      text(body.contact_phone, 40),
      text(body.contact_email, 120),
      oneOf(VENUE_STATUS, body.status) ?? "onboarding",
      text(body.notes, 2000),
    )
    .run();
  return c.json({ id }, 201);
});

admin.patch("/venues/:id", async (c) => {
  const body = await readBody<VenueBody>(c);
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    values.push(v);
  };

  if ("name" in body) {
    const name = text(body.name, 80);
    if (!name) return c.json({ error: "name_required" }, 400);
    set("name", name);
  }
  if ("status" in body) {
    const status = oneOf(VENUE_STATUS, body.status);
    if (!status) return c.json({ error: "invalid_status" }, 400);
    set("status", status);
  }
  for (const [col, max] of [["city", 80], ["contact_name", 80], ["contact_phone", 40], ["contact_email", 120], ["notes", 2000]] as const) {
    if (col in body) set(col, text(body[col], max));
  }
  if (!sets.length) return c.json({ error: "nothing_to_update" }, 400);

  const result = await c.env.DB.prepare(`UPDATE venues SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values, c.req.param("id"))
    .run();
  if (!result.meta.changes) return c.json({ error: "venue_not_found" }, 404);
  return c.json({ ok: true });
});

admin.get("/venues/:id", async (c) => {
  await ensureInvoices(c.env.DB);
  const db = c.env.DB;
  const id = c.req.param("id");

  const venue = await db.prepare("SELECT * FROM venues WHERE id = ?").bind(id).first();
  if (!venue) return c.json({ error: "venue_not_found" }, 404);

  const [courts, devices, equipment, contract, invoices, totals, series, access] = await db.batch([
    courtsStmt(db, id),
    devicesStmt(db, c.env, id),
    db
      .prepare(
        `SELECT eq.*, co.name AS court_name FROM equipment eq
         LEFT JOIN courts co ON co.id = eq.court_id
         WHERE eq.venue_id = ? ORDER BY eq.kind, eq.model`,
      )
      .bind(id),
    activeContractStmt(db, id),
    invoicesStmt(db, id),
    totalsStmt(db, id),
    seriesStmt(db, id),
    db
      .prepare(
        `SELECT created_at, last_used_at FROM venue_access_links
         WHERE venue_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(id),
  ]);

  return c.json({
    venue,
    courts: courts.results,
    devices: (devices.results as Row[]).map(withDeviceStatus),
    equipment: equipment.results,
    contract: contract.results[0] ?? null,
    invoices: (invoices.results as Row[]).map(withInvoiceStatus),
    totals30: byType(totals.results as Row[]),
    series: series.results,
    access: access.results[0] ?? null,
  });
});

/* --------------------------------------------------- acesso da arena */

/** Gera link do portal (revoga o anterior). O token só aparece nesta resposta. */
admin.post("/venues/:id/access-link", async (c) => {
  const venueId = c.req.param("id");
  const venue = await c.env.DB.prepare("SELECT 1 FROM venues WHERE id = ?").bind(venueId).first();
  if (!venue) return c.json({ error: "venue_not_found" }, 404);

  const id = `al_${randomHex(6)}`;
  const token = randomHex(24);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE venue_access_links SET revoked_at = datetime('now') WHERE venue_id = ? AND revoked_at IS NULL",
    ).bind(venueId),
    c.env.DB.prepare("INSERT INTO venue_access_links (id, venue_id, token_hash) VALUES (?, ?, ?)").bind(
      id,
      venueId,
      await sha256Hex(token),
    ),
    audit(c.env.DB, "admin", "access_link.create", id, venueId),
  ]);
  return c.json({ id, url: `${new URL(c.req.url).origin}/a/${token}` }, 201);
});

admin.delete("/venues/:id/access-link", async (c) => {
  const venueId = c.req.param("id");
  const [result] = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE venue_access_links SET revoked_at = datetime('now') WHERE venue_id = ? AND revoked_at IS NULL",
    ).bind(venueId),
    audit(c.env.DB, "admin", "access_link.revoke", null, venueId),
  ]);
  if (!result.meta.changes) return c.json({ error: "access_link_not_found" }, 404);
  return c.json({ ok: true });
});

/* ---------------------------------------------------------------- quadras */

async function uniquePublicKey(db: D1Database, base: string): Promise<string> {
  let key = base || `q${randomHex(3)}`;
  for (let i = 0; i < 5; i++) {
    const hit = await db.prepare("SELECT 1 FROM courts WHERE public_key = ?").bind(key).first();
    if (!hit) return key;
    key = `${base}${randomHex(2)}`;
  }
  return `${base}${randomHex(4)}`;
}

const PUBLIC_KEY_RE = /^[a-z0-9-]{3,32}$/;

admin.post("/venues/:id/courts", async (c) => {
  const body = await readBody<{ name: string; public_key: string }>(c);
  const name = text(body.name, 60);
  if (!name) return c.json({ error: "name_required" }, 400);

  const venue = await c.env.DB.prepare("SELECT name FROM venues WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ name: string }>();
  if (!venue) return c.json({ error: "venue_not_found" }, 404);

  let publicKey: string;
  if (body.public_key !== undefined) {
    if (typeof body.public_key !== "string" || !PUBLIC_KEY_RE.test(body.public_key)) {
      return c.json({ error: "invalid_public_key" }, 400);
    }
    const hit = await c.env.DB.prepare("SELECT 1 FROM courts WHERE public_key = ?").bind(body.public_key).first();
    if (hit) return c.json({ error: "public_key_taken" }, 409);
    publicKey = body.public_key;
  } else {
    publicKey = await uniquePublicKey(c.env.DB, `${slug(venue.name).slice(0, 10)}${slug(name).slice(0, 8)}`);
  }

  const id = `c_${randomHex(6)}`;
  await c.env.DB.prepare("INSERT INTO courts (id, venue_id, name, public_key) VALUES (?, ?, ?, ?)")
    .bind(id, c.req.param("id"), name, publicKey)
    .run();
  return c.json({ id, public_key: publicKey }, 201);
});

admin.patch("/courts/:id", async (c) => {
  const body = await readBody<{ name: string; public_key: string }>(c);
  const sets: string[] = [];
  const values: unknown[] = [];
  if ("name" in body) {
    const name = text(body.name, 60);
    if (!name) return c.json({ error: "name_required" }, 400);
    sets.push("name = ?");
    values.push(name);
  }
  if ("public_key" in body) {
    if (typeof body.public_key !== "string" || !PUBLIC_KEY_RE.test(body.public_key)) {
      return c.json({ error: "invalid_public_key" }, 400);
    }
    const hit = await c.env.DB.prepare("SELECT 1 FROM courts WHERE public_key = ? AND id != ?")
      .bind(body.public_key, c.req.param("id"))
      .first();
    if (hit) return c.json({ error: "public_key_taken" }, 409);
    sets.push("public_key = ?");
    values.push(body.public_key);
  }
  if (!sets.length) return c.json({ error: "nothing_to_update" }, 400);

  const result = await c.env.DB.prepare(`UPDATE courts SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values, c.req.param("id"))
    .run();
  if (!result.meta.changes) return c.json({ error: "court_not_found" }, 404);
  return c.json({ ok: true });
});

/* ----------------------------------------------------------- dispositivos */

/** Cadastra um Pi e devolve o token UMA vez (só o hash fica salvo). */
admin.post("/devices", async (c) => {
  const body = await readBody<{ venue_id: string; name: string; kind: string }>(c);
  const name = text(body.name, 60);
  if (!body.venue_id || !name) return c.json({ error: "venue_id_and_name_required" }, 400);

  const venue = await c.env.DB.prepare("SELECT id FROM venues WHERE id = ?").bind(body.venue_id).first();
  if (!venue) return c.json({ error: "venue_not_found" }, 404);

  const id = crypto.randomUUID();
  const token = `dev_${randomHex(32)}`;
  await c.env.DB.prepare(
    "INSERT INTO devices (id, venue_id, kind, name, token_hash) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, body.venue_id, text(body.kind, 20) ?? "pi", name, await sha256Hex(token))
    .run();

  return c.json({ id, venue_id: body.venue_id, name, token }, 201);
});

admin.get("/devices", async (c) => {
  const venue = c.req.query("venue");
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.venue_id, v.name AS venue_name, d.kind, d.name, d.agent_version,
            d.last_seen_at, d.last_payload, d.revoked_at, d.created_at,
            CASE WHEN d.last_seen_at > datetime('now', ?) THEN 1 ELSE 0 END AS online
     FROM devices d JOIN venues v ON v.id = d.venue_id
     WHERE (? IS NULL OR d.venue_id = ?)
     ORDER BY d.revoked_at IS NOT NULL, v.name, d.name`,
  )
    .bind(offlineWindow(c.env), venue ?? null, venue ?? null)
    .all<Row>();
  return c.json({ devices: results.map(withDeviceStatus) });
});

admin.post("/devices/:id/revoke", async (c) => {
  const result = await c.env.DB.prepare(
    "UPDATE devices SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL",
  )
    .bind(c.req.param("id"))
    .run();
  if (!result.meta.changes) return c.json({ error: "device_not_found" }, 404);
  return c.json({ ok: true });
});

/* ----------------------------------------------------------- equipamentos */

type EquipmentBody = {
  kind: string;
  model: string;
  serial: string;
  cost_cents: number;
  status: string;
  venue_id: string | null;
  court_id: string | null;
  device_id: string | null;
  notes: string;
  event_note: string;
};

admin.get("/equipment", async (c) => {
  const { status, venue, kind } = c.req.query();
  const { results } = await c.env.DB.prepare(
    `SELECT eq.*, v.name AS venue_name, co.name AS court_name, d.name AS device_name
     FROM equipment eq
     LEFT JOIN venues v ON v.id = eq.venue_id
     LEFT JOIN courts co ON co.id = eq.court_id
     LEFT JOIN devices d ON d.id = eq.device_id
     WHERE (? IS NULL OR eq.status = ?) AND (? IS NULL OR eq.venue_id = ?) AND (? IS NULL OR eq.kind = ?)
     ORDER BY eq.created_at DESC
     LIMIT 1000`,
  )
    .bind(status ?? null, status ?? null, venue ?? null, venue ?? null, kind ?? null, kind ?? null)
    .all();
  return c.json({ equipment: results });
});

async function checkPlacement(
  db: D1Database,
  venueId: string | null,
  courtId: string | null,
  deviceId: string | null,
): Promise<string | null> {
  if (venueId && !(await db.prepare("SELECT 1 FROM venues WHERE id = ?").bind(venueId).first())) {
    return "venue_not_found";
  }
  if (courtId) {
    const court = await db.prepare("SELECT venue_id FROM courts WHERE id = ?").bind(courtId).first<{ venue_id: string }>();
    if (!court || court.venue_id !== venueId) return "court_not_in_venue";
  }
  if (deviceId) {
    const dev = await db.prepare("SELECT venue_id FROM devices WHERE id = ?").bind(deviceId).first<{ venue_id: string }>();
    if (!dev || dev.venue_id !== venueId) return "device_not_in_venue";
  }
  return null;
}

admin.post("/equipment", async (c) => {
  const body = await readBody<EquipmentBody>(c);
  const kind = oneOf(EQUIPMENT_KINDS, body.kind);
  if (!kind) return c.json({ error: "invalid_kind" }, 400);
  const venueId = text(body.venue_id ?? null, 40);
  const courtId = venueId ? text(body.court_id ?? null, 40) : null;
  const deviceId = venueId ? text(body.device_id ?? null, 40) : null;
  const placementError = await checkPlacement(c.env.DB, venueId, courtId, deviceId);
  if (placementError) return c.json({ error: placementError }, 400);

  const status = oneOf(EQUIPMENT_STATUS, body.status) ?? (venueId ? "installed" : "stock");
  const id = `eq_${randomHex(6)}`;
  const serial = text(body.serial, 80);
  if (serial && (await c.env.DB.prepare("SELECT 1 FROM equipment WHERE serial = ?").bind(serial).first())) {
    return c.json({ error: "serial_taken" }, 409);
  }

  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO equipment (id, kind, model, serial, cost_cents, status, venue_id, court_id, device_id, installed_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      kind,
      text(body.model, 80),
      serial,
      cents(body.cost_cents),
      status,
      venueId,
      courtId,
      deviceId,
      venueId ? todayBrt() : null,
      text(body.notes, 2000),
    ),
  ];
  if (venueId) {
    stmts.push(
      c.env.DB.prepare("INSERT INTO equipment_events (equipment_id, type, venue_id, notes) VALUES (?, 'assigned', ?, ?)")
        .bind(id, venueId, text(body.event_note, 500)),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ id }, 201);
});

admin.patch("/equipment/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readBody<EquipmentBody>(c);
  const current = await c.env.DB.prepare("SELECT * FROM equipment WHERE id = ?")
    .bind(id)
    .first<{ venue_id: string | null; court_id: string | null; device_id: string | null; status: string }>();
  if (!current) return c.json({ error: "equipment_not_found" }, 404);

  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    values.push(v);
  };
  const events: { type: string; venue_id: string | null }[] = [];
  const note = text(body.event_note, 500);

  if ("kind" in body) {
    const kind = oneOf(EQUIPMENT_KINDS, body.kind);
    if (!kind) return c.json({ error: "invalid_kind" }, 400);
    set("kind", kind);
  }
  if ("model" in body) set("model", text(body.model, 80));
  if ("serial" in body) {
    const serial = text(body.serial, 80);
    if (serial) {
      const hit = await c.env.DB.prepare("SELECT 1 FROM equipment WHERE serial = ? AND id != ?").bind(serial, id).first();
      if (hit) return c.json({ error: "serial_taken" }, 409);
    }
    set("serial", serial);
  }
  if ("cost_cents" in body) set("cost_cents", cents(body.cost_cents));
  if ("notes" in body) set("notes", text(body.notes, 2000));

  const venueChanged = "venue_id" in body && (body.venue_id ?? null) !== current.venue_id;
  const venueId = "venue_id" in body ? text(body.venue_id ?? null, 40) : current.venue_id;
  const courtId = "court_id" in body ? text(body.court_id ?? null, 40) : venueChanged ? null : current.court_id;
  const deviceId = "device_id" in body ? text(body.device_id ?? null, 40) : venueChanged ? null : current.device_id;
  if (venueId || courtId || deviceId) {
    const placementError = await checkPlacement(c.env.DB, venueId, courtId, deviceId);
    if (placementError) return c.json({ error: placementError }, 400);
  }

  let status = "status" in body ? oneOf(EQUIPMENT_STATUS, body.status) : current.status;
  if (!status) return c.json({ error: "invalid_status" }, 400);

  if (venueChanged) {
    if (current.venue_id) events.push({ type: "returned", venue_id: current.venue_id });
    if (venueId) {
      events.push({ type: "assigned", venue_id: venueId });
      if (!("status" in body)) status = "installed";
      set("installed_at", todayBrt());
    } else {
      if (!("status" in body)) status = "stock";
      set("installed_at", null);
    }
    set("venue_id", venueId);
  }
  if (venueChanged || "court_id" in body) set("court_id", courtId);
  if (venueChanged || "device_id" in body) set("device_id", deviceId);
  if (status !== current.status) {
    set("status", status);
    if (status === "maintenance") events.push({ type: "maintenance", venue_id: venueId });
  }
  if (!sets.length && !note) return c.json({ error: "nothing_to_update" }, 400);
  if (!events.length && note) events.push({ type: "note", venue_id: venueId });

  const stmts: D1PreparedStatement[] = [];
  if (sets.length) {
    stmts.push(c.env.DB.prepare(`UPDATE equipment SET ${sets.join(", ")} WHERE id = ?`).bind(...values, id));
  }
  for (const e of events) {
    stmts.push(
      c.env.DB.prepare("INSERT INTO equipment_events (equipment_id, type, venue_id, notes) VALUES (?, ?, ?, ?)")
        .bind(id, e.type, e.venue_id, note),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, events: events.map((e) => e.type) });
});

admin.get("/equipment/:id/events", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, v.name AS venue_name FROM equipment_events e
     LEFT JOIN venues v ON v.id = e.venue_id
     WHERE e.equipment_id = ? ORDER BY e.created_at DESC, e.id DESC`,
  )
    .bind(c.req.param("id"))
    .all();
  return c.json({ events: results });
});

/* ------------------------------------------------------------- financeiro */

admin.put("/venues/:id/contract", async (c) => {
  const venueId = c.req.param("id");
  const body = await readBody<{ monthly_cents: number; due_day: number; start_date: string; notes: string }>(c);
  const monthly = cents(body.monthly_cents);
  const dueDay = Number(body.due_day);
  if (monthly === null) return c.json({ error: "invalid_monthly_cents" }, 400);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) return c.json({ error: "invalid_due_day" }, 400);
  if (!isDate(body.start_date)) return c.json({ error: "invalid_start_date" }, 400);

  const venue = await c.env.DB.prepare("SELECT 1 FROM venues WHERE id = ?").bind(venueId).first();
  if (!venue) return c.json({ error: "venue_not_found" }, 404);

  const startPeriod = body.start_date.slice(0, 7);
  const dayBefore = new Date(Date.parse(`${body.start_date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const id = `ct_${randomHex(6)}`;

  await c.env.DB.batch([
    // Contrato anterior encerra na véspera; faturas abertas dele a partir do novo início caem.
    c.env.DB.prepare(
      `DELETE FROM invoices WHERE venue_id = ? AND status = 'open' AND period >= ?`,
    ).bind(venueId, startPeriod),
    c.env.DB.prepare(
      `UPDATE contracts SET end_date = ? WHERE venue_id = ? AND (end_date IS NULL OR end_date >= ?)`,
    ).bind(dayBefore, venueId, body.start_date),
    c.env.DB.prepare(
      `INSERT INTO contracts (id, venue_id, monthly_cents, due_day, start_date, notes) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, venueId, monthly, dueDay, body.start_date, text(body.notes, 2000)),
  ]);
  const generated = (await ensureInvoices(c.env.DB)).filter((v) => v === venueId).length;
  return c.json({ id, generated });
});

admin.delete("/venues/:id/contract", async (c) => {
  const body = await readBody<{ end_date: string }>(c);
  const endDate = isDate(body.end_date) ? body.end_date : todayBrt();
  const result = await c.env.DB.prepare(
    `UPDATE contracts SET end_date = ? WHERE venue_id = ? AND (end_date IS NULL OR end_date >= ?)`,
  )
    .bind(endDate, c.req.param("id"), endDate)
    .run();
  if (!result.meta.changes) return c.json({ error: "contract_not_found" }, 404);
  return c.json({ ok: true, end_date: endDate });
});

admin.get("/invoices", async (c) => {
  await ensureInvoices(c.env.DB);
  const { status, venue } = c.req.query();
  const today = todayBrt();
  const dbStatus = status === "overdue" ? "open" : (status ?? null);
  const { results } = await c.env.DB.prepare(
    `SELECT i.*, v.name AS venue_name FROM invoices i JOIN venues v ON v.id = i.venue_id
     WHERE (? IS NULL OR i.status = ?) AND (? IS NULL OR i.venue_id = ?)
       AND (? = 0 OR i.due_date < ?)
     ORDER BY i.due_date DESC, v.name
     LIMIT 500`,
  )
    .bind(dbStatus, dbStatus, venue ?? null, venue ?? null, status === "overdue" ? 1 : 0, today)
    .all<Row>();
  return c.json({ invoices: results.map(withInvoiceStatus) });
});

admin.post("/invoices/:id/pay", async (c) => {
  const body = await readBody<{ method: string; paid_at: string; notes: string }>(c);
  const paidAt = isDate(body.paid_at) ? body.paid_at : todayBrt();
  const result = await c.env.DB.prepare(
    `UPDATE invoices SET status = 'paid', paid_at = ?, paid_method = ?, notes = COALESCE(?, notes)
     WHERE id = ? AND status = 'open'`,
  )
    .bind(paidAt, text(body.method, 30) ?? "pix", text(body.notes, 500), c.req.param("id"))
    .run();
  if (!result.meta.changes) return c.json({ error: "invoice_not_open" }, 409);
  return c.json({ ok: true });
});

admin.post("/invoices/:id/void", async (c) => {
  const body = await readBody<{ notes: string }>(c);
  const result = await c.env.DB.prepare(
    `UPDATE invoices SET status = 'void', notes = COALESCE(?, notes) WHERE id = ? AND status = 'open'`,
  )
    .bind(text(body.notes, 500), c.req.param("id"))
    .run();
  if (!result.meta.changes) return c.json({ error: "invoice_not_open" }, 409);
  return c.json({ ok: true });
});

/** Desfaz baixa/anulação lançada por engano. */
admin.post("/invoices/:id/reopen", async (c) => {
  const result = await c.env.DB.prepare(
    `UPDATE invoices SET status = 'open', paid_at = NULL, paid_method = NULL WHERE id = ? AND status != 'open'`,
  )
    .bind(c.req.param("id"))
    .run();
  if (!result.meta.changes) return c.json({ error: "invoice_already_open" }, 409);
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ clips */


admin.get("/clips", async (c) => {
  const date = c.req.query("date") ?? todayBrt();
  if (!isDate(date)) return c.json({ error: "invalid_date" }, 400);
  const clips = await clipsForDay(c.env.DB, date, c.req.query("venue") ?? null);
  return c.json({ date, clips });
});

/** Apaga clip (vídeo + miniatura) no R2 + metadados no D1. Takedown/LGPD. */
admin.delete("/clips/:clipId", async (c) => {
  const clipId = c.req.param("clipId");
  const venue = await c.env.DB.prepare(
    "SELECT co.venue_id FROM clips cl JOIN courts co ON co.id = cl.court_id WHERE cl.id = ?",
  )
    .bind(clipId)
    .first<{ venue_id: string }>();
  if (!(await deleteClip(c.env, clipId))) return c.json({ error: "clip_not_found" }, 404);
  await audit(c.env.DB, "admin", "clip.delete", clipId, venue?.venue_id ?? null).run();
  return c.json({ ok: true, clip_id: clipId, deleted: true });
});