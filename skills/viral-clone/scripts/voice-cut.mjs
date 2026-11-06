// A voice track made ready for the edit: `tighten` shortens every pause the words and the waveform both call silent,
// so the read runs as tight as the reference's, and `split` cuts it at sentence ends into takes short enough for one
// Video 1 generation each. Both carry the words along, re-timed to what they wrote.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { ffmpegBin, round } from "./media.mjs";
import { Fix, loadWords, numbers, outDir, parseTool, probe } from "./tool.mjs";

const USAGE = `usage: vc voice tighten IN.wav WORDS.json [--keep 0.09] [--min-gap 0.2] [--out OUT.wav]
       vc voice split IN.wav WORDS.json [--max 11.5] [--out DIR]
  tighten: every pause longer than --min-gap that both the words and the waveform (-35 dB) call silent becomes --keep
  seconds, joined with 6 ms fades; never inside a word. Writes OUT.wav (default IN-tight.wav) and OUT.words.json.
  Prints {out, words, before_s, after_s, cuts, removed_s}.
  split: takes of whole sentences, each at most --max seconds (Video 1 speaks up to ~11.5 s a take); a longer
  sentence is cut at its longest pause. Cuts fall mid-pause. Writes DIR/seg-01.wav... and DIR/segments.json with
  each take's words on its own clock. Prints {dir, segments: [{file, start, end, seconds, text}]}.`;
const EXAMPLE =
  "node scripts/vc.mjs voice tighten assets/voice/vo.wav assets/voice/vo.json --keep 0.09";

const SILENCE = "silencedetect=noise=-35dB:d=0.12";
const JOIN_FADE = 0.006;
const EDGE_FADE = 0.01;
// Silence a take keeps before its first word and after its last, at most: a breath, not the whole pause.
const BREATH = 0.25;
const SENTENCE_END = /[.?!。？！…]["'”’)\]]*$/;
const COMMA = /[,;:，；、]["'”’)\]]*$/;

/** @typedef {{text: string, start: number, end: number}} Word */

/** [start, end] of each stretch ffmpeg hears as silent. @param {string} path @param {number} duration */
export function silences(path, duration) {
  const { stderr } = spawnSync(
    ffmpegBin(),
    ["-nostdin", "-hide_banner", "-nostats", "-i", path, "-af", SILENCE, "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  /** @type {number[][]} */
  const out = [];
  for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g))
    if (m[1] === "start") out.push([Math.max(0, Number(m[2])), duration]);
    else if (out.length) out[out.length - 1][1] = Number(m[2]);
  return out;
}

/** `spans` of `input` joined into `out`, `fade` seconds of fade at each join (and at the ends when `edges`).
 * @param {string} input @param {number[][]} spans @param {string} out @param {number} fade @param {boolean} edges */
function cut(input, spans, out, fade, edges) {
  const chains = spans.map(([s, e], i) => {
    const fadeIn = edges || i > 0 ? `,afade=t=in:d=${fade}` : "";
    const fadeOut =
      edges || i < spans.length - 1 ? `,afade=t=out:st=${round(e - s - fade, 4)}:d=${fade}` : "";
    return `[0:a]atrim=start=${round(s, 4)}:end=${round(e, 4)},asetpts=PTS-STARTPTS${fadeIn}${fadeOut}[p${i}]`;
  });
  const graph = `${chains.join(";")};${spans.map((_, i) => `[p${i}]`).join("")}concat=n=${spans.length}:v=0:a=1[o]`;
  execFileSync(ffmpegBin(), [
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-i",
    input,
    "-filter_complex",
    graph,
    "-map",
    "[o]",
    out,
  ]);
}

/** Pauses cut down to `keep`: what both the gaps between words and silencedetect call silent, over `minGap`.
 * @param {string} input @param {Word[]} words @param {{keep: number, minGap: number, out: string}} o */
export function tighten(input, words, { keep, minGap, out }) {
  const duration = probe(input).duration;
  const gaps = [0, ...words.map((w) => w.end)].map((s, i) => [s, words[i]?.start ?? duration]);
  const quiet = silences(input, duration);
  const cuts = gaps
    .flatMap(([s, e]) => quiet.map(([qs, qe]) => [Math.max(s, qs), Math.min(e, qe)]))
    .filter(([s, e]) => e - s > minGap)
    .map(([s, e]) => [s + keep / 2, e - keep / 2]);
  const kept = [...cuts, [duration, duration]].map(([s], i) => [cuts[i - 1]?.[1] ?? 0, s]);
  cut(input, kept, out, JOIN_FADE, false);
  const shift = (/** @type {number} */ t) =>
    cuts.reduce((d, [s, e]) => (e <= t ? d + e - s : d), 0);
  const moved = words.map((w) => ({
    text: w.text,
    start: round(w.start - shift(w.start)),
    end: round(w.end - shift(w.end)),
  }));
  const wordsPath = `${out.slice(0, out.length - extname(out).length)}.words.json`;
  writeFileSync(wordsPath, JSON.stringify({ words: moved }));
  const removed = cuts.reduce((d, [s, e]) => d + e - s, 0);
  return {
    out,
    words: wordsPath,
    before_s: round(duration, 2),
    after_s: round(duration - removed, 2),
    cuts: cuts.length,
    removed_s: round(removed, 2),
  };
}

/** Where a run of words splits best: after its longest pause, a comma winning a tie. @param {Word[]} ws */
function breakAt(ws) {
  let [best, at] = [-Infinity, 1];
  for (let k = 1; k < ws.length; k++) {
    const gap = ws[k].start - ws[k - 1].end + (COMMA.test(ws[k - 1].text) ? 1e-6 : 0);
    if (gap > best) [best, at] = [gap, k];
  }
  return at;
}

/** Sentences, each longer than `max` with its breaths cut at its longest pause until it fits.
 * @param {Word[]} words @param {number} max @returns {Word[][]} */
function units(words, max) {
  /** @type {Word[][]} */
  const sentences = [[]];
  for (const w of words) {
    sentences[sentences.length - 1].push(w);
    if (SENTENCE_END.test(w.text)) sentences.push([]);
  }
  /** @param {Word[]} ws @returns {Word[][]} */
  const fit = (ws) => {
    if (ws.length < 2 || ws[ws.length - 1].end - ws[0].start + 2 * BREATH <= max) return [ws];
    const k = breakAt(ws);
    return [...fit(ws.slice(0, k)), ...fit(ws.slice(k))];
  };
  return sentences.filter((s) => s.length).flatMap(fit);
}

/** Takes of whole units, as many as fit in `max` seconds each, cut mid-pause with at most BREATH of silence kept.
 * @param {Word[]} words @param {number} max @param {number} duration */
export function segments(words, max, duration) {
  const us = units(words, max);
  const mid = us.map((u, i) => (i ? (us[i - 1][us[i - 1].length - 1].end + u[0].start) / 2 : 0));
  const from = (/** @type {number} */ i) => Math.max(mid[i], us[i][0].start - BREATH);
  const to = (/** @type {number} */ j) =>
    Math.min(mid[j + 1] ?? duration, us[j][us[j].length - 1].end + BREATH);
  const out = [];
  for (let i = 0, j = 0; i < us.length; i = ++j) {
    while (j + 1 < us.length && to(j + 1) - from(i) <= max) j++;
    out.push({ start: round(from(i)), end: round(to(j)), words: us.slice(i, j + 1).flat() });
  }
  return out;
}

/** Writes DIR/seg-NN.wav and DIR/segments.json. @param {string} input @param {Word[]} words
 * @param {{max: number, dir: string}} o */
export function split(input, words, { max, dir }) {
  const segs = segments(words, max, probe(input).duration).map((s, i) => {
    const file = join(dir, `seg-${String(i + 1).padStart(2, "0")}.wav`);
    cut(input, [[s.start, s.end]], file, EDGE_FADE, true);
    const text = s.words.map((w) => w.text).join(" ");
    const local = s.words.map((w) => ({
      text: w.text,
      start: round(w.start - s.start),
      end: round(w.end - s.start),
    }));
    return {
      file,
      start: s.start,
      end: s.end,
      seconds: round(s.end - s.start),
      text,
      words: local,
    };
  });
  writeFileSync(join(dir, "segments.json"), JSON.stringify(segs));
  return {
    dir,
    segments: segs.map(({ file, start, end, seconds, text }) => ({
      file,
      start,
      end,
      seconds,
      text,
    })),
  };
}

/** @param {string[]} args */
export async function main(args) {
  const parsed = parseTool(args, {
    usage: USAGE,
    example: EXAMPLE,
    options: Object.fromEntries(
      ["keep", "min-gap", "max", "out"].map((k) => [k, { type: "string" }]),
    ),
  });
  if (!parsed) return;
  const { values: v, positionals } = parsed;
  const [sub, input, wordsPath] = positionals;
  if (!["tighten", "split"].includes(sub) || !input || !wordsPath)
    throw new Fix("voice needs tighten or split, IN.wav and WORDS.json", `run it as: ${EXAMPLE}`);
  const words = loadWords(wordsPath);
  const num = (/** @type {string} */ k, /** @type {number} */ d) =>
    v[k] === undefined ? d : numbers(String(v[k]), `--${k}`)[0];
  if (sub === "tighten") {
    const out = v.out
      ? String(v.out)
      : join(dirname(input), `${basename(input, extname(input))}-tight.wav`);
    mkdirSync(dirname(out), { recursive: true });
    console.log(
      JSON.stringify(
        tighten(input, words, { keep: num("keep", 0.09), minGap: num("min-gap", 0.2), out }),
      ),
    );
  } else
    console.log(
      JSON.stringify(
        split(input, words, {
          max: num("max", 11.5),
          dir: outDir(v.out && String(v.out), "voice-split"),
        }),
      ),
    );
}
