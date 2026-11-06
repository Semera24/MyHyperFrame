#!/usr/bin/env node
// One rebuilt piece against the reference on the reference's clock, inside the piece's box only: per-frame SSIM, and
// how the box changes while it holds (moving share, changes a second, frames between changes), so a still where the
// reference boils or plays footage fails even when its entry and exit match.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ffprobeBin, frames, meanAbsDiff, roi, round } from "./media.mjs";

const USAGE = `usage: node piece-pair.mjs REF DRAFT START SECONDS ROI [DRAFT_ROI] [--draft-start T]
       ROI is x,y,w,h in the reference's pixels; DRAFT_ROI defaults to ROI scaled to the draft's width.
       node piece-pair.mjs --selftest REF START SECONDS ROI     (must print ssim_mean 1, moving_ratio 1)`;
const WIDTH = 160;
// Mean grey change between frames above which the box counts as changing: a boiling title measured about 7,
// a held one 0.1.
const MOVING = 1.5;

const widthOf = (path) =>
  Number(
    execFileSync(ffprobeBin(), [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width",
      "-of",
      "csv=p=0",
      path,
    ])
      .toString()
      .trim(),
  );

/** SSIM of two grey frames over 8x8 blocks. @param {Uint8Array} a @param {Uint8Array} b @param {number} w */
export function ssim(a, b, w) {
  const h = Math.floor(Math.min(a.length, b.length) / w);
  const [c1, c2] = [6.5025, 58.5225];
  let sum = 0,
    n = 0;
  for (let by = 0; by + 8 <= h; by += 4)
    for (let bx = 0; bx + 8 <= w; bx += 4) {
      let ma = 0,
        mb = 0,
        va = 0,
        vb = 0,
        cov = 0;
      for (let y = by; y < by + 8; y++)
        for (let x = bx; x < bx + 8; x++) {
          ma += a[y * w + x];
          mb += b[y * w + x];
        }
      ma /= 64;
      mb /= 64;
      for (let y = by; y < by + 8; y++)
        for (let x = bx; x < bx + 8; x++) {
          const [da, db] = [a[y * w + x] - ma, b[y * w + x] - mb];
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
      sum +=
        ((2 * ma * mb + c1) * ((2 * cov) / 63 + c2)) /
        ((ma * ma + mb * mb + c1) * (va / 63 + vb / 63 + c2));
      n++;
    }
  return n ? sum / n : 1;
}

/** How the box changes while it is on screen. @param {Uint8Array[]} fs */
export function change(fs) {
  const diffs = fs.slice(1).map((f, i) => meanAbsDiff(f, fs[i]));
  const moving = diffs.map((d) => d > MOVING);
  // A step stands out of the box's own noise (compression and the host behind an overlay change every frame), and a
  // run of changing frames is one change: Cindy's label popped in over 4 frames, then boiled every 7-8, and counting
  // each entry frame as a step read its boil as "every 3 frames".
  const floor = [...diffs].sort((a, b) => a - b)[diffs.length >> 1] ?? 0;
  const over = diffs.map((d) => d > Math.max(MOVING, 3 * floor));
  const at = over.flatMap((m, i) => (m && !over[i - 1] ? [i] : []));
  const gaps = at
    .slice(1)
    .map((t, i) => t - at[i])
    .sort((x, y) => x - y);
  return {
    moving_share: round(moving.filter(Boolean).length / Math.max(1, moving.length)),
    changes_per_s: round((at.length * 30) / Math.max(1, moving.length), 1),
    median_gap_frames: gaps.length ? gaps[gaps.length >> 1] : null,
  };
}

/** One piece in its box, reference against draft. @param {string} ref @param {string} draft @param {number} start
 * @param {number} seconds @param {number[]} rr reference ROI @param {number[] | null} [draftRoi]
 * @param {number | null} [draftStart] */
export function pair(ref, draft, start, seconds, rr, draftRoi = null, draftStart = null) {
  const scale = widthOf(draft) / widthOf(ref);
  const dr = draftRoi ?? rr.map((v) => Math.round(v * scale));
  const opts = { width: WIDTH, gray: true };
  const a = frames(ref, start, seconds, rr, opts);
  const b = frames(draft, draftStart ?? start, seconds, dr, opts);
  const n = Math.min(a.length, b.length);
  const scores = Array.from({ length: n }, (_, i) => ssim(a[i], b[i], WIDTH));
  const [r, d] = [change(a.slice(0, n)), change(b.slice(0, n))];
  return {
    frames: n,
    ssim_mean: round(scores.reduce((s, v) => s + v, 0) / Math.max(1, n)),
    ssim_share_0_9: round(scores.filter((v) => v >= 0.9).length / Math.max(1, n)),
    worst_frame: scores.indexOf(Math.min(...scores)),
    moving_ratio: r.moving_share
      ? round(d.moving_share / r.moving_share)
      : d.moving_share
        ? null
        : 1,
    ref: r,
    draft: d,
  };
}

function main() {
  let args = process.argv.slice(2);
  if (args[0] === "--selftest") args = [args[1], args[1], args[2], args[3], args[4]];
  const flag = args.indexOf("--draft-start");
  const draftStart = flag >= 0 ? Number(args.splice(flag, 2)[1]) : null;
  if (args.length < 5) {
    console.error(USAGE);
    process.exit(2);
  }
  const [ref, draft, start, seconds, refRoi, draftRoi] = args;
  console.log(
    JSON.stringify(
      pair(ref, draft, +start, +seconds, roi(refRoi), draftRoi ? roi(draftRoi) : null, draftStart),
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  main();
