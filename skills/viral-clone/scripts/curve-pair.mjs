#!/usr/bin/env node
// Off-clock entry/exit curve match for one graphic, robust to moving backgrounds (footage, a talking host).
// progress(t) = mean |frame_t - frame_first| inside an ROI that lies INSIDE the element, normalised to its settled
// value (exits flipped); kind=track follows the centroid x of bright pixels. match = 1 - mean |p_ref - p_draft| at
// the best lag within ±3 frames (pass >= 0.8). Start the window after the element's shot has settled.
import { frames, meanAbsDiff, roi, round } from "./media.mjs";

const USAGE = `usage: node curve-pair.mjs REF REF_T DRAFT DRAFT_T SECONDS REF_ROI DRAFT_ROI [in|out|pulse|track]
       node curve-pair.mjs --selftest REF T SECONDS ROI     (must print curve_match 1)`;

function progress(fs, kind, w) {
  if (kind === "track") {
    const xs = fs.map((f) => {
      let sx = 0,
        n = 0;
      for (let i = 0; i < f.length; i += 3) {
        if (Math.min(f[i], f[i + 1], f[i + 2]) > 232) {
          sx += (i / 3) % w;
          n++;
        }
      }
      return n > 50 ? sx / n : NaN;
    });
    const end = median(xs.slice(-3).filter(Number.isFinite));
    return xs.map((x) => (x - xs[0]) / (end - xs[0] || 1e-6));
  }
  if (kind === "out") {
    const d = fs.map((f) => meanAbsDiff(f, fs.at(-1)));
    const base = Math.max(median(d.slice(0, 3)), 1e-6);
    return d.map((v) => v / base);
  }
  const d = fs.map((f) => meanAbsDiff(f, fs[0]));
  const base = Math.max(kind === "pulse" ? Math.max(...d) : median(d.slice(-3)), 1e-6);
  return d.map((v) => v / base);
}

function median(v) {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
}

function match(a, b) {
  let best = null;
  for (let lag = -3; lag <= 3; lag++) {
    let e = 0,
      n = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= b.length || !Number.isFinite(a[i]) || !Number.isFinite(b[j])) continue;
      e += Math.abs(Math.min(a[i], 1.3) - Math.min(b[j], 1.3));
      n++;
    }
    if (n && (!best || e / n < best[0])) best = [e / n, lag];
  }
  return best ? [round(Math.max(0, 1 - best[0])), best[1]] : [0, 0];
}

let a = process.argv.slice(2);
if (a[0] === "--selftest") a = [a[1], a[2], a[1], a[2], a[3], a[4], a[4]];
if (a.length < 7) {
  console.error(USAGE);
  process.exit(2);
}
const [ref, rt, draft, dt, secs, rroi, droi, kind = "in"] = a;
const [rr, dr] = [roi(rroi), roi(droi)];
const p = progress(frames(ref, +rt, +secs, rr), kind, rr[2]);
const q = progress(frames(draft, +dt, +secs, dr), kind, dr[2]);
const [m, lag] = match(p, q);
console.log(
  JSON.stringify({
    curve_match: m,
    lag_frames: lag,
    kind,
    ref: p.map((v) => round(v, 2)),
    draft: q.map((v) => round(v, 2)),
  }),
);
