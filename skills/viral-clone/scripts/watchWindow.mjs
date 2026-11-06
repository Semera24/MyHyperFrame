// The stretch of a long reference that `vc watch` analyses: all of a short one, else the first two minutes or the
// stretch the agent picked with --from and --to.
import { execFileSync } from "node:child_process";
import { ffmpegBin } from "./media.mjs";

export const WATCH_SECONDS = 120;

/** "90", "1:30" or "1:02:03" as seconds, or null when it is not a time. @param {string | undefined} text */
export function seconds(text) {
  if (!text || !/^\d+(\.\d+)?(:\d+(\.\d+)?){0,2}$/.test(text)) return null;
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** @param {number} s */
export const clock = (s) => {
  const t = Math.round(s);
  const m = Math.floor(t / 60);
  const rest = String(t % 60).padStart(2, "0");
  return t >= 3600
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${rest}`
    : `${m}:${rest}`;
};

/** The stretch to watch, or null when the whole reference is watched (no flags and two minutes or less).
 * @param {number} total @param {string[]} args @returns {{ from: number, to: number } | null} */
export function watchWindow(total, args) {
  const flag = (/** @type {string} */ name) => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args[at + 1];
  };
  const [rawFrom, rawTo] = [flag("--from"), flag("--to")];
  const [from, to] = [seconds(rawFrom), seconds(rawTo)];
  if ((rawFrom !== undefined && from === null) || (rawTo !== undefined && to === null))
    throw new Error("--from and --to take a time: seconds, m:ss or h:mm:ss");
  if (from === null && to === null && total <= WATCH_SECONDS) return null;
  if (from !== null && from >= total)
    throw new Error(`--from is past the end of a ${clock(total)} reference`);
  const start = from ?? 0;
  const end = Math.min(total, to ?? start + WATCH_SECONDS);
  if (end - start < 1)
    throw new Error(`--from and --to leave nothing to watch in a ${clock(total)} reference`);
  return { from: start, to: end };
}

/** The stretch cut out as its own file at full size, frame-accurate. @param {string} source @param {string} out
 * @param {{ from: number, to: number }} window */
export function cutWindow(source, out, window) {
  const args = ["-nostdin", "-v", "error", "-y", "-ss", String(window.from), "-i", source];
  args.push("-t", String(window.to - window.from), "-c:v", "libx264", "-preset", "veryfast");
  args.push("-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", out);
  execFileSync(ffmpegBin(), args, { stdio: ["ignore", "ignore", "inherit"] });
}
