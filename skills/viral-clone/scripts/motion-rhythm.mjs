#!/usr/bin/env node
// How a film moves over time: the share of frames where the picture changes, the still holds, the rate the animation
// updates at (on ones, twos, threes) and the camera's zoom and pan inside each shot. Zoom and pan are the dominant
// whole-frame transform every 0.5 s, so a large moving subject can read as camera; confirm a move on frames.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ffprobeBin, frames, meanAbsDiff, roi, round } from "./media.mjs";

const USAGE =
  "usage: node motion-rhythm.mjs <video> [--start s] [--seconds n] [--roi x,y,w,h] [--compare <draft> [--draft-start s] [--draft-roi x,y,w,h]]";
const CUT = 25;
const W = 160;

export function probe(path) {
  const out = execFileSync(ffprobeBin(), [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate:format=duration",
    "-of",
    "json",
    path,
  ]).toString();
  const j = JSON.parse(out);
  const s = j.streams[0];
  const [a, b] = s.r_frame_rate.split("/").map(Number);
  return {
    width: s.width,
    height: s.height,
    fps: a / (b || 1),
    duration: Number(j.format.duration),
  };
}

function bilinear(img, w, h, x, y) {
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) return -1;
  const fx = x - x0,
    fy = y - y0,
    i = y0 * w + x0;
  return (
    (img[i] * (1 - fx) + img[i + 1] * fx) * (1 - fy) +
    (img[i + w] * (1 - fx) + img[i + w + 1] * fx) * fy
  );
}

/** Best s, dx, dy with B(x) ≈ A(c + (x − c)/s + d): s > 1 is a push in. */
export function cameraStep(a, b, w, h) {
  const cx = w / 2,
    cy = h / 2,
    m = Math.round(w * 0.1);
  const cost = (s, dx, dy) => {
    let sum = 0,
      n = 0;
    for (let y = m; y < h - m; y += 2)
      for (let x = m; x < w - m; x += 2) {
        const v = bilinear(a, w, h, cx + (x - cx) / s + dx, cy + (y - cy) / s + dy);
        if (v >= 0) ((sum += Math.abs(v - b[y * w + x])), n++);
      }
    return n ? sum / n : 1e9;
  };
  let best = [cost(1, 0, 0), 1, 0, 0];
  const search = (ss, dxs, dys) => {
    for (const s of ss)
      for (const dx of dxs)
        for (const dy of dys) {
          const c = cost(s, dx, dy);
          if (c < best[0]) best = [c, s, dx, dy];
        }
  };
  const range = (c, step, n) => Array.from({ length: 2 * n + 1 }, (_, i) => c + (i - n) * step);
  // coarse first, wide enough for a handheld swing (±10% zoom, ±10% of the width), then fine around the best
  search(range(1, 0.02, 5), range(0, 4, 4), range(0, 4, 4));
  search(range(best[1], 0.005, 2), range(best[2], 1, 2), range(best[3], 1, 2));
  search(range(best[1], 0.0025, 2), range(best[2], 0.5, 2), range(best[3], 0.5, 2));
  return { s: best[1], dx: best[2], dy: best[3], residual: best[0], still: cost(1, 0, 0) };
}

/** True when the whole frame moved: the best zoom and pan leave well under the change a still camera leaves. A
 * presenter swaying in front of a locked camera changes a small area, and moving it barely helps.
 * @param {{ residual: number, still: number }} step */
export const cameraMoved = (step) => step.residual < 0.7 * step.still;

export function rhythm(path, start = 0, seconds = 0, box = null, still = null) {
  const p = probe(path);
  const secs = seconds || p.duration - start;
  const r = box ?? [0, 0, p.width, p.height];
  const fs = frames(path, start, secs, r, { fps: 0, width: W, gray: true });
  const h = fs[0].length / W;
  const d = fs.slice(1).map((f, i) => meanAbsDiff(f, fs[i]));
  // mean |Δluma| on a 160 px frame below which nothing visibly changed; grain and compression raise the floor
  // (capped, so a window that never stops moving is not read as noise); a draft is measured at the reference's level
  const STILL =
    still ??
    Math.min(
      1.5,
      Math.max(0.5, 2 * ([...d].sort((x, y) => x - y)[Math.floor(d.length * 0.1)] ?? 0)),
    );
  const cuts = d.flatMap((v, i) => (v > CUT ? [i + 1] : []));
  // a frame is moving when it or a neighbour changes, so animation on twos or threes still counts as motion
  const moving = d.map((_, i) => [d[i - 1], d[i], d[i + 1]].some((v) => v > STILL && v <= CUT));
  const holds = [];
  for (let i = 0, run = 0; i <= moving.length; i++) {
    if (i < moving.length && !moving[i] && d[i] <= CUT) run++;
    else (run && holds.push(run / p.fps), (run = 0));
  }
  // inside stretches that are moving, a repeated frame means the animation updates on twos or threes
  let inMotion = 0,
    repeats = 0;
  for (let i = 2; i < d.length - 2; i++) {
    const near = Math.max(d[i - 2], d[i - 1], d[i + 1], d[i + 2]);
    if (near > STILL && near <= CUT) (inMotion++, d[i] < 0.2 * near && repeats++);
  }
  const step = Math.max(1, Math.round(p.fps / 2));
  const shots = [];
  const fresh = (t) => ({ start: t, zoom: 1, pan_x: 0, pan_y: 0, path: 0, residuals: [] });
  let shot = fresh(0);
  for (let i = 0; i + step < fs.length; i += step) {
    const cut = cuts.find((c) => c > i && c <= i + step);
    if (cut) {
      shots.push({ ...shot, end: cut / p.fps });
      shot = fresh(cut / p.fps);
      continue;
    }
    const c = cameraStep(fs[i], fs[i + step], W, h);
    shot.zoom *= c.s;
    shot.pan_x += c.dx / W;
    shot.pan_y += c.dy / h;
    if (cameraMoved(c)) shot.path += Math.hypot(c.dx / W, c.dy / h) + Math.abs(Math.log(c.s));
    shot.residuals.push(c.residual);
  }
  shots.push({ ...shot, end: fs.length / p.fps });
  // what is left after the best whole-frame transform; far above the film's usual level, the frame changed in a way
  // no zoom or pan explains (a swing past the search, a rotation, a large subject crossing the frame)
  const all = shots.flatMap((s) => s.residuals).sort((x, y) => x - y);
  const UNEXPLAINED = Math.max(12, 3 * (all[Math.floor(all.length / 2)] ?? 0));
  const kind = (s) => {
    const dur = s.end - s.start;
    if (dur < 0.6) return "short";
    const z = s.zoom - 1;
    if (Math.abs(z) > 0.03) return z > 0 ? "push in" : "pull out";
    if (Math.hypot(s.pan_x, s.pan_y) > 0.03) return "pan/drift";
    if (s.path > 0.08) return "handheld";
    if (s.residuals.some((r) => r > UNEXPLAINED)) return "moving, unexplained (confirm on frames)";
    return "static";
  };
  const sorted = [...holds].sort((x, y) => x - y);
  return {
    path,
    start,
    seconds: round(secs, 2),
    fps: round(p.fps, 2),
    moving_share: round(moving.filter(Boolean).length / Math.max(1, d.length), 2),
    longest_hold_s: round(sorted.at(-1) ?? 0, 2),
    median_hold_s: round(sorted[Math.floor(sorted.length / 2)] ?? 0, 2),
    holds_over_1s_per_min: round((holds.filter((x) => x >= 1).length / secs) * 60, 1),
    update_fps: round(p.fps * (1 - repeats / Math.max(1, inMotion)), 1),
    still_threshold: round(STILL, 2),
    cuts_per_min: round((cuts.length / secs) * 60, 1),
    camera_moves_per_min: round(
      (shots.filter((s) => /push|pull|pan|handheld/.test(kind(s))).length / secs) * 60,
      1,
    ),
    shots: shots.map((s) => ({
      start: round(start + s.start, 2),
      end: round(start + s.end, 2),
      camera: kind(s),
      zoom: round(s.zoom, 3),
      pan_x: round(s.pan_x, 3),
      pan_y: round(s.pan_y, 3),
      path: round(s.path, 3),
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : dflt;
  };
  const start = Number(opt("--start", 0)),
    seconds = Number(opt("--seconds", 0)),
    box = opt("--roi", null);
  const draft = opt("--compare", null),
    dStart = Number(opt("--draft-start", 0)),
    dBox = opt("--draft-roi", null);
  if (args.length !== 1 || args[0] === "--help") {
    console.error(USAGE);
    process.exit(2);
  }
  const ref = rhythm(args[0], start, seconds, box && roi(box));
  if (!draft) console.log(JSON.stringify(ref, null, 1));
  else {
    const ours = rhythm(
      draft,
      dStart,
      seconds || ref.seconds,
      dBox && roi(dBox),
      ref.still_threshold,
    );
    const keys = [
      "moving_share",
      "longest_hold_s",
      "median_hold_s",
      "holds_over_1s_per_min",
      "update_fps",
      "cuts_per_min",
      "camera_moves_per_min",
    ];
    console.log(
      JSON.stringify(
        {
          ref: { ...ref, shots: undefined },
          draft: { ...ours, shots: undefined },
          ratio: Object.fromEntries(
            keys.map((k) => [k, ref[k] ? round(ours[k] / ref[k], 2) : null]),
          ),
          ref_shots: ref.shots,
          draft_shots: ours.shots,
        },
        null,
        1,
      ),
    );
  }
}
