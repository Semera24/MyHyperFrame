#!/usr/bin/env node
// Retime a generated take onto the reference's beat clock in a few constant-speed pieces (HyperFrames has no
// playback-rate attribute, so the edit plays a derived file). Each piece maps a take span to a reference span.
// Writes a silent H.264 at the take's size, then holds the last frame up to --total if given.
import { execFileSync } from "node:child_process";
import { ffmpegBin, round } from "./media.mjs";

const USAGE = `usage: node scripts/retime.mjs <take> <out.mp4> --map "take_in:take_out=ref_in:ref_out,..." [--fps 30] [--total <seconds>]
  e.g. --map "0.66:5.83=0.20:4.60,5.83:9.25=4.60:7.34" lands take 5.83 s on reference 4.60 s.
  Prints each piece's rate: keep it ≤ ~1.5 without speech and 0.85–1.15 with speech, and record it in frame.md.`;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const [take, out] = args;
const mapArg = opt("--map");
if (!take || !out || !mapArg) {
  console.error(USAGE);
  process.exit(2);
}
const fps = Number(opt("--fps", 30));
const pieces = mapArg.split(",").map((p) => {
  const [[tin, tout], [rin, rout]] = p.split("=").map((s) => s.split(":").map(Number));
  if (![tin, tout, rin, rout].every(Number.isFinite) || tout <= tin || rout <= rin)
    throw new Error(`bad piece "${p}"`);
  return { tin, tout, rate: (tout - tin) / (rout - rin), length: rout - rin };
});
const made = pieces.reduce((s, p) => s + p.length, 0);
const total = Number(opt("--total", made));
const chains = pieces.map(
  (p, i) => `[0:v]trim=${p.tin}:${p.tout},setpts=(PTS-STARTPTS)/${p.rate}[s${i}]`,
);
const graph =
  `${chains.join(";")};${pieces.map((_, i) => `[s${i}]`).join("")}concat=n=${pieces.length}:v=1:a=0,` +
  `fps=${fps},tpad=stop_mode=clone:stop_duration=${Math.max(0, total - made) + 0.1}[v]`;
execFileSync(ffmpegBin(), [
  "-nostdin",
  "-v",
  "error",
  "-y",
  "-i",
  take,
  "-filter_complex",
  graph,
  "-map",
  "[v]",
  "-t",
  String(total),
  "-c:v",
  "libx264",
  "-crf",
  "14",
  "-pix_fmt",
  "yuv420p",
  out,
]);
console.log(
  JSON.stringify({
    out,
    total,
    held_s: round(Math.max(0, total - made), 2),
    pieces: pieces.map((p) => ({ take: [p.tin, p.tout], rate: round(p.rate, 3) })),
  }),
);
