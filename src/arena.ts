import { Hono } from "hono";
import { endArenaSession } from "./auth";
import { randomHex, todayBrt, type Env } from "./lib";
import {
  activeContractStmt,
  audit,
  BRAND_COLORS,
  brandOf,
  byType,
  clipsForDay,
  courtsStmt,
  deleteClip,
  devicesStmt,
  ensureInvoices,
  invoicesStmt,
  isDate,
  oneOf,
  readBody,
  seriesStartUtc,
  seriesStmt,
  text,
  totalsStmt,
  withInvoiceStatus,
  type Row,
} from "./queries";

/** API do portal da arena (/portal). Todo SQL filtra pelo venueId da sessão. */
export const arena = new Hono<Env>();

const LOGO_MAX_BYTES = 300_000;
const LOGO_TYPES: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) =>
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
};

const actor = (venueId: string) => `arena:${venueId}`;

arena.get("/me", async (c) => {
  const venueId = c.get("venueId");
  const db = c.env.DB;
  const [venue, contract, overdue] = await db.batch([
    db
      .prepare(
        `SELECT id, name, city, public_name, brand_color, logo_key, status, created_at
         FROM venues WHERE id = ?`,
      )
      .bind(venueId),
    activeContractStmt(db, venueId),
    db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM invoices
         WHERE venue_id = ? AND status = 'open' AND due_date < ?`,
      )
      .bind(venueId, todayBrt()),
  ]);
  const v = venue.results[0] as Row | undefined;
  if (!v) return c.json({ error: "venue_not_found" }, 404);
  const ct = contract.results[0] as Row | undefined;
  const { logo_key: _logo, ...rest } = v;
  return c.json({
    venue: rest,
    brand: brandOf(v),
    brand_colors: BRAND_COLORS,
    contract: ct ? { monthly_cents: ct.monthly_cents, due_day: ct.due_day, start_date: ct.start_date } : null,
    overdue: overdue.results[0],
    support_whatsapp: c.env.SUPPORT_WHATSAPP || null,
    today: todayBrt(),
  });
});

arena.get("/overview", async (c) => {
  const venueId = c.get("venueId");
  const days = oneOf(["7", "30", "90"] as const, c.req.query("days")) ?? "30";
  const n = Number(days);
  const db = c.env.DB;
  const start = seriesStartUtc(n);

  const [totals, series, courts, heat, uniques] = await db.batch([
    totalsStmt(db, venueId, n),
    seriesStmt(db, venueId, n),
    db
      .prepare(
        `SELECT co.id, co.name, co.public_key,
                COALESCE(SUM(e.type = 'created'), 0) AS clips, COALESCE(SUM(e.type = 'view'), 0) AS views,
                COALESCE(SUM(e.type = 'download'), 0) AS downloads, COALESCE(SUM(e.type = 'share'), 0) AS shares
         FROM courts co
         LEFT JOIN clip_events e ON e.court_id = co.id AND e.created_at >= ?
         WHERE co.venue_id = ?
         GROUP BY co.id ORDER BY clips DESC, co.name`,
      )
      .bind(start, venueId),
    db
      .prepare(
        `SELECT CAST(strftime('%w', created_at, '-3 hours') AS INTEGER) AS dow,
                CAST(strftime('%H', created_at, '-3 hours') AS INTEGER) AS hour, COUNT(*) AS n
         FROM clip_events WHERE venue_id = ? AND type = 'created' AND created_at >= ?
         GROUP BY dow, hour`,
      )
      .bind(venueId, start),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT DISTINCT date(created_at, '-3 hours'), ip_hash FROM clip_events
           WHERE venue_id = ? AND type != 'created' AND ip_hash IS NOT NULL AND created_at >= ?)`,
      )
      .bind(venueId, start),
  ]);

  return c.json({
    days: n,
    today: todayBrt(),
    totals: byType(totals.results as Row[]),
    unique_daily_visitors: Number((uniques.results[0] as Row)?.n ?? 0),
    series: series.results,
    courts: courts.results,
    heatmap: heat.results,
  });
});

arena.get("/courts", async (c) => {
  const { results } = await courtsStmt(c.env.DB, c.get("venueId")).all();
  return c.json({ courts: results });
});

/** Só o que o dono precisa: online/offline e último clip. Nada de token ou payload técnico. */
arena.get("/devices", async (c) => {
  const venueId = c.get("venueId");
  const db = c.env.DB;
  const [devices, courts] = await db.batch([devicesStmt(db, c.env, venueId), courtsStmt(db, venueId)]);
  return c.json({
    devices: (devices.results as Row[])
      .filter((d) => !d.revoked_at)
      .map((d) => ({ id: d.id, name: d.name, online: Boolean(d.online), last_seen_at: d.last_seen_at })),
    courts: (courts.results as Row[]).map((co) => ({
      id: co.id,
      name: co.name,
      last_clip_at: co.last_clip_at,
      clips_7d: co.clips_7d,
    })),
  });
});

arena.get("/clips", async (c) => {
  const date = c.req.query("date") ?? todayBrt();
  if (!isDate(date)) return c.json({ error: "invalid_date" }, 400);
  const clips = await clipsForDay(c.env.DB, date, c.get("venueId"), c.req.query("court") || null);
  return c.json({ date, clips });
});

arena.delete("/clips/:clipId", async (c) => {
  const venueId = c.get("venueId");
  const clipId = c.req.param("clipId");
  if (!(await deleteClip(c.env, clipId, venueId))) return c.json({ error: "clip_not_found" }, 404);
  await audit(c.env.DB, actor(venueId), "clip.delete", clipId, venueId).run();
  return c.json({ ok: true });
});

arena.get("/invoices", async (c) => {
  await ensureInvoices(c.env.DB);
  const venueId = c.get("venueId");
  const [invoices, contract] = await c.env.DB.batch([
    invoicesStmt(c.env.DB, venueId),
    activeContractStmt(c.env.DB, venueId),
  ]);
  const ct = contract.results[0] as Row | undefined;
  return c.json({
    invoices: (invoices.results as Row[]).map((i) => {
      const { notes: _notes, contract_id: _contract, ...rest } = withInvoiceStatus(i);
      return rest;
    }),
    contract: ct ? { monthly_cents: ct.monthly_cents, due_day: ct.due_day } : null,
  });
});

/* ------------------------------------------------------------------ marca */

arena.patch("/branding", async (c) => {
  const venueId = c.get("venueId");
  const body = await readBody<{ public_name: string | null; brand_color: string | null }>(c);
  const sets: string[] = [];
  const values: unknown[] = [];
  if ("public_name" in body) {
    sets.push("public_name = ?");
    values.push(text(body.public_name, 60));
  }
  if ("brand_color" in body) {
    const color = body.brand_color === null ? null : oneOf(BRAND_COLORS, body.brand_color);
    if (body.brand_color !== null && !color) return c.json({ error: "invalid_brand_color" }, 400);
    sets.push("brand_color = ?");
    values.push(color);
  }
  if (!sets.length) return c.json({ error: "nothing_to_update" }, 400);

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE venues SET ${sets.join(", ")} WHERE id = ?`).bind(...values, venueId),
    audit(c.env.DB, actor(venueId), "branding.update", JSON.stringify(body).slice(0, 200), venueId),
  ]);
  return c.json({ ok: true });
});

/** Corpo cru (png/jpeg/webp). SVG fora: script embutido = XSS servido do nosso domínio. */
arena.put("/branding/logo", async (c) => {
  const venueId = c.get("venueId");
  const type = (c.req.header("content-type") ?? "").split(";")[0].trim();
  const check = LOGO_TYPES[type];
  if (!check) return c.json({ error: "invalid_logo_type" }, 415);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.byteLength) return c.json({ error: "empty_body" }, 400);
  if (bytes.byteLength > LOGO_MAX_BYTES) return c.json({ error: "logo_too_large" }, 413);
  if (!check(bytes)) return c.json({ error: "invalid_logo_type" }, 415);

  const prev = await c.env.DB.prepare("SELECT logo_key FROM venues WHERE id = ?")
    .bind(venueId)
    .first<{ logo_key: string | null }>();
  const key = `brand/${venueId}/logo-${randomHex(4)}`;
  await c.env.CLIPS.put(key, bytes, { httpMetadata: { contentType: type } });
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE venues SET logo_key = ? WHERE id = ?").bind(key, venueId),
    audit(c.env.DB, actor(venueId), "branding.logo", key, venueId),
  ]);
  if (prev?.logo_key) await c.env.CLIPS.delete(prev.logo_key);
  return c.json({ ok: true, logo_url: brandOf({ id: venueId, name: "", logo_key: key }).logo_url });
});

arena.delete("/branding/logo", async (c) => {
  const venueId = c.get("venueId");
  const prev = await c.env.DB.prepare("SELECT logo_key FROM venues WHERE id = ?")
    .bind(venueId)
    .first<{ logo_key: string | null }>();
  if (!prev?.logo_key) return c.json({ error: "logo_not_found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE venues SET logo_key = NULL WHERE id = ?").bind(venueId),
    audit(c.env.DB, actor(venueId), "branding.logo_remove", prev.logo_key, venueId),
  ]);
  await c.env.CLIPS.delete(prev.logo_key);
  return c.json({ ok: true });
});

arena.delete("/session", (c) => {
  endArenaSession(c);
  return c.json({ ok: true });
});
