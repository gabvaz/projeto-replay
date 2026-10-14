import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  DB: D1Database;
  CLIPS: R2Bucket;
  ADMIN_TOKEN: string;
  RETENTION_DAYS?: string;
};

type Device = {
  id: string;
  venue_id: string;
  name: string;
};

type Env = { Bindings: Bindings; Variables: { device: Device } };

type ClipRow = {
  id: string;
  court_id: string;
  object_key: string;
  status: string;
  content_type: string;
  bytes: number | null;
  created_at: string;
  ready_at: string | null;
  device_id: string | null;
  expires_at: string | null;
};

const app = new Hono<Env>();

app.use("/courts/*", cors());
app.use("/clips/*", cors());

app.get("/", (c) =>
  c.json({
    ok: true,
    service: "projeto-replay",
    core: "upload/download",
    trigger: "local-only",
  }),
);

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bearer(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function retentionDays(env: Bindings): number {
  const n = Number(env.RETENTION_DAYS ?? 7);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

/** Pi autenticado por token próprio; só o hash fica no D1. */
const edgeAuth: MiddlewareHandler<Env> = async (c, next) => {
  const token = bearer(c.req.header("authorization"));
  if (!token) return c.json({ error: "unauthorized" }, 401);

  const device = await c.env.DB.prepare(
    "SELECT id, venue_id, name FROM devices WHERE token_hash = ? AND revoked_at IS NULL",
  )
    .bind(await sha256Hex(token))
    .first<Device>();

  if (!device) return c.json({ error: "unauthorized" }, 401);
  c.set("device", device);
  await next();
};

/** Temporário até o admin ir pra trás do Cloudflare Access. */
const adminAuth: MiddlewareHandler<Env> = async (c, next) => {
  const token = bearer(c.req.header("authorization"));
  if (!token || !c.env.ADMIN_TOKEN) return c.json({ error: "unauthorized" }, 401);

  const [a, b] = await Promise.all([sha256Hex(token), sha256Hex(c.env.ADMIN_TOKEN)]);
  const enc = new TextEncoder();
  if (!crypto.subtle.timingSafeEqual(enc.encode(a), enc.encode(b))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

app.use("/edge/*", edgeAuth);
app.use("/admin/*", adminAuth);

/** Lista clips ready de uma quadra (por public_key). */
app.get("/courts/:publicKey/clips", async (c) => {
  const publicKey = c.req.param("publicKey");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);

  const court = await c.env.DB.prepare(
    "SELECT id, name, public_key FROM courts WHERE public_key = ?",
  )
    .bind(publicKey)
    .first<{ id: string; name: string; public_key: string }>();

  if (!court) return c.json({ error: "court_not_found" }, 404);

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
    "SELECT id, object_key, status FROM clips WHERE id = ? AND device_id = ?",
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

  await c.env.DB.prepare(
    `UPDATE clips
     SET status = 'ready', content_type = ?, bytes = ?, ready_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(contentType, bytes, clipId)
    .run();

  return c.json({
    clip_id: clipId,
    status: "ready",
    bytes,
    play_url: `/clips/${clipId}`,
  });
});

/** Saúde do Pi a cada ~60s. Payload livre (cpu, ram, temp, câmeras, versão). */
app.post("/edge/heartbeat", async (c) => {
  const device = c.get("device");
  const payload = await c.req
    .json<Record<string, unknown>>()
    .catch((): Record<string, unknown> => ({}));
  const agentVersion = typeof payload.agent_version === "string" ? payload.agent_version : null;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE devices
       SET last_seen_at = datetime('now'), agent_version = COALESCE(?, agent_version)
       WHERE id = ?`,
    ).bind(agentVersion, device.id),
    c.env.DB.prepare("INSERT INTO heartbeats (device_id, payload) VALUES (?, ?)").bind(
      device.id,
      JSON.stringify(payload).slice(0, 4000),
    ),
  ]);

  return c.json({ ok: true, device_id: device.id, server_time: new Date().toISOString() });
});

/** Stream / download do vídeo (bucket permanece privado). */
app.get("/clips/:clipId", async (c) => {
  const clipId = c.req.param("clipId");
  const asDownload = c.req.query("download") === "1";

  const clip = await c.env.DB.prepare(
    `SELECT id, object_key, status, content_type FROM clips
     WHERE id = ? AND expires_at > datetime('now')`,
  )
    .bind(clipId)
    .first<ClipRow>();

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

/** Cadastra um Pi e devolve o token UMA vez (só o hash fica salvo). */
app.post("/admin/devices", async (c) => {
  const body = await c.req
    .json<{ venue_id?: string; name?: string; kind?: string }>()
    .catch(() => ({}) as { venue_id?: string; name?: string; kind?: string });
  if (!body.venue_id || !body.name) return c.json({ error: "venue_id_and_name_required" }, 400);

  const venue = await c.env.DB.prepare("SELECT id FROM venues WHERE id = ?")
    .bind(body.venue_id)
    .first();
  if (!venue) return c.json({ error: "venue_not_found" }, 404);

  const id = crypto.randomUUID();
  const rawToken = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const token = `dev_${rawToken}`;

  await c.env.DB.prepare(
    "INSERT INTO devices (id, venue_id, kind, name, token_hash) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, body.venue_id, body.kind ?? "pi", body.name, await sha256Hex(token))
    .run();

  return c.json({ id, venue_id: body.venue_id, name: body.name, token }, 201);
});

app.get("/admin/devices", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.venue_id, v.name AS venue_name, d.kind, d.name, d.agent_version,
            d.last_seen_at, d.revoked_at,
            CASE WHEN d.last_seen_at > datetime('now', '-5 minutes') THEN 1 ELSE 0 END AS online
     FROM devices d JOIN venues v ON v.id = d.venue_id
     ORDER BY v.name, d.name`,
  ).all();
  return c.json({ devices: results });
});

app.post("/admin/devices/:id/revoke", async (c) => {
  const result = await c.env.DB.prepare(
    "UPDATE devices SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL",
  )
    .bind(c.req.param("id"))
    .run();
  if (!result.meta.changes) return c.json({ error: "device_not_found" }, 404);
  return c.json({ ok: true });
});

/** Apaga clip no R2 + metadados no D1. */
app.delete("/admin/clips/:clipId", async (c) => {
  const clipId = c.req.param("clipId");

  const clip = await c.env.DB.prepare("SELECT id, object_key FROM clips WHERE id = ?")
    .bind(clipId)
    .first<{ id: string; object_key: string }>();

  if (!clip) return c.json({ error: "clip_not_found" }, 404);

  await c.env.CLIPS.delete(clip.object_key);
  await c.env.DB.prepare("DELETE FROM clips WHERE id = ?").bind(clipId).run();

  return c.json({ ok: true, clip_id: clipId, deleted: true });
});

/** Galeria pública. Trigger é local/ESP; moderação fica no portal da arena/admin. */
app.get("/c/:publicKey", async (c) => {
  const publicKey = c.req.param("publicKey");
  const court = await c.env.DB.prepare(
    "SELECT id, name, public_key FROM courts WHERE public_key = ?",
  )
    .bind(publicKey)
    .first<{ id: string; name: string; public_key: string }>();

  if (!court) return c.text("Quadra não encontrada", 404);

  const { results } = await c.env.DB.prepare(
    `SELECT id, created_at, bytes
     FROM clips
     WHERE court_id = ? AND status = 'ready' AND expires_at > datetime('now')
     ORDER BY created_at DESC
     LIMIT 20`,
  )
    .bind(court.id)
    .all<{ id: string; created_at: string; bytes: number | null }>();

  const items = results
    .map(
      (clip) => `
      <li>
        <p>${clip.created_at}${clip.bytes != null ? ` · ${(clip.bytes / 1e6).toFixed(1)} MB` : ""}</p>
        <video controls preload="metadata" src="/clips/${clip.id}"></video>
        <p><a href="/clips/${clip.id}?download=1">download</a></p>
      </li>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${court.name} · Replay</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 1.5rem auto; max-width: 42rem; padding: 0 1rem; }
    video { width: 100%; background: #111; }
    li { list-style: none; margin: 0 0 1.5rem; padding: 0; }
    ul { padding: 0; }
    .note { opacity: .75; margin: 0 0 1.25rem; }
  </style>
</head>
<body>
  <h1>${court.name}</h1>
  <p>Galeria · <code>${court.public_key}</code></p>
  <p class="note">Replays ficam disponíveis por ${retentionDays(c.env)} dias.</p>
  <ul>${items || "<li>Nenhum clip ainda.</li>"}</ul>
</body>
</html>`;

  return c.html(html);
});

/** Retenção: apaga clips expirados (R2 + D1), pendentes órfãos e heartbeats antigos. */
async function purgeExpired(env: Bindings): Promise<{ clips: number }> {
  let total = 0;
  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT id, object_key FROM clips
       WHERE expires_at <= datetime('now')
          OR (status = 'pending' AND created_at <= datetime('now', '-1 day'))
       LIMIT 100`,
    ).all<{ id: string; object_key: string }>();
    if (!results.length) break;

    await env.CLIPS.delete(results.map((r) => r.object_key));
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
