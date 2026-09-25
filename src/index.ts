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
      delete_url: `/clips/${clip.id}`,
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

/** Apaga clip no R2 + metadados no D1. */
app.delete("/clips/:clipId", async (c) => {
  const clipId = c.req.param("clipId");

  const clip = await c.env.DB.prepare(
    "SELECT id, object_key FROM clips WHERE id = ?",
  )
    .bind(clipId)
    .first<{ id: string; object_key: string }>();

  if (!clip) return c.json({ error: "clip_not_found" }, 404);

  await c.env.CLIPS.delete(clip.object_key);

  // tabela residual de requests (se ainda existir) — evita FK órfã
  try {
    await c.env.DB.prepare(
      "UPDATE replay_requests SET clip_id = NULL WHERE clip_id = ?",
    )
      .bind(clipId)
      .run();
  } catch {
    // ignore se a tabela não existir
  }

  await c.env.DB.prepare("DELETE FROM clips WHERE id = ?").bind(clipId).run();

  return c.json({ ok: true, clip_id: clipId, deleted: true });
});

/** Galeria pública. Trigger é local/ESP; apagar na própria página. */
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
      <li data-clip-id="${clip.id}">
        <p>${clip.created_at}${clip.bytes != null ? ` · ${(clip.bytes / 1e6).toFixed(1)} MB` : ""}</p>
        <video controls preload="metadata" src="/clips/${clip.id}"></video>
        <p class="row">
          <a href="/clips/${clip.id}?download=1">download</a>
          <button type="button" class="danger" data-delete="${clip.id}">apagar</button>
        </p>
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
    .row { display: flex; gap: 1rem; align-items: center; }
    button.danger {
      font: inherit; border: 0; background: transparent; color: #c33;
      cursor: pointer; text-decoration: underline; padding: 0;
    }
    button.danger:disabled { opacity: .5; cursor: not-allowed; }
  </style>
</head>
<body>
  <h1>${court.name}</h1>
  <p>Galeria · <code>${court.public_key}</code></p>
  <p class="note">Gravação só no botão físico / edge local. Apagar remove o arquivo da nuvem.</p>
  <ul id="clips">${items || "<li id='empty'>Nenhum clip ainda.</li>"}</ul>
  <script>
    document.getElementById('clips')?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-delete]');
      if (!btn) return;
      const id = btn.getAttribute('data-delete');
      if (!id) return;
      if (!confirm('Apagar este replay de forma permanente?')) return;
      btn.disabled = true;
      try {
        const res = await fetch('/clips/' + encodeURIComponent(id), { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'falha ao apagar');
        btn.closest('li')?.remove();
        const list = document.getElementById('clips');
        if (list && !list.querySelector('li')) {
          list.innerHTML = "<li id='empty'>Nenhum clip ainda.</li>";
        }
      } catch (err) {
        alert(String(err.message || err));
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;

  return c.html(html);
});

export default app;
