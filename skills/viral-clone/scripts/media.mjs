// Decode with ffmpeg into raw arrays, so the measuring scripts need nothing but node and ffmpeg.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, delimiter, join } from "node:path";

const MAX_BUFFER = 1 << 30;
/** The app's own FFmpeg when the run carries it (every agent run the app starts does), else the one on PATH. */
export const ffmpegBin = () => process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
export const ffprobeBin = () => process.env.HYPERFRAMES_FFPROBE_PATH || "ffprobe";
/** Whether the file has an audio stream; a silent reference has nothing to separate or measure. @param {string} path */
export const hasAudio = (path) =>
  execFileSync(
    ffprobeBin(),
    [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      path,
    ],
    { encoding: "utf8" },
  ).trim() !== "";
/** separate.mjs ends with this when Demucs cannot run here: the app ships Node and FFmpeg, not uv or Python. */
export const NEEDS_UV = 4;
/** The first audio stream in words, for a message about a file FFmpeg could not use. @param {string} path */
export function audioFormat(path) {
  try {
    const [codec, rate, channels] = execFileSync(
      ffprobeBin(),
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name,sample_rate,channels",
      ].concat(["-of", "csv=p=0", path]),
      { encoding: "utf8" },
    )
      .trim()
      .split(",");
    return `${codec}, ${rate} Hz, ${channels} channel${channels === "1" ? "" : "s"}`;
  } catch {
    return "unreadable"; // expected: these words only go into an error message
  }
}
/** One sentence for an FFmpeg that failed on a piece of the sound: which piece, its own last line, the format.
 * @param {string} what @param {any} error @param {string} format */
export function soundFailure(what, error, format) {
  const said = String(error?.stderr ?? error?.message ?? error)
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  return `Could not ${what}: ${said ?? "FFmpeg gave no reason"}. The sound is ${format}.`;
}
/** The search path of `env`, whatever its spelling: a copy of Windows' environment names it "Path". This script runs
 * standalone in a run, so it cannot share the app's pathKey. @param {NodeJS.ProcessEnv} env */
const searchPath = (env) =>
  env.PATH ?? Object.entries(env).find(([name]) => name.toUpperCase() === "PATH")?.[1] ?? "";
/** The hf-media a run starts: the app's launcher on its PATH, which waits while the app sets hf-media up. Windows
 * starts hf-media.cmd for "hf-media" (never an hf-media.exe: Smart App Control blocks the one pip makes).
 * @param {NodeJS.ProcessEnv} env */
export function hfMediaCommand(env) {
  const command = env.HF_MEDIA || "hf-media";
  const names =
    process.platform === "win32" && !/\.(exe|cmd)$/i.test(command)
      ? [`${command}.exe`, `${command}.cmd`]
      : [command];
  const dirs =
    basename(command) !== command ? [""] : searchPath(env).split(delimiter).filter(Boolean);
  for (const dir of dirs)
    for (const name of names) if (existsSync(join(dir, name))) return join(dir, name);
  return null;
}
/** hf-media as a run starts it: its full path where PATH holds it (a .cmd run by bare name sees `%~dp0` as the
 * current folder, not its own), else the bare name, so the call itself says it is missing. */
export const hfMediaBin = (env = process.env) => hfMediaCommand(env) ?? env.HF_MEDIA ?? "hf-media";
/** `hf-media args` for execFile and execFileSync. Windows has no hf-media.exe (Smart App Control blocks the one pip
 * makes), only hf-media.cmd, which Node starts through cmd.exe. @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env] the environment the call will run with */
export const hfMediaCall = (args, env = process.env) => {
  const bin = hfMediaBin(env);
  return process.platform === "win32" && !/\.exe$/i.test(bin)
    ? cmdCall(bin, args)
    : { file: bin, args, shell: false };
};
/** hf-media's output for `args`. @param {string[]} args */
export const hfMedia = (args) => {
  const { file, args: rest, shell } = hfMediaCall(args);
  return execFileSync(file, rest, { maxBuffer: MAX_BUFFER, shell });
};
/** `file args` as execFileSync/spawnSync take it where `file` is a .cmd, which Node starts only through cmd.exe: there
 * it is one command line, each argument quoted; a trailing backslash is doubled so it does not escape the quote.
 * @param {string} file @param {string[]} args */
const cmdCall = (file, args) => ({
  file: [file, ...args].map((arg) => `"${arg.replace(/(\\+)$/, "$1$1")}"`).join(" "),
  args: /** @type {string[]} */ ([]),
  shell: true,
});
/** @param {string[]} args */
const npx = (args) =>
  process.platform === "win32" ? cmdCall("npx", args) : { file: "npx", args, shell: false };
/** The CLI Desktop pins (its package.json). The app's npx runs its own CLI for any version; elsewhere npx fetches
 * exactly this one, never an older global install. */
export const HYPERFRAMES = "hyperframes@0.9.13";
/** `npx` running the pinned CLI with `args`. @param {string[]} args */
export const hyperframes = (args) => npx(["--yes", HYPERFRAMES, ...args]);

/** Frames of one ROI as Uint8Array RGB, sampled at `fps` from `start` for `seconds` (fps 0: every frame, e.g. a still).
 * @param {string} path @param {number} start @param {number} seconds @param {number[]} roi x,y,w,h
 * @param {{fps?: number, width?: number, gray?: boolean}} [opts] */
export function frames(
  path,
  start,
  seconds,
  [x, y, w, h],
  { fps = 30, width = 0, gray = false } = {},
) {
  const outW = width ? width : w;
  const outH = width ? Math.max(2, Math.round((h * width) / w / 2) * 2) : h;
  const pix = gray ? "gray" : "rgb24";
  const scale = width ? `,scale=${outW}:${outH}` : "";
  const raw = execFileSync(
    ffmpegBin(),
    [
      "-nostdin",
      "-v",
      "error",
      "-ss",
      String(start),
      "-i",
      path,
      "-t",
      String(seconds),
      "-vf",
      `${fps ? `fps=${fps},` : ""}crop=${w}:${h}:${x}:${y}${scale},format=${pix}`,
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: MAX_BUFFER },
  );
  const size = outW * outH * (gray ? 1 : 3);
  const out = [];
  for (let i = 0; i + size <= raw.length; i += size) out.push(raw.subarray(i, i + size));
  return out;
}

/** Mono float samples at `rate` Hz, after an optional ffmpeg audio filter (e.g. "highpass=f=3000").
 * @param {string} path @param {number} [rate] @param {string} [af] */
export function samples(path, rate = 16000, af = "") {
  const raw = execFileSync(
    ffmpegBin(),
    [
      "-nostdin",
      "-v",
      "error",
      "-i",
      path,
      ...(af ? ["-af", af] : []),
      "-ac",
      "1",
      "-ar",
      String(rate),
      "-f",
      "s16le",
      "-",
    ],
    { maxBuffer: MAX_BUFFER },
  );
  const out = new Float32Array(raw.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = raw.readInt16LE(i * 2) / 32768;
  return out;
}

/** Mean absolute difference of two equal-length byte arrays. @param {Uint8Array} a @param {Uint8Array} b */
export function meanAbsDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** @param {string} s "x,y,w,h" */
export const roi = (s) => {
  const v = s.split(",").map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n)))
    throw new Error(`ROI must be x,y,w,h, got "${s}"`);
  return v;
};

export const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
