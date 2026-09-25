/**
 * Edge agent (dev) — buffer circular + upload pro Worker.
 *
 * Fonte:
 *   - RTSP_URL definido (edge/.env) → câmera
 *   - senão → testsrc sintético
 *
 * Uso:
 *   npm run edge
 *   curl -X POST http://127.0.0.1:8788/local/replay
 *   # ou Enter/Espaço/R neste processo
 *
 * Env: API_BASE, COURT_KEY, RTSP_URL, EDGE_PORT, PRE_ROLL_SEC, POST_ROLL_SEC, SEGMENT_SEC
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readdir, rm, writeFile, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

  log("starting ffmpeg buffer →", BUFFER_DIR);
  ffmpegProc = spawn("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"] });
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
    const proc = spawn(
      "ffmpeg",
      [
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
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
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

async function handleReplay(source = "api", requestId = null) {
  if (busy) {
    log("replay ignorado (busy)");
    return { ok: false, error: "busy" };
  }
  busy = true;
  const t0 = Date.now();
  try {
    log(
      `replay trigger (${source}${requestId ? ` ${requestId}` : ""}) — post-roll ${POST_ROLL_SEC}s`,
    );
    await new Promise((r) => setTimeout(r, POST_ROLL_SEC * 1000));
    const clipPath = await buildClip();
    log("clip gerado:", clipPath);
    const uploaded = await uploadClip(clipPath);
    log("uploaded:", uploaded);
    if (requestId) {
      await finishRequest(requestId, { ok: true, clip_id: uploaded.clip_id });
    }
    log(`done in ${Date.now() - t0}ms`);
    return { ok: true, ...uploaded };
  } catch (err) {
    log("replay failed:", err.message ?? err);
    if (requestId) {
      await finishRequest(requestId, {
        ok: false,
        error: String(err.message ?? err),
      }).catch((e) => log("finishRequest failed:", e.message ?? e));
    }
    return { ok: false, error: String(err.message ?? err) };
  } finally {
    busy = false;
  }
}

async function finishRequest(requestId, payload) {
  const res = await fetch(`${API_BASE}/edge/requests/${requestId}/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`finish ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function pollCloudTriggers() {
  if (busy) return;
  try {
    const res = await fetch(
      `${API_BASE}/edge/pending?court_key=${encodeURIComponent(COURT_KEY)}`,
    );
    if (!res.ok) {
      log("pending poll error:", res.status, await res.text());
      return;
    }
    const data = await res.json();
    if (!data.request?.id) return;
    log("cloud trigger claimed:", data.request.id);
    await handleReplay("cloud", data.request.id);
  } catch (err) {
    log("poll failed:", err.message ?? err);
  }
}

function startCloudPoll() {
  const ms = Number(process.env.POLL_MS ?? 1500);
  log(`polling cloud triggers every ${ms}ms`);
  setInterval(() => {
    void pollCloudTriggers();
  }, ms);
}

function startHttp() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, busy, court: COURT_KEY, api: API_BASE }));
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
      log(`porta ${EDGE_PORT} ocupada — API local desligada; cloud poll segue ativo`);
      return;
    }
    throw err;
  });
  server.listen(EDGE_PORT, "127.0.0.1", () => {
    log(`local API http://127.0.0.1:${EDGE_PORT}/local/replay`);
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
startCloudPoll();

// warm-up: espera alguns segmentos antes de aceitar replay “bom”
log(`warming buffer ~${PRE_ROLL_SEC + 5}s...`);
