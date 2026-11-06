#!/usr/bin/env node
// Off-clock ink/position/scale/blur match for a graphic on a FLAT background (`hf-media evidence motion` compares two
// films on one clock, a remix has its own). Over footage or a moving host this scores ~0 — use curve-pair.mjs there.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ffmpegBin, hfMedia, roi } from "./media.mjs";

const USAGE =
  "usage: node motion-pair.mjs <ref> <ref-t> <draft> <draft-t> <seconds> <ref-roi> [<draft-roi>] --out <dir>";

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const [ref, rt, draft, dt, secs, rroi, droi] = args;
if (!out || !rroi) {
  console.error(USAGE);
  process.exit(2);
}
roi(rroi);
if (droi) roi(droi);
mkdirSync(out, { recursive: true });
const cut = (src, t, name) => {
  const file = join(out, name);
  execFileSync(ffmpegBin(), [
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-ss",
    String(t),
    "-t",
    String(secs),
    "-i",
    src,
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "12",
    "-pix_fmt",
    "yuv420p",
    file,
  ]);
  return file;
};
const a = cut(ref, rt, "ref.mp4");
const b = cut(draft, dt, "draft.mp4");
const cmd = [
  "evidence",
  "motion",
  a,
  b,
  "--roi",
  rroi,
  "--start",
  "0",
  "--end",
  String(secs),
  "--out",
  join(out, "motion"),
];
if (droi) cmd.push("--candidate-roi", droi);
process.stdout.write(hfMedia(cmd));
