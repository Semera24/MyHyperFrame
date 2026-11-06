// The G2 rows agents ran by hand on every run, measured on the draft against the reference: lip-sync per talking run,
// loudness per section, holds and motion per segment, captions at word starts, each piece's box against the face, and
// the sound map's picture events and palette.
// Each row stands alone: a missing input or a failing tool leaves that row unmeasured with the fix, never the review.
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isInk } from "./ink-scan.mjs";
import { frames, hfMediaCall, meanAbsDiff, round } from "./media.mjs";
import { rhythm } from "./motion-rhythm.mjs";
import { pool } from "./pieces-score.mjs";
import { Fix, loadWords, probe } from "./tool.mjs";

/** @typedef {{what: string, ref: string, ours: string, pass: boolean | null, worst: number[], note: string,
 *   advisory?: boolean}} Row advisory: shown against its bar, never counted as a failure */
/** @typedef {(args: string[]) => Promise<any>} HfRunner `hf-media evidence <args>`, its JSON parsed */
/** @typedef {{name: string, start: number, end: number}} Section */

const run = promisify(execFile);
// checks.md's lip-sync bar: the picture at most 45 ms late or 125 ms early (positive lag is a late picture)
const LATE_MS = 45;
const EARLY_MS = 125;
const RUN_GAP_S = 0.35;
const RUN_MIN_S = 1.5;
// av-sync wants a window without cuts; a whole tight voiceover is one run that crosses every cutaway and head turn
const RUN_MAX_S = 5;
export const LU = 1;
// a hold a few frames longer than the reference's is not visible, however short the reference's is
const HOLD_SLACK_S = 0.1;
// motion-rhythm.mjs's level above which a frame change is a cut, not motion
const CUT = 25;
// caption ink is pixels near the caption color (white unless template.json says); a caption change flips at least
// INK_MIN_SHARE of the band and well over the band's usual flips, so a white card or sweater moving through is not one
const INK_TOL = 25;
const INK_MIN_SHARE = 0.0005;
const INK_OVER_MEDIAN = 3;
const CAPTION_FRAMES = 2;
const CAPTION_SAMPLES = 12;
// share of a face's box a piece must cover to count as covering it, not crossing it
const COVERS = 0.3;
// checks.md's sound bars: the share of picture events with a sound within 0.15 of the reference's, and as many
// distinct sounds within 30%. Advisory: the map counts hits rising 20 dB, so effects mixed 11–17 dB down can read as
// none, and a draft with quiet effects then measures like one without.
const SOUND_SHARE = 0.15;
const PALETTE = 0.3;
const SCRIPTS = dirname(fileURLToPath(import.meta.url));

/** @type {HfRunner} */
export const hfMedia = async (args) => {
  const { file, args: rest, shell } = hfMediaCall(["evidence", ...args]);
  const { stdout } = await run(file, rest, { maxBuffer: 1 << 28, shell });
  return JSON.parse(stdout);
};

const readJson = (/** @type {string} */ path) =>
  existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;

/** [x, y, w, h] from {x, y, w, h}, {left, top, width, height} or an array; null when not four numbers. */
const asBox = (/** @type {any} */ b) => {
  const v = Array.isArray(b)
    ? b
    : b && [b.x ?? b.left, b.y ?? b.top, b.w ?? b.width, b.h ?? b.height];
  return v?.length === 4 && v.every(Number.isFinite) ? v.map(Number) : null;
};

/** Integer pixels kept inside the frame. @param {number[]} b @param {{width: number, height: number}} size */
const inFrame = ([x, y, w, h], { width, height }) => {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  return [
    x0,
    y0,
    Math.max(2, Math.min(width, Math.round(x + w)) - x0),
    Math.max(2, Math.min(height, Math.round(y + h)) - y0),
  ];
};

/** Words merged into speech runs (gaps under RUN_GAP_S, at most RUN_MAX_S long), keeping runs of RUN_MIN_S or more.
 * @param {{start: number, end: number}[]} words */
function speechRuns(words) {
  const runs = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const last = runs.at(-1);
    if (last && w.start - last.end < RUN_GAP_S && w.end - last.start <= RUN_MAX_S)
      last.end = Math.max(last.end, w.end);
    else runs.push({ start: w.start, end: w.end });
  }
  return runs.filter((r) => r.end - r.start >= RUN_MIN_S);
}

/** The mouth: the lower third of the face box, a little wider. @param {number[]} face normalized x,y,w,h */
function mouthRoi([x, y, w, h], size) {
  const W = size.width;
  const H = size.height;
  return inFrame([(x - 0.1 * w) * W, (y + (2 * h) / 3) * H, 1.2 * w * W, (h / 3) * H], size);
}

/** Where a piece sits on the face: clear (no overlap), covers (over COVERS of the face box), crosses, or none (no
 * face). Both boxes in the same pixels. @param {number[] | null} face @param {number[]} piece */
function faceRelation(face, [px, py, pw, ph]) {
  if (!face) return "none";
  const [fx, fy, fw, fh] = face;
  const ix = Math.max(0, Math.min(px + pw, fx + fw) - Math.max(px, fx));
  const iy = Math.max(0, Math.min(py + ph, fy + fh) - Math.max(py, fy));
  const share = (ix * iy) / (fw * fh);
  return share === 0 ? "clear" : share > COVERS ? "covers" : "crosses";
}

/** The words file: the one given, .viral-clone/work/voice.words.json, else the newest under assets/voice/.
 * @param {string} root @param {string | undefined} given */
function wordsPath(root, given) {
  if (given) return given;
  const fixed = join(root, ".viral-clone", "work", "voice.words.json");
  if (existsSync(fixed)) return fixed;
  const dir = join(root, "assets", "voice");
  const found = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /\.(words|transcript)\.json$/.test(f))
        .map((f) => join(dir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  if (!found.length)
    throw new Fix(
      "no words for the draft's voice",
      "voice.transcribeAudio renders/v0.mp4 and pass --words",
    );
  return found[0];
}

/** The reference's sections: template.json's form, else Gemini's read, else the whole film; and the same sections on
 * the draft, stretched to its duration when the lengths differ. */
function sections(root, slug, refDur, draftDur) {
  const tpl = readJson(join(root, "templates", String(slug), "template.json"));
  const read = readJson(join(root, "templates", String(slug), "reference", "gemini-read.json"));
  const named = (/** @type {any} */ list) =>
    (Array.isArray(list) ? list : []).filter(
      (s) => Number.isFinite(s?.start) && Number.isFinite(s?.end) && s.end > s.start,
    );
  const form = named(tpl?.form);
  const gem = named(read?.sections);
  const ref = form.length
    ? form
    : gem.length
      ? gem
      : [{ name: "whole film", start: 0, end: refDur }];
  const from = form.length
    ? "template.json form"
    : gem.length
      ? "gemini-read.json sections"
      : "no sections";
  const k = draftDur / refDur;
  /** @type {Section[]} */
  const draft = ref.map((s) => ({
    name: s.name,
    start: round(s.start * k),
    end: round(Math.min(draftDur, s.end * k)),
  }));
  const stretched = Math.abs(k - 1) > 0.01 ? `, stretched ×${round(k, 2)} onto the draft` : "";
  return { ref, draft, from: from + stretched };
}

/** Lip-sync: av-sync over each speech run of the draft's voice, on a mouth box from the draft's own face. */
async function lipSync({ draft, size, words, faceAt, hf }) {
  const runs = speechRuns(words).map((r) => ({
    start: r.start,
    end: Math.min(size.duration, r.end),
  }));
  if (!runs.length) throw new Fix("no speech run of 1.5 s or more in the words", "pass --words");
  const faces = await faceAt;
  const windows = await pool(runs, 4, async (r) => {
    const face = faces.over(r.start, r.end);
    if (!face) return { ...r, error: "no face" };
    try {
      const j = await hf([
        "av-sync",
        draft,
        "--mouth-roi",
        mouthRoi(face, size).join(","),
        "--start",
        String(round(r.start, 2)),
        "--end",
        String(round(r.end, 2)),
      ]);
      return { ...r, lag: Number(j.best_lag_ms), confidence: j.confidence };
    } catch (e) {
      return { ...r, error: errorText(e) };
    }
  });
  // av-sync's low confidence is a lag its own curve does not single out (on a cutaway or a covered mouth): reported,
  // never the verdict
  const counted = windows.filter((w) => Number.isFinite(w.lag) && w.confidence !== "low");
  const bad = counted.filter((w) => w.lag > LATE_MS || w.lag < -EARLY_MS);
  const span = (/** @type {any} */ w) => `${round(w.start, 1)}–${round(w.end, 1)} s`;
  return [
    {
      what: `Lip-sync over ${runs.length} talking runs`,
      ref: `picture ≤${LATE_MS} ms late, ≤${EARLY_MS} ms early`,
      ours: `${counted.length - bad.length}/${counted.length} in range (low confidence not counted)`,
      pass: counted.length ? !bad.length : null,
      worst: bad.map((w) => round(w.start, 1)),
      note: windows
        .map((w) =>
          w.error
            ? `${span(w)} ${w.error}`
            : `${span(w)} ${w.lag > 0 ? "+" : ""}${Math.round(w.lag)} ms (${w.confidence})`,
        )
        .join("; "),
    },
  ];
}

/** Loudness of the whole film and of each section, both films in one hf-media call each. */
async function loudness({ ref, draft, refSize, size, cut, hf }) {
  const call = (
    /** @type {string} */ file,
    /** @type {Section[]} */ list,
    /** @type {number} */ dur,
  ) =>
    hf([
      "loudness",
      file,
      "--windows",
      JSON.stringify([...list.map((s) => [s.start, s.end]), [0, round(dur)]]),
    ]).then((j) => j.windows.map((/** @type {any} */ w) => Number(w.integrated_lufs)));
  const [r, d] = await Promise.all([
    call(ref, cut.ref, refSize.duration),
    call(draft, cut.draft, size.duration),
  ]);
  const diff = (/** @type {number} */ i) => round(d[i] - r[i], 1);
  const whole = cut.ref.length;
  const bad = cut.ref.map((_, i) => i).filter((i) => !(Math.abs(diff(i)) <= LU));
  const lufs = cut.ref.map((_, i) => r[i]);
  return [
    {
      what: "Loudness, whole film",
      ref: `${r[whole]} LUFS`,
      ours: `${d[whole]} LUFS (${diff(whole) > 0 ? "+" : ""}${diff(whole)} LU)`,
      pass: Math.abs(diff(whole)) <= LU,
      worst: [],
      note: "",
    },
    {
      what: `Loudness per section (${cut.from})`,
      ref: `${Math.min(...lufs)} to ${Math.max(...lufs)} LUFS over ${lufs.length}`,
      ours: `${lufs.length - bad.length}/${lufs.length} within ${LU} LU`,
      pass: !bad.length,
      worst: bad.map((i) => cut.draft[i].start),
      note: bad
        .map((i) => `${cut.draft[i].name} ${diff(i) > 0 ? "+" : ""}${diff(i)} LU`)
        .join("; "),
    },
  ];
}

/** Where the longest still run starts, by motion-rhythm.mjs's rule: a frame moves when it or a neighbour changes. */
function longestHoldAt(path, start, seconds, size, still) {
  const fs = frames(path, start, seconds, [0, 0, size.width, size.height], {
    fps: 0,
    width: 160,
    gray: true,
  });
  const d = fs.slice(1).map((f, i) => meanAbsDiff(f, fs[i]));
  const moving = d.map((_, i) => [d[i - 1], d[i], d[i + 1]].some((v) => v > still && v <= CUT));
  let best = { frames: 0, at: 0 };
  for (let i = 0, n = 0; i <= d.length; i++) {
    if (i < d.length && !moving[i] && d[i] <= CUT) n++;
    else {
      if (n > best.frames) best = { frames: n, at: i - n };
      n = 0;
    }
  }
  return round(start + (best.at + 1) / size.fps, 1);
}

/** Moving share and longest hold per segment, the draft measured at the reference's still level. */
function holds({ ref, draft, size, cut }) {
  return cut.ref.map((s, i) => {
    const ds = cut.draft[i];
    const r = rhythm(ref, s.start, s.end - s.start);
    const d = rhythm(draft, ds.start, ds.end - ds.start, null, r.still_threshold);
    const share = r.moving_share ? d.moving_share / r.moving_share : d.moving_share ? Infinity : 1;
    const holdOk =
      d.longest_hold_s <= Math.max(1.3 * r.longest_hold_s, r.longest_hold_s + HOLD_SLACK_S);
    const shareOk = share >= 0.8 && share <= 1.25;
    return {
      what: `Holds and motion: ${s.name} (ours ${ds.start}–${ds.end} s)`,
      ref: `moving ${r.moving_share}, longest hold ${r.longest_hold_s} s`,
      ours: `moving ${d.moving_share} (×${round(share, 2)}), longest hold ${d.longest_hold_s} s`,
      pass: holdOk && shareOk,
      worst: holdOk
        ? shareOk
          ? []
          : [ds.start]
        : [longestHoldAt(draft, ds.start, ds.end - ds.start, size, r.still_threshold)],
      note: holdOk ? "" : `hold over 1.3× the reference's`,
    };
  });
}

/** The caption band: the one given, around template.json's caption y, else the lower middle of the frame. */
function captionBand(given, tpl, size) {
  if (given) return inFrame(given, size);
  const y = Number(tpl?.captions?.y);
  const scale = size.height / (tpl?.canvas?.height || size.height);
  if (Number.isFinite(y))
    return inFrame([0, y * scale - 0.08 * size.height, size.width, 0.16 * size.height], size);
  return inFrame([0, 0.55 * size.height, size.width, 0.3 * size.height], size);
}

/** The caption's ink test: template.json's caption color, else white. */
function captionInk(tpl) {
  const hex = /^#?([0-9a-f]{6})$/i.exec(String(tpl?.captions?.color ?? ""))?.[1] ?? "ffffff";
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
  return isInk(rgb, INK_TOL);
}

/** The frame, relative to the word's, of the caption change nearest it (null when none stands out), and whether the
 * band is busy: its usual frame already flips as much ink as a caption, so a miss there is not measured.
 * @param {Uint8Array[]} fs RGB frames, `before` ahead of the word's */
function inkChange(fs, before, ink) {
  const masks = fs.map((f) => {
    const m = new Uint8Array(f.length / 3);
    for (let p = 0; p < m.length; p++) m[p] = ink(f[3 * p], f[3 * p + 1], f[3 * p + 2]) ? 1 : 0;
    return m;
  });
  const flips = masks.slice(1).map((m, i) => {
    let n = 0;
    for (let p = 0; p < m.length; p++) n += m[p] ^ masks[i][p];
    return n;
  });
  const usual = [...flips].sort((a, b) => a - b)[flips.length >> 1];
  const least = Math.max(1, INK_MIN_SHARE * masks[0].length);
  const floor = Math.max(least, INK_OVER_MEDIAN * usual);
  const at = flips.flatMap((n, i) => (n >= floor ? [i + 1 - before] : []));
  return {
    at: at.length ? at.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a)) : null,
    busy: usual >= least,
  };
}

/** The seconds `vc assemble` made the captions change (word or phrase starts), as words to check, or null.
 * @param {string} root */
function captionCues(root) {
  const cues = readJson(join(root, ".viral-clone", "work", "assembled.json"))?.captions?.cues;
  return Array.isArray(cues) && cues.length
    ? cues.map((t) => ({ text: `@${t}`, start: Number(t), end: Number(t) }))
    : null;
}

/** Captions at word starts: at a spread of the draft's word starts, the band's ink changes within two frames. */
function captions({ draft, size, words, band, ink }) {
  const before = CAPTION_FRAMES + 3;
  const fit = words.filter(
    (w) => w.start * size.fps >= before + 1 && (size.duration - w.start) * size.fps >= before + 1,
  );
  if (!fit.length) throw new Fix("no word start inside the draft", "pass --words for this render");
  const n = Math.min(CAPTION_SAMPLES, fit.length);
  const picked = Array.from(
    { length: n },
    (_, i) => fit[n === 1 ? 0 : Math.round((i * (fit.length - 1)) / (n - 1))],
  );
  const checked = picked.map((w) => {
    const k = Math.round(w.start * size.fps);
    // a quarter frame ahead of a frame's time: half a frame duplicates the first frame on some renders
    const fs = frames(draft, (k - before - 0.25) / size.fps, (2 * before) / size.fps, band, {
      fps: 0,
    });
    const { at, busy } = inkChange(fs, before, ink);
    const ok = at !== null && Math.abs(at) <= CAPTION_FRAMES;
    return { ...w, at, ok, busy: busy && !ok };
  });
  const seen = checked.filter((c) => !c.busy);
  const bad = seen.filter((c) => !c.ok);
  const busy = checked.length - seen.length;
  const off = (/** @type {any} */ c) =>
    `"${c.text}" ${c.at === null ? "no change" : `${c.at > 0 ? "+" : ""}${c.at} f`}`;
  return [
    {
      what: `Captions at word starts (band ${band.join(",")})`,
      ref: `ink changes within ±${CAPTION_FRAMES} frames, nothing early`,
      ours: `${seen.length - bad.length}/${seen.length} word starts`,
      pass: seen.length ? (seen.length - bad.length) / seen.length >= 0.8 : null,
      worst: bad.map((c) => round(c.start, 2)),
      note: [
        ...bad.map(off),
        ...(busy ? [`${busy} not measured: other ink moves through the band`] : []),
      ].join("; "),
    },
  ];
}

/** Each vocabulary type with a face relation, at every time the assembled draft shows it, against the draft's face. */
async function facePlacement({ root, tpl, size, faceAt }) {
  if (!tpl) throw new Fix("no template.json", "node vc.mjs template draft");
  const typed = (tpl.vocabulary ?? []).filter((/** @type {any} */ t) => t?.face?.relation && t.box);
  if (!typed.length)
    throw new Fix("no vocabulary type has a box and a face relation", "node vc.mjs template check");
  const done = readJson(join(root, ".viral-clone", "work", "assembled.json"));
  const overlays = done?.overlays ?? done?.pieces;
  if (!Array.isArray(overlays))
    throw new Fix("no .viral-clone/work/assembled.json", "node vc.mjs assemble timeline.json");
  const faces = await faceAt;
  const canvas = done.canvas?.width ? done.canvas : size;
  const refCanvas = tpl.canvas?.width ? tpl.canvas : size;
  const scaled = (/** @type {number[]} */ b, /** @type {any} */ c) => {
    const [sx, sy] = [size.width / c.width, size.height / c.height];
    return [b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy];
  };
  const rows = typed.flatMap((/** @type {any} */ t) => {
    const shown = overlays.filter((/** @type {any} */ o) => (o.type ?? o.name) === t.name);
    if (!shown.length) return [];
    const checked = shown.map((/** @type {any} */ o) => {
      const end = Number(o.end ?? Number(o.start) + Number(o.duration));
      const at = round((Number(o.start) + end) / 2, 2);
      const box = asBox(o.box) ? scaled(asBox(o.box), canvas) : scaled(asBox(t.box), refCanvas);
      const face = faces.at(at);
      const got = faceRelation(face && pixels(face, size), box);
      return { at, got, ok: got === t.face.relation };
    });
    const bad = checked.filter((c) => !c.ok);
    return [
      {
        what: `Face relation: ${t.name}`,
        ref: t.face.relation,
        ours: `${checked.length - bad.length}/${checked.length} ${t.face.relation}`,
        pass: !bad.length,
        worst: bad.map((c) => c.at),
        note: bad.map((c) => `${c.at} s ${c.got}`).join("; "),
      },
    ];
  });
  if (!rows.length)
    throw new Fix(
      "assembled.json shows no piece of a type with a face relation",
      "give each overlay its template.json type name",
    );
  return rows;
}

/** A normalized box in the video's pixels. @param {number[]} b */
const pixels = ([x, y, w, h], size) => [
  x * size.width,
  y * size.height,
  w * size.width,
  h * size.height,
];

/** One face-size call over the whole draft, read as the face at a second or over a span (median of its samples). */
async function faceTrack(draft, size, hf) {
  const samples = Math.min(60, Math.max(8, Math.ceil(size.duration)));
  const j = await hf(["face-size", draft, "--samples", String(samples)]);
  const seen = (j.face_boxes ?? [])
    .map((/** @type {any} */ f) => ({ t: Number(f.frame) / size.fps, box: asBox(f.box) }))
    .filter((/** @type {any} */ f) => f.box);
  const at = (/** @type {number} */ t) => {
    const near = seen.reduce(
      (best, f) => (!best || Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best),
      null,
    );
    return near && Math.abs(near.t - t) <= 1 ? near.box : null;
  };
  const over = (/** @type {number} */ a, /** @type {number} */ b) => {
    const inside = seen.filter((f) => f.t >= a && f.t <= b).map((f) => f.box);
    if (!inside.length) return at((a + b) / 2);
    const mid = (/** @type {number} */ k) =>
      inside.map((v) => v[k]).sort((x, y) => x - y)[inside.length >> 1];
    return [0, 1, 2, 3].map(mid);
  };
  return { at, over };
}

/** What a failed step said: its error line, not the stack frames and the "Node.js vN" line a crash ends with. */
export const errorText = (/** @type {any} */ e) => {
  const lines = String(e?.stderr || e?.message || e)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(at |\^+$|Node\.js v\d)/.test(l));
  const named = lines.findIndex((l) => /^(\w*Error\b|error:)/i.test(l));
  return lines
    .slice(named < 0 ? -2 : named, named < 0 ? undefined : named + 2)
    .join(" ")
    .slice(0, 240);
};

/** sound-map.mjs's arguments for a film: the voice-free stem separate.mjs printed, the film's temporal scan in
 * scanDir, the words when given; the map lands in out/sound. @param {string} video @param {string} separated
 * @param {string} scanDir @param {string} out @param {string} [words] */
export function soundMapArgs(video, separated, scanDir, out, words) {
  return [
    "--video",
    video,
    "--stem",
    JSON.parse(separated).no_vocals,
    "--scan",
    join(scanDir, "manifest.json"),
    ...(words ? ["--words", words] : []),
    "--out",
    join(out, "sound"),
  ];
}

/** A sound map's distinct sounds: each group of alike hits that is not the music's regular one, and each lone hit on
 * a picture event. @param {any} map */
const paletteOf = (map) =>
  (map.groups ?? []).filter((/** @type {any} */ g) => !g.periodic).length +
  (map.rows ?? []).filter((/** @type {any} */ r) => r.on_picture_event && !r.group).length;

/** The sound rows from the reference's and the draft's sound maps. @param {any} ref @param {any} draft
 * @returns {Row[]} */
export function soundRows(ref, draft) {
  // maps written before the share was named say events_with_sound
  const share = (/** @type {any} */ m) =>
    m.summary.share_of_events_with_sound ?? m.summary.events_with_sound;
  const sounded = (/** @type {any} */ m) =>
    m.summary.events
      ? `${Math.round(share(m) * m.summary.events)} of ${m.summary.events} picture events`
      : "no picture events";
  const refHits = (ref.rows ?? [])
    .filter((/** @type {any} */ r) => r.on_picture_event && !r.periodic)
    .map((/** @type {any} */ r) => r.t);
  const [p, q] = [paletteOf(ref), paletteOf(draft)];
  return [
    {
      what: "Sound on picture events",
      ref: sounded(ref),
      ours: sounded(draft),
      pass:
        share(ref) === undefined || share(draft) === undefined
          ? null
          : Math.abs(share(draft) - share(ref)) <= SOUND_SHARE,
      worst: [],
      advisory: true,
      note: refHits.length
        ? `reference hits on picture events at ${refHits.join(", ")} s`
        : "the reference leaves its picture events silent",
    },
    {
      what: "Sound palette",
      ref: `${p} distinct sounds`,
      ours: `${q} distinct sounds`,
      pass: Math.abs(q - p) <= PALETTE * p,
      worst: [],
      advisory: true,
      note: "groups of alike hits plus lone hits on picture events; a regular group is the music",
    },
  ];
}

/** The draft's sound map (its own stems, scan and map in .viral-clone/work/draft-sound) beside the reference's.
 * @param {{root: string, slug: string | null, draft: string, hf: HfRunner}} o */
async function soundEvents({ root, slug, draft, hf }) {
  const refMap = readJson(
    join(root, "templates", String(slug), "reference", "sound", "sound-map.json"),
  );
  if (!refMap)
    throw new Fix(
      `no templates/${slug}/reference/sound/sound-map.json`,
      "node vc.mjs watch makes it; or sound-map.mjs on the reference (watch.md, Sound); no audio track, no sound to compare",
    );
  const work = join(root, ".viral-clone", "work", "draft-sound");
  // temporal-scan writes only into a new or empty folder, and a review runs again after each patch
  rmSync(join(work, "scan"), { recursive: true, force: true });
  const [stems] = await Promise.all([
    run(process.execPath, [join(SCRIPTS, "separate.mjs"), draft, join(work, "sep")], {
      maxBuffer: 1 << 24,
    }),
    hf(["temporal-scan", draft, "--out", join(work, "scan")]),
  ]);
  await run(process.execPath, [
    join(SCRIPTS, "sound-map.mjs"),
    ...soundMapArgs(draft, stems.stdout, join(work, "scan"), work),
  ]);
  return soundRows(refMap, readJson(join(work, "sound", "sound-map.json")));
}

/** A row builder's rows, or one unmeasured row saying why. @param {string} what @param {() => any} build */
async function measured(what, build) {
  try {
    return await build();
  } catch (e) {
    const note = e instanceof Fix ? e.message.replace("\nfix: ", "; fix: ") : errorText(e);
    return [{ what, ref: "", ours: "", pass: null, worst: [], note }];
  }
}

const cell = (/** @type {string} */ s) => String(s).replaceAll("|", "/");

/** The rows as review.md's table, then the worst seconds of each failing row. @param {Row[]} rows */
function rowsMd(rows) {
  const verdict = (/** @type {Row} */ r) =>
    r.pass === null
      ? "not measured"
      : r.advisory
        ? `advisory: ${r.pass ? "inside" : "outside"} the bar`
        : r.pass
          ? "pass"
          : "**FAIL**";
  const failing = rows.filter((r) => r.pass === false && !r.advisory);
  return [
    "## G2 rows (draft against reference)",
    "",
    "| What | Reference | Ours | Pass | Note |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${[r.what, r.ref, r.ours, verdict(r), r.note].map(cell).join(" | ")} |`),
    "",
    ...(failing.length
      ? [
          "Worst seconds:",
          "",
          ...failing.map((r) => `- ${r.what}: ${r.worst.join(", ") || "whole span"}`),
          "",
        ]
      : []),
  ].join("\n");
}

/** Measures the draft against the reference on G2's hand-run rows. `root` is the project folder holding templates/,
 * assets/ and .viral-clone/; `words` overrides the voice's words file, `captionRoi` the caption band in draft pixels.
 * @param {{ref: string, draft: string, slug: string | null, root?: string, words?: string, captionRoi?: number[],
 *   hf?: HfRunner}} opts @returns {Promise<{rows: Row[], md: string}>} */
export async function g2Rows({ ref, draft, slug, root = ".", words, captionRoi, hf = hfMedia }) {
  const size = probe(draft);
  const refSize = probe(ref);
  const tpl = readJson(join(root, "templates", String(slug), "template.json"));
  const cut = sections(root, slug, refSize.duration, size.duration);
  const faceAt = faceTrack(draft, size, hf);
  faceAt.catch(() => {});
  const spoken = () => loadWords(wordsPath(root, words));
  const groups = await Promise.all([
    measured("Lip-sync", () => lipSync({ draft, size, words: spoken(), faceAt, hf })),
    measured("Loudness", () => loudness({ ref, draft, refSize, size, cut, hf })),
    measured("Face relation", () => facePlacement({ root, tpl, size, faceAt })),
    measured("Holds and motion", () => holds({ ref, draft, size, cut })),
    measured("Captions at word starts", () =>
      captions({
        draft,
        size,
        words: captionCues(root) ?? spoken(),
        band: captionBand(captionRoi, tpl, size),
        ink: captionInk(tpl),
      }),
    ),
    measured("Sound", () => soundEvents({ root, slug, draft, hf })),
  ]);
  const rows = groups.flat();
  return { rows, md: rowsMd(rows) };
}
