import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { admin, payloadIssues } from "./admin";
import { adminAuth, edgeAuth } from "./auth";
import { retentionDays, sha256Hex, todayBrt, type Bindings, type Env } from "./lib";

type ClipRow = {
  id: string;
  court_id: string;
  object_key: string;
  thumb_key: string | null;
  status: string;
  content_type: string;
  bytes: number | null;
  created_at: string;
  ready_at: string | null;
  device_id: string | null;
  expires_at: string | null;
};

type EventType = "view" | "download" | "share";

const MAX_THUMB_BYTES = 1_000_000;
const HEARTBEAT_HISTORY_MIN = 15;

const app = new Hono<Env>();

app.use("/api/*", cors());
app.use("/courts/*", cors());
app.use("/clips/*", cors());

/** Registra view/download/share. IP vira hash com sal diário (não rastreia entre dias). */
async function recordEvent(
  c: Context<Env>,
  clip: { id: string; court_id: string; venue_id: string },
  type: EventType,
): Promise<void> {
  const ip = c.req.header("cf-connecting-ip") ?? "";
  const ipHash = ip ? await sha256Hex(`${ip}|${todayBrt()}|${c.env.IP_HASH_SALT ?? ""}`) : null;
  await c.env.DB.prepare(
    "INSERT INTO clip_events (clip_id, court_id, venue_id, type, ip_hash) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(clip.id, clip.court_id, clip.venue_id, type, ipHash)
    .run();
}

app.use("/edge/*", edgeAuth);
app.use("/admin/*", adminAuth);
app.route("/admin", admin);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "projeto-replay",
    core: "upload/download",
    trigger: "local-only",
  }),
);

app.get("/api/courts/:key", async (c) => {
  const court = await c.env.DB.prepare(
    `SELECT co.public_key AS key, co.name, v.name AS venue_name
     FROM courts co JOIN venues v ON v.id = co.venue_id
     WHERE co.public_key = ?`,
  )
    .bind(c.req.param("key"))
    .first<{ key: string; name: string; venue_name: string }>();

  if (!court) return c.json({ error: "court_not_found" }, 404);
  return c.json({ ...court, retention_days: retentionDays(c.env), today: todayBrt() });
});

/** Clips ready de um dia no fuso de Brasília. */
app.get("/api/courts/:key/clips", async (c) => {
  const date = c.req.query("date") ?? todayBrt();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "invalid_date" }, 400);

  const court = await c.env.DB.prepare("SELECT id FROM courts WHERE public_key = ?")
    .bind(c.req.param("key"))
    .first<{ id: string }>();
  if (!court) return c.json({ error: "court_not_found" }, 404);

  const dayStart = `${date} 00:00:00`;
  const { results } = await c.env.DB.prepare(
    `SELECT id, bytes, expires_at, thumb_key,
            strftime('%H:%M', created_at, '-3 hours') AS time_local,
            CAST(strftime('%H', created_at, '-3 hours') AS INTEGER) AS hour
     FROM clips
     WHERE court_id = ? AND status = 'ready' AND expires_at > datetime('now')
       AND created_at >= datetime(?, '+3 hours')
       AND created_at < datetime(?, '+1 day', '+3 hours')
     ORDER BY created_at DESC
     LIMIT 300`,
  )
    .bind(court.id, dayStart, dayStart)
    .all<{
      id: string;
      bytes: number | null;
      expires_at: string;
      thumb_key: string | null;
      time_local: string;
      hour: number;
    }>();

  return c.json({
    date,
    clips: results.map(({ thumb_key, ...clip }) => ({
      ...clip,
      thumb_url: thumb_key ? `/clips/${clip.id}/thumb.jpg` : null,
      play_url: `/clips/${clip.id}`,
      download_url: `/clips/${clip.id}?download=1`,
    })),
  });
});

app.get("/api/clips/:id", async (c) => {
  const clip = await c.env.DB.prepare(
    `SELECT cl.id, cl.bytes, cl.expires_at, cl.thumb_key,
            strftime('%Y-%m-%d', cl.created_at, '-3 hours') AS date_local,
            strftime('%H:%M', cl.created_at, '-3 hours') AS time_local,
            co.public_key AS court_key, co.name AS court_name, v.name AS venue_name
     FROM clips cl
     JOIN courts co ON co.id = cl.court_id
     JOIN venues v ON v.id = co.venue_id
     WHERE cl.id = ? AND cl.status = 'ready' AND cl.expires_at > datetime('now')`,
  )
    .bind(c.req.param("id"))
    .first<{ id: string; thumb_key: string | null } & Record<string, unknown>>();

  if (!clip) return c.json({ error: "clip_not_found" }, 404);
  const { thumb_key, ...rest } = clip;
  return c.json({
    ...rest,
    thumb_url: thumb_key ? `/clips/${clip.id}/thumb.jpg` : null,
    play_url: `/clips/${clip.id}`,
    download_url: `/clips/${clip.id}?download=1`,
  });
});

/** view/share vêm do front; download é registrado no próprio GET do arquivo. */
app.post("/api/clips/:id/events", async (c) => {
  const body = await c.req.json<{ type?: string }>().catch((): { type?: string } => ({}));
  if (body.type !== "view" && body.type !== "share") {
    return c.json({ error: "invalid_type" }, 400);
  }

  const clip = await c.env.DB.prepare(
    `SELECT cl.id, cl.court_id, co.venue_id
     FROM clips cl JOIN courts co ON co.id = cl.court_id
     WHERE cl.id = ?`,
  )
    .bind(c.req.param("id"))
    .first<{ id: string; court_id: string; venue_id: string }>();
  if (!clip) return c.json({ error: "clip_not_found" }, 404);

  await recordEvent(c, clip, body.type);
  return c.json({ ok: true });
});

/**
 * Pi pede um slot de upload.
 * Body: { court_key: "demo01", clip_id?: string }
 */
app.post("/edge/clips/upload-slot", async (c) => {
  const device = c.get("device");
  type SlotBody = { court_key?: string; clip_id?: string };
  const body = await c.req.json<SlotBody>().catch((): SlotBody => ({}));
  const courtKey = body.court_key;
  if (!courtKey) return c.json({ error: "court_key_required" }, 400);

  const court = await c.env.DB.prepare(
    "SELECT id FROM courts WHERE public_key = ? AND venue_id = ?",
  )
    .bind(courtKey, device.venue_id)
    .first<{ id: string }>();

  if (!court) return c.json({ error: "court_not_found" }, 404);

  const clipId = body.clip_id ?? crypto.randomUUID();
  const objectKey = `courts/${court.id}/${clipId}.mp4`;

  await c.env.DB.prepare(
    `INSERT INTO clips (id, court_id, object_key, status, device_id, expires_at)
     VALUES (?, ?, ?, 'pending', ?, datetime('now', ?))`,
  )
    .bind(clipId, court.id, objectKey, device.id, `+${retentionDays(c.env)} days`)
    .run();

  return c.json({
    clip_id: clipId,
    upload_url: `/edge/clips/${clipId}/content`,
    thumbnail_url: `/edge/clips/${clipId}/thumbnail`,
    method: "PUT",
    content_type: "video/mp4",
  });
});

/** Pi faz PUT do MP4 no corpo da request. */
app.put("/edge/clips/:clipId/content", async (c) => {
  const device = c.get("device");
  const clipId = c.req.param("clipId");
  const contentType = c.req.header("content-type") ?? "video/mp4";

  const clip = await c.env.DB.prepare(
    "SELECT id, court_id, object_key, status FROM clips WHERE id = ? AND device_id = ?",
  )
    .bind(clipId, device.id)
    .first<ClipRow>();

  if (!clip) return c.json({ error: "clip_not_found" }, 404);
  if (clip.status !== "pending") return c.json({ error: "clip_already_uploaded" }, 409);

  const body = c.req.raw.body;
  if (!body) return c.json({ error: "empty_body" }, 400);

  const putResult = await c.env.CLIPS.put(clip.object_key, body, {
    httpMetadata: { contentType },
  });

  const bytes = putResult.size;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE clips
       SET status = 'ready', content_type = ?, bytes = ?, ready_at = datetime('now')
       WHERE id = ?`,
    ).bind(contentType, bytes, clipId),
    c.env.DB.prepare(
      "INSERT INTO clip_events (clip_id, court_id, venue_id, type) VALUES (?, ?, ?, 'created')",
    ).bind(clipId, clip.court_id, device.venue_id),
  ]);

  return c.json({
    clip_id: clipId,
    status: "ready",
    bytes,
    play_url: `/clips/${clipId}`,
  });
});

/** Miniatura JPG do clip (1 frame extraído no Pi). */
app.put("/edge/clips/:clipId/thumbnail", async (c) => {
  const device = c.get("device");
  const clipId = c.req.param("clipId");

  const clip = await c.env.DB.prepare(
    "SELECT id, court_id FROM clips WHERE id = ? AND device_id = ?",
  )
    .bind(clipId, device.id)
    .first<{ id: string; court_id: string }>();
  if (!clip) return c.json({ error: "clip_not_found" }, 404);

  const bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength) return c.json({ error: "empty_body" }, 400);
  if (bytes.byteLength > MAX_THUMB_BYTES) return c.json({ error: "thumbnail_too_large" }, 413);

  const thumbKey = `courts/${clip.court_id}/${clipId}.jpg`;
  await c.env.CLIPS.put(thumbKey, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  await c.env.DB.prepare("UPDATE clips SET thumb_key = ? WHERE id = ?")
    .bind(thumbKey, clipId)
    .run();

  return c.json({ ok: true, thumb_url: `/clips/${clipId}/thumb.jpg` });
});

/**
 * Saúde do Pi a cada ~60s. O último payload fica em devices.last_payload (o painel lê dali);
 * histórico em heartbeats só a cada 15 min ou quando algo muda — escrita no D1 é o limite do grátis.
 */
app.post("/edge/heartbeat", async (c) => {
  const device = c.get("device");
  const payload = await c.req
    .json<Record<string, unknown>>()
    .catch((): Record<string, unknown> => ({}));
  const agentVersion = typeof payload.agent_version === "string" ? payload.agent_version : null;
  const json = JSON.stringify(payload).slice(0, 4000);

  const prev = await c.env.DB.prepare(
    `SELECT d.agent_version,
            (SELECT MAX(created_at) FROM heartbeats h WHERE h.device_id = d.id) AS last_history
     FROM devices d WHERE d.id = ?`,
  )
    .bind(device.id)
    .first<{ agent_version: string | null; last_history: string | null }>();

  const historyDue =
    !prev?.last_history ||
    Date.parse(`${prev.last_history.replace(" ", "T")}Z`) <= Date.now() - HEARTBEAT_HISTORY_MIN * 60_000;
  const anomaly =
    payloadIssues(payload).length > 0 || (agentVersion !== null && agentVersion !== prev?.agent_version);

  const stmts = [
    c.env.DB.prepare(
      `UPDATE devices
       SET last_seen_at = datetime('now'), last_payload = ?, agent_version = COALESCE(?, agent_version)
       WHERE id = ?`,
    ).bind(json, agentVersion, device.id),
  ];
  if (historyDue || anomaly) {
    stmts.push(
      c.env.DB.prepare("INSERT INTO heartbeats (device_id, payload) VALUES (?, ?)").bind(device.id, json),
    );
  }
  await c.env.DB.batch(stmts);

  return c.json({
    ok: true,
    device_id: device.id,
    history: historyDue || anomaly,
    server_time: new Date().toISOString(),
  });
});

app.get("/clips/:clipId/thumb.jpg", async (c) => {
  const clip = await c.env.DB.prepare(
    "SELECT thumb_key FROM clips WHERE id = ? AND expires_at > datetime('now')",
  )
    .bind(c.req.param("clipId"))
    .first<{ thumb_key: string | null }>();
  if (!clip?.thumb_key) return c.json({ error: "thumbnail_not_found" }, 404);

  const object = await c.env.CLIPS.get(clip.thumb_key);
  if (!object) return c.json({ error: "thumbnail_not_found" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=86400");
  return new Response(object.body, { headers });
});

/** Stream / download do vídeo (bucket permanece privado). */
app.get("/clips/:clipId", async (c) => {
  const clipId = c.req.param("clipId");
  const asDownload = c.req.query("download") === "1";

  const clip = await c.env.DB.prepare(
    `SELECT cl.id, cl.court_id, cl.object_key, cl.status, co.venue_id
     FROM clips cl JOIN courts co ON co.id = cl.court_id
     WHERE cl.id = ? AND cl.expires_at > datetime('now')`,
  )
    .bind(clipId)
    .first<ClipRow & { venue_id: string }>();

  if (!clip) return c.json({ error: "clip_not_found" }, 404);
  if (clip.status !== "ready") return c.json({ error: "clip_not_ready" }, 409);

  const object = await c.env.CLIPS.get(clip.object_key, {
    range: c.req.raw.headers,
    onlyIf: c.req.raw.headers,
  });
  if (!object) return c.json({ error: "object_missing" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=60");
  if (asDownload) {
    headers.set("content-disposition", `attachment; filename="replay-${clipId}.mp4"`);
  }

  if (!("body" in object)) return new Response(null, { status: 304, headers });

  if (asDownload && !c.req.header("range")) {
    c.executionCtx.waitUntil(recordEvent(c, clip, "download"));
  }

  if (c.req.header("range") && object.range && "offset" in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
});

/** Página do clip com og:* pra prévia no WhatsApp/Instagram; o resto é o SPA. */
app.get("/v/:id", async (c) => {
  const indexRes = await c.env.ASSETS.fetch(new URL("/", c.req.url));
  const clip = await c.env.DB.prepare(
    `SELECT cl.id, cl.thumb_key, co.name AS court_name, v.name AS venue_name,
            strftime('%d/%m %H:%M', cl.created_at, '-3 hours') AS when_local
     FROM clips cl
     JOIN courts co ON co.id = cl.court_id
     JOIN venues v ON v.id = co.venue_id
     WHERE cl.id = ? AND cl.status = 'ready' AND cl.expires_at > datetime('now')`,
  )
    .bind(c.req.param("id"))
    .first<{
      id: string;
      thumb_key: string | null;
      court_name: string;
      venue_name: string;
      when_local: string;
    }>();
  if (!clip) return indexRes;

  const origin = new URL(c.req.url).origin;
  const title = `Replay · ${clip.venue_name} · ${clip.court_name} · ${clip.when_local}`;
  const image = clip.thumb_key ? `${origin}/clips/${clip.id}/thumb.jpg` : null;

  const rewriter = new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(title);
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute("content", title);
      },
    })
    .on('meta[property="og:url"]', {
      element(el) {
        el.setAttribute("content", `${origin}/v/${clip.id}`);
      },
    })
    .on('meta[property="og:image"]', {
      element(el) {
        if (image) el.setAttribute("content", image);
        else el.remove();
      },
    });

  return rewriter.transform(indexRes);
});

app.get("/c/:key", (c) => c.redirect(`/q/${c.req.param("key")}`, 301));

/** Mantido p/ compatibilidade; o front usa /api/courts/:key/clips. */
app.get("/courts/:publicKey/clips", async (c) => {
  const court = await c.env.DB.prepare(
    "SELECT id, name, public_key FROM courts WHERE public_key = ?",
  )
    .bind(c.req.param("publicKey"))
    .first<{ id: string; name: string; public_key: string }>();
  if (!court) return c.json({ error: "court_not_found" }, 404);

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const { results } = await c.env.DB.prepare(
    `SELECT id, court_id, status, content_type, bytes, created_at, ready_at, expires_at
     FROM clips
     WHERE court_id = ? AND status = 'ready' AND expires_at > datetime('now')
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(court.id, limit)
    .all<ClipRow>();

  return c.json({
    court,
    clips: results.map((clip) => ({
      ...clip,
      play_url: `/clips/${clip.id}`,
      download_url: `/clips/${clip.id}?download=1`,
    })),
  });
});

/** Retenção: apaga clips expirados (R2 + D1), pendentes órfãos e heartbeats antigos. */
async function purgeExpired(env: Bindings): Promise<{ clips: number }> {
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

  await env.DB.prepare("DELETE FROM heartbeats WHERE created_at <= datetime('now', '-7 days')").run();
  return { clips: total };
}

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      purgeExpired(env).then((r) => console.log(JSON.stringify({ event: "purge", ...r }))),
    );
  },
} satisfies ExportedHandler<Bindings>;
