/**
 * Load test: 6 cams, ring buffer ~20s (pre-roll do PASSADO) + trigger.
 *
 * Uso:
 *   node edge/loadtest-6cam.mjs
 *   node edge/loadtest-6cam.mjs --pi3          # falha se estourar envelope Pi 3 B+
 *   powershell -File edge/run-loadtest-pi3.ps1 # LIMITA RAM/CPU via Job Object (Windows)
 *
 * --mode=copy|encode  --cams=6 --pre=20 --duration=120 --trigger-after=40
 * --rtsp=rtsp://...   cam0 vira câmera real (--rtsp-transport=udp|tcp)
 * No Pi (Linux) também loga RAM livre do sistema, temperatura e throttling.
 * --limit-ram-mb=700  --limit-cpu-cores=4   (só informativo no node; limite real = .ps1)
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, cpus } from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const PI3 = hasFlag("pi3");
const CAMS = Number(arg("cams", "6"));
const PRE_ROLL_SEC = Number(arg("pre", "20"));
const POST_ROLL_SEC = Number(arg("post", "0"));
const SEGMENT_SEC = Number(arg("sec", "2"));
const DURATION_SEC = (() => {
  const n = Number(arg("duration", PI3 ? "90" : "120"));
  return Number.isFinite(n) && n > 0 ? n : PI3 ? 90 : 120;
})();
const MODE = arg("mode", "copy");
/** cam0 puxa RTSP real; demais seguem simuladas (Yoosee aguenta mal >1 sessão). */
const RTSP_URL = arg("rtsp", "");
const RTSP_TRANSPORT = arg("rtsp-transport", "udp");
const TRIGGER_AFTER_SEC = (() => {
  const n = Number(arg("trigger-after", "35"));
  return Number.isFinite(n) && n > 0 ? n : 35;
})();
/** Envelope Pi 3 B+: ~1 GB RAM total; OS+Node ~250–350 → apps ~650–750 */
const LIMIT_RAM_MB = (() => {
  const n = Number(arg("limit-ram-mb", PI3 ? "700" : "0"));
  return Number.isFinite(n) ? n : 0;
})();
const LIMIT_CPU_CORES = (() => {
  const n = Number(arg("limit-cpu-cores", PI3 ? "4" : "0"));
  return Number.isFinite(n) ? n : 0;
})();
const HOST_CORES = cpus().length || 1;
const ROOT = path.join(__dirname, ".loadtest-6cam");
const SEGMENT_WRAP =
  Math.ceil((PRE_ROLL_SEC + POST_ROLL_SEC + 10) / SEGMENT_SEC) + 5;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

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
        if (ent.isFile() && /^ffmpeg(\.exe)?$/i.test(ent.name)) return full;
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
  return null;
}

const FFMPEG = resolveFfmpegBin();
if (!FFMPEG) {
  console.error("ffmpeg não encontrado");
  process.exit(1);
}

/** @type {import('node:child_process').ChildProcess[]} */
const procs = [];
let stopping = false;

/** @type {{ t: number, ffmpegCpuMs: number, nodeCpuMs: number } | null} */
let prevSample = null;

function spawnFf(args, label) {
  const proc = spawn(FFMPEG, args, {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  proc.stderr?.on("data", (buf) => {
    const line = buf.toString().trim();
    if (line && !stopping) log(`[${label}]`, line.slice(0, 200));
  });
  proc.on("exit", (code, signal) => {
    if (!stopping) log(`[${label}] EXIT code=${code} signal=${signal}`);
  });
  procs.push(proc);
  return proc;
}

/**
 * Amostra RSS + CPU% (média no intervalo desde a última amostra).
 * CPU% = 100 * delta_cpu_time / (wall * host_cores)  → 100% = saturou a máquina inteira.
 * cpu_equiv_cores = delta_cpu_time / wall  → quantos cores “cheios” os procs usaram.
 */
function sampleResources() {
  const now = Date.now();
  if (process.platform === "win32") {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$ff = @(Get-Process ffmpeg)
$node = Get-Process -Id ${process.pid}
$ffRss = ($ff | Measure-Object WorkingSet64 -Sum).Sum
$nodeRss = $node.WorkingSet64
$ffCpu = ($ff | Measure-Object CPU -Sum).Sum
if (-not $ffCpu) { $ffCpu = 0 }
$nodeCpu = $node.CPU
if (-not $nodeCpu) { $nodeCpu = 0 }
$ffCount = $ff.Count
Write-Output "$ffCount|$ffRss|$nodeRss|$ffCpu|$nodeCpu"
`;
    const out = spawnSync("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
    });
    const parts = String(out.stdout).trim().split("|").map(Number);
    const [ffCount, ffRss, nodeRss, ffCpuSec, nodeCpuSec] = parts;
    const ffmpegCpuMs = (ffCpuSec || 0) * 1000;
    const nodeCpuMs = (nodeCpuSec || 0) * 1000;
    let ffmpegCpuPct = 0;
    let nodeCpuPct = 0;
    let equivCores = 0;
    if (prevSample) {
      const wallMs = Math.max(1, now - prevSample.t);
      const dFf = Math.max(0, ffmpegCpuMs - prevSample.ffmpegCpuMs);
      const dNode = Math.max(0, nodeCpuMs - prevSample.nodeCpuMs);
      ffmpegCpuPct = (100 * dFf) / (wallMs * HOST_CORES);
      nodeCpuPct = (100 * dNode) / (wallMs * HOST_CORES);
      equivCores = (dFf + dNode) / wallMs;
    }
    prevSample = { t: now, ffmpegCpuMs, nodeCpuMs };
    return {
      ffmpegCount: ffCount || 0,
      ffmpegRssMb: (ffRss || 0) / (1024 * 1024),
      nodeRssMb: (nodeRss || 0) / (1024 * 1024),
      totalRssMb: ((ffRss || 0) + (nodeRss || 0)) / (1024 * 1024),
      ffmpegCpuPct,
      nodeCpuPct,
      equivCores,
    };
  }

  // Linux (Pi): /proc/<pid>/stat utime+stime (ticks de 100 Hz) + statm (páginas de 4 KB)
  let ffTicks = 0;
  let ffRssKb = 0;
  let ffCount = 0;
  for (const p of procs) {
    if (p.exitCode !== null || !p.pid) continue;
    try {
      const stat = readFileSync(`/proc/${p.pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      ffTicks += Number(fields[11]) + Number(fields[12]);
      ffRssKb += Number(readFileSync(`/proc/${p.pid}/statm`, "utf8").split(" ")[1]) * 4;
      ffCount += 1;
    } catch {
      /* processo saiu entre o filtro e a leitura */
    }
  }
  const ffmpegCpuMs = ffTicks * 10;
  const cu = process.cpuUsage();
  const nodeCpuMs = (cu.user + cu.system) / 1000;
  let ffmpegCpuPct = 0;
  let nodeCpuPct = 0;
  let equivCores = 0;
  if (prevSample) {
    const wallMs = Math.max(1, now - prevSample.t);
    const dFf = Math.max(0, ffmpegCpuMs - prevSample.ffmpegCpuMs);
    const dNode = Math.max(0, nodeCpuMs - prevSample.nodeCpuMs);
    ffmpegCpuPct = (100 * dFf) / (wallMs * HOST_CORES);
    nodeCpuPct = (100 * dNode) / (wallMs * HOST_CORES);
    equivCores = (dFf + dNode) / wallMs;
  }
  prevSample = { t: now, ffmpegCpuMs, nodeCpuMs };
  const self = process.memoryUsage().rss / (1024 * 1024);
  return {
    ffmpegCount: ffCount,
    ffmpegRssMb: ffRssKb / 1024,
    nodeRssMb: self,
    totalRssMb: ffRssKb / 1024 + self,
    ffmpegCpuPct,
    nodeCpuPct,
    equivCores,
    ...readPiHealth(),
  };
}

/** Saúde do sistema no Linux/Pi: RAM livre real, temperatura do SoC, throttling. */
function readPiHealth() {
  const out = {};
  try {
    const mem = readFileSync("/proc/meminfo", "utf8");
    const avail = mem.match(/MemAvailable:\s+(\d+)/);
    if (avail) out.memAvailableMb = Number(avail[1]) / 1024;
  } catch {
    /* sem /proc */
  }
  try {
    out.tempC = Number(readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8")) / 1000;
  } catch {
    /* sem sensor */
  }
  const thr = spawnSync("vcgencmd", ["get_throttled"], { encoding: "utf8" });
  if (thr.status === 0) out.throttled = thr.stdout.trim().replace("throttled=", "");
  return out;
}

async function countSegs(dir) {
  try {
    const names = await readdir(dir);
    let n = 0;
    let bytes = 0;
    for (const name of names) {
      if (!name.endsWith(".ts")) continue;
      n += 1;
      bytes += (await stat(path.join(dir, name))).size;
    }
    return { n, bytes };
  } catch {
    return { n: 0, bytes: 0 };
  }
}

async function buildClipFromBuffer(bufDir, outPath) {
  const needed = Math.ceil((PRE_ROLL_SEC + POST_ROLL_SEC) / SEGMENT_SEC);
  const names = await readdir(bufDir);
  const segs = [];
  for (const name of names) {
    if (!name.endsWith(".ts")) continue;
    const full = path.join(bufDir, name);
    const st = await stat(full);
    if (st.size > 0) segs.push({ full, mtimeMs: st.mtimeMs });
  }
  segs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (segs.length < Math.max(3, Math.floor(needed / 2))) {
    throw new Error(`buffer frio: ${segs.length} segs (precisa ~${needed})`);
  }
  const window = segs.slice(0, needed).reverse();
  const listPath = outPath + ".txt";
  await writeFile(
    listPath,
    window.map((s) => `file '${s.full.replace(/\\/g, "/")}'`).join("\n"),
    "utf8",
  );
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    const proc = spawn(
      FFMPEG,
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
      { stdio: "inherit", windowsHide: true },
    );
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`concat exit ${code}`)),
    );
  });
  const st = await stat(outPath);
  return { ms: Date.now() - t0, bytes: st.size, segs: window.length };
}

async function makeSeed(seedPath) {
  if (existsSync(seedPath)) {
    log("seed ok:", seedPath);
    return;
  }
  log("gerando seed H.264 720p15 (~30s)…");
  await new Promise((resolve, reject) => {
    const proc = spawn(
      FFMPEG,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=1280x720:rate=15",
        "-t",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "30",
        "-an",
        "-f",
        "mpegts",
        seedPath,
      ],
      { stdio: "inherit", windowsHide: true },
    );
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`seed exit ${code}`)),
    );
  });
}

function startCopyCam(i, seedPath, bufDir) {
  const pattern = path.join(bufDir, "seg_%03d.ts");
  return spawnFf(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-re",
      "-stream_loop",
      "-1",
      "-i",
      seedPath,
      "-map",
      "0:v:0",
      "-c:v",
      "copy",
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
    ],
    `cam${i}`,
  );
}

function startRtspCam(i, url, bufDir) {
  const pattern = path.join(bufDir, "seg_%03d.ts");
  return spawnFf(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-rtsp_transport",
      RTSP_TRANSPORT,
      "-i",
      url,
      "-map",
      "0:v:0",
      "-c:v",
      "copy",
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
    ],
    `cam${i}-rtsp`,
  );
}

function startEncodeCam(i, bufDir) {
  const pattern = path.join(bufDir, "seg_%03d.ts");
  return spawnFf(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=1280x720:rate=15:decimals=1`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "30",
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
    ],
    `cam${i}`,
  );
}

async function shutdown(code) {
  stopping = true;
  for (const p of procs) {
    try {
      p.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 800));
  for (const p of procs) {
    try {
      p.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

async function main() {
  const constrained = process.env.LOADTEST_CONSTRAINED === "1";
  log("=== loadtest 6cam (pre-roll passado) ===");
  log({
    CAMS,
    PRE_ROLL_SEC,
    SEGMENT_SEC,
    DURATION_SEC,
    MODE,
    PI3,
    LIMIT_RAM_MB: LIMIT_RAM_MB || null,
    LIMIT_CPU_CORES: LIMIT_CPU_CORES || null,
    HOST_CORES,
    constrained,
    jobLimits: constrained
      ? "Job Object ativo (RAM/CPU limitados)"
      : "SEM limite de cgroup — use: npm run edge:loadtest-pi3",
  });

  if (PI3 && !constrained && process.platform === "win32") {
    log(
      "AVISO: --pi3 sem Job Object só mede e falha por threshold. Pra LIMITAR de verdade: npm run edge:loadtest-pi3",
    );
  }

  await rm(ROOT, { recursive: true, force: true });
  await mkdir(ROOT, { recursive: true });

  const seedPath = path.join(ROOT, "seed.ts");
  if (MODE === "copy") await makeSeed(seedPath);

  const bufDirs = [];
  for (let i = 0; i < CAMS; i += 1) {
    const bufDir = path.join(ROOT, `cam${i}`);
    await mkdir(bufDir, { recursive: true });
    bufDirs.push(bufDir);
    if (i === 0 && RTSP_URL) startRtspCam(i, RTSP_URL, bufDir);
    else if (MODE === "copy") startCopyCam(i, seedPath, bufDir);
    else startEncodeCam(i, bufDir);
  }
  if (RTSP_URL) log("cam0 = RTSP real", RTSP_URL.replace(/:([^:@/]+)@/, ":***@"));

  log(`started ${CAMS} ring buffers (${MODE})`);
  sampleResources(); // baseline CPU

  const tStart = Date.now();
  let triggered = false;
  let triggerResult = null;
  let failed = false;
  let failReason = null;
  const series = [];
  let maxTotalRss = 0;
  let maxEquivCores = 0;

  while ((Date.now() - tStart) / 1000 < DURATION_SEC) {
    await new Promise((r) => setTimeout(r, 5000));
    const alive = procs.filter((p) => p.exitCode === null && !p.killed).length;
    const m = sampleResources();
    maxTotalRss = Math.max(maxTotalRss, m.totalRssMb);
    maxEquivCores = Math.max(maxEquivCores, m.equivCores);

    const perCam = [];
    for (let i = 0; i < CAMS; i += 1) {
      const c = await countSegs(bufDirs[i]);
      perCam.push(`${c.n}`);
    }

    const row = {
      t: Math.round((Date.now() - tStart) / 1000),
      alive,
      ...m,
    };
    series.push(row);

    log(
      `t=${row.t}s alive=${alive}/${CAMS} ` +
        `rss_ff=${m.ffmpegRssMb.toFixed(0)}MB rss_node=${m.nodeRssMb.toFixed(0)}MB total=${m.totalRssMb.toFixed(0)}MB | ` +
        `cpu_ff=${m.ffmpegCpuPct.toFixed(1)}% cpu_node=${m.nodeCpuPct.toFixed(1)}% ≈${m.equivCores.toFixed(2)} cores | ` +
        `segs=[${perCam.join(",")}]` +
        (m.memAvailableMb !== undefined ? ` | mem_livre=${m.memAvailableMb.toFixed(0)}MB` : "") +
        (m.tempC !== undefined ? ` temp=${m.tempC.toFixed(1)}C` : "") +
        (m.throttled !== undefined ? ` throttled=${m.throttled}` : ""),
    );

    if (alive < CAMS) {
      failed = true;
      failReason = "ffmpeg_exit";
      log("FAIL: algum ffmpeg morreu (OOM/kill?)");
      break;
    }

    if (LIMIT_RAM_MB > 0 && m.totalRssMb > LIMIT_RAM_MB) {
      failed = true;
      failReason = `ram_over_${LIMIT_RAM_MB}MB`;
      log(`FAIL: total RSS ${m.totalRssMb.toFixed(0)} MB > limite ${LIMIT_RAM_MB} MB (envelope Pi 3)`);
      break;
    }

    if (LIMIT_CPU_CORES > 0 && m.equivCores > LIMIT_CPU_CORES * 1.15) {
      // soft warn first samples after trigger can spike; only fail if sustained — check last 3
      const last = series.slice(-3);
      if (
        last.length >= 3 &&
        last.every((s) => s.equivCores > LIMIT_CPU_CORES * 1.15)
      ) {
        failed = true;
        failReason = `cpu_over_${LIMIT_CPU_CORES}_cores`;
        log(
          `FAIL: CPU sustentada ≈${m.equivCores.toFixed(2)} cores > ${LIMIT_CPU_CORES} (Pi 3 B+)`,
        );
        break;
      }
      log(
        `WARN: CPU ≈${m.equivCores.toFixed(2)} cores (Pi 3 tem ${LIMIT_CPU_CORES}) — A53 ainda é mais fraco que o teu CPU`,
      );
    }

    if (!triggered && (Date.now() - tStart) / 1000 >= TRIGGER_AFTER_SEC) {
      triggered = true;
      const out = path.join(ROOT, "clip-cam0.mp4");
      log("TRIGGER cam0 → ~20s do passado…");
      try {
        triggerResult = await buildClipFromBuffer(bufDirs[0], out);
        log(
          `TRIGGER OK ${triggerResult.ms}ms size=${(triggerResult.bytes / 1e6).toFixed(2)}MB`,
        );
        if (triggerResult.ms > 5000 && PI3) {
          failed = true;
          failReason = "trigger_too_slow";
          log("FAIL: trigger > 5s sob carga (Pi 3 envelope)");
          break;
        }
      } catch (err) {
        failed = true;
        failReason = "trigger_error";
        log("TRIGGER FAIL:", err.message ?? err);
        break;
      }
    }
  }

  const report = {
    ok: !failed,
    failReason,
    mode: MODE,
    cams: CAMS,
    pre_roll_sec: PRE_ROLL_SEC,
    duration_sec: DURATION_SEC,
    host_cores: HOST_CORES,
    constrained,
    limits: {
      ram_mb: LIMIT_RAM_MB || null,
      cpu_cores: LIMIT_CPU_CORES || null,
    },
    max_total_rss_mb: Math.round(maxTotalRss),
    max_equiv_cores: Number(maxEquivCores.toFixed(2)),
    trigger: triggerResult,
    series_tail: series.slice(-8),
    pi3b_verdict: failed
      ? `REPROVA envelope Pi 3 B+: ${failReason}`
      : constrained
        ? "PASSOU com Job Object (RAM/CPU limitados). Ainda assim A53≠CPU do host — valide no Pi real se possível."
        : "PASSOU thresholds sem cgroup. Rode npm run edge:loadtest-pi3 pra LIMITAR RAM/CPU.",
  };

  const reportPath = path.join(ROOT, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  log("report →", reportPath);
  log(report.pi3b_verdict);

  await shutdown(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await shutdown(1);
});
