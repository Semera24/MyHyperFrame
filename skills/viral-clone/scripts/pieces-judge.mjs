// G0.5's verdict, pure so the app imports it. A missing or still piece waits in every round until fixed or let go by
// an answer the app heard from the person (Cindy's v1 went on with a still Step title); a build difference waits until
// v1, then goes on only under a named stand-in. A failed look always waits.
import { createHash } from "node:crypto";

// Look numbers stay advice: on 38 scored pieces (2026-10-16) neither SSIM, move size nor sharpness told the two
// rebuilds an editor rejected (a scrap-per-letter title, a mosaicked list) from the ones that matched.

const KINDS = ["opaque", "overlay"];
// Under half its window in the solo render: the piece is missing, not late.
const PRESENT = 0.5;
// The still Cindy card scored 0.22 against its moving reference; matching held cards 0.4 and up.
const STATIC = 0.3;
// Mean optical flow inside the box above which the reference clearly moves: flow's still floor is 0.05, and a held
// Dan Martell card measured 0.06 from compression and the host at its edge.
const MOVES = 0.15;
const ENERGY = [0.8, 1.25];
const SSIM = 0.85;
const CLOCK = 0.01;
// A piece whose solo render fills this share of the middle of its box covers what is under it, whatever its label.
const COVERS = 0.8;
// Steps per second under which the reference's changes are a boil or a stepped update rather than motion.
const BOILS = 15;
// Round 1 scores v0; round 2 scores v1, after the one fix round.
const V1_ROUND = 2;

const num = (v) => typeof v === "number" && Number.isFinite(v);

/** Whether the piece hides what is under it: labelled opaque, or measured so on the solo render. @param {any} piece */
export const covering = (piece) =>
  piece.kind === "opaque" || (num(piece.cover) && piece.cover >= COVERS);

/** Why G0's spec of this window cannot be checked, or null: no build list, or an item that is not text. No reason
 * excuses it, since there is nothing to compare the rebuild with. @param {any} window @returns {string | null} */
function specProblem(window) {
  const items = window?.build;
  const valid =
    Array.isArray(items) &&
    items.length > 0 &&
    items.every((b) => typeof b === "string" && b.trim());
  return valid
    ? null
    : `${window?.name}: G0 recorded no usable build items for this window; write them (watch.md step 4)`;
}

/** What Gemini saw differ, major ones, when it looked at the window; else the build items the rebuild has not answered
 * as done. A builder's own "done" is not read once Gemini has looked: Cindy's v1 answered every hook-title item done
 * on a single strip where the reference has one scrap per 2-3 letters. @param {any} piece @param {any} window
 * @returns {string[]} */
function buildProblems(piece, window) {
  const name = window.name;
  if (Array.isArray(piece.look?.differences))
    return piece.look.differences
      .filter((d) => d?.severity === "major")
      .map((d) => `${name}: looks different from the reference: ${d.what}`);
  const items = window.build;
  const answers = Array.isArray(piece.build) ? piece.build : [];
  return items.flatMap((item, i) => {
    const answer = answers[i];
    if (answer?.item !== item) return [`${name}: build item ${i + 1} not answered ("${item}")`];
    if (answer.done === true) return [];
    return [
      `${name}: not built as the reference: ${item}${answer.note ? ` (${answer.note})` : ""}`,
    ];
  });
}

/** @param {any} piece @param {any} window G0's record of this window
 * @returns {{ fixed: string[], motion: string[], look: string[] }} `fixed` problems no reason excuses, `motion` ones
 * only the person may accept, `look` ones v1 may go on with under the piece's own note */
function hardProblems(piece, window) {
  const name = window.name;
  if (!KINDS.includes(piece.kind))
    return { fixed: [`${name}: kind must be "opaque" or "overlay"`], motion: [], look: [] };
  const sameRoi =
    Array.isArray(piece.roi) &&
    piece.roi.length === 4 &&
    piece.roi.every((v, i) => v === window.roi?.[i]);
  if (
    !num(piece.start) ||
    !num(piece.seconds) ||
    Math.abs(piece.start - window.start) > CLOCK ||
    Math.abs(piece.seconds - window.seconds) > CLOCK ||
    !sameRoi
  )
    return {
      fixed: [`${name}: scored at another time or box than G0 recorded`],
      motion: [],
      look: [],
    };
  if (!num(piece.cover) || !num(piece.ref_energy))
    return {
      fixed: [`${name}: scored without cover or ref_energy; run pieces-score.mjs again`],
      motion: [],
      look: [],
    };
  // A missing piece is never let go: the person's answer keeps a piece still, it does not drop one.
  const missing =
    !num(piece.present_share) || piece.present_share < PRESENT
      ? [`${name}: missing from the solo render (shown for ${piece.present_share} of its window)`]
      : [];
  const motion = [];
  // Only a covering piece hides the host, so only there does flow, read inside it, measure the piece. A fade or a
  // black frame is flat in the reference: its flow is a brightness change, not motion the rebuild must play.
  if (
    covering(piece) &&
    piece.ref_fade !== true &&
    piece.ref_energy >= MOVES &&
    !(piece.energy_ratio >= STATIC)
  )
    motion.push(
      `${name}: holds still where the reference moves (energy_ratio ${piece.energy_ratio}` +
        `${piece.kind === "opaque" ? "" : `, and it covers ${piece.cover} of its box`}); play its footage or ` +
        "rebuild the animation",
    );
  // A boil is the step a hand-made title or label takes every few frames; Cindy's titles and labels came back still
  // three times, and the eye reads that before anything else.
  if (
    num(piece.ref_gap) &&
    piece.ref_gap > 1 &&
    piece.ref_changes_per_s < BOILS &&
    !num(piece.draft_gap)
  )
    motion.push(
      `${name}: holds still where the reference changes every ${piece.ref_gap} frames (a boil, a scroll or a stepped update)`,
    );
  // A look that was asked for and failed is not a missing key: nothing was compared, so nothing excuses it.
  if (piece.look_error)
    return {
      fixed: [
        ...missing,
        `${name}: Gemini's look failed (${piece.look_error}); score it again with --changed ${name}`,
      ],
      motion,
      look: [],
    };
  return { fixed: missing, motion, look: buildProblems(piece, window) };
}

/** @param {any} piece @returns {string[]} what to change, from the scorer's fix list and the numbers */
function advice(piece) {
  const name = piece.name;
  const out = (Array.isArray(piece.fix) ? piece.fix : []).map((f) => `${name}: ${f}`);
  for (const d of piece.look?.differences ?? [])
    if (d?.severity === "minor") out.push(`${name}: ${d.what}`);
  // Over a host, an overlay's flow reads the person behind it, so its motion is read off its sheet.
  if (covering(piece) && piece.ref_still !== true && num(piece.energy_ratio))
    if (piece.energy_ratio < ENERGY[0] || piece.energy_ratio > ENERGY[1])
      out.push(`${name}: moves ${piece.energy_ratio}× as much as the reference`);
  if (covering(piece) && num(piece.ssim_mean) && piece.ssim_mean < SSIM)
    out.push(
      `${name}: looks different from the reference (ssim ${piece.ssim_mean}); see its sheet`,
    );
  return out;
}

const text = (/** @type {unknown} */ v) => (typeof v === "string" ? v.trim() : "");

/** How a question about this piece alone starts: its template, its window and a digest of the window's time, box and
 * build items, so an answer never carries to another template's window of the same name or to a window G0 changed.
 * @param {string | undefined} template @param {any} window */
export function askPrefix(template, window) {
  const what = [
    template ?? "",
    window.name,
    window.start,
    window.seconds,
    window.roi,
    window.build,
  ];
  const id = createHash("sha256").update(JSON.stringify(what)).digest("hex").slice(0, 8);
  return `G0.5 ${template ?? "-"}/${window.name} ${id}:`;
}

/** An askPrefix leading a question's words: the app records the answer under it but never shows it, since it names the
 * template (often the reference's creator) and an id the person can't read. */
export const ASK_KEY = /^G0\.5 [^/\n]+\/.+? [0-9a-f]{8}:\s*/;

/** The one option that lets a still piece go on. Its words are fixed so no answer is read as consent: "No", "Blue"
 * or any other pick to the same question holds. */
export const LET_GO = "Go on with it still";

/** Why a still piece goes on, in any round: the person's latest answer to the question `prefix` starts, as the app
 * heard it, is LET_GO. Nothing the agent writes counts.
 * @param {string} prefix @param {readonly {question: string, answer: string}[]} heard */
const personReason = (prefix, heard) =>
  heard.findLast((h) => h.question.startsWith(prefix))?.answer === LET_GO
    ? `the person picked "${LET_GO}" for ${prefix.slice(0, -1)}`
    : null;

/** Why a build difference goes on: from v1, the piece's `accepted` naming its stand-in and why. Never the person's
 * answer to a motion question, which was about something else. @param {any} piece @param {any} scores */
const lookReason = (piece, scores) => {
  const standIn = text(piece.accepted?.stand_in);
  const why = text(piece.accepted?.why);
  return num(scores?.round) && scores.round >= V1_ROUND && standIn && why
    ? `stand-in ${standIn} (${why})`
    : null;
};

/** @param {any} scores the parsed scores.json @param {any[] | null} windows G0's motion windows, each
 * {name, start, seconds, roi, build} @param {readonly {question: string, answer: string}[]} [heard] the person's
 * answers in this project with their questions, as main recorded them; outside the app there are none
 * @returns {{ pass: boolean, problems: string[], advice: string[], accepted: string[] }} `accepted`: problems that
 * go on, each with its reason, for the top of RESULT.md */
export function judge(scores, windows, heard = []) {
  const pieces = Array.isArray(scores?.pieces) ? scores.pieces : [];
  if (!pieces.length)
    return { pass: false, problems: ["no piece is scored yet"], advice: [], accepted: [] };
  if (!windows?.length)
    return {
      pass: false,
      problems: [
        "G0's motion windows are missing, or the scores name another template than this remix uses (frame.md)",
      ],
      advice: [],
      accepted: [],
    };
  const problems = [];
  const tips = [];
  const accepted = [];
  for (const window of windows) {
    const piece = pieces.find((p) => p?.name === window?.name);
    if (!piece) {
      problems.push(`motion window "${window?.name}" has no scored piece`);
      continue;
    }
    const spec = specProblem(window);
    if (spec) {
      problems.push(spec);
      continue;
    }
    const { fixed, motion, look } = hardProblems(piece, window);
    problems.push(...fixed);
    const prefix = askPrefix(scores?.template, window);
    const letGo = personReason(prefix, heard);
    if (motion.length && !letGo)
      tips.push(
        `${window.name}: to ask the person, start the question "${prefix}" and offer "${LET_GO}"`,
      );
    for (const [list, reason] of [
      [motion, letGo],
      [look, lookReason(piece, scores)],
    ])
      if (reason) accepted.push(...list.map((p) => `${p}; accepted: ${reason}`));
      else problems.push(...list);
    tips.push(...advice(piece));
  }
  return { pass: problems.length === 0, problems, advice: tips, accepted };
}
