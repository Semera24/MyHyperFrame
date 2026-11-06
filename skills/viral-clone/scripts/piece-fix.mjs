// What to change in one rebuilt piece, in the units its code is edited in: the same measurements taken on the
// reference and on the solo render (its moves as tweens from `hf-media evidence flow-track`, its ink box over time,
// its step gap), set side by side. Pure, so pieces-score writes it and tests call it without video.

/** @typedef {{ kind: string, start: number, duration?: number, x: number, y: number, scale: number, ease?: string }}
 * Move */
/** @typedef {(number[] | null)[]} Boxes per sampled frame, [x, y, w, h] in the reference's pixels, or null */

// Under these a difference is measuring noise: two frames of time, 4 px or a tenth of the move, 3% of scale or size.
const FRAMES = 2;
const PX = 4;
const SHARE = 0.1;
const SCALE = 0.03;
const SIZE = 0.05;
const FILLS = 0.9;

const r1 = (v) => Math.round(v * 10) / 10;
const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];

/** @param {number} frames */
const late = (frames) =>
  `${Math.abs(frames)} frame${Math.abs(frames) === 1 ? "" : "s"} ${frames > 0 ? "late" : "early"}`;

/** @param {Move} ref @param {Move} ours @param {number} fps @returns {string[]} */
function moveDiff(ref, ours, fps) {
  const out = [];
  const startFrames = Math.round((ours.start - ref.start) * fps);
  if (Math.abs(startFrames) >= FRAMES) out.push(`starts ${late(startFrames)}`);
  const lasts = Math.round(((ours.duration ?? 0) - (ref.duration ?? 0)) * fps);
  if (Math.abs(lasts) >= FRAMES)
    out.push(`lasts ${r1(ours.duration ?? 0)} s, the reference ${r1(ref.duration ?? 0)} s`);
  const off = Math.hypot(ours.x - ref.x, ours.y - ref.y);
  if (off >= Math.max(PX, SHARE * Math.hypot(ref.x, ref.y)))
    out.push(
      `travels (${r1(ours.x)}, ${r1(ours.y)}) px, the reference (${r1(ref.x)}, ${r1(ref.y)})`,
    );
  if (Math.abs(ours.scale - ref.scale) >= SCALE)
    out.push(`scales ×${ours.scale}, the reference ×${ref.scale}`);
  if (ref.ease && ours.ease && ref.ease !== ours.ease)
    out.push(`eases ${ours.ease}, the reference ${ref.ease}`);
  return out;
}

/** A move too small to see: flow on a held piece finds a few of these from compression alone. @param {Move} m */
const visible = (m) => Math.hypot(m.x, m.y) >= PX || Math.abs(m.scale - 1) >= SCALE;

const count = (/** @type {number} */ n) => `${n} move${n === 1 ? "" : "s"}`;

/** The reference's moves against ours, in order, ignoring moves too small to see.
 * @param {Move[]} refMoves @param {Move[]} ourMoves @param {number} fps */
export function movesFix(refMoves, ourMoves, fps) {
  const [ref, ours] = [refMoves.filter(visible), ourMoves.filter(visible)];
  const kinds = (moves) => moves.map((m) => m.kind).join(", ") || "none";
  const out =
    ref.length === ours.length
      ? []
      : [
          `the reference makes ${count(ref.length)} (${kinds(ref)}), yours ${ours.length} (${kinds(ours)})`,
        ];
  for (let i = 0; i < Math.min(ref.length, ours.length); i++) {
    const diff = moveDiff(ref[i], ours[i], fps);
    if (diff.length) out.push(`move ${i + 1} ${diff.join("; ")}`);
  }
  return out;
}

/** When the piece shows and where it sits, ours against the reference's ink. Both sampled at `fps`. Says nothing
 * when the reference's ink fills its box: its color then matches what is behind it too (a white caption on a white
 * card), and the sheet is the measure.
 * @param {Boxes} ref @param {Boxes} ours @param {number} fps @param {number[]} roi */
export function boxFix(ref, ours, fps, [, , w, h]) {
  const first = (boxes) => boxes.findIndex(Boolean);
  const last = (boxes) => boxes.length - 1 - [...boxes].reverse().findIndex(Boolean);
  const [r, o] = [ref.filter(Boolean), ours.filter(Boolean)];
  if (!r.length || !o.length) return [];
  if (median(r.map((b) => (b[2] * b[3]) / (w * h))) >= FILLS) return [];
  const out = [];
  const seconds = (frames) => r1(frames / fps);
  const inAt = first(ours) - first(ref);
  if (inAt) out.push(`appears ${seconds(Math.abs(inAt))} s ${inAt > 0 ? "late" : "early"}`);
  const outAt = last(ours) - last(ref);
  if (outAt) out.push(`leaves ${seconds(Math.abs(outAt))} s ${outAt > 0 ? "late" : "early"}`);
  const mid = (boxes, i) => median(boxes.map((b) => b[i]));
  const [rw, rh, ow, oh] = [mid(r, 2), mid(r, 3), mid(o, 2), mid(o, 3)];
  const dx = mid(o, 0) + ow / 2 - (mid(r, 0) + rw / 2);
  const dy = mid(o, 1) + oh / 2 - (mid(r, 1) + rh / 2);
  const shift = (d, less, more) =>
    Math.abs(d) >= PX ? [`${Math.abs(Math.round(d))} px ${d < 0 ? less : more}`] : [];
  const shifted = [...shift(dx, "further left", "further right"), ...shift(dy, "higher", "lower")];
  if (shifted.length) out.push(`sits ${shifted.join(" and ")} than the reference`);
  const size = (a, b, more, less) =>
    Math.abs(a / b - 1) >= SIZE
      ? [`${Math.abs(Math.round((a / b - 1) * 100))}% ${a > b ? more : less}`]
      : [];
  const sized = [...size(ow, rw, "wider", "narrower"), ...size(oh, rh, "taller", "shorter")];
  if (sized.length) out.push(`is ${sized.join(" and ")} than the reference`);
  return out;
}

/** A boil or stepped animation: how often the box changes, ours against the reference's.
 * @param {{ changes_per_s?: number, median_gap_frames?: number | null }} ref
 * @param {{ median_gap_frames?: number | null }} ours */
export function stepFix(ref, ours, stepped = 15) {
  if (!(ref.changes_per_s && ref.changes_per_s < stepped && ref.median_gap_frames)) return [];
  if (ours.median_gap_frames && Math.abs(ours.median_gap_frames - ref.median_gap_frames) <= 1)
    return [];
  if (!ours.median_gap_frames)
    return [
      `holds still where the reference steps every ${ref.median_gap_frames} frames (a boil or stepped update): give it the boil`,
    ];
  return [
    `steps every ${ours.median_gap_frames} frames, the reference every ${ref.median_gap_frames} (a boil or stepped update)`,
  ];
}
