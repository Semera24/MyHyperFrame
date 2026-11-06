// One window, reference above and rebuild below, frame for frame at the reference's own rate, row by row, so a
// boil, a fade or an ease reads off the picture the way an editor reads it side by side; three stills show none.
import { execFileSync } from "node:child_process";
import { ffmpegBin, ffprobeBin } from "./media.mjs";

// Past this many frames a window shows every Nth frame, N = ceil(frames / 48): a 3 s hold stays one readable image.
const MAX_FRAMES = 48;
const TILE_H = 120;
const ROW_W = 1920;
// A box flatter or taller than this is shown with the frame around it, so a one-line title stays legible.
const ASPECT = 3;

/** The video's frame rate. @param {string} path */
export function fpsOf(path) {
  const [num, den] = execFileSync(ffprobeBin(), [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=r_frame_rate",
    "-of",
    "csv=p=0",
    path,
  ])
    .toString()
    .trim()
    .split("/")
    .map(Number);
  return num / (den || 1);
}

const even = (v) => Math.max(2, Math.round(v / 2) * 2);

/** @param {string} path @returns {[number, number]} */
const sizeOf = (path) =>
  /** @type {[number, number]} */ (
    execFileSync(ffprobeBin(), [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      path,
    ])
      .toString()
      .trim()
      .split(",")
      .map(Number)
  );

/** The box widened about its centre to at most ASPECT:1 either way, kept inside a `fw`×`fh` frame.
 * @param {number[]} roi @param {number} fw @param {number} fh */
export function shown([x, y, w, h], fw, fh) {
  const [W, H] = [Math.max(w, Math.ceil(h / ASPECT)), Math.max(h, Math.ceil(w / ASPECT))];
  const [nw, nh] = [Math.min(W, fw), Math.min(H, fh)];
  const clamp = (v, size, room) => Math.min(Math.max(0, Math.round(v)), room - size);
  return [clamp(x + w / 2 - nw / 2, nw, fw), clamp(y + h / 2 - nh / 2, nh, fh), nw, nh];
}

/** Rows of the window: each a start time and length, `perRow` frames at `rate`.
 * @param {number} start @param {number} seconds @param {number} fps @param {number} perRow */
export function rows(start, seconds, fps, perRow) {
  const frames = Math.max(1, Math.round(seconds * fps));
  const step = Math.ceil(frames / MAX_FRAMES);
  const rate = fps / step;
  const span = perRow / rate;
  return {
    step,
    rate,
    rows: Array.from({ length: Math.ceil(frames / step / perRow) }, (_, i) => ({
      start: start + i * span,
      seconds: Math.min(span, start + seconds - (start + i * span)),
    })),
  };
}

/** Writes the strip to `out` (PNG). The rebuild's box is the reference's scaled by the two videos' widths, as the
 * scorer scales it. @param {string} ref @param {string} solo @param {number} start @param {number} seconds
 * @param {number[]} roi in the reference's pixels @param {string} out
 * @param {number} [soloStart] where the window starts in the solo render: 0 for a piece's own solo page */
export function strip(ref, solo, start, seconds, roi, out, soloStart = start) {
  const [refW, refH] = sizeOf(ref);
  const scale = sizeOf(solo)[0] / refW;
  const [x, y, w, h] = shown(roi, refW, refH);
  const [dx, dy, dw, dh] = [x, y, w, h].map((v) => Math.round(v * scale));
  const H = TILE_H;
  const W = even((H * w) / h);
  const perRow = Math.max(4, Math.floor(ROW_W / W));
  const plan = rows(start, seconds, fpsOf(ref), perRow);
  const inputs = plan.rows.flatMap((r) => {
    const span = (/** @type {number} */ at) => ["-ss", String(at), "-t", String(r.seconds)];
    return [...span(r.start), "-i", ref, ...span(r.start - start + soloStart), "-i", solo];
  });
  const cell = (/** @type {string} */ crop) =>
    `${crop},scale=${W}:${H},setsar=1,fps=${plan.rate},tile=${perRow}x1:padding=2:color=white`;
  const graph = plan.rows.flatMap((_, i) => [
    `[${i * 2}:v]${cell(`crop=${w}:${h}:${x}:${y}`)}[r${i}]`,
    `[${i * 2 + 1}:v]${cell(`crop=${dw}:${dh}:${dx}:${dy}`)}[d${i}]`,
  ]);
  const pairs = plan.rows.map((_, i) => `[r${i}][d${i}]`).join("");
  graph.push(`${pairs}vstack=${plan.rows.length * 2}[out]`);
  execFileSync(ffmpegBin(), [
    "-nostdin",
    "-v",
    "error",
    "-y",
    ...inputs,
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[out]",
    "-frames:v",
    "1",
    out,
  ]);
  return { frames_per_row: perRow, every: plan.step, rows: plan.rows.length };
}

// A 1 FPS sheet or a 48-frame strip shows a 680 px title at a few px a letter, too small to count paper scraps: G0
// wrote "a scrap per 2-3 letters" for Cindy's title, which has one per 1-2. The zoom shows the box this wide.
const ZOOM_W = 1600;

/** The box at the middle of its window, reference above and rebuild below, scaled up to read construction from.
 * @param {string} ref @param {string} solo @param {number} at reference seconds @param {number[]} roi
 * @param {number[]} soloRoi @param {number} soloAt @param {string} out .png */
export function zoomPair(ref, solo, at, [x, y, w, h], [sx, sy, sw, sh], soloAt, out) {
  const height = Math.max(2, Math.round((h * ZOOM_W) / w / 2) * 2);
  execFileSync(ffmpegBin(), [
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-ss",
    String(at),
    "-i",
    ref,
    "-ss",
    String(soloAt),
    "-i",
    solo,
    "-filter_complex",
    `[0:v]crop=${w}:${h}:${x}:${y},scale=${ZOOM_W}:${height}:flags=lanczos[a];` +
      `[1:v]crop=${sw}:${sh}:${sx}:${sy},scale=${ZOOM_W}:${height}:flags=lanczos[b];[a][b]vstack`,
    "-frames:v",
    "1",
    out,
  ]);
  return out;
}
