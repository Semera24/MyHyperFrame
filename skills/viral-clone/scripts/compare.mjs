// The reference and ours side by side at chosen moments: one sheet of [ref | ours] pairs, each labelled with both
// times and its SSIM, so what differs and by how much come from one call, on any two videos of any sizes.
import { execFileSync } from "node:child_process";
import { basename, extname, join } from "node:path";
import { ffmpegBin, round } from "./media.mjs";
import { ssim } from "./piece-pair.mjs";
import { Fix, box, numbers, outDir, parseTool, probe } from "./tool.mjs";

const USAGE = `usage: vc compare REF OURS --at t1,t2,... [--map refT=oursT,...] [--roi x,y,w,h] [--ours-roi x,y,w,h] [--out DIR]
  Each pair is the reference at t beside ours at t, or at the time --map gives (--map replaces --at).
  --roi is in the reference's pixels; ours defaults to it scaled by the two widths, and to the whole frame without
  --roi. Ours is scaled to the reference's box, so sizes and aspects may differ.
  Prints {sheet, pairs: [{ref_t, ours_t, ssim}], mean_ssim, worst}; the sheet is one PNG of [ref | ours] pairs.`;
const EXAMPLE = "node scripts/vc.mjs compare reference/ref.mp4 renders/v0.mp4 --at 1.2,4.8,9.5";

// Both the tile and the grey frame SSIM is taken on; a 9:16 box at this width is 570 tall, the tallest a tile gets.
const WORK_W = 320;
const MAX_TILE_H = 570;
const SHEET_W = 1600;
const GAP = 4;
const PAD = 12;
// Labels are drawn from a 3x5 pixel font at this scale: ffmpeg's drawtext needs fonts a Linux or Windows box lacks.
const SCALE = 3;
const LABEL_H = 5 * SCALE + 6;
const GLYPHS = {
  0: "111101101101111",
  1: "010110010010111",
  2: "111001111100111",
  3: "111001111001111",
  4: "101101111001001",
  5: "111100111001111",
  6: "111100111101111",
  7: "111001001001001",
  8: "111101111101111",
  9: "111101111001111",
  ".": "000000000000010",
  "-": "000000111000000",
  r: "000111100100100",
  e: "111101111100111",
  f: "011010111010010",
  o: "000111101101111",
  u: "000101101101111",
  s: "011100010001110",
  i: "010000010010010",
  m: "000111111101101",
};

const even = (/** @type {number} */ v) => Math.max(2, Math.round(v / 2) * 2);
const stem = (/** @type {string} */ p) => basename(p, extname(p));

/** One frame's box at time `t`, scaled to `w`×`h`, as RGB bytes. @param {string} path @param {number} t
 * @param {number[]} roi @param {number} w @param {number} h */
function grab(path, t, [x, y, bw, bh], w, h) {
  const vf = `crop=${bw}:${bh}:${x}:${y},scale=${w}:${h},format=rgb24`;
  const raw = execFileSync(
    ffmpegBin(),
    [
      "-nostdin",
      "-v",
      "error",
      "-ss",
      String(t),
      "-i",
      path,
      "-frames:v",
      "1",
      "-vf",
      vf,
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: 1 << 28 },
  );
  if (raw.length < w * h * 3)
    throw new Fix(`no frame at ${t}s in ${path}`, "pick a time at least one frame before its end");
  return raw.subarray(0, w * h * 3);
}

/** BT.601 luma of RGB bytes. @param {Uint8Array} rgb */
function grey(rgb) {
  const out = new Uint8Array(rgb.length / 3);
  for (let i = 0; i < out.length; i++)
    out[i] = (77 * rgb[3 * i] + 150 * rgb[3 * i + 1] + 29 * rgb[3 * i + 2]) >> 8;
  return out;
}

/** An RGB canvas `w` wide that tiles and labels are drawn into. @param {number} w @param {number} h */
function canvas(w, h) {
  const px = Buffer.alloc(w * h * 3, 24);
  /** @param {number} x @param {number} y @param {number} cw @param {number} ch @param {Uint8Array} [src] */
  const put = (x, y, cw, ch, src) => {
    for (let r = 0; r < ch; r++)
      if (src) px.set(src.subarray(r * cw * 3, (r + 1) * cw * 3), ((y + r) * w + x) * 3);
      else px.fill(255, ((y + r) * w + x) * 3, ((y + r) * w + x + cw) * 3);
  };
  /** @param {string} text @param {number} x @param {number} y */
  const label = (text, x, y) =>
    [...text].forEach((ch, i) => {
      const g = /** @type {Record<string, string>} */ (GLYPHS)[ch] ?? "";
      for (let k = 0; k < g.length; k++)
        if (g[k] === "1")
          put(x + (i * 4 + (k % 3)) * SCALE, y + Math.floor(k / 3) * SCALE, SCALE, SCALE);
    });
  return { px, put, label };
}

const scored = (/** @type {{ref_t: number, ours_t: number, ssim: number}} */ p) => ({
  ref_t: p.ref_t,
  ours_t: p.ours_t,
  ssim: p.ssim,
});

/** The pairs' frames, their SSIM and the sheet written to `sheet`.
 * @param {string} ref @param {string} ours @param {[number, number][]} times reference and ours seconds
 * @param {{roi?: number[], oursRoi?: number[], sheet: string}} opts */
export function compare(ref, ours, times, { roi, oursRoi, sheet }) {
  const [r, o] = [probe(ref), probe(ours)];
  /** @param {number} at @param {{duration: number}} v @param {string} name @param {string} path */
  const inside = (at, v, name, path) => {
    if (at < 0 || at >= v.duration)
      throw new Fix(
        `${at}s is past the end of ${name} (${path} is ${round(v.duration, 2)}s)`,
        "pick times inside both videos, or pair them with --map refT=oursT",
      );
  };
  for (const [t, ot] of times) {
    inside(t, r, "the reference", ref);
    inside(ot, o, "ours", ours);
  }
  /** @param {number[]} b @param {{width: number, height: number}} v @param {string} flag */
  const fits = ([x, y, w, h], v, flag) => {
    if (x < 0 || y < 0 || x + w > v.width || y + h > v.height)
      throw new Fix(
        `${flag} ${[x, y, w, h]} leaves the ${v.width}x${v.height} frame`,
        `pass x,y,w,h with x+w <= ${v.width} and y+h <= ${v.height}`,
      );
  };
  const rr = roi ?? [0, 0, r.width, r.height];
  fits(rr, r, "--roi");
  const [x, y, w, h] = rr.map((v) => Math.round((v * o.width) / r.width));
  const scaled = [x, y, Math.min(w, o.width - x), Math.min(h, o.height - y)];
  const or = oursRoi ?? (roi ? scaled : [0, 0, o.width, o.height]);
  fits(or, o, "--ours-roi");
  const tw = Math.min(WORK_W, even((MAX_TILE_H * rr[2]) / rr[3]));
  const th = even((rr[3] * tw) / rr[2]);
  const pairs = times.map(([t, ot]) => {
    const [a, b] = [grab(ref, t, rr, tw, th), grab(ours, ot, or, tw, th)];
    return { ref_t: t, ours_t: ot, ssim: round(ssim(grey(a), grey(b), tw)), a, b };
  });
  drawSheet(pairs, tw, th, sheet);
  const scores = pairs.map((p) => p.ssim);
  const worst = pairs[scores.indexOf(Math.min(...scores))];
  return {
    sheet,
    pairs: pairs.map(scored),
    mean_ssim: round(scores.reduce((sum, v) => sum + v, 0) / scores.length),
    worst: scored(worst),
  };
}

/** [ref | ours] pairs, as many to a row as fit SHEET_W, each tile under its label, as one PNG.
 * @param {{ref_t: number, ours_t: number, ssim: number, a: Uint8Array, b: Uint8Array}[]} pairs
 * @param {number} tw @param {number} th @param {string} out */
function drawSheet(pairs, tw, th, out) {
  const [cellW, cellH] = [2 * tw + GAP, LABEL_H + th];
  const cols = Math.min(pairs.length, Math.max(1, Math.floor((SHEET_W + PAD) / (cellW + PAD))));
  const rows = Math.ceil(pairs.length / cols);
  const [w, h] = [cols * cellW + (cols - 1) * PAD, rows * cellH + (rows - 1) * PAD];
  const c = canvas(w, h);
  pairs.forEach((p, i) => {
    const [x, y] = [(i % cols) * (cellW + PAD), Math.floor(i / cols) * (cellH + PAD)];
    c.label(`ref ${p.ref_t}s`, x + 3, y + 3);
    c.label(`ours ${p.ours_t}s ssim ${p.ssim}`, x + tw + GAP + 3, y + 3);
    c.put(x, y + LABEL_H, tw, th, p.a);
    c.put(x + tw + GAP, y + LABEL_H, tw, th, p.b);
  });
  execFileSync(
    ffmpegBin(),
    [
      "-nostdin",
      "-v",
      "error",
      "-y",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-s",
      `${w}x${h}`,
      "-i",
      "-",
      out,
    ],
    { input: c.px },
  );
}

/** "1.2=1.35,4=4.1" as [ref, ours] seconds. @param {string} text */
function pairsOf(text) {
  return text.split(",").map((p) => {
    const v = p.split("=").map(Number);
    if (v.length !== 2 || !v.every(Number.isFinite))
      throw new Fix(`--map pairs are refT=oursT, got "${p}"`, "--map 1.2=1.35,4.8=5.1");
    return /** @type {[number, number]} */ (v);
  });
}

/** @param {string[]} args */
export async function main(args) {
  const parsed = parseTool(args, {
    usage: USAGE,
    example: EXAMPLE,
    options: {
      at: { type: "string" },
      map: { type: "string" },
      roi: { type: "string" },
      "ours-roi": { type: "string" },
      out: { type: "string" },
    },
  });
  if (!parsed) return;
  const { values: v, positionals } = parsed;
  const [ref, ours] = positionals;
  if (!ref || !ours || (!v.at && !v.map))
    throw new Fix("compare needs REF, OURS and --at or --map", `run it as: ${EXAMPLE}`);
  const times = v.map ? pairsOf(v.map) : numbers(v.at, "--at").map((t) => [t, t]);
  const sheet = join(outDir(v.out, "compare"), `${stem(ours)}-at-${times[0][0]}s.png`);
  const result = compare(ref, ours, /** @type {[number, number][]} */ (times), {
    roi: v.roi ? box(v.roi) : undefined,
    oursRoi: v["ours-roi"] ? box(v["ours-roi"]) : undefined,
    sheet,
  });
  console.log(JSON.stringify(result));
}
