// Decode with ffmpeg into raw arrays, so the scripts need nothing but node and ffmpeg.
import { execFileSync } from "node:child_process";

const MAX_BUFFER = 1 << 30;
/** The app's own FFmpeg when the run carries it (every agent run the app starts does), else the one on PATH. */
export const ffmpegBin = () => process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
export const ffprobeBin = () => process.env.HYPERFRAMES_FFPROBE_PATH || "ffprobe";
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

/** @param {string} s "x,y,w,h" */
export const roi = (s) => {
  const v = s.split(",").map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n)))
    throw new Error(`ROI must be x,y,w,h, got "${s}"`);
  return v;
};

export const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
