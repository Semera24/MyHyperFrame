// Where one graphic sits, found by its color rather than by what moves, so a presenter who never stops does not
// pull the box: at one time its box, ink, dominant colors, text line bands and cap height; over a range when it is
// on screen; with --track each move of its centre, size and ink, fitted to the closest GSAP ease.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ffmpegBin, frames, round } from "./media.mjs";
import { fitMoves } from "./motion-curve.mjs";
import { Fix, box as roiArg, numbers, outDir, parseTool, probe } from "./tool.mjs";

const USAGE = `usage: vc box VIDEO (--at t | --start s --end s) [--roi x,y,w,h] [--color #hex|white|dark|auto|alpha]
              [--tol 40] [--track] [--frames] [--out DIR]
  --color picks the graphic's pixels (default auto): #hex within --tol of RGB distance; white, every channel at least
  255-tol; dark, every channel at most tol; alpha, all but a solo render's #00ff00; auto, the commonest color in the
  ROI that matches none of the colors of its 2 px border, so draw the ROI round the graphic with its ground around it.
  A blob of matching pixels under 2% of the largest one's size (over a range, the range's largest) is speckle and
  left out; over a range, a frame with under 5% of the range's most ink counts as not showing it.
  --at: {box, ink_px, colors (top 3 in the box), lines (text bands), cap_height_px (the median band's height: cap
  height for caps, ascender to descender for lowercase), image}. A range: first and last frame it is seen, the union
  and median box. --track adds each move of x and y (the box's centre), w, h and ink with its ease and overshoot,
  and the still holds; --frames adds every frame's row.`;
const EXAMPLE =
  "node scripts/vc.mjs box .viral-clone/ref/ref.mp4 --at 1 --roi 240,280,600,540 --color auto";

// A range is read at this width (a 1080 px frame at 3 px a step); one time is read at full size.
const RANGE_W = 360;
const BLOB = 0.02;
const MIN_BLOB = 4;
// Over a range a frame shows the graphic when it holds this share of the range's most ink; less is noise.
const PRESENT = 0.05;
const BORDER = 2;
const HOLD_S = 0.3;

const hexOf = (/** @type {number[]} */ c) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const dist2 = (/** @type {number[]} */ a, /** @type {number[]} */ b) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Prints JSON with each innermost array or object on one line. @param {any} v */
export const print = (v) =>
  console.log(
    JSON.stringify(v, null, 1).replace(/[[{][^[\]{}]*[\]}]/g, (m) => m.replace(/\n\s*/g, " ")),
  );

/** @typedef {{ px: Uint8Array, w: number, h: number }} Frame */
/** @typedef {(r: number, g: number, b: number) => boolean} Match */

/** Color clusters of the pixels in `rect` that `keep` passes: 16-level bins, each merged into the first larger
 * cluster within `radius`, largest first. @param {Frame} f @param {number[]} rect x0,y0,x1,y1 inclusive
 * @param {(x: number, y: number, o: number) => boolean} keep @param {number} radius */
function clusters({ px, w }, [x0, y0, x1, y1], keep, radius) {
  /** @type {Map<number, number[]>} */
  const bins = new Map();
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const o = (y * w + x) * 3;
      if (!keep(x, y, o)) continue;
      const key = ((px[o] >> 4) << 8) | ((px[o + 1] >> 4) << 4) | (px[o + 2] >> 4);
      const bin = bins.get(key) ?? bins.set(key, [0, 0, 0, 0]).get(key);
      bin[0]++;
      for (let c = 0; c < 3; c++) bin[c + 1] += px[o + c];
    }
  /** @type {{ seed: number[], n: number, sum: number[] }[]} */
  const out = [];
  for (const [n, ...sum] of [...bins.values()].sort((a, b) => b[0] - a[0])) {
    const rgb = sum.map((s) => s / n);
    const home = out.find((c) => dist2(c.seed, rgb) <= radius * radius);
    if (!home) out.push({ seed: rgb, n, sum });
    else {
      home.n += n;
      sum.forEach((s, c) => (home.sum[c] += s));
    }
  }
  return out.map((c) => ({ rgb: c.sum.map((s) => s / c.n), n: c.n })).sort((a, b) => b.n - a.n);
}

/** --color auto: the commonest cluster among pixels that match no color holding 2% of the ROI's border ring.
 * @param {Frame} f @param {number} tol @returns {{ rgb: number[], n: number } | null} */
function autoColor(f, tol) {
  const { w, h } = f;
  const ring = (/** @type {number} */ x, /** @type {number} */ y) =>
    x < BORDER || y < BORDER || x >= w - BORDER || y >= h - BORDER;
  const border = clusters(f, [0, 0, w - 1, h - 1], ring, tol);
  const total = border.reduce((s, c) => s + c.n, 0);
  const ground = border.filter((c) => c.n >= 0.02 * total).map((c) => c.rgb);
  const unlike = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ o) =>
    !ring(x, y) && ground.every((c) => dist2(c, [f.px[o], f.px[o + 1], f.px[o + 2]]) > tol * tol);
  return clusters(f, [0, 0, w - 1, h - 1], unlike, tol)[0] ?? null;
}

/** The pixel test for --color. @param {string} spec @param {number} tol @returns {Match} */
function matcher(spec, tol) {
  if (spec === "white") return (r, g, b) => Math.min(r, g, b) >= 255 - tol;
  if (spec === "dark") return (r, g, b) => Math.max(r, g, b) <= tol;
  // the same test pieces-score.mjs's notGreen applies to a solo render
  if (spec === "alpha") return (r, g, b) => r + (255 - g) + b >= 90;
  const m = /^#?([0-9a-f]{6})$/i.exec(spec);
  if (!m)
    throw new Fix(
      `--color must be #rrggbb, white, dark, auto or alpha, got "${spec}"`,
      "--color #fce7bc",
    );
  const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return (r, g, b) => dist2(c, [r, g, b]) <= tol * tol;
}

/** The 8-connected blobs of the pixels `match` passes: each one's size and box, and every pixel's blob (0: none).
 * @param {Frame} f @param {Match} match */
function blobs({ px, w, h }, match) {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = match(px[3 * i], px[3 * i + 1], px[3 * i + 2]) ? 1 : 0;
  const id = new Int32Array(w * h);
  const list = [{ n: 0, x0: w, y0: h, x1: -1, y1: -1 }];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || id[s]) continue;
    const blob = { n: 0, x0: w, y0: h, x1: -1, y1: -1 };
    const c = list.push(blob) - 1;
    const stack = [s];
    id[s] = c;
    while (stack.length) {
      const p = /** @type {number} */ (stack.pop());
      const x = p % w;
      const y = (p - x) / w;
      blob.n++;
      [blob.x0, blob.y0] = [Math.min(blob.x0, x), Math.min(blob.y0, y)];
      [blob.x1, blob.y1] = [Math.max(blob.x1, x), Math.max(blob.y1, y)];
      for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++)
        for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) {
          const q = ny * w + nx;
          if (!mask[q] || id[q]) continue;
          id[q] = c;
          stack.push(q);
        }
    }
  }
  return { id, list };
}

/** Blobs under BLOB of the graphic's largest are speckle (a highlight on a jacket, a slice of other text).
 * @param {{ n: number }[][]} lists */
const floorOf = (...lists) =>
  Math.max(MIN_BLOB, BLOB * lists.flat().reduce((m, b) => Math.max(m, b.n), 0));

/** The box and pixel count of the blobs holding `floor` pixels or more, or null.
 * @param {{ n: number, x0: number, y0: number, x1: number, y1: number }[]} list @param {number} floor */
function graphic(list, floor) {
  const kept = list.filter((b) => b.n >= floor);
  if (!kept.length) return null;
  const edge = (
    /** @type {"x0" | "y0" | "x1" | "y1"} */ k,
    /** @type {(...v: number[]) => number} */ f,
  ) => f(...kept.map((b) => b[k]));
  const ink = kept.reduce((s, b) => s + b.n, 0);
  return {
    x0: edge("x0", Math.min),
    y0: edge("y0", Math.min),
    x1: edge("x1", Math.max),
    y1: edge("y1", Math.max),
    ink,
  };
}

/** One frame's graphic, with its text line bands: runs of rows holding it, a one-row gap bridged, under 3 rows
 * dropped. @param {Frame} f @param {Match} match */
function measure(f, match) {
  const { id, list } = blobs(f, match);
  const floor = floorOf(list);
  const g = graphic(list, floor);
  if (!g) return null;
  /** @type {number[][]} */
  const lines = [];
  for (let y = g.y0; y <= g.y1; y++) {
    let on = false;
    for (let x = g.x0; x <= g.x1 && !on; x++)
      on = list[id[y * f.w + x]].n >= floor && id[y * f.w + x] > 0;
    if (!on) continue;
    const last = lines.at(-1);
    if (last && y - last[1] <= 2) last[1] = y;
    else lines.push([y, y]);
  }
  return { ...g, lines: lines.filter(([a, b]) => b - a + 1 >= 3) };
}

/** Frames of `roi` from `start` for `seconds`, every one, at `width` (0: full size). @param {string} video
 * @param {number} start @param {number} seconds @param {number[]} roi @param {number} width */
function read(video, start, seconds, roi, width) {
  const fs = frames(video, start, seconds, roi, { fps: 0, width });
  const w = width || roi[2];
  return fs.map((px) => ({ px, w, h: px.length / 3 / w }));
}

/** One frame with the box drawn, cropped round it. @param {string} video @param {number} t @param {number[]} b box
 * @param {number[]} size video width, height @param {string} out @param {number[] | null} [union] */
function picture(video, t, b, [W, H], out, union = null) {
  const outer = union ?? b;
  const pad = Math.max(16, Math.round(0.25 * Math.max(outer[2], outer[3])));
  const cx = Math.max(0, outer[0] - pad);
  const cy = Math.max(0, outer[1] - pad);
  const cw = Math.min(W, outer[0] + outer[2] + pad) - cx;
  const ch = Math.min(H, outer[1] + outer[3] + pad) - cy;
  const draw = (
    /** @type {number[]} */ [x, y, w, h],
    /** @type {string} */ color,
    /** @type {number} */ t,
  ) => `drawbox=x=${x - cx}:y=${y - cy}:w=${w}:h=${h}:color=${color}:t=${t}`;
  const vf = [
    `crop=${cw}:${ch}:${cx}:${cy}`,
    ...(union ? [draw(union, "yellow", 1)] : []),
    draw(b, "red", 2),
  ];
  const args = ["-nostdin", "-v", "error", "-y", "-ss", String(t), "-i", video, "-frames:v", "1"];
  execFileSync(ffmpegBin(), [...args, "-vf", vf.join(","), out]);
  return out;
}

/** The --color spec as a test, choosing auto's color on the sample of `fs` where it covers most.
 * @param {string} spec @param {number} tol @param {Frame[]} fs */
function choose(spec, tol, fs) {
  if (spec !== "auto") return { match: matcher(spec, tol), color: spec };
  const picks = [0, 0.25, 0.5, 0.75, 1].map((p) =>
    autoColor(fs[Math.round(p * (fs.length - 1))], tol),
  );
  const best = picks.reduce((a, b) => ((b?.n ?? 0) > (a?.n ?? 0) ? b : a), null);
  if (!best)
    throw new Fix(
      "--color auto found nothing unlike the ROI's border",
      "pass --color #rrggbb or white",
    );
  return { match: matcher(hexOf(best.rgb), tol), color: hexOf(best.rgb) };
}

/** The no-pixels error, naming what the ROI does hold. @param {Frame} f @param {string} color @param {number} tol */
function nothing(f, color, tol) {
  const top = clusters(f, [0, 0, f.w - 1, f.h - 1], () => true, tol).slice(0, 3);
  const names = top
    .map((c) => `${hexOf(c.rgb)} ${Math.round((100 * c.n) / (f.w * f.h))}%`)
    .join(", ");
  const pick = autoColor(f, tol);
  return new Fix(
    `no pixels of ${color} (within --tol ${tol}) in the ROI; it holds ${names}`,
    pick
      ? `pass --color ${hexOf(pick.rgb)} (what --color auto picks here) or one of those colors`
      : "draw --roi round the graphic with some of its ground, then --color auto",
  );
}

/** @param {number[]} roi @param {number} w @param {number} h */
function checkRoi([x, y, rw, rh], w, h) {
  if (x < 0 || y < 0 || x + rw > w || y + rh > h)
    throw new Fix(
      `--roi ${[x, y, rw, rh].join(",")} runs past the ${w}x${h} frame`,
      `keep it inside 0,0,${w},${h}`,
    );
}

/** In video pixels. @param {any} m @param {number[]} roi @param {number} kx @param {number} ky */
const toVideo = (m, [rx, ry], kx, ky) => ({
  x: Math.round(rx + m.x0 * kx),
  y: Math.round(ry + m.y0 * ky),
  w: Math.round((m.x1 - m.x0 + 1) * kx),
  h: Math.round((m.y1 - m.y0 + 1) * ky),
});

/** One time. @param {any} o */
function at(o) {
  const [f] = read(o.video, o.t, 1.5 / o.fps, o.roi, 0);
  if (!f)
    throw new Fix(`no frame at ${o.t}s`, `pick a time before ${round(o.duration - 1 / o.fps, 2)}s`);
  const { match, color } = choose(o.color, o.tol, [f]);
  const m = measure(f, match);
  if (!m) throw nothing(f, color, o.tol);
  const box = toVideo(m, o.roi, 1, 1);
  const inBox = clusters(f, [m.x0, m.y0, m.x1, m.y1], () => true, o.tol);
  const area = box.w * box.h;
  const lines = m.lines.map(([a, b]) => ({ y: o.roi[1] + a, h: b - a + 1 }));
  const heights = lines.map((l) => l.h).sort((a, b) => a - b);
  return {
    t: o.t,
    frame: o.frame0,
    color,
    box,
    ink_px: m.ink,
    colors: inBox.slice(0, 3).map((c) => ({ hex: hexOf(c.rgb), share: round(c.n / area, 2) })),
    lines,
    cap_height_px: heights[(heights.length - 1) >> 1] ?? null,
    image: picture(
      o.video,
      o.t,
      [box.x, box.y, box.w, box.h],
      [o.width, o.height],
      join(o.dir, `box-${o.t}s.png`),
    ),
  };
}

/** Runs where the box is on screen and none of x, y, w, h moves past `quant`, 0.3 s or longer.
 * @param {any[]} rows @param {number} quant @param {number} fps */
function holds(rows, quant, fps) {
  const still = rows.map(
    (r, i) =>
      i > 0 &&
      r.x != null &&
      rows[i - 1].x != null &&
      ["x", "y", "w", "h"].every((k) => Math.abs(r[k] - rows[i - 1][k]) <= quant),
  );
  const out = [];
  for (let i = 0, run = 0; i <= still.length; i++) {
    if (still[i]) run++;
    else {
      if (run + 1 >= HOLD_S * fps)
        out.push({ start_s: rows[i - run - 1].t, seconds: round((run + 1) / fps, 2) });
      run = 0;
    }
  }
  return out;
}

/** A range: when it is seen, its union and median box; --track fits its moves. @param {any} o */
function range(o) {
  const width = Math.min(RANGE_W, o.roi[2]);
  const fs = read(o.video, o.start, o.end - o.start, o.roi, width);
  if (!fs.length)
    throw new Fix(
      `no frames between ${o.start}s and ${o.end}s`,
      `keep --end at most ${round(o.duration, 2)}`,
    );
  const kx = o.roi[2] / width;
  const ky = o.roi[3] / fs[0].h;
  const { match, color } = choose(o.color, o.tol, fs);
  // speckle is judged against the graphic's largest blob in the whole range, so a sliver entering is not swamped
  const found = fs.map((f) => blobs(f, match).list);
  const floor = floorOf(...found);
  const rows = found.map((list, i) => {
    const frame = o.frame0 + i;
    const t = round(frame / o.fps, 3);
    const m = graphic(list, floor);
    if (!m) return { t, frame, x: null, y: null, w: 0, h: 0, ink: 0, box: null };
    const b = toVideo(m, o.roi, kx, ky);
    const ink = Math.round(m.ink * kx * ky);
    return {
      t,
      frame,
      x: round(b.x + b.w / 2, 1),
      y: round(b.y + b.h / 2, 1),
      w: b.w,
      h: b.h,
      ink,
      box: b,
    };
  });
  const most = Math.max(...rows.map((r) => r.ink));
  for (const r of rows)
    if (r.box && r.ink < PRESENT * most)
      Object.assign(r, { x: null, y: null, w: 0, h: 0, ink: 0, box: null });
  const seen = rows.filter((r) => r.box);
  if (!seen.length) throw nothing(fs[fs.length >> 1], color, o.tol);
  const med = (/** @type {number[]} */ v) => [...v].sort((a, b) => a - b)[(v.length - 1) >> 1];
  const boxes = seen.map((r) => r.box);
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const union = [
    x0,
    y0,
    Math.max(...boxes.map((b) => b.x + b.w)) - x0,
    Math.max(...boxes.map((b) => b.y + b.h)) - y0,
  ];
  const median = ["x", "y", "w", "h"].map((k) => med(boxes.map((b) => b[k])));
  const last = seen.at(-1);
  const out = {
    start: o.start,
    end: o.end,
    fps: round(o.fps, 3),
    color,
    frames: rows.length,
    seen_frames: seen.length,
    first_seen_s: seen[0].t,
    first_seen_frame: seen[0].frame,
    last_seen_s: last.t,
    last_seen_frame: last.frame,
    box_union: union,
    box_median: median,
    ink_px_median: med(seen.map((r) => r.ink)),
    image: picture(
      o.video,
      last.t,
      [last.box.x, last.box.y, last.box.w, last.box.h],
      [o.width, o.height],
      join(o.dir, `box-${o.start}-${o.end}s.png`),
      union,
    ),
  };
  const plain = rows.map((r) => ({ ...r, box: undefined }));
  if (o.track) Object.assign(out, track(plain, Math.max(kx, ky), o));
  if (o.frames) Object.assign(out, { rows: plain });
  return out;
}

/** Each move of x, y (the box's centre), w, h and ink, fitted by motion-curve.mjs, and the still holds.
 * @param {any[]} rows @param {number} quant video pixels per working pixel @param {any} o */
function track(rows, quant, o) {
  const minPx = Math.max(2 * quant, 0.02 * Math.max(o.roi[2], o.roi[3]));
  const maxInk = Math.max(...rows.map((r) => r.ink));
  const moves = ["x", "y", "w", "h", "ink"]
    .flatMap((k) =>
      k === "ink"
        ? fitMoves(rows, k, o.fps, 0.1 * maxInk, 0.02 * maxInk)
        : fitMoves(rows, k, o.fps, minPx, quant),
    )
    .sort((a, b) => a.start_s - b.start_s)
    .map((m) => ({
      prop: m.prop,
      ...(m.pulse ? { pulse: true, peak: m.peak } : {}),
      start_s: m.start_s,
      duration_s: m.duration_s,
      from: m.from,
      to: m.to,
      ease: m.ease,
      overshoot_pct: m.overshoot_pct,
      rmse: m.rmse,
    }));
  return { moves, holds: holds(rows, quant, o.fps) };
}

/** @param {string[]} args */
export async function main(args) {
  const parsed = parseTool(args, {
    usage: USAGE,
    example: EXAMPLE,
    options: {
      at: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      roi: { type: "string" },
      color: { type: "string", default: "auto" },
      tol: { type: "string", default: "40" },
      track: { type: "boolean" },
      frames: { type: "boolean" },
      out: { type: "string" },
    },
  });
  if (!parsed) return;
  const { values: v, positionals } = parsed;
  const video = positionals[0];
  if (!video) throw new Fix("no video given", `run it as: ${EXAMPLE}`);
  const p = probe(video);
  const roi = v.roi ? roiArg(v.roi) : [0, 0, p.width, p.height];
  checkRoi(roi, p.width, p.height);
  const tol = numbers(v.tol, "--tol")[0];
  const base = {
    video,
    roi,
    tol,
    color: v.color,
    fps: p.fps,
    duration: p.duration,
    width: p.width,
    height: p.height,
  };
  const dir = outDir(v.out, "box");
  const frameAt = (/** @type {number} */ t) => Math.ceil(t * p.fps - 1e-6);
  let result;
  if (v.at != null) {
    const t = numbers(v.at, "--at")[0];
    result = at({ ...base, t, frame0: frameAt(t), dir });
  } else if (v.start != null && v.end != null) {
    const [start, end] = [numbers(v.start, "--start")[0], numbers(v.end, "--end")[0]];
    if (end <= start)
      throw new Fix(`--end ${end} is not after --start ${start}`, "--start 3.5 --end 4.0");
    result = range({
      ...base,
      start,
      end,
      frame0: frameAt(start),
      track: v.track,
      frames: v.frames,
      dir,
    });
  } else throw new Fix("give --at t, or --start and --end", `run it as: ${EXAMPLE}`);
  print({ video, roi, ...result });
}
