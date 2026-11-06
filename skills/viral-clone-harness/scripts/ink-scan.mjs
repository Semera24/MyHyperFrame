#!/usr/bin/env node
// Where text ink sits in an ROI, per sample: its bounding box in frame pixels, or null when no ink is there.
// Gives caption anchor and maximum width, first/last visible time (cue timing against the heard words), and the
// line height that solves font size: render a candidate font at a known size with `hyperframes snapshot`, scan the
// same text there (SECONDS 0 reads a still), and size_ref = size_candidate × box_h_ref / box_h_candidate.
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { ffmpegBin, frames, roi, round } from "./media.mjs";

const USAGE =
  "usage: node scripts/ink-scan.mjs VIDEO START SECONDS ROI [--fps 10] [--ink light|dark|R,G,B] [--tol 60] [--min 12]\n" +
  "       node scripts/ink-scan.mjs --selftest";

export function isInk(spec, tol) {
  if (spec === "light") return (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b >= 255 - tol;
  if (spec === "dark") return (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b <= tol;
  const [cr, cg, cb] = spec.split(",").map(Number);
  return (r, g, b) => Math.hypot(r - cr, g - cg, b - cb) <= tol;
}

export function scan(
  path,
  start,
  seconds,
  [x, y, w, h],
  { fps = 10, ink = "light", tol = 60, min = 12 } = {},
) {
  const test = isInk(ink, tol);
  const still = seconds <= 0;
  const fs = frames(path, still ? 0 : start, still ? 1 : seconds, [x, y, w, h], {
    fps: still ? 0 : fps,
  });
  return (still ? fs.slice(0, 1) : fs).map((f, i) => {
    let x0 = w,
      y0 = h,
      x1 = -1,
      y1 = -1,
      n = 0;
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        const o = (py * w + px) * 3;
        if (!test(f[o], f[o + 1], f[o + 2])) continue;
        n++;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
    const t = round(start + i / fps);
    return n < min
      ? { t, box: null, ink_px: n }
      : { t, box: [x + x0, y + y0, x1 - x0 + 1, y1 - y0 + 1], ink_px: n };
  });
}

function summary(rows) {
  const on = rows.filter((r) => r.box);
  const med = (v) => v.sort((a, b) => a - b)[v.length >> 1];
  return on.length
    ? {
        first_visible: on[0].t,
        last_visible: on.at(-1).t,
        median_box_h: med(on.map((r) => r.box[3])),
        max_box_w: Math.max(...on.map((r) => r.box[2])),
      }
    : { first_visible: null };
}

async function selftest() {
  const dir = mkdtempSync(`${tmpdir()}/ink-`);
  const clip = `${dir}/t.mp4`;
  let result;
  try {
    result = scanSyntheticClip(clip);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

/** Scans a clip with one white box visible from 0.5 s to 1.45 s. @param {string} clip */
function scanSyntheticClip(clip) {
  execFileSync(ffmpegBin(), [
    "-nostdin",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=black:s=320x180:d=2:r=10",
    "-vf",
    "drawbox=x=100:y=50:w=60:h=20:color=white:t=fill:enable='between(t,0.5,1.45)'",
    "-pix_fmt",
    "yuv444p",
    "-c:v",
    "libx264",
    "-crf",
    "0",
    clip,
  ]);
  const s = summary(scan(clip, 0, 2, [0, 0, 320, 180]));
  const box = scan(clip, 1, 0.1, [0, 0, 320, 180])[0].box;
  const ok =
    s.first_visible === 0.5 &&
    s.last_visible === 1.4 &&
    box.every((v, i) => Math.abs(v - [100, 50, 60, 20][i]) <= 1);
  return { ok, ...s, box };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--selftest") await selftest();
  else {
    const pos = [],
      opt = {};
    for (let i = 0; i < args.length; i++)
      args[i].startsWith("--") ? (opt[args[i].slice(2)] = args[++i]) : pos.push(args[i]);
    if (pos.length < 4) {
      console.error(USAGE);
      process.exit(2);
    }
    const rows = scan(pos[0], +pos[1], +pos[2], roi(pos[3]), {
      fps: +(opt.fps ?? 10),
      ink: opt.ink ?? "light",
      tol: +(opt.tol ?? 60),
      min: +(opt.min ?? 12),
    });
    console.log(JSON.stringify({ ...summary(rows), rows }));
  }
}
