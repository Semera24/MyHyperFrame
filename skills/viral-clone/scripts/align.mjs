// How far apart two recordings of the same speech sit, and how to land one on the other: B's lag behind A from
// their loudness envelopes, or, given both transcripts, a few constant-speed pieces that carry B's clock onto A's,
// printed as retime.mjs's --map with each piece's rate and how well its words land.
import { basename, extname } from "node:path";
import { round, samples } from "./media.mjs";
import { Fix, loadWords, numbers, parseTool, probe } from "./tool.mjs";

const USAGE = `usage: vc align A B [--words a.json b.json] [--start-a s] [--end-a s] [--start-b s] [--end-b s]
  Without --words: B's lag behind A from their audio envelopes (10 ms hop, log RMS, z-scored), within the given
  windows: {lag_s (positive: B is later), peak, a_s, b_s, map, retime}.
  With --words (the same script spoken twice, A the reference, B the take): words matched in order, then a few
  constant-speed pieces carrying B's clock onto A's: {map, retime, pieces: [{take, ref, rate, words, unmatched
  (-only in A, +only in B), residual_ms, warn}]}. Speech pieces should keep rate 0.85-1.15.
  map is retime.mjs's --map ("take_in:take_out=ref_in:ref_out,..."), retime the command that plays B on A's clock.`;
const EXAMPLE =
  "node scripts/vc.mjs align reference/voice.wav takes/t01.mp4 --words reference/voice.json takes/t01.json";

const RATE = 8000;
const HOP = 80;
// A piece ends where a word would land more than this far off its line: about a frame and a half at 30 fps.
const TOLERANCE_S = 0.05;
const SAME_RATE = 0.03;
const PIECES_PER_30S = 8;
const SPEECH = [0.85, 1.15];

const stem = (/** @type {string} */ p) => basename(p, extname(p));
/** @param {string} take @param {string} map */
const retimeCommand = (take, map) =>
  `node scripts/retime.mjs "${take}" "${stem(take)}-retimed.mp4" --map "${map}"`;

/** Log RMS per 10 ms of mono samples at RATE. @param {Float32Array} x */
export function envelope(x) {
  const out = new Float64Array(Math.floor(x.length / HOP));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let j = i * HOP; j < (i + 1) * HOP; j++) s += x[j] * x[j];
    out[i] = Math.log(Math.sqrt(s / HOP) + 1e-4);
  }
  return out;
}

/** @param {Float64Array} e */
function zscore(e) {
  const mean = e.reduce((s, v) => s + v, 0) / e.length;
  const sd = Math.sqrt(e.reduce((s, v) => s + (v - mean) ** 2, 0) / e.length) || 1;
  return e.map((v) => (v - mean) / sd);
}

/** The shift k (in hops) with b[i + k] most like a[i], and the two envelopes' cosine over their overlap there: 1 when
 * they match. @param {Float64Array} a @param {Float64Array} b */
export function bestShift(a, b) {
  /** @param {number} k */
  const overlap = (k) => [Math.max(0, -k), Math.min(a.length, b.length - k)];
  let [best, at] = [-Infinity, 0];
  // ponytail: every shift is tried, O(len A x len B): about a second for two 5-minute files; an FFT if longer.
  for (let k = 1 - a.length; k < b.length; k++) {
    let s = 0;
    for (let i = overlap(k)[0]; i < overlap(k)[1]; i++) s += a[i] * b[i + k];
    if (s > best) [best, at] = [s, k];
  }
  let [aa, bb] = [0, 0];
  for (let i = overlap(at)[0]; i < overlap(at)[1]; i++)
    [aa, bb] = [aa + a[i] ** 2, bb + b[i + at] ** 2];
  return { k: at, peak: best / Math.sqrt(aa * bb || 1) };
}

/** B's lag behind A in seconds, each optionally windowed. @param {string} a @param {string} b
 * @param {{startA?: number, endA?: number, startB?: number, endB?: number}} [w] */
export function alignAudio(a, b, { startA = 0, endA, startB = 0, endB } = {}) {
  for (const p of [a, b])
    if (!probe(p).audio)
      throw new Fix(`${p} has no sound`, "pass the audio or a video with its sound");
  const window = (
    /** @type {string} */ p,
    /** @type {number} */ s,
    /** @type {number | undefined} */ e,
  ) => {
    const env = envelope(samples(p, RATE));
    const part = env.subarray(
      Math.round(s * 100),
      e === undefined ? env.length : Math.round(e * 100),
    );
    if (part.length < 10)
      throw new Fix(`the window on ${p} holds under 0.1 s of sound`, "widen --start/--end");
    return { env, z: zscore(part) };
  };
  const [A, B] = [window(a, startA, endA), window(b, startB, endB)];
  const { k, peak } = bestShift(A.z, B.z);
  const lag = startB - startA + k / 100;
  const [aS, bS] = [A.env.length / 100, B.env.length / 100];
  const [aIn, aOut] = [Math.max(0, -lag), Math.min(aS, bS - lag)];
  const map = `${round(aIn + lag)}:${round(aOut + lag)}=${round(aIn)}:${round(aOut)}`;
  return {
    lag_s: round(lag, 2),
    peak: round(peak),
    a_s: aS,
    b_s: bS,
    map,
    retime: retimeCommand(b, map),
  };
}

const key = (/** @type {string} */ t) =>
  t
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "");

/** Index pairs [i, j] of the longest common run of words in order, skipping inserted and dropped ones.
 * @param {string[]} a @param {string[]} b */
export function matchWords(a, b) {
  const L = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  /** @type {[number, number][]} */
  const out = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; )
    if (a[i] === b[j]) out.push([i++, j++]);
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  return out;
}

/** @typedef {{b: number, a: number}} Point B's time and A's time of one matched word edge */

/** A's time on the line through two points, at B's time `t`. @param {Point} p @param {Point} q @param {number} t */
const onLine = (p, q, t) => p.a + ((t - p.b) * (q.a - p.a)) / (q.b - p.b);

/** Indices where the map bends: split at the point furthest off the chord while it is over `tol` (Douglas-Peucker).
 * @param {Point[]} pts @param {number} i @param {number} j @param {number} tol @returns {number[]} */
function bends(pts, i, j, tol) {
  let [worst, at] = [0, -1];
  for (let m = i + 1; m < j; m++) {
    const off = Math.abs(pts[m].a - onLine(pts[i], pts[j], pts[m].b));
    if (off > worst) [worst, at] = [off, m];
  }
  return worst > tol ? [...bends(pts, i, at, tol), at, ...bends(pts, at, j, tol)] : [];
}

/** Piece ends: the bends, then neighbours whose rates are within SAME_RATE merged. @param {Point[]} pts
 * @param {number} tol */
function pieceEnds(pts, tol) {
  const ends = [0, ...bends(pts, 0, pts.length - 1, tol), pts.length - 1];
  const rate = (/** @type {number} */ i, /** @type {number} */ j) =>
    (pts[j].b - pts[i].b) / (pts[j].a - pts[i].a);
  for (let k = 1; k < ends.length - 1; )
    if (Math.abs(rate(ends[k], ends[k + 1]) / rate(ends[k - 1], ends[k]) - 1) <= SAME_RATE)
      ends.splice(k, 1);
    else k++;
  return ends;
}

/** The pieces carrying B's words onto A's. @param {{text: string, start: number, end: number}[]} aw A's words
 * @param {{text: string, start: number, end: number}[]} bw B's words */
export function alignWords(aw, bw) {
  const [ak, bk] = [aw.map((w) => key(w.text)), bw.map((w) => key(w.text))];
  const matched = matchWords(ak, bk).filter(([i]) => ak[i]);
  /** @type {Point[]} */
  const pts = [];
  for (const [i, j] of matched)
    for (const edge of /** @type {const} */ (["start", "end"])) {
      const p = { b: bw[j][edge], a: aw[i][edge] };
      const last = pts.at(-1);
      // a map that runs backwards, or a piece under 10 ms, is no speed retime.mjs can play
      if (!last || (p.b > last.b + 0.01 && p.a > last.a + 0.01)) pts.push(p);
    }
  if (pts.length < 2)
    throw new Fix(
      `only ${matched.length} words match between the two transcripts`,
      "check both speak the same script",
    );
  const cap = Math.max(1, Math.ceil((PIECES_PER_30S * (pts.at(-1).a - pts[0].a)) / 30));
  let [tol, ends] = [TOLERANCE_S, pieceEnds(pts, TOLERANCE_S)];
  while (ends.length - 1 > cap) ends = pieceEnds(pts, (tol *= 1.5));
  const usedA = new Set(matched.map(([i]) => i));
  const usedB = new Set(matched.map(([, j]) => j));
  const pieces = ends.slice(1).map((e, n) => {
    const [p, q] = [pts[ends[n]], pts[e]];
    const last = n === ends.length - 2;
    const within = (
      /** @type {number} */ t,
      /** @type {number} */ from,
      /** @type {number} */ to,
    ) => (n === 0 || t >= from) && (last || t < to);
    const offs = pts
      .slice(ends[n], e + 1)
      .map((m) => Math.abs(m.a - onLine(p, q, m.b)))
      .sort((x, y) => x - y);
    const rate = round((q.b - p.b) / (q.a - p.a));
    return {
      take: [round(p.b), round(q.b)],
      ref: [round(p.a), round(q.a)],
      rate,
      words: matched.filter(([, j]) => within(bw[j].start, p.b, q.b)).length,
      unmatched: [
        ...aw.flatMap((w, i) => (!usedA.has(i) && within(w.start, p.a, q.a) ? [`-${w.text}`] : [])),
        ...bw.flatMap((w, j) => (!usedB.has(j) && within(w.start, p.b, q.b) ? [`+${w.text}`] : [])),
      ],
      residual_ms: Math.round(offs[offs.length >> 1] * 1000),
      ...(rate < SPEECH[0] || rate > SPEECH[1]
        ? { warn: `rate ${rate} is outside 0.85-1.15 for speech` }
        : {}),
    };
  });
  return {
    map: pieces.map((p) => `${p.take.join(":")}=${p.ref.join(":")}`).join(","),
    pieces,
    matched: matched.length,
  };
}

/** @param {string[]} args */
export async function main(args) {
  const parsed = parseTool(args, {
    usage: USAGE,
    example: EXAMPLE,
    options: Object.fromEntries(
      ["words", "start-a", "end-a", "start-b", "end-b"].map((k) => [k, { type: "string" }]),
    ),
  });
  if (!parsed) return;
  const { values: v, positionals } = parsed;
  const [a, b, bWords] = positionals;
  if (!a || !b) throw new Fix("align needs A and B", `run it as: ${EXAMPLE}`);
  if (v.words) {
    if (!bWords)
      throw new Fix("--words takes two files, A's words then B's", `run it as: ${EXAMPLE}`);
    const out = alignWords(loadWords(String(v.words)), loadWords(bWords));
    console.log(JSON.stringify({ ...out, retime: retimeCommand(b, out.map) }));
    return;
  }
  const at = (/** @type {string} */ k) =>
    v[k] === undefined ? undefined : numbers(String(v[k]), `--${k}`)[0];
  console.log(
    JSON.stringify(
      alignAudio(a, b, {
        startA: at("start-a"),
        endA: at("end-a"),
        startB: at("start-b"),
        endB: at("end-b"),
      }),
    ),
  );
}
