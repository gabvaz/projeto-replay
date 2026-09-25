/**
 * Edge agent (dev) — buffer circular + upload pro Worker.
 *
 * Fonte:
 *   - RTSP_URL definido (edge/.env) → câmera
 *   - senão → testsrc sintético
 *
 * Uso:
 *   npm run edge          → terminal + teclado
 *   npm run edge:ui       → sobe e abre UI local (127.0.0.1)
 *   curl -X POST http://127.0.0.1:8788/local/replay
 *
 * A UI de gravação é SÓ local (não vai pro Worker/Cloudflare).
 *
 * Env: API_BASE, COURT_KEY, RTSP_URL, EDGE_PORT, PRE_ROLL_SEC, POST_ROLL_SEC, SEGMENT_SEC, OPEN_UI
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readdir, rm, writeFile, stat, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadDotEnv() {
  try {
    const raw = await readFile(path.join(__dirname, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // .env opcional
  }
}

await loadDotEnv();

const API_BASE = (
  process.env.API_BASE ??
  "https://projeto-replay.gabrieltenoriovaz-10a.workers.dev"
).replace(/\/$/, "");
const COURT_KEY = process.env.COURT_KEY ?? "demo01";
const RTSP_URL = process.env.RTSP_URL?.trim() || "";
const EDGE_PORT = Number(process.env.EDGE_PORT ?? 8788);
const PRE_ROLL_SEC = Number(process.env.PRE_ROLL_SEC ?? 15);
const POST_ROLL_SEC = Number(process.env.POST_ROLL_SEC ?? 3);
const SEGMENT_SEC = Number(process.env.SEGMENT_SEC ?? 2);
const BUFFER_DIR = process.env.BUFFER_DIR
  ? path.resolve(process.env.BUFFER_DIR)
  : path.join(__dirname, ".buffer");
const CLIPS_DIR = path.join(__dirname, ".clips");

const SEGMENT_WRAP = Math.ceil((PRE_ROLL_SEC + POST_ROLL_SEC + 10) / SEGMENT_SEC) + 5;

let ffmpegProc = null;
let busy = false;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function redactUrl(url) {
  return url.replace(/:([^:@/]+)@/, ":***@");
}

/** Resolve ffmpeg mesmo se o terminal não tiver PATH atualizado (WinGet). */
function resolveFfmpegBin() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], {
    encoding: "utf8",
    shell: true,
  });
  if (which.status === 0) {
    const first = which.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first && existsSync(first)) return first;
  }

  const wingetRoot = path.join(
    process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"),
    "Microsoft",
    "WinGet",
    "Packages",
  );
  if (existsSync(wingetRoot)) {
    const stack = [wingetRoot];
    let steps = 0;
    while (stack.length && steps < 400) {
      steps += 1;
      const dir = stack.pop();
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isFile() && ent.name.toLowerCase() === "ffmpeg.exe") return full;
        if (ent.isFile() && ent.name === "ffmpeg") return full;
        if (
          ent.isDirectory() &&
          (ent.name.startsWith("Gyan") ||
            ent.name.startsWith("ffmpeg") ||
            ent.name.includes("full_build") ||
            ent.name === "bin")
        ) {
          stack.push(full);
        }
      }
    }
  }

  for (const g of [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "ffmpeg", "bin", "ffmpeg.exe"),
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
  ]) {
    if (existsSync(g)) return g;
  }

  return null;
}

const FFMPEG_BIN = resolveFfmpegBin();
if (!FFMPEG_BIN) {
  console.error(
    "ffmpeg não encontrado. Abra um terminal NOVO após instalar, ou no edge/.env:\n" +
      "FFMPEG_PATH=C:\\\\caminho\\\\para\\\\ffmpeg.exe",
  );
  process.exit(1);
}

function spawnFfmpeg(args, opts = {}) {
  const proc = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "inherit", "inherit"], ...opts });
  proc.on("error", (err) => {
    log("ffmpeg spawn error:", err.message ?? err);
  });
  return proc;
}

async function ensureDirs() {
  try {
    await rm(BUFFER_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    log("warn: limpeza buffer falhou:", err.message ?? err);
  }
  await mkdir(BUFFER_DIR, { recursive: true });
  await mkdir(CLIPS_DIR, { recursive: true });
}

function startBuffer() {
  const pattern = path.join(BUFFER_DIR, "seg_%03d.ts");
  const segmentTail = [
    "-an",
    "-f",
    "segment",
    "-segment_time",
    String(SEGMENT_SEC),
    "-segment_wrap",
    String(SEGMENT_WRAP),
    "-reset_timestamps",
    "1",
    "-segment_format",
    "mpegts",
    pattern,
  ];

  /** @type {string[]} */
  let args;
  if (RTSP_URL) {
    // Yoosee/iCSee: UDP; vídeo H.264 copy; drop áudio pcm_alaw
    args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-rtsp_transport",
      "udp",
      "-i",
      RTSP_URL,
      "-map",
      "0:v:0",
      "-c:v",
      "copy",
      ...segmentTail,
    ];
    log("fonte: RTSP", redactUrl(RTSP_URL));
  } else {
    args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=1280x720:rate=30",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "60",
      "-keyint_min",
      "60",
      ...segmentTail,
    ];
    log("fonte: testsrc (sem RTSP_URL)");
  }

  log("ffmpeg:", FFMPEG_BIN);
  log("starting ffmpeg buffer →", BUFFER_DIR);
  ffmpegProc = spawnFfmpeg(args);
  ffmpegProc.on("exit", (code, signal) => {
    log(`ffmpeg exited code=${code} signal=${signal}`);
  });
}

async function listSegmentsNewestFirst() {
  const names = await readdir(BUFFER_DIR);
  const segs = [];
  for (const name of names) {
    if (!name.endsWith(".ts")) continue;
    const full = path.join(BUFFER_DIR, name);
    const st = await stat(full);
    segs.push({ name, full, mtimeMs: st.mtimeMs, size: st.size });
  }
  segs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return segs.filter((s) => s.size > 0);
}

async function buildClip() {
  const needed = Math.ceil((PRE_ROLL_SEC + POST_ROLL_SEC) / SEGMENT_SEC);
  const segments = await listSegmentsNewestFirst();
  if (segments.length < Math.max(3, Math.floor(needed / 2))) {
    throw new Error(
      `buffer ainda frio: ${segments.length} segmentos (precisa ~${needed})`,
    );
  }

  // Ordem cronológica: mais antigo → mais recente entre os N últimos
  const window = segments.slice(0, needed).reverse();
  const listPath = path.join(CLIPS_DIR, `concat-${Date.now()}.txt`);
  const outPath = path.join(CLIPS_DIR, `clip-${Date.now()}.mp4`);
  const listBody = window.map((s) => `file '${s.full.replace(/\\/g, "/")}'`).join("\n");
  await writeFile(listPath, listBody, "utf8");

  await new Promise((resolve, reject) => {
    const proc = spawnFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      outPath,
    ]);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg concat exit ${code}`));
    });
  });

  return outPath;
}

async function uploadClip(filePath) {
  const slotRes = await fetch(`${API_BASE}/clips/upload-slot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ court_key: COURT_KEY }),
  });
  if (!slotRes.ok) {
    throw new Error(`upload-slot ${slotRes.status}: ${await slotRes.text()}`);
  }
  const slot = await slotRes.json();
  const bytes = await (await import("node:fs/promises")).readFile(filePath);

  const putRes = await fetch(`${API_BASE}${slot.upload_url}`, {
    method: "PUT",
    headers: { "content-type": "video/mp4" },
    body: bytes,
  });
  if (!putRes.ok) {
    throw new Error(`put ${putRes.status}: ${await putRes.text()}`);
  }
  const result = await putRes.json();
  return {
    ...result,
    gallery: `${API_BASE}/c/${COURT_KEY}`,
    play: `${API_BASE}${result.play_url}`,
  };
}

async function handleReplay(source = "api") {
  if (busy) {
    log("replay ignorado (busy)");
    return { ok: false, error: "busy" };
  }
  busy = true;
  const t0 = Date.now();
  try {
    log(`replay trigger (${source}) — post-roll ${POST_ROLL_SEC}s`);
    await new Promise((r) => setTimeout(r, POST_ROLL_SEC * 1000));
    const clipPath = await buildClip();
    log("clip gerado:", clipPath);
    const uploaded = await uploadClip(clipPath);
    log("uploaded:", uploaded);
    log(`done in ${Date.now() - t0}ms`);
    return { ok: true, ...uploaded };
  } catch (err) {
    log("replay failed:", err.message ?? err);
    return { ok: false, error: String(err.message ?? err) };
  } finally {
    busy = false;
  }
}

function localRecordPage() {
  const gallery = `${API_BASE}/c/${COURT_KEY}`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Replay · local</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.5rem; }
    main { width: min(24rem, 100%); text-align: center; }
    button {
      width: 100%; font: inherit; font-size: 1.35rem; font-weight: 700;
      padding: 1.1rem 1.25rem; border: 0; border-radius: .75rem;
      background: #0a7; color: #fff; cursor: pointer;
    }
    button:disabled { opacity: .55; cursor: not-allowed; }
    #status { margin-top: 1rem; min-height: 1.5em; opacity: .85; }
    #status[data-state="error"] { color: #c33; }
    #status[data-state="ok"] { color: #0a7; }
    .meta { margin-top: 1.5rem; font-size: .9rem; opacity: .7; }
    a { color: inherit; }
  </style>
</head>
<body>
  <main>
    <h1>Gravar replay</h1>
    <p>Só neste PC · edge local</p>
    <button type="button" id="btn">Gravar agora</button>
    <p id="status" role="status"></p>
    <p class="meta">quadra <code>${COURT_KEY}</code><br />
      <a href="${gallery}" target="_blank" rel="noopener">abrir galeria</a>
    </p>
  </main>
  <script>
    const btn = document.getElementById('btn');
    const statusEl = document.getElementById('status');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      statusEl.dataset.state = '';
      statusEl.textContent = 'Gravando…';
      try {
        const res = await fetch('/local/replay', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'falhou');
        statusEl.dataset.state = 'ok';
        statusEl.innerHTML = 'Pronto! <a href="' + (data.play || data.gallery) + '" target="_blank" rel="noopener">ver clip</a>';
      } catch (err) {
        statusEl.dataset.state = 'error';
        statusEl.textContent = String(err.message || err);
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function startHttp() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/ui")) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(localRecordPage());
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, busy, court: COURT_KEY, api: API_BASE, local_ui: true }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/local/replay") {
      const result = await handleReplay("http");
      res.writeHead(result.ok ? 200 : 509, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      log(`porta ${EDGE_PORT} ocupada — API local não subiu`);
      return;
    }
    throw err;
  });
  // 127.0.0.1 = só esta máquina (não expõe na LAN / não vai pra Cloudflare)
  server.listen(EDGE_PORT, "127.0.0.1", () => {
    const ui = `http://127.0.0.1:${EDGE_PORT}/`;
    log(`UI local ${ui}`);
    log(`API local ${ui}local/replay`);
    if (process.env.OPEN_UI === "1") {
      spawn("cmd", ["/c", "start", "", ui], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    }
  });
}

function startKeyboard() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.on("keypress", (_str, key) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        shutdown();
        return;
      }
      if (key.name === "return" || key.name === "space" || key.name === "r") {
        void handleReplay("keyboard");
      }
    });
    log("teclas: Enter/Espaço/R = replay · Ctrl+C = sair");
  }
}

function shutdown() {
  log("shutdown");
  if (ffmpegProc && !ffmpegProc.killed) ffmpegProc.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await ensureDirs();
startBuffer();
startHttp();
startKeyboard();

log(`warming buffer ~${PRE_ROLL_SEC + 5}s...`);
log("trigger: UI local / POST /local/replay / Enter|Espaço|R");
