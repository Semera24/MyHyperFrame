#!/usr/bin/env node
// Body/camera motion for footage remixes, where the person, clothes and room all differ from the reference. Both
// films are sampled on one 12 fps grid (mixed 24/30 fps skewed per-frame differences), ROI scaled to 270 px wide, luma.
// Energy(t) = mean |frame_t - frame_t-1|. Reports the Pearson r of the two curves at the best lag within ±1 s
// (same action: onset, peak, settle) and the peak and mean energy ratios (draft/ref; amount of movement, 0.7–1.4).
import { frames, meanAbsDiff, roi, round } from "./media.mjs";

const RATE = 12;
const USAGE = `usage: node motion-energy.mjs <ref> <ref-t> <draft> <draft-t> <seconds> <ref-roi> <draft-roi>
  r is only meaningful when the action is the same; for a new action read the ratios.`;

const curve = (path, t, secs, box) => {
  const fs = frames(path, t, secs, box, { fps: RATE, width: 270, gray: true });
  return fs.slice(1).map((f, i) => meanAbsDiff(f, fs[i]));
};

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1e-12);
}

const args = process.argv.slice(2);
if (args.length < 7) {
  console.error(USAGE);
  process.exit(2);
}
const [ref, rt, draft, dt, secs, rroi, droi] = args;
const a = curve(ref, +rt, +secs, roi(rroi));
const b = curve(draft, +dt, +secs, roi(droi));
let best = [-2, 0];
for (let lag = -RATE; lag <= RATE; lag++) {
  const [aa, bb] =
    lag >= 0
      ? [a.slice(0, a.length - lag), b.slice(lag)]
      : [a.slice(-lag), b.slice(0, b.length + lag)];
  if (Math.min(aa.length, bb.length) > 8) {
    const r = pearson(aa, bb);
    if (r > best[0]) best = [r, lag];
  }
}
const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
console.log(
  JSON.stringify({
    r: round(best[0]),
    lag_samples: best[1],
    rate: RATE,
    peak_ratio: round(Math.max(...b) / Math.max(...a), 2),
    mean_ratio: round(mean(b) / mean(a), 2),
  }),
);
