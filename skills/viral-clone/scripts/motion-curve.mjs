#!/usr/bin/env node
// The ease of one graphic move, as numbers: inside an ROI, the element's box (centre, width, height) and its ink
// (mean difference from the background) on every frame, then for each property that changes, when the move starts
// and settles, the overshoot past its end value, and the closest GSAP ease. With --compare, the same on a draft's
// window and the differences, so a spring, a back-out or a slow expo is checked rather than eyeballed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { ffmpegBin, frames, roi, round } from "./media.mjs";
import { probe } from "./motion-rhythm.mjs";

const USAGE = `usage: node motion-curve.mjs <video> <start> <seconds> x,y,w,h [--bg #rrggbb] [--thr 24] [--compare <draft> <draft-start> [--draft-roi x,y,w,h]]
       node motion-curve.mjs --selftest
  The element must stand out from a flat background (sampled from the ROI's border on the first frame, or --bg);
  give the ROI room for the whole move, overshoot included, and nothing else that moves.`;
const W = 240;
const PROPS = ["x", "y", "w", "h", "ink"];

const pw = (k) => [`power${k}.in`, (u) => u ** (k + 1)];
const pwo = (k) => [`power${k}.out`, (u) => 1 - (1 - u) ** (k + 1)];
const pwio = (k) => [
  `power${k}.inOut`,
  (u) => (u < 0.5 ? 2 ** k * u ** (k + 1) : 1 - (-2 * u + 2) ** (k + 1) / 2),
];
const back = (s) => [
  `back.out(${s.toFixed(1)})`,
  (u) => 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2,
];
const elastic = (p) => [
  `elastic.out(1,${p})`,
  (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 2 ** (-10 * u) * Math.sin(((u - p / 4) * 2 * Math.PI) / p) + 1),
];
/** GSAP's named eases as functions of normalized time. */
export const EASES = [
  ["none", (u) => u],
  ...[1, 2, 3, 4].flatMap((k) => [pw(k), pwo(k), pwio(k)]),
  ["sine.out", (u) => Math.sin((u * Math.PI) / 2)],
  ["sine.inOut", (u) => -(Math.cos(Math.PI * u) - 1) / 2],
  ["expo.out", (u) => (u >= 1 ? 1 : 1 - 2 ** (-10 * u))],
  ["circ.out", (u) => Math.sqrt(1 - (u - 1) ** 2)],
  ...Array.from({ length: 26 }, (_, i) => back(0.5 + i * 0.1)),
  ...[0.2, 0.25, 0.3, 0.4, 0.5].map(elastic),
];

/** Box and ink per frame. */
export function track(path, start, seconds, box, { bg = null, thr = 24 } = {}) {
  const fps = probe(path).fps;
  const width = Math.min(W, box[2]);
  const fs = frames(path, start, seconds, box, { fps: 0, width });
  const h = fs[0].length / 3 / width;
  const k = box[2] / width;
  let ref = bg;
  if (!ref) {
    const border = [[], [], []];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < width; x++)
        if (x < 2 || y < 2 || x >= width - 2 || y >= h - 2)
          for (let c = 0; c < 3; c++) border[c].push(fs[0][(y * width + x) * 3 + c]);
    ref = border.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
  }
  return {
    fps,
    bg: ref,
    rows: fs.map((f, i) => {
      const xs = [],
        ys = [];
      let ink = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < width; x++) {
          const j = (y * width + x) * 3;
          const d = Math.max(
            Math.abs(f[j] - ref[0]),
            Math.abs(f[j + 1] - ref[1]),
            Math.abs(f[j + 2] - ref[2]),
          );
          ink += d;
          if (d > thr) (xs.push(x), ys.push(y));
        }
      const t = round(start + i / fps, 3);
      if (xs.length < 4)
        return { t, x: null, y: null, w: 0, h: 0, ink: round(ink / (width * h), 2) };
      (xs.sort((a, b) => a - b), ys.sort((a, b) => a - b));
      const q = (v, p) => v[Math.min(v.length - 1, Math.floor(v.length * p))];
      const [x0, x1, y0, y1] = [q(xs, 0.01), q(xs, 0.99), q(ys, 0.01), q(ys, 0.99)];
      return {
        t,
        x: round(box[0] + ((x0 + x1 + 1) / 2) * k, 1),
        y: round(box[1] + ((y0 + y1 + 1) / 2) * k, 1),
        w: round((x1 - x0 + 1) * k, 1),
        h: round((y1 - y0 + 1) * k, 1),
        ink: round(ink / (width * h), 2),
      };
    }),
  };
}

/** Fit one stretch of values from its start value to its settled end value. */
function fit(rows, idx, v, prop, fps, a, b) {
  const v0 = v[a],
    v1 = v[b],
    span = v1 - v0;
  const p = v.slice(a, b + 1).map((x) => (x - v0) / span);
  const u = p.map((_, i) => i / Math.max(1, p.length - 1));
  const fits = EASES.map(([name, f]) => ({
    name,
    rmse: Math.sqrt(p.reduce((s, x, i) => s + (x - f(u[i])) ** 2, 0) / p.length),
  })).sort((m, n) => m.rmse - n.rmse);
  return {
    prop,
    from: round(v0, 1),
    to: round(v1, 1),
    start_s: rows[idx[a]].t,
    duration_s: round((idx[b] - idx[a]) / fps, 3),
    frames: idx[b] - idx[a],
    overshoot_pct: round(Math.max(0, Math.max(...p) - 1) * 100, 1),
    anticipation_pct: round(Math.max(0, -Math.min(...p)) * 100, 1),
    ease: fits[0].name,
    rmse: round(fits[0].rmse, 3),
    next: fits.slice(1, 3).map((f) => `${f.name} ${round(f.rmse, 3)}`),
    curve: Array.from({ length: 21 }, (_, i) => round(p[Math.round((i / 20) * (p.length - 1))], 3)),
  };
}

/** Every move of one property: stretches of change separated by holds of 0.15 s or more (shorter stills are the
 * turn at an overshoot's peak). A stretch that returns to
 * where it began is a pulse (peak and length, no ease). */
export function fitMoves(rows, prop, fps, minChange, quant) {
  const idx = rows.map((r, i) => (r[prop] == null ? -1 : i)).filter((i) => i >= 0);
  const v = idx.map((i) => rows[i][prop]);
  const out = [];
  for (let i = 0; i < v.length - 1; ) {
    if (Math.abs(v[i + 1] - v[i]) <= quant) {
      i++;
      continue;
    }
    const hold = Math.max(3, Math.round(0.15 * fps));
    let b = i + 1,
      still = 0;
    for (let j = i + 1; j < v.length - 1 && still < hold; j++)
      Math.abs(v[j + 1] - v[j]) <= quant ? still++ : ((still = 0), (b = j + 1));
    const span = v[b] - v[i];
    const peak = v
      .slice(i, b + 1)
      .reduce((m, x) => (Math.abs(x - v[i]) > Math.abs(m - v[i]) ? x : m), v[i]);
    // a creep of under 3% of the move before it really starts is compression noise, not the move
    let a = i;
    while (a < b - 2 && Math.abs(v[a + 1] - v[a]) < 0.03 * Math.abs(span)) a++;
    if (Math.abs(span) >= minChange) out.push(fit(rows, idx, v, prop, fps, a, b));
    else if (Math.abs(peak - v[i]) >= minChange)
      out.push({
        prop,
        pulse: true,
        from: round(v[i], 1),
        peak: round(peak, 1),
        start_s: rows[idx[i]].t,
        duration_s: round((idx[b] - idx[i]) / fps, 3),
        frames: idx[b] - idx[i],
      });
    i = b;
  }
  return out;
}

export function curves(path, start, seconds, box, opts = {}) {
  const { fps, bg, rows } = track(path, start, seconds, box, opts);
  const minPx = 0.02 * Math.max(box[2], box[3]);
  const step = box[2] / Math.min(W, box[2]);
  const moves = PROPS.flatMap((k) =>
    k === "ink" ? fitMoves(rows, k, fps, 2, 0.5) : fitMoves(rows, k, fps, minPx, step),
  ).sort((m, n) => m.start_s - n.start_s);
  return { path, start, seconds, roi: box, fps: round(fps, 2), bg, moves, rows };
}

/** Pair each reference move with the draft move of the same property that starts closest on the window's clock. */
function compare(ref, draft) {
  const family = (s) => s.replace(/\(.*\)/, "").replace(/\d/, "");
  return ref.moves.map((m) => {
    const rel = m.start_s - ref.start;
    const d = draft.moves
      .filter((x) => x.prop === m.prop && !!x.pulse === !!m.pulse)
      .sort(
        (x, y) => Math.abs(x.start_s - draft.start - rel) - Math.abs(y.start_s - draft.start - rel),
      )[0];
    const head = { prop: m.prop, at_s: round(rel, 2) };
    if (!d) return { ...head, draft: "no matching move" };
    const common = {
      ...head,
      start_offset_s: round(d.start_s - draft.start - rel, 3),
      duration_frames: `${m.frames} → ${d.frames}`,
    };
    if (m.pulse) return { ...common, pulse: true, peak: `${m.peak} → ${d.peak}` };
    return {
      ...common,
      ease: `${m.ease} → ${d.ease}`,
      same_family: family(m.ease) === family(d.ease),
      overshoot_pct: `${m.overshoot_pct} → ${d.overshoot_pct}`,
      curve_rmse: round(
        Math.sqrt(m.curve.reduce((s, x, i) => s + (x - d.curve[i]) ** 2, 0) / m.curve.length),
        3,
      ),
    };
  });
}

async function selftest() {
  const dir = mkdtempSync(`${tmpdir()}/curve-`);
  // a white box slides 0.5 s with back.out(1.7) from x=20 to x=220, starting at 0.3 s
  const s = 1.7,
    q = `min(max((t-0.3)/0.5,0),1)-1`;
  const x = `20+200*(1+${s + 1}*pow(${q},3)+${s}*pow(${q},2))`;
  const make = (out, shift) =>
    execFileSync(ffmpegBin(), [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=black:s=320x120:d=1.2:r=30",
      "-f",
      "lavfi",
      "-i",
      "color=white:s=40x40:d=1.2:r=30",
      "-filter_complex",
      `[0][1]overlay=x='${x.replaceAll("t", `(t-${shift})`)}':y=40`,
      "-pix_fmt",
      "yuv444p",
      "-c:v",
      "libx264",
      "-crf",
      "0",
      out,
    ]);
  make(`${dir}/a.mp4`, 0);
  make(`${dir}/b.mp4`, 0.1);
  const a = curves(`${dir}/a.mp4`, 0, 1.2, [0, 0, 320, 120]);
  const b = curves(`${dir}/b.mp4`, 0, 1.2, [0, 0, 320, 120]);
  const mx = a.moves.find((m) => m.prop === "x");
  const c = compare(a, b).find((m) => m.prop === "x");
  const ok =
    a.moves.length === 1 &&
    /^back\.out\((1\.[5-9])\)/.test(mx.ease) &&
    Math.abs(mx.duration_s - 0.5) <= 0.07 &&
    Math.abs(mx.overshoot_pct - 10) <= 3 &&
    Math.abs(c.start_offset_s - 0.1) <= 0.04 &&
    c.curve_rmse < 0.05;
  console.log(JSON.stringify({ ok, move: { ...mx, curve: undefined }, compare: c }));
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--selftest") await selftest();
  else {
    const pos = [],
      opt = {};
    for (let i = 0; i < args.length; i++)
      if (args[i] === "--compare") ((opt.compare = args[++i]), (opt.draftStart = args[++i]));
      else if (args[i].startsWith("--")) opt[args[i].slice(2)] = args[++i];
      else pos.push(args[i]);
    if (pos.length !== 4) {
      console.error(USAGE);
      process.exit(2);
    }
    const o = {
      thr: +(opt.thr ?? 24),
      bg: opt.bg ? opt.bg.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16)) : null,
    };
    const ref = curves(pos[0], +pos[1], +pos[2], roi(pos[3]), o);
    if (!opt.compare) console.log(JSON.stringify({ ...ref, rows: undefined }, null, 1));
    else {
      const draft = curves(
        opt.compare,
        +opt.draftStart,
        +pos[2],
        roi(opt["draft-roi"] ?? pos[3]),
        o,
      );
      console.log(
        JSON.stringify(
          { compare: compare(ref, draft), ref: ref.moves, draft: draft.moves },
          (k, v) => (k === "curve" ? undefined : v),
          1,
        ),
      );
    }
  }
}
