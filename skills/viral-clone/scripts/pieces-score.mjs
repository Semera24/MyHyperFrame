#!/usr/bin/env node
// Scores every motion window G0 recorded in one call: scores.json, a frame-by-frame strip per window and a fix list.
// Everything reads the solo render on green, since over the reference its own graphic shows through every fade and
// stands in for a missing piece.
import { execFile, execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { geminiAccess, look } from "./gemini.mjs";
import { isInk } from "./ink-scan.mjs";
import { ffprobeBin, frames, hfMedia, round } from "./media.mjs";
import { boxFix, movesFix, stepFix } from "./piece-fix.mjs";
import { pair } from "./piece-pair.mjs";
import { strip, zoomPair } from "./piece-strip.mjs";
import { covering, judge } from "./pieces-judge.mjs";

const USAGE =
  "usage: node pieces-score.mjs .viral-clone/pieces/pieces.json [--changed name,name]\n" +
  '  pieces.json: {"template": "<slug>", "ref", "solo",\n' +
  '                "pieces": [{"name" (a motion window), "kind": "opaque"|"overlay", "ink"?,\n' +
  '                            "solo"? (its own solo render, starting at the window\'s start),\n' +
  '                            "build": [{"item", "done": true|false, "note"?}] (G0\'s build items, in order),\n' +
  '                            "accepted"? {"stand_in", "why"} (from v1: what a build difference goes on with)}]}\n' +
  "  A missing piece, or one held still where the reference moves or boils, waits in every round until it is fixed\n" +
  '  or the person picks "Go on with it still" on a question starting with the prefix report.md gives it\n' +
  '  ("G0.5 <template>/<window> <id>:", lapsing when the window changes); a build difference\n' +
  "  waits until v1, then goes on only with accepted. Outside the app no answer is heard, so it shows here as waiting.\n" +
  "  Each window's time and box come from templates/<slug>/reference/motion-windows.json, never from pieces.json.\n" +
  "  Every call is a round: the last round's scores, solo renders and strips are kept in rounds/r<N>/.\n" +
  "  With a Vertex key or the run's HeyGen key, Gemini compares each window's box in both as soon as it is scored (gemini.mjs look).\n" +
  "  --changed: only these windows are scored and looked at again; the others keep last round's.\n" +
  "  Writes report.md: per window its problems, advice, Gemini's differences and a zoomed pair to open.";
export const SOLO_GREEN = [0, 255, 0];
// A frame shows the piece when at least this share of its box differs from the green.
const SHOWN = 0.01;
const FPS = 10;

const widthOf = (path) =>
  Number(
    execFileSync(ffprobeBin(), [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width",
      "-of",
      "csv=p=0",
      path,
    ])
      .toString()
      .trim(),
  );

/** Whether a solo-render pixel is the piece rather than the green. */
const notGreen = (f, o) =>
  Math.abs(f[o] - SOLO_GREEN[0]) +
    Math.abs(f[o + 1] - SOLO_GREEN[1]) +
    Math.abs(f[o + 2] - SOLO_GREEN[2]) >=
  90;

/** Per sampled frame, the box of everything in `roi` that is not the solo render's green, or null.
 * @param {string} path @param {number} start where the window starts in `path` @param {number} seconds
 * @param {number[]} roi */
export function soloBoxes(path, start, seconds, [x, y, w, h]) {
  return frames(path, start, seconds, [x, y, w, h], { fps: FPS }).map((f) => {
    let x0 = w,
      y0 = h,
      x1 = -1,
      y1 = -1,
      n = 0;
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        if (!notGreen(f, (py * w + px) * 3)) continue;
        n++;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
    return n / (w * h) < SHOWN ? null : [x + x0, y + y0, x1 - x0 + 1, y1 - y0 + 1];
  });
}

/** The median share of `roi` the solo render fills over the window: a card fills its box, a caption does not.
 * @param {string} path @param {number} start @param {number} seconds @param {number[]} roi */
export function coverShare(path, start, seconds, [x, y, w, h]) {
  const shares = frames(path, start, seconds, [x, y, w, h], { fps: FPS }).map((f) => {
    let n = 0;
    for (let o = 0; o + 2 < w * h * 3; o += 3) if (notGreen(f, o)) n++;
    return n / (w * h);
  });
  return shares.length ? round([...shares].sort((a, b) => a - b)[shares.length >> 1]) : 0;
}

/** The share of sampled frames that show the piece. @param {(number[] | null)[]} boxes */
export const presentShare = (boxes) =>
  round(boxes.filter(Boolean).length / Math.max(1, boxes.length));

/** Per sampled frame, the box of the reference's `ink` inside `roi`, in frame pixels, or null.
 * @param {string} path @param {number} start @param {number} seconds @param {number[]} roi @param {string} ink */
function inkBoxes(path, start, seconds, [x, y, w, h], ink) {
  const test = isInk(ink, 60);
  return frames(path, start, seconds, [x, y, w, h], { fps: FPS }).map((f) => {
    let x0 = w,
      y0 = h,
      x1 = -1,
      y1 = -1;
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        const o = (py * w + px) * 3;
        if (!test(f[o], f[o + 1], f[o + 2])) continue;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
    return x1 < 0 ? null : [x + x0, y + y0, x1 - x0 + 1, y1 - y0 + 1];
  });
}

/** @param {string[]} args */
const hfMediaJson = (args) => JSON.parse(hfMedia(args).toString());

const span = (window) => [
  "--start",
  String(window.start),
  "--end",
  String(window.start + window.seconds),
];

const flowOf = (ref, solo, window, draftRoi, soloStart) =>
  hfMediaJson([
    "evidence",
    "flow",
    ref,
    solo,
    "--roi",
    window.roi.join(","),
    ...span(window),
    "--candidate-roi",
    draftRoi.join(","),
    "--candidate-start",
    String(soloStart),
  ]);

/** @returns {{ fps: number, moves: any[] }} */
const trackOf = (path, roi, window) =>
  hfMediaJson(["evidence", "flow-track", path, "--roi", roi.join(","), ...span(window)]);

/** The middle of a box, `share` in from each edge: G0 draws a box with margin, and the host shows at its edges.
 * @param {number[]} roi */
export const inset = ([x, y, w, h], share = 0.15) => [
  Math.round(x + w * share),
  Math.round(y + h * share),
  Math.round(w * (1 - 2 * share)),
  Math.round(h * (1 - 2 * share)),
];

/** The edits that close this piece's gap to the reference, ours measured on the solo render. Moves are compared
 * only inside an opaque piece: over a host, flow reads the person behind an overlay rather than the overlay. */
function fixOf(window, piece, { ref, solo, scale, soloStart }, draftRoi, pp) {
  const refBoxes = inkBoxes(ref, window.start, window.seconds, window.roi, piece.ink ?? "light");
  const ours = soloBoxes(solo, soloStart, window.seconds, draftRoi).map(
    (b) => b && b.map((v) => v / scale),
  );
  const fix = [...boxFix(refBoxes, ours, FPS, window.roi), ...stepFix(pp.ref, pp.draft)];
  if (piece.kind !== "opaque") return fix;
  const [refTrack, soloTrack] = [
    trackOf(ref, inset(window.roi), window),
    trackOf(solo, inset(draftRoi), { ...window, start: soloStart }),
  ];
  const inRef = (/** @type {any} */ m) => ({ ...m, x: m.x / scale, y: m.y / scale });
  return [...fix, ...movesFix(refTrack.moves, soloTrack.moves.map(inRef), refTrack.fps)];
}

const mean = (/** @type {number[]} */ v) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);

// A dip to or from a flat field (black, white, a plain color): the box is flat at one end of its window, under FLAT
// grey levels of spread, and its brightness moves by at least DIMS levels over it. Flow reads that change as motion.
const FLAT = 6;
const DIMS = 30;

/** Whether the reference's box only dips to or from a flat field over the window, so its flow is no motion to
 * rebuild. @param {Uint8Array[]} fs grey frames */
export function onlyFades(fs) {
  if (fs.length < 2) return false;
  const avg = (/** @type {Uint8Array} */ f) => mean([...f]);
  const spread = (/** @type {Uint8Array} */ f) =>
    Math.sqrt(mean([...f].map((v) => v * v)) - avg(f) ** 2);
  const levels = fs.map(avg);
  const flatEnd = spread(fs[0]) < FLAT || spread(fs[fs.length - 1]) < FLAT;
  return flatEnd && Math.max(...levels) - Math.min(...levels) >= DIMS;
}

function scoreWindow(window, piece, ctx) {
  const { ref, dir } = ctx;
  const solo = piece.solo ? resolve(dir, piece.solo) : ctx.solo;
  const soloStart = piece.solo ? 0 : window.start;
  const scale = widthOf(solo) / ctx.refWidth;
  const draftRoi = window.roi.map((v) => Math.round(v * scale));
  const pp = pair(ref, solo, window.start, window.seconds, window.roi, draftRoi, soloStart);
  const cover = coverShare(solo, soloStart, window.seconds, inset(draftRoi));
  const opaque = covering({ kind: piece.kind, cover });
  const fl = opaque
    ? flowOf(ref, solo, { ...window, roi: inset(window.roi) }, inset(draftRoi), soloStart)
    : flowOf(ref, solo, window, draftRoi, soloStart);
  const refGrey = frames(ref, window.start, window.seconds, inset(window.roi), {
    fps: FPS,
    width: 64,
    gray: true,
  });
  const sheetPath = join(dir, "sheets", `${window.name.replace(/[^\w-]/g, "_")}.png`);
  const shown = strip(ref, solo, window.start, window.seconds, window.roi, sheetPath, soloStart);
  const mid = window.seconds / 2;
  const zoom = zoomPair(
    ref,
    solo,
    window.start + mid,
    window.roi,
    draftRoi,
    soloStart + mid,
    sheetPath.replace(/\.png$/, "-zoom.png"),
  );
  return {
    name: window.name,
    kind: piece.kind,
    start: window.start,
    seconds: window.seconds,
    roi: window.roi,
    ...(piece.solo ? { solo: piece.solo } : {}),
    present_share: presentShare(soloBoxes(solo, soloStart, window.seconds, draftRoi)),
    cover,
    ref_still: fl.ref_still,
    ref_fade: onlyFades(refGrey),
    ref_energy: round(mean(fl.ref_motion), 3),
    energy_ratio: fl.energy_ratio,
    motion_corr: fl.motion_corr,
    lag_frames: fl.lag_frames,
    ref_changes_per_s: pp.ref.changes_per_s,
    ref_gap: pp.ref.median_gap_frames,
    draft_gap: pp.draft.median_gap_frames,
    ...(opaque ? { ssim_mean: pp.ssim_mean } : {}),
    fix: fixOf(
      window,
      { ...piece, kind: opaque ? "opaque" : piece.kind },
      { ref, solo, scale, soloStart },
      draftRoi,
      pp,
    ),
    sheet: sheetPath,
    sheet_every: shown.every,
    zoom,
    build: Array.isArray(piece.build) ? piece.build : [],
    ...(piece.accepted && typeof piece.accepted === "object" ? { accepted: piece.accepted } : {}),
  };
}

/** Keeps the last round's scores, solo renders and strips in rounds/r<N>/ and returns this round's number.
 * @param {string} dir the pieces folder @param {any} spec */
function archiveLastRound(dir, spec) {
  const scoresPath = join(dir, "scores.json");
  if (!existsSync(scoresPath)) return 1;
  let last = { round: 1 };
  try {
    last = JSON.parse(readFileSync(scoresPath, "utf8"));
  } catch {}
  const round = Number.isFinite(last.round) ? last.round : 1;
  const into = join(dir, "rounds", `r${round}`);
  mkdirSync(join(into, "sheets"), { recursive: true });
  copyFileSync(scoresPath, join(into, "scores.json"));
  const solos = [spec.solo, ...(spec.pieces ?? []).map((p) => p?.solo)].filter(Boolean);
  for (const s of new Set(solos)) {
    const from = resolve(dir, s);
    if (existsSync(from)) copyFileSync(from, join(into, basename(from)));
  }
  for (const piece of last.pieces ?? [])
    if (piece?.sheet && existsSync(piece.sheet))
      copyFileSync(piece.sheet, join(into, "sheets", basename(piece.sheet)));
  return round + 1;
}

/** Gemini's look at one scored window, onto its score; a look that fails (after its own retry) leaves `look_error`.
 * @param {any} sa @param {any} piece @param {any} ctx */
async function addLook(sa, piece, ctx) {
  const solo = piece.solo ? resolve(ctx.dir, piece.solo) : ctx.solo;
  const scale = widthOf(solo) / ctx.refWidth;
  const window = {
    ref: ctx.ref,
    refStart: piece.start,
    ours: solo,
    oursStart: piece.solo ? 0 : piece.start,
    seconds: piece.seconds,
    refRoi: piece.roi,
    oursRoi: piece.roi.map((/** @type {number} */ v) => Math.round(v * scale)),
  };
  try {
    const { reference, ours, differences } = await look(
      sa,
      mkdtempSync(join(tmpdir(), "look-")),
      window,
    );
    piece.look = { reference, ours, differences };
    delete piece.look_error;
  } catch (e) {
    piece.look_error = String(/** @type {any} */ (e)?.message ?? e).slice(0, 200);
  }
}

const run = promisify(execFile);
// Windows scored at once, each in its own process and then looked at by Gemini: one at a time, Cindy's 20 windows
// took 194 s, most of it waiting on ffmpeg, hf-media and Gemini in turn.
const SCORES_AT_ONCE = Math.max(2, Math.min(6, Math.floor(availableParallelism() / 2)));

/** Runs `job` over `items`, `limit` at a time, in order of the results. @template T, R
 * @param {T[]} items @param {number} limit @param {(item: T) => Promise<R>} job @returns {Promise<R[]>} */
export async function pool(items, limit, job) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await job(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** report.md: one section per window, its problems first, then Gemini's minor differences and the fix list, with the
 * zoom and strip to open. @param {any[]} pieces @param {{problems: string[], advice: string[], accepted: string[]}}
 * verdict @param {number} round @param {string} dir paths are written relative to it */
export function report(pieces, verdict, round, dir = ".") {
  const of = (/** @type {string[]} */ list, /** @type {string} */ name) =>
    list.filter((l) => l.startsWith(`${name}: `)).map((l) => l.slice(name.length + 2));
  const lines = [`# G0.5 round ${round}${round >= 2 ? " (v1)" : " (v0)"}`, ""];
  for (const p of pieces) {
    const problems = of(verdict.problems, p.name);
    const accepted = of(verdict.accepted, p.name);
    lines.push(
      `## ${p.name}: ${problems.length ? `${problems.length} problem(s)` : accepted.length ? "goes on" : "ok"}`,
      `open: ${p.zoom ? relative(dir, p.zoom) : "-"} (zoom) · ${relative(dir, p.sheet)} (strip)`,
      ...problems.map((l) => `- problem: ${l}`),
      ...accepted.map((l) => `- goes on: ${l}`),
      ...of(verdict.advice, p.name).map((l) => `- advice: ${l}`),
      ...(p.look_error ? [`- gemini: ${p.look_error}`] : []),
      "",
    );
  }
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (/** @type {string} */ name) => {
    const i = argv.indexOf(name);
    return i < 0 ? null : (argv[i + 1] ?? "");
  };
  const [specPath] = argv;
  if (!specPath || specPath.startsWith("--")) {
    console.error(USAGE);
    process.exit(2);
  }
  const dir = dirname(resolve(specPath));
  const project = resolve(dir, "..", "..");
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const windowsPath = join(
    project,
    "templates",
    String(spec.template),
    "reference",
    "motion-windows.json",
  );
  const windows = JSON.parse(readFileSync(windowsPath, "utf8"));
  const [ref, solo] = ["ref", "solo"].map((k) => resolve(dir, spec[k]));
  const ctx = { ref, solo, refWidth: widthOf(ref), dir };
  const pieceOf = (/** @type {any} */ w) => (spec.pieces ?? []).find((p) => p?.name === w.name);
  const only = flag("--window");
  if (only !== null) {
    const window = windows.find((w) => w.name === only);
    process.stdout.write(JSON.stringify(scoreWindow(window, pieceOf(window), ctx)));
    return;
  }
  const changed = flag("--changed")?.split(",").filter(Boolean) ?? null;
  const last = existsSync(join(dir, "scores.json"))
    ? JSON.parse(readFileSync(join(dir, "scores.json"), "utf8"))
    : { pieces: [] };
  const round = archiveLastRound(dir, spec);
  mkdirSync(join(dir, "sheets"), { recursive: true });
  const todo = windows.filter((w) => pieceOf(w));
  const kept = (/** @type {any} */ w) =>
    changed && !changed.includes(w.name) ? last.pieces?.find((p) => p?.name === w.name) : null;
  const self = fileURLToPath(import.meta.url);
  const sa = geminiAccess();
  const fresh = [];
  const pieces = await pool(todo, SCORES_AT_ONCE, async (w) => {
    const keep = kept(w);
    if (keep) return keep;
    const { stdout } = await run(process.execPath, [self, specPath, "--window", w.name], {
      maxBuffer: 1 << 26,
    });
    const piece = JSON.parse(stdout);
    if (sa) await addLook(sa, piece, ctx);
    fresh.push(piece);
    return piece;
  });
  const scores = { template: spec.template, round, pieces };
  writeFileSync(join(dir, "scores.json"), `${JSON.stringify(scores, null, 1)}\n`);
  const verdict = judge(scores, windows);
  writeFileSync(join(dir, "report.md"), report(pieces, verdict, round, dir));
  console.log(
    JSON.stringify(
      {
        pass: verdict.pass,
        problems: verdict.problems.length,
        accepted: verdict.accepted.length,
        rescored: fresh.length,
        report: join(dir, "report.md"),
      },
      null,
      1,
    ),
  );
  process.exit(verdict.pass ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  await main();
