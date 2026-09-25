import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  DB: D1Database;
  CLIPS: R2Bucket;
};

type ClipRow = {
  id: string;
  court_id: string;
  object_key: string;
  status: string;
  content_type: string;
  bytes: number | null;
  created_at: string;
  ready_at: string | null;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", cors());

app.get("/", (c) =>
  c.json({
    ok: true,
    service: "projeto-replay",
    core: "upload/download",
    trigger: "local-only",
  }),
);

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
    `SELECT id, court_id, status, content_type, bytes, created_at, ready_at
     FROM clips
     WHERE court_id = ? AND status = 'ready'
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
 * Edge pede um slot de upload.
 * Body: { court_key: "demo01", clip_id?: string }
 */
app.post("/clips/upload-slot", async (c) => {
  const body = await c.req.json<{ court_key?: string; clip_id?: string }>().catch(() => ({}));
  const courtKey = body.court_key;
  if (!courtKey) return c.json({ error: "court_key_required" }, 400);

  const court = await c.env.DB.prepare(
    "SELECT id FROM courts WHERE public_key = ?",
  )
    .bind(courtKey)
    .first<{ id: string }>();

  if (!court) return c.json({ error: "court_not_found" }, 404);

  const clipId = body.clip_id ?? crypto.randomUUID();
  const objectKey = `courts/${court.id}/${clipId}.mp4`;

  await c.env.DB.prepare(
    `INSERT INTO clips (id, court_id, object_key, status)
     VALUES (?, ?, ?, 'pending')`,
  )
    .bind(clipId, court.id, objectKey)
    .run();

  return c.json({
    clip_id: clipId,
    upload_url: `/clips/${clipId}/content`,
    method: "PUT",
    content_type: "video/mp4",
  });
});

/** Edge faz PUT do MP4 no corpo da request. */
app.put("/clips/:clipId/content", async (c) => {
  const clipId = c.req.param("clipId");
  const contentType = c.req.header("content-type") ?? "video/mp4";

  const clip = await c.env.DB.prepare(
    "SELECT id, object_key, status FROM clips WHERE id = ?",
  )
    .bind(clipId)
    .first<ClipRow>();

  if (!clip) return c.json({ error: "clip_not_found" }, 404);

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

/** Stream / download do vídeo (bucket permanece privado). */
app.get("/clips/:clipId", async (c) => {
  const clipId = c.req.param("clipId");
  const asDownload = c.req.query("download") === "1";

  const clip = await c.env.DB.prepare(
    "SELECT id, object_key, status, content_type FROM clips WHERE id = ?",
  )
    .bind(clipId)
    .first<ClipRow>();

  if (!clip) return c.json({ error: "clip_not_found" }, 404);
  if (clip.status !== "ready") return c.json({ error: "clip_not_ready" }, 409);

  const object = await c.env.CLIPS.get(clip.object_key);
  if (!object) return c.json({ error: "object_missing" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=60");
  if (asDownload) {
    headers.set("content-disposition", `attachment; filename="${clipId}.mp4"`);
  }

  return new Response(object.body, { headers });
});

/** Galeria pública (somente leitura). Trigger é local/ESP. */
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
     WHERE court_id = ? AND status = 'ready'
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
  <p class="note">Gravação só no botão físico / edge local — esta página é só para assistir.</p>
  <ul>${items || "<li>Nenhum clip ainda.</li>"}</ul>
</body>
</html>`;

  return c.html(html);
});

export default app;
