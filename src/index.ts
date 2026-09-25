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

type RequestRow = {
  id: string;
  court_id: string;
  status: string;
  clip_id: string | null;
  error: string | null;
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", cors());

app.get("/", (c) =>
  c.json({
    ok: true,
    service: "projeto-replay",
    core: "upload/download",
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
 * Botão "Gravar agora" na página pública.
 * Cria pedido pending; o edge agent busca e processa.
 */
app.post("/courts/:publicKey/record", async (c) => {
  const publicKey = c.req.param("publicKey");
  const court = await c.env.DB.prepare(
    "SELECT id FROM courts WHERE public_key = ?",
  )
    .bind(publicKey)
    .first<{ id: string }>();

  if (!court) return c.json({ error: "court_not_found" }, 404);

  const inflight = await c.env.DB.prepare(
    `SELECT id FROM replay_requests
     WHERE court_id = ? AND status IN ('pending', 'processing')
     LIMIT 1`,
  )
    .bind(court.id)
    .first<{ id: string }>();

  if (inflight) {
    return c.json(
      { error: "busy", request_id: inflight.id, status: "already_in_progress" },
      409,
    );
  }

  const requestId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO replay_requests (id, court_id, status)
     VALUES (?, ?, 'pending')`,
  )
    .bind(requestId, court.id)
    .run();

  return c.json({ request_id: requestId, status: "pending" }, 201);
});

/** Status de um pedido (página faz poll). */
app.get("/courts/:publicKey/requests/:requestId", async (c) => {
  const publicKey = c.req.param("publicKey");
  const requestId = c.req.param("requestId");

  const row = await c.env.DB.prepare(
    `SELECT r.id, r.status, r.clip_id, r.error, r.created_at, r.finished_at
     FROM replay_requests r
     JOIN courts c ON c.id = r.court_id
     WHERE r.id = ? AND c.public_key = ?`,
  )
    .bind(requestId, publicKey)
    .first<RequestRow>();

  if (!row) return c.json({ error: "request_not_found" }, 404);

  return c.json({
    ...row,
    play_url: row.clip_id ? `/clips/${row.clip_id}` : null,
  });
});

/**
 * Edge: pega o próximo pending da quadra e marca processing.
 * GET /edge/pending?court_key=demo01
 */
app.get("/edge/pending", async (c) => {
  const courtKey = c.req.query("court_key");
  if (!courtKey) return c.json({ error: "court_key_required" }, 400);

  const court = await c.env.DB.prepare(
    "SELECT id FROM courts WHERE public_key = ?",
  )
    .bind(courtKey)
    .first<{ id: string }>();

  if (!court) return c.json({ error: "court_not_found" }, 404);

  const pending = await c.env.DB.prepare(
    `SELECT id FROM replay_requests
     WHERE court_id = ? AND status = 'pending'
     ORDER BY created_at ASC
     LIMIT 1`,
  )
    .bind(court.id)
    .first<{ id: string }>();

  if (!pending) return c.json({ request: null });

  const claim = await c.env.DB.prepare(
    `UPDATE replay_requests
     SET status = 'processing', claimed_at = datetime('now')
     WHERE id = ? AND status = 'pending'`,
  )
    .bind(pending.id)
    .run();

  if (!claim.meta.changes) return c.json({ request: null });

  return c.json({ request: { id: pending.id, court_id: court.id } });
});

/** Edge: marca pedido como done/failed. */
app.post("/edge/requests/:requestId/finish", async (c) => {
  const requestId = c.req.param("requestId");
  const body = await c.req
    .json<{ ok?: boolean; clip_id?: string; error?: string }>()
    .catch(() => ({}));

  const existing = await c.env.DB.prepare(
    "SELECT id, status FROM replay_requests WHERE id = ?",
  )
    .bind(requestId)
    .first<{ id: string; status: string }>();

  if (!existing) return c.json({ error: "request_not_found" }, 404);

  if (body.ok && body.clip_id) {
    await c.env.DB.prepare(
      `UPDATE replay_requests
       SET status = 'ready', clip_id = ?, error = NULL, finished_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(body.clip_id, requestId)
      .run();
    return c.json({ ok: true, status: "ready", clip_id: body.clip_id });
  }

  await c.env.DB.prepare(
    `UPDATE replay_requests
     SET status = 'failed', error = ?, finished_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(body.error ?? "unknown", requestId)
    .run();

  return c.json({ ok: false, status: "failed" });
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

/** Página pública da quadra + botão Gravar agora. */
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
    .actions { display: flex; gap: .75rem; align-items: center; margin: 1.25rem 0 1.5rem; flex-wrap: wrap; }
    button {
      font: inherit; font-weight: 600; padding: .75rem 1.25rem;
      border: 0; border-radius: .5rem; background: #0a7; color: #fff; cursor: pointer;
    }
    button:disabled { opacity: .55; cursor: not-allowed; }
    #status { opacity: .8; min-height: 1.25em; }
    #status[data-state="error"] { color: #c33; }
    #status[data-state="ok"] { color: #0a7; }
  </style>
</head>
<body>
  <h1>${court.name}</h1>
  <p>Galeria · <code>${court.public_key}</code></p>
  <div class="actions">
    <button type="button" id="recordBtn">Gravar agora</button>
    <span id="status" role="status"></span>
  </div>
  <ul id="clips">${items || "<li id='empty'>Nenhum clip ainda.</li>"}</ul>
  <script>
    const courtKey = ${JSON.stringify(court.public_key)};
    const btn = document.getElementById('recordBtn');
    const statusEl = document.getElementById('status');
    const list = document.getElementById('clips');

    function setStatus(text, state) {
      statusEl.textContent = text || '';
      statusEl.dataset.state = state || '';
    }

    async function waitRequest(requestId) {
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const res = await fetch('/courts/' + encodeURIComponent(courtKey) + '/requests/' + requestId);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'status_failed');
        if (data.status === 'ready' && data.clip_id) return data;
        if (data.status === 'failed') throw new Error(data.error || 'gravação falhou');
        setStatus('Gravando… (' + data.status + ')', 'busy');
      }
      throw new Error('timeout esperando o edge');
    }

    function prependClip(clipId) {
      document.getElementById('empty')?.remove();
      const li = document.createElement('li');
      li.dataset.clipId = clipId;
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      li.innerHTML =
        '<p>' + now + ' · novo</p>' +
        '<video controls preload="metadata" src="/clips/' + clipId + '"></video>' +
        '<p><a href="/clips/' + clipId + '?download=1">download</a></p>';
      list.prepend(li);
    }

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      setStatus('Enviando pedido…', 'busy');
      try {
        const res = await fetch('/courts/' + encodeURIComponent(courtKey) + '/record', { method: 'POST' });
        const data = await res.json();
        if (res.status === 409) {
          setStatus('Já tem uma gravação em andamento…', 'busy');
          const done = await waitRequest(data.request_id);
          prependClip(done.clip_id);
          setStatus('Pronto!', 'ok');
          return;
        }
        if (!res.ok) throw new Error(data.error || 'falha ao pedir gravação');
        setStatus('Aguardando câmera/edge…', 'busy');
        const done = await waitRequest(data.request_id);
        prependClip(done.clip_id);
        setStatus('Pronto!', 'ok');
      } catch (err) {
        setStatus(String(err.message || err), 'error');
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;

  return c.html(html);
});

export default app;
