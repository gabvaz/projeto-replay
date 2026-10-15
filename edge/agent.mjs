/**
 * Edge agent — buffer circular + fila de upload pro Worker.
 *
 * Fonte:
 *   - RTSP_URL definido (edge/.env ou /etc/replay/edge.env) → câmera
 *   - senão → testsrc sintético
 *
 * Gatilhos:
 *   - BUTTON_SERIAL (Linux) → ESP32 via USB: recebe BTN/HB, responde REC/OK/ERR/BUSY
 *   - UI/API local só em 127.0.0.1 (não vai pro Worker/Cloudflare)
 *   - teclado (Enter/Espaço/R) quando roda num terminal
 *
 * Uso:
 *   npm run edge          → terminal + teclado
 *   npm run edge:ui       → sobe e abre UI local (127.0.0.1)
 *   curl -X POST http://127.0.0.1:8788/local/replay
 */

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { freemem, homedir, loadavg, totalmem } from "node:os";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_LINUX = process.platform === "linux";

async function loadDotEnv(file) {
  try {
    const raw = await readFile(file, "utf8");
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

// systemd injeta /etc/replay/edge.env via EnvironmentFile; o .env local serve pro PC.
await loadDotEnv(path.join(__dirname, ".env"));

const API_BASE = (
  process.env.API_BASE ??
  "https://projeto-replay.gabrieltenoriovaz-10a.workers.dev"
).replace(/\/$/, "");
const COURT_KEY = process.env.COURT_KEY ?? "demo01";
const EDGE_TOKEN = process.env.EDGE_TOKEN?.trim() || "";
const AGENT_VERSION = "0.4.1";
/** Câmera instalada deitada → flag de rotação no MP4 (graus horário, sem re-encode). */
const CAMERA_ROTATION = Number(process.env.CAMERA_ROTATION ?? 0);
const THUMB_WIDTH = 480;
const HEARTBEAT_SEC = Number(process.env.HEARTBEAT_SEC ?? 60);
const RTSP_URL = process.env.RTSP_URL?.trim() || "";
const RTSP_TRANSPORT = process.env.RTSP_TRANSPORT === "udp" ? "udp" : "tcp";
const EDGE_PORT = Number(process.env.EDGE_PORT ?? 8788);
const PRE_ROLL_SEC = Number(process.env.PRE_ROLL_SEC ?? 15);
const POST_ROLL_SEC = Number(process.env.POST_ROLL_SEC ?? 3);
const SEGMENT_SEC = Number(process.env.SEGMENT_SEC ?? 2);
const COOLDOWN_SEC = Number(process.env.COOLDOWN_SEC ?? 5);
const OUTBOX_MAX_MB = Number(process.env.OUTBOX_MAX_MB ?? 200);
const BUTTON_SERIAL = process.env.BUTTON_SERIAL?.trim() || "";
/** Sem segmento novo nesse tempo = câmera travada mesmo com o ffmpeg vivo. */
const STALL_SEC = Math.max(3 * SEGMENT_SEC, 6);
/** ESP32 manda HB a cada 10s. */
const BUTTON_HB_TIMEOUT_MS = 30_000;

// Buffer em RAM no Pi: um .ts a cada 2s mata o cartão SD em semanas.
const BUFFER_DIR = process.env.BUFFER_DIR
  ? path.resolve(process.env.BUFFER_DIR)
  : IS_LINUX && existsSync("/dev/shm")
    ? "/dev/shm/replay"
    : path.join(__dirname, ".buffer");
const OUTBOX_DIR = process.env.OUTBOX_DIR
  ? path.resolve(process.env.OUTBOX_DIR)
  : path.join(__dirname, ".outbox");
const EVENTS_FILE = path.join(OUTBOX_DIR, "events.jsonl");

const SEGMENT_WRAP = Math.ceil((PRE_ROLL_SEC + POST_ROLL_SEC + 10) / SEGMENT_SEC) + 5;
const FFMPEG_BACKOFF_SEC = [1, 2, 5, 10, 30];
const UPLOAD_BACKOFF_SEC = [5, 15, 30, 60, 120, 300];

let ffmpegProc = null;
let ffmpegStartedAt = 0;
let ffmpegBackoff = 0;
let ffmpegRestarts = 0;
/** Timestamps dos reinícios na última hora (vira alerta no Worker). */
let ffmpegRestartTimes = [];
let stopping = false;
let busy = false;
let cooldownUntil = 0;
let lastButtonHb = 0;
let uploadFailures = 0;
let nextUploadAt = 0;
let flushing = null;

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

/** ffmpeg >= 6 ignora a tag "rotate"; usa -display_rotation (anti-horário) na entrada. */
const FFMPEG_MAJOR = Number(
  spawnSync(FFMPEG_BIN, ["-version"], { encoding: "utf8" }).stdout?.match(/ffmpeg version n?(\d+)/)?.[1] ?? 0,
);

function rotationArgs() {
  if (!CAMERA_ROTATION) return { input: [], output: [] };
  if (FFMPEG_MAJOR >= 6) return { input: ["-display_rotation", String(-CAMERA_ROTATION)], output: [] };
  return { input: [], output: ["-metadata:s:v:0", `rotate=${CAMERA_ROTATION}`] };
}

function spawnFfmpeg(args, opts = {}) {
  const proc = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "inherit", "pipe"], ...opts });
  // ffmpeg ecoa a URL RTSP (com senha) nos erros; no Pi isso iria pro journald.
  proc.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk.toString("utf8").replace(/(rtsps?:\/\/[^:/@\s]+):[^@\s]+@/g, "$1:***@"));
  });
  proc.on("error", (err) => {
    log("ffmpeg spawn error:", err.message ?? err);
  });
  return proc;
}

/* ---------------------------------------------------------------- eventos */

/** Vão no próximo heartbeat; ficam em disco pra sobreviver a reinício sem internet. */
let pendingEvents = [];
const MAX_PENDING_EVENTS = 500;

function pushEvent(type, detail = null) {
  const ev = { type, detail: detail === null ? null : String(detail).slice(0, 200), at: new Date().toISOString() };
  pendingEvents.push(ev);
  if (pendingEvents.length > MAX_PENDING_EVENTS) pendingEvents = pendingEvents.slice(-MAX_PENDING_EVENTS);
  appendFile(EVENTS_FILE, `${JSON.stringify(ev)}\n`).catch(() => {});
}

async function loadEvents() {
  try {
    const raw = await readFile(EVENTS_FILE, "utf8");
    pendingEvents = raw
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      })
      .slice(-MAX_PENDING_EVENTS);
  } catch {
    pendingEvents = [];
  }
}

async function saveEvents() {
  const body = pendingEvents.map((e) => JSON.stringify(e)).join("\n");
  await writeFile(EVENTS_FILE, body ? `${body}\n` : "");
}

/* ----------------------------------------------------------------- buffer */

async function ensureDirs() {
  await clearBuffer();
  await mkdir(OUTBOX_DIR, { recursive: true });
}

async function clearBuffer() {
  try {
    await rm(BUFFER_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    log("warn: limpeza buffer falhou:", err.message ?? err);
  }
  await mkdir(BUFFER_DIR, { recursive: true });
}

function bufferArgs() {
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

  if (RTSP_URL) {
    // H.264 copy; drop áudio pcm_alaw. -timeout (µs) faz o ffmpeg sair se a câmera sumir.
    return [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-rtsp_transport",
      RTSP_TRANSPORT,
      "-timeout",
      "5000000",
      "-i",
      RTSP_URL,
      "-map",
      "0:v:0",
      "-c:v",
      "copy",
      ...segmentTail,
    ];
  }
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-re",
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
}

/** Supervisor: ffmpeg que sai volta com backoff; buffer velho é descartado (clip com buraco não serve). */
function startBuffer() {
  if (stopping) return;
  ffmpegStartedAt = Date.now();
  ffmpegProc = spawnFfmpeg(bufferArgs());
  const proc = ffmpegProc;
  proc.on("exit", (code, signal) => {
    if (ffmpegProc === proc) ffmpegProc = null;
    if (stopping) return;
    if (Date.now() - ffmpegStartedAt > 60_000) ffmpegBackoff = 0;
    const delay = FFMPEG_BACKOFF_SEC[Math.min(ffmpegBackoff++, FFMPEG_BACKOFF_SEC.length - 1)];
    ffmpegRestarts += 1;
    ffmpegRestartTimes.push(Date.now());
    pushEvent("ffmpeg_restart", `code=${code} signal=${signal}`);
    log(`ffmpeg saiu (code=${code} signal=${signal}) — reinicia em ${delay}s`);
    setTimeout(() => {
      void clearBuffer().then(startBuffer);
    }, delay * 1000);
  });
}

function startStallWatch() {
  setInterval(async () => {
    if (!ffmpegProc || Date.now() - ffmpegStartedAt < (STALL_SEC + PRE_ROLL_SEC) * 1000) return;
    const newest = (await listSegmentsNewestFirst().catch(() => []))[0];
    if (newest && Date.now() - newest.mtimeMs < STALL_SEC * 1000) return;
    log(`buffer parado há >${STALL_SEC}s — matando ffmpeg`);
    ffmpegProc.kill("SIGKILL");
  }, SEGMENT_SEC * 1000);
}

async function listSegmentsNewestFirst() {
  const names = await readdir(BUFFER_DIR);
  const segs = [];
  for (const name of names) {
    if (!name.endsWith(".ts")) continue;
    const full = path.join(BUFFER_DIR, name);
    try {
      const st = await stat(full);
      segs.push({ name, full, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      // segmento sobrescrito no meio da listagem
    }
  }
  segs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return segs.filter((s) => s.size > 0);
}

function runFfmpeg(args, label) {
  return new Promise((resolve, reject) => {
    const proc = spawnFfmpeg(args);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg ${label} exit ${code}`));
    });
  });
}

async function buildClip(outPath) {
  const wantSec = PRE_ROLL_SEC + POST_ROLL_SEC;
  const segments = await listSegmentsNewestFirst();

  // O muxer só corta em keyframe: com GOP da câmera > SEGMENT_SEC cada arquivo dura mais que
  // SEGMENT_SEC. A duração real de cada um é o intervalo entre o mtime dele e o do anterior.
  const picked = [];
  let covered = 0;
  for (let i = 0; i < segments.length && covered < wantSec; i++) {
    picked.push(segments[i]);
    const older = segments[i + 1];
    covered += older ? (segments[i].mtimeMs - older.mtimeMs) / 1000 : SEGMENT_SEC;
  }
  if (picked.length < 3 || covered < wantSec / 2) {
    throw new Error(`buffer ainda frio: ${covered.toFixed(0)}s de ${wantSec}s`);
  }

  const window = picked.reverse();
  const listPath = `${outPath}.concat.txt`;
  const listBody = window.map((s) => `file '${s.full.replace(/\\/g, "/")}'`).join("\n");
  await writeFile(listPath, listBody, "utf8");

  const rotation = rotationArgs();
  try {
    await runFfmpeg(
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        ...rotation.input,
        "-i",
        listPath,
        "-c",
        "copy",
        ...rotation.output,
        "-movflags",
        "+faststart",
        outPath,
      ],
      "concat",
    );
  } finally {
    await rm(listPath, { force: true });
  }
}

/** 1 frame perto do fim (o lance) → JPG pequeno. Só decodifica esse frame; o vídeo não é re-encodado. */
async function buildThumbnail(clipPath, thumbPath) {
  await runFfmpeg(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-sseof",
      "-2",
      "-i",
      clipPath,
      "-frames:v",
      "1",
      "-vf",
      `scale=${THUMB_WIDTH}:-2`,
      "-q:v",
      "5",
      thumbPath,
    ],
    "thumb",
  );
}

/* ----------------------------------------------------------------- outbox */

/**
 * Cada clip vira <id>.mp4 (+ .jpg) + <id>.json no OUTBOX_DIR. O .json é escrito por último
 * (rename atômico): sem ele o clip não está completo e não é enviado.
 */
const entryPath = (id, ext) => path.join(OUTBOX_DIR, `${id}.${ext}`);

async function listOutbox() {
  const names = await readdir(OUTBOX_DIR).catch(() => []);
  const entries = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      entries.push(JSON.parse(await readFile(path.join(OUTBOX_DIR, name), "utf8")));
    } catch {
      // .json corrompido: some no próximo enforceOutboxLimit
    }
  }
  return entries.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
}

async function removeEntry(id) {
  await Promise.all(["mp4", "jpg", "json"].map((ext) => rm(entryPath(id, ext), { force: true })));
}

async function outboxBytes(entries) {
  let total = 0;
  for (const e of entries) {
    for (const ext of ["mp4", "jpg"]) {
      total += await stat(entryPath(e.clip_id, ext)).then((s) => s.size, () => 0);
    }
  }
  return total;
}

/** Sem internet por dias: descarta os mais antigos pra não lotar o SD. */
async function enforceOutboxLimit() {
  const entries = await listOutbox();
  let total = await outboxBytes(entries);
  while (entries.length && total > OUTBOX_MAX_MB * 1048576) {
    const oldest = entries.shift();
    total -= await outboxBytes([oldest]);
    await removeEntry(oldest.clip_id);
    pushEvent("queue_drop", oldest.clip_id);
    log("outbox cheio — descartado", oldest.clip_id);
  }
}

/** Erro que não melhora tentando de novo (quadra apagada, payload inválido). */
class PermanentError extends Error {}

async function edgeFetch(pathname, init) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${EDGE_TOKEN}`, ...init.headers },
    signal: AbortSignal.timeout(120_000),
  });
  return res;
}

async function uploadEntry(entry) {
  const slotRes = await edgeFetch("/edge/clips/upload-slot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ court_key: entry.court_key, clip_id: entry.clip_id, recorded_at: entry.recorded_at }),
  });
  if (!slotRes.ok) {
    const msg = `upload-slot ${slotRes.status}: ${await slotRes.text()}`;
    if ([400, 404, 409].includes(slotRes.status)) throw new PermanentError(msg);
    throw new Error(msg);
  }
  const slot = await slotRes.json();

  const putRes = await edgeFetch(slot.upload_url, {
    method: "PUT",
    headers: { "content-type": "video/mp4" },
    body: await readFile(entryPath(entry.clip_id, "mp4")),
  });
  // 409 = já subiu numa tentativa anterior que perdeu a resposta.
  if (!putRes.ok && putRes.status !== 409) {
    throw new Error(`put ${putRes.status}: ${await putRes.text()}`);
  }

  const thumb = await readFile(entryPath(entry.clip_id, "jpg")).catch(() => null);
  if (thumb) {
    const thumbRes = await edgeFetch(slot.thumbnail_url, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: thumb,
    }).catch((err) => ({ ok: false, status: 0, text: async () => String(err) }));
    if (!thumbRes.ok) log(`thumbnail ${thumbRes.status}: ${await thumbRes.text()}`);
  }
}

/** Envia a fila em ordem. Uma execução por vez; quem chama durante uma execução espera a mesma. */
function flushOutbox() {
  if (!flushing) {
    flushing = (async () => {
      for (const entry of await listOutbox()) {
        try {
          await uploadEntry(entry);
          await removeEntry(entry.clip_id);
          uploadFailures = 0;
          nextUploadAt = 0;
          pushEvent("clip_ok", entry.clip_id);
          log("enviado:", `${API_BASE}/v/${entry.clip_id}`);
        } catch (err) {
          if (err instanceof PermanentError) {
            await removeEntry(entry.clip_id);
            pushEvent("clip_fail", `${entry.clip_id} ${err.message}`);
            log("descartado (erro permanente):", err.message);
            continue;
          }
          uploadFailures += 1;
          const delay = UPLOAD_BACKOFF_SEC[Math.min(uploadFailures - 1, UPLOAD_BACKOFF_SEC.length - 1)];
          nextUploadAt = Date.now() + delay * 1000;
          log(`upload falhou (${err.message ?? err}) — tenta de novo em ${delay}s`);
          break;
        }
      }
    })().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

function startUploadLoop() {
  setInterval(() => {
    if (Date.now() >= nextUploadAt) void flushOutbox();
  }, 5000);
}

/* ----------------------------------------------------------------- replay */

async function handleReplay(source = "api") {
  if (busy || Date.now() < cooldownUntil) {
    log(`replay ignorado (${busy ? "busy" : "cooldown"})`);
    return { ok: false, error: "busy" };
  }
  busy = true;
  const t0 = Date.now();
  const clipId = randomUUID();
  pushEvent("press", source);
  try {
    log(`replay trigger (${source}) — post-roll ${POST_ROLL_SEC}s`);
    await new Promise((r) => setTimeout(r, POST_ROLL_SEC * 1000));
    const recordedAt = new Date().toISOString();
    const mp4 = entryPath(clipId, "mp4");
    await buildClip(mp4);
    await buildThumbnail(mp4, entryPath(clipId, "jpg")).catch((err) => {
      log("thumbnail falhou (clip segue sem):", err.message ?? err);
    });
    const meta = { clip_id: clipId, court_key: COURT_KEY, recorded_at: recordedAt };
    await writeFile(`${entryPath(clipId, "json")}.tmp`, JSON.stringify(meta));
    await rename(`${entryPath(clipId, "json")}.tmp`, entryPath(clipId, "json"));
    await enforceOutboxLimit();
    log(`clip gerado em ${Date.now() - t0}ms`);
  } catch (err) {
    log("replay failed:", err.message ?? err);
    await removeEntry(clipId);
    pushEvent("clip_fail", String(err.message ?? err));
    return { ok: false, error: String(err.message ?? err) };
  } finally {
    busy = false;
    cooldownUntil = Date.now() + COOLDOWN_SEC * 1000;
  }

  // Gravado = sucesso pro jogador; sem internet ele aparece na galeria quando a fila esvaziar.
  return { ok: true, clip_id: clipId };
}

/** UI/teclado: espera a fila pra poder mostrar o link do clip. */
async function replayAndUpload(source) {
  const result = await handleReplay(source);
  if (!result.ok) return result;
  await flushOutbox();
  return {
    ...result,
    queued: existsSync(entryPath(result.clip_id, "json")),
    gallery: `${API_BASE}/q/${COURT_KEY}`,
    play: `${API_BASE}/v/${result.clip_id}`,
  };
}

/* ------------------------------------------------------------------ serial */

/**
 * ESP32 via USB (Linux). Protocolo por linha:
 *   ESP32 → Pi: BTN (apertou), HB (vivo, a cada 10s)
 *   Pi → ESP32: ACK (resposta ao HB), REC (gravando), OK, ERR, BUSY
 * Sem dependência npm: stty configura a porta e o device é lido como arquivo.
 */
function startSerial() {
  if (!BUTTON_SERIAL) return;
  if (!IS_LINUX) {
    log("BUTTON_SERIAL só funciona no Linux — ignorado");
    return;
  }

  let reader = null;
  let writer = null;
  let retryTimer = null;

  const send = (msg) => {
    if (writer && !writer.destroyed) writer.write(`${msg}\n`);
  };

  let lastWhy = "";
  const retry = (why) => {
    if (stopping || retryTimer) return;
    // Sem ESP32 plugado isso roda a cada 3s; repetir a mesma linha só enche o journal.
    if (why && why !== lastWhy) log(`botão: ${why} — tentando de novo a cada 3s`);
    lastWhy = why ?? "";
    reader?.destroy();
    writer?.destroy();
    reader = writer = null;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, 3000);
  };

  const open = () => {
    if (!existsSync(BUTTON_SERIAL)) return retry(`${BUTTON_SERIAL} não existe`);
    // -hupcl: não derruba DTR ao fechar (evita reset do ESP32 a cada reconexão).
    const stty = spawnSync("stty", ["-F", BUTTON_SERIAL, "115200", "raw", "-echo", "-hupcl"], {
      encoding: "utf8",
    });
    if (stty.status !== 0) return retry(`stty falhou: ${stty.stderr?.trim()}`);

    reader = createReadStream(BUTTON_SERIAL, { highWaterMark: 64 });
    writer = createWriteStream(BUTTON_SERIAL, { flags: "a" });
    let buf = "";
    reader.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim().toUpperCase();
        buf = buf.slice(nl + 1);
        if (line === "HB") {
          lastButtonHb = Date.now();
          send("ACK");
        }
        if (line === "BTN") {
          lastButtonHb = Date.now();
          if (busy || Date.now() < cooldownUntil) {
            send("BUSY");
            continue;
          }
          send("REC");
          void handleReplay("button").then((r) => {
            send(r.ok ? "OK" : r.error === "busy" ? "BUSY" : "ERR");
            if (r.ok) void flushOutbox();
          });
        }
      }
      if (buf.length > 256) buf = "";
    });
    reader.on("error", (err) => retry(`leitura: ${err.message}`));
    reader.on("close", () => retry("porta fechou"));
    writer.on("error", (err) => retry(`escrita: ${err.message}`));
    lastWhy = "";
    log("botão conectado em", BUTTON_SERIAL);
  };

  open();
}

/* --------------------------------------------------------------- heartbeat */

function readPiHealth() {
  const out = {};
  try {
    out.temp_c = Number(readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8")) / 1000;
  } catch {
    /* sem sensor (PC) */
  }
  const thr = spawnSync("vcgencmd", ["get_throttled"], { encoding: "utf8" });
  if (thr.status === 0) out.throttled = thr.stdout.trim().replace("throttled=", "");
  return out;
}

async function sendHeartbeat() {
  let segments = 0;
  try {
    segments = (await readdir(BUFFER_DIR)).filter((n) => n.endsWith(".ts")).length;
  } catch {
    /* buffer ainda não existe */
  }
  const hourAgo = Date.now() - 3600_000;
  ffmpegRestartTimes = ffmpegRestartTimes.filter((t) => t > hourAgo);
  const events = pendingEvents.slice(0, 50);
  const payload = {
    agent_version: AGENT_VERSION,
    court_key: COURT_KEY,
    uptime_s: Math.round(process.uptime()),
    buffer_alive: Boolean(ffmpegProc && ffmpegProc.exitCode === null),
    segments,
    busy,
    queue_len: (await listOutbox()).length,
    ffmpeg_restarts: ffmpegRestarts,
    ffmpeg_restarts_1h: ffmpegRestartTimes.length,
    ...(BUTTON_SERIAL ? { button_alive: Date.now() - lastButtonHb < BUTTON_HB_TIMEOUT_MS } : {}),
    load1: loadavg()[0],
    mem_free_mb: Math.round(freemem() / 1048576),
    mem_total_mb: Math.round(totalmem() / 1048576),
    rss_mb: Math.round(process.memoryUsage().rss / 1048576),
    ...readPiHealth(),
    events,
  };
  try {
    const res = await edgeFetch("/edge/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      log(`heartbeat ${res.status}: ${await res.text()}`);
      return;
    }
    // Só tira da fila o que foi enviado; o que chegou durante o fetch fica pro próximo.
    pendingEvents = pendingEvents.slice(events.length);
    await saveEvents();
    if (Date.now() >= nextUploadAt) void flushOutbox();
  } catch (err) {
    log("heartbeat falhou:", err.message ?? err);
  }
}

function startHeartbeat() {
  void sendHeartbeat();
  setInterval(() => void sendHeartbeat(), HEARTBEAT_SEC * 1000);
}

/* ---------------------------------------------------------------- UI local */

function localRecordPage() {
  const gallery = `${API_BASE}/q/${COURT_KEY}`;
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
        statusEl.innerHTML = data.queued
          ? 'Gravado! Sem internet agora — sobe sozinho quando voltar.'
          : 'Pronto! <a href="' + data.play + '" target="_blank" rel="noopener">ver clip</a>';
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
      res.end(
        JSON.stringify({
          ok: true,
          busy,
          court: COURT_KEY,
          api: API_BASE,
          buffer_alive: Boolean(ffmpegProc),
          queue_len: (await listOutbox()).length,
          pending_events: pendingEvents.length,
          local_ui: true,
        }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/local/replay") {
      const result = await replayAndUpload("http");
      res.writeHead(result.ok ? 200 : result.error === "busy" ? 429 : 500, {
        "content-type": "application/json",
      });
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
  if (!process.stdin.isTTY) return;
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on("keypress", (_str, key) => {
    if (!key) return;
    if (key.ctrl && key.name === "c") {
      shutdown();
      return;
    }
    if (key.name === "return" || key.name === "space" || key.name === "r") {
      void replayAndUpload("keyboard").then((r) => log("resultado:", JSON.stringify(r)));
    }
  });
  log("teclas: Enter/Espaço/R = replay · Ctrl+C = sair");
}

function shutdown() {
  log("shutdown");
  stopping = true;
  if (ffmpegProc && !ffmpegProc.killed) ffmpegProc.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// Estado desconhecido: melhor morrer e o systemd subir limpo do que ficar meio vivo.
process.on("uncaughtException", (err) => {
  log("erro fatal:", err.stack ?? err);
  stopping = true;
  ffmpegProc?.kill("SIGKILL");
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  log("promise rejeitada:", err?.stack ?? err);
});

if (!EDGE_TOKEN) {
  console.error("EDGE_TOKEN ausente no edge/.env (gere com: npm run admin:device).");
  process.exit(1);
}

await ensureDirs();
await loadEvents();
pushEvent("boot", AGENT_VERSION);
log(`buffer: ${BUFFER_DIR} · outbox: ${OUTBOX_DIR}`);
log(RTSP_URL ? `fonte: RTSP/${RTSP_TRANSPORT} ${redactUrl(RTSP_URL)}` : "fonte: testsrc (sem RTSP_URL)");
startBuffer();
startStallWatch();
startHttp();
startKeyboard();
startSerial();
startHeartbeat();
startUploadLoop();

log(`warming buffer ~${PRE_ROLL_SEC + 5}s...`);
log("trigger: botão serial / UI local / POST /local/replay / Enter|Espaço|R");
