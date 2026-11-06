// When things change on screen, from the frame-to-frame grey difference inside an ROI or each cell of a grid: cuts
// (most of the frame changes at once), appears and disappears (a region steps from one steady look to another),
// holds (still for 0.3 s or more) and other motion, each with its frame number, and one strip of their before|after.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { print } from "./box.mjs";
import { ffmpegBin, frames, round } from "./media.mjs";
import { Fix, box, grid, numbers, outDir, parseTool, probe } from "./tool.mjs";

const USAGE = `usage: vc events VIDEO [--roi x,y,w,h | --grid 6x10] [--start s --end s] [--thr 5] [--out DIR]
  Every frame is read 160 px wide, grey. A burst is a run of frames where a cell (or the ROI) changes by over twice
  its usual change (its 25th percentile) and over 2 grey levels. A burst of 0.5 s or less whose last frame differs
  from the frame before it by --thr or more (mean grey levels), with under a third of that change in the 0.3 s either
  side, is an appear or a disappear: appear when the region gains contrast or, a flat fill on flat ground, gets
  brighter. Other bursts are change. A cut is a frame where 70% of the frame's cells change by --thr or more. A hold
  is 0.3 s or more where the ROI (with --grid, the whole frame) stays still. Cells are r{row}c{col}, r0c0 top left;
  neighbouring cells whose steps overlap in time are one event, with its roi in video pixels for vc box.
  Prints {fps, frames, counts, holds, strip, events}; the strip is up to 24 before|after pairs in time order: every
  cut, the largest appears and disappears (cells × magnitude), then the largest changes.`;
const EXAMPLE = "node scripts/vc.mjs events .viral-clone/ref/ref.mp4 --grid 6x10 --start 0 --end 6";

// The width motion-rhythm.mjs reads motion at, so its still threshold carries over.
const W = 160;
const CUT_SHARE = 0.7;
const CUT_GRID = 4;
const HOLD_S = 0.3;
const STEP_MAX_S = 0.5;
const STRIP_MAX = 24;
const STRIP_W = 1200;

/** A grid cell; rect is x0,y0,x1,y1 in working pixels, end exclusive.
 * @typedef {{ name: string, rect: number[] }} Cell */

/** BT.601 luma. @param {Uint8Array} rgb */
function grey(rgb) {
  const out = new Uint8Array(rgb.length / 3);
  for (let i = 0; i < out.length; i++)
    out[i] = (77 * rgb[3 * i] + 150 * rgb[3 * i + 1] + 29 * rgb[3 * i + 2]) >> 8;
  return out;
}

/** The cols×rows cells of a w×h picture. @param {number} cols @param {number} rows @param {number} w
 * @param {number} h @returns {Cell[]} */
function cells(cols, rows, w, h) {
  return Array.from({ length: rows * cols }, (_, i) => {
    const [r, c] = [Math.floor(i / cols), i % cols];
    const rect = [Math.floor((c * w) / cols), Math.floor((r * h) / rows)];
    rect.push(Math.floor(((c + 1) * w) / cols), Math.floor(((r + 1) * h) / rows));
    return { name: `r${r}c${c}`, rect };
  });
}

/** Mean absolute difference of two frames inside `rect`. @param {Uint8Array} a @param {Uint8Array} b @param {number} w
 * @param {number[]} rect */
function diff(a, b, w, [x0, y0, x1, y1]) {
  let s = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) s += Math.abs(a[y * w + x] - b[y * w + x]);
  return s / Math.max(1, (x1 - x0) * (y1 - y0));
}

/** Mean and standard deviation of grey inside `rect`. @param {Uint8Array} f @param {number} w @param {number[]} rect */
function level(f, w, [x0, y0, x1, y1]) {
  let s = 0;
  let s2 = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      s += f[y * w + x];
      s2 += f[y * w + x] ** 2;
    }
  const n = Math.max(1, (x1 - x0) * (y1 - y0));
  return { mean: s / n, std: Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) };
}

/** Each frame's change from the one before inside `rect` (frame 0: 0). @param {Uint8Array[]} g @param {number} w
 * @param {number[]} rect */
const changes = (g, w, rect) => g.map((f, i) => (i ? diff(f, g[i - 1], w, rect) : 0));

/** Runs of frames changing by over twice the series' 25th percentile and over 2 grey levels, one quiet frame bridged.
 * @param {number[]} d */
function bursts(d) {
  const q = d.slice(1).sort((a, b) => a - b);
  const act = Math.max(2, 2 * (q[Math.floor(q.length / 4)] ?? 0));
  /** @type {number[][]} */
  const out = [];
  for (let i = 1; i < d.length; i++) {
    if (d[i] <= act) continue;
    const last = out.at(-1);
    if (last && i - last[1] <= 2) last[1] = i;
    else out.push([i, i]);
  }
  return out;
}

/** Still runs of HOLD_S or more, by motion-rhythm.mjs's still threshold (twice the 10th percentile, 0.5 to 1.5).
 * @param {number[]} d @param {number} fps @returns {number[][]} [first frame of the held picture, its frames] */
function stills(d, fps) {
  const q = d.slice(1).sort((a, b) => a - b);
  const floor = Math.min(1.5, Math.max(0.5, 2 * (q[Math.floor(q.length / 10)] ?? 0)));
  const out = [];
  for (let i = 1, run = 0; i <= d.length; i++) {
    if (i < d.length && d[i] <= floor) run++;
    else {
      if (run + 1 >= HOLD_S * fps) out.push([i - run - 1, run + 1]);
      run = 0;
    }
  }
  return out;
}

/** Joins items whose `near(a, b)` holds, transitively. @template T @param {T[]} items
 * @param {(a: T, b: T) => boolean} near @returns {T[][]} */
function groups(items, near) {
  const root = items.map((_, i) => i);
  const find = (/** @type {number} */ i) => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (near(items[i], items[j])) root[find(i)] = find(j);
  /** @type {Map<number, T[]>} */
  const out = new Map();
  items.forEach((it, i) => out.set(find(i), [...(out.get(find(i)) ?? []), it]));
  return [...out.values()];
}

/** One PNG of each shown event's before|after pair. @param {Buffer[]} rgb @param {number} w @param {number} h
 * @param {any[]} shown with .before, .after frame indexes and .rect (working pixels) or null @param {string} out */
function strip(rgb, w, h, shown, out) {
  const per = Math.max(1, Math.floor(STRIP_W / (2 * w + 12)));
  const cw = per * (2 * w + 12);
  const ch = Math.ceil(shown.length / per) * (h + 8);
  const px = Buffer.alloc(cw * ch * 3, 255);
  shown.forEach((e, k) => {
    const [ox, oy] = [(k % per) * (2 * w + 12), Math.floor(k / per) * (h + 8)];
    [e.before, e.after].forEach((f, side) => {
      const x0 = ox + side * (w + 2);
      for (let y = 0; y < h; y++)
        rgb[f].copy(px, ((oy + y) * cw + x0) * 3, y * w * 3, (y + 1) * w * 3);
      if (!e.rect) return;
      const [rx0, ry0, rx1, ry1] = e.rect;
      for (let y = ry0; y < ry1; y++)
        for (let x = rx0; x < rx1; x++)
          if (y === ry0 || y === ry1 - 1 || x === rx0 || x === rx1 - 1)
            px.set([255, 0, 0], ((oy + y) * cw + x0 + x) * 3);
    });
  });
  execFileSync(
    ffmpegBin(),
    ["-v", "error", "-y", "-f", "ppm_pipe", "-i", "-", "-frames:v", "1", out],
    { input: Buffer.concat([Buffer.from(`P6\n${cw} ${ch}\n255\n`), px]) },
  );
  return out;
}

/** Frames where CUT_SHARE of the cells change by `thr` or more at once, and each cell's change per frame.
 * @param {Uint8Array[]} g whole frames @param {Cell[]} cutCells @param {number} thr */
function cutFrames(g, cutCells, thr) {
  const d = cutCells.map((c) => changes(g, W, c.rect));
  const cuts = g
    .map((_, i) => i)
    .filter((i) => i > 0 && d.filter((x) => x[i] >= thr).length >= CUT_SHARE * cutCells.length);
  return { cuts, d };
}

/** Each region's bursts outside the cuts, split into steps and other motion. @param {Uint8Array[]} g
 * @param {Cell[]} regions @param {number[]} cuts @param {number} thr @param {number} fps */
function bursting(g, regions, cuts, thr, fps) {
  const settle = Math.round(HOLD_S * fps);
  const steps = [];
  const moves = [];
  for (const [ci, c] of regions.entries()) {
    const d = changes(g, W, c.rect);
    for (const [a, b] of bursts(d)) {
      if (cuts.some((f) => f >= a && f <= b)) continue;
      const net = diff(g[b], g[a - 1], W, c.rect);
      // a step joins two looks that each last: the region moves under a third as much in the 0.3 s either side
      const was = diff(g[a - 1], g[Math.max(0, a - 1 - settle)], W, c.rect);
      const now = diff(g[b], g[Math.min(g.length - 1, b + settle)], W, c.rect);
      const step = net >= thr && b - a + 1 <= STEP_MAX_S * fps && Math.max(was, now) <= net / 3;
      (step ? steps : moves).push({ ci, c, a, b, net, peak: Math.max(...d.slice(a, b + 1)) });
    }
  }
  return { steps, moves };
}

/** Cuts, steps, other motion and holds as events, each with the frames and box its strip pair shows.
 * @param {any} ctx {g, h, roi, spec, fps, f0, thr, wholeG} */
function describe({ g, h, roi, spec, fps, f0, thr, wholeG }) {
  const at = (/** @type {number} */ i) => ({ frame: f0 + i, t: round((f0 + i) / fps, 3) });
  const wholeH = wholeG[0].length / W;
  // cuts are read on the whole frame: the grid's own cells, or with --roi a 4x4 grid of the whole frame
  const cutCells = cells(spec?.cols ?? CUT_GRID, spec?.rows ?? CUT_GRID, W, wholeH);
  const cut = cutFrames(wholeG, cutCells, thr);
  const regions = spec ? cutCells : [{ name: "roi", rect: [0, 0, W, h] }];
  const { steps, moves } = bursting(g, regions, cut.cuts, thr, fps);
  const cols = spec?.cols ?? 1;
  const touching = (/** @type {any} */ s, /** @type {any} */ o) =>
    Math.abs(Math.floor(s.ci / cols) - Math.floor(o.ci / cols)) <= 1 &&
    Math.abs((s.ci % cols) - (o.ci % cols)) <= 1;
  const overlap = (/** @type {any} */ s, /** @type {any} */ o) => s.a <= o.b + 2 && o.a <= s.b + 2;
  const [kx, ky] = [roi[2] / W, roi[3] / h];
  const event = (
    /** @type {any[]} */ grp,
    /** @type {string} */ type,
    /** @type {number} */ size,
  ) => {
    const [a, b] = [Math.min(...grp.map((s) => s.a)), Math.max(...grp.map((s) => s.b))];
    const rect = [0, 1, 2, 3].map((k) =>
      (k < 2 ? Math.min : Math.max)(...grp.map((s) => s.c.rect[k])),
    );
    const vid = [
      rect[0] * kx + roi[0],
      rect[1] * ky + roi[1],
      (rect[2] - rect[0]) * kx,
      (rect[3] - rect[1]) * ky,
    ];
    const where = spec
      ? { cells: [...new Set(grp.map((s) => s.c.name))].sort(), roi: vid.map(Math.round) }
      : {};
    const shown = { before: a - 1, after: b, rect: spec ? rect : null };
    return { type, ...at(a), frames: b - a + 1, ...where, magnitude: round(size, 1), ...shown };
  };
  const stepEvents = groups(steps, (s, o) => overlap(s, o) && touching(s, o)).map((grp) => {
    const e = event(grp, "", grp.reduce((m, s) => m + s.net, 0) / grp.length);
    const box = e.rect ?? [0, 0, W, h];
    const [was, now] = [level(g[e.before], W, box), level(g[e.after], W, box)];
    const up = Math.abs(now.std - was.std) >= 2 ? now.std > was.std : now.mean > was.mean;
    return { ...e, type: up ? "appear" : "disappear" };
  });
  const moveEvents = groups(moves, overlap).map((grp) =>
    event(grp, "change", Math.max(...grp.map((s) => s.peak))),
  );
  const cutEvents = cut.cuts.map((i) => ({
    type: "cut",
    ...at(i),
    magnitude: round(cut.d.reduce((m, d) => m + d[i], 0) / cut.d.length, 1),
    before: i - 1,
    after: i,
    rect: null,
  }));
  const still = spec ? changes(wholeG, W, [0, 0, W, wholeH]) : changes(g, W, [0, 0, W, h]);
  const held = stills(still, fps).map(([i, n]) => ({
    type: "hold",
    ...at(i),
    seconds: round(n / fps, 2),
  }));
  return { cutEvents, stepEvents, moveEvents, held };
}

/** @param {string[]} args */
export async function main(args) {
  const parsed = parseTool(args, {
    usage: USAGE,
    example: EXAMPLE,
    options: {
      roi: { type: "string" },
      grid: { type: "string" },
      start: { type: "string", default: "0" },
      end: { type: "string" },
      thr: { type: "string", default: "5" },
      out: { type: "string" },
    },
  });
  if (!parsed) return;
  const { values: v, positionals } = parsed;
  const video = positionals[0];
  if (!video) throw new Fix("no video given", `run it as: ${EXAMPLE}`);
  if (v.roi && v.grid)
    throw new Fix("--roi and --grid both given", "pass one: --roi x,y,w,h or --grid 6x10");
  const p = probe(video);
  const start = numbers(v.start, "--start")[0];
  const end = v.end == null ? p.duration : numbers(v.end, "--end")[0];
  if (end <= start)
    throw new Fix(`--end ${end} is not after --start ${start}`, "--start 0 --end 6");
  const thr = numbers(v.thr, "--thr")[0];
  const full = [0, 0, p.width, p.height];
  const roi = v.roi ? box(v.roi) : full;
  if (roi[0] < 0 || roi[1] < 0 || roi[0] + roi[2] > p.width || roi[1] + roi[3] > p.height)
    throw new Fix(
      `--roi ${roi.join(",")} runs past the ${p.width}x${p.height} frame`,
      "keep it inside the frame",
    );
  const rgb = frames(video, start, end - start, roi, { fps: 0, width: W });
  if (rgb.length < 3)
    throw new Fix(`under 3 frames between ${start}s and ${end}s`, "widen --start/--end");
  const g = rgb.map(grey);
  const wholeG = v.roi
    ? frames(video, start, end - start, full, { fps: 0, width: W, gray: true })
    : g;
  const h = g[0].length / W;
  const spec = v.grid ? grid(v.grid) : null;
  const f0 = Math.ceil(start * p.fps - 1e-6);
  const found = describe({ g, h, roi, spec, fps: p.fps, f0, thr, wholeG });
  const { cutEvents, stepEvents, moveEvents, held } = found;

  const order = (/** @type {any} */ x, /** @type {any} */ y) => x.frame - y.frame;
  // the strip keeps the biggest: cuts, then steps by cells × magnitude, then changes by magnitude
  const weight = (/** @type {any} */ e) => (e.cells?.length ?? 1) * e.magnitude;
  const shown = [
    ...cutEvents,
    ...[...stepEvents].sort((x, y) => weight(y) - weight(x)),
    ...[...moveEvents].sort((x, y) => y.magnitude - x.magnitude),
  ]
    .slice(0, STRIP_MAX)
    .sort(order);
  const name = `events-${start}-${round(end, 2)}s.png`;
  const stripPath = shown.length
    ? strip(rgb, W, h, shown, join(outDir(v.out, "events"), name))
    : null;
  shown.forEach((e, k) => (e.strip = k + 1));
  const events = [...cutEvents, ...stepEvents, ...moveEvents, ...held]
    .sort(order)
    .map((e) => ({ ...e, before: undefined, after: undefined, rect: undefined }));
  const lengths = held.map((x) => x.seconds).sort((a, b) => a - b);
  const count = (/** @type {string} */ type) => events.filter((e) => e.type === type).length;
  print({
    video,
    ...(spec ? { grid: v.grid } : { roi }),
    start,
    end: round(end, 3),
    fps: round(p.fps, 3),
    frames: rgb.length,
    thr,
    counts: Object.fromEntries(
      ["cut", "appear", "disappear", "change", "hold"].map((t) => [t, count(t)]),
    ),
    holds: {
      longest_s: lengths.at(-1) ?? 0,
      median_s: lengths[(lengths.length - 1) >> 1] ?? 0,
      count: lengths.length,
    },
    strip: stripPath,
    strip_events: `${shown.length} of ${events.length - held.length} (cuts, then the largest steps, then changes)`,
    events,
  });
}
