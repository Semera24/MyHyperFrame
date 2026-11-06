// The check after any change, and what holds `vc next` short of Done: the person's asks, the render against the last
// edit, and on-screen text lifted from the reference. 27 of 45 runs that missed an ask never rendered their own film.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { hyperframes, round } from "./media.mjs";
import { spans as frameSpans } from "./patch-render.mjs";
import { hfMedia, LU } from "./review-rows.mjs";
import { loadWords } from "./tool.mjs";

export const ASKS = ".viral-clone/asks.json";
const FROM = ["setup", "message", "follow-up"];
const STRIP_FPS = 8;
// a run this long shared with the reference reads as copied: 8 words, or 10 CJK characters, or a mix weighed so
const RUN_WORDS = 8;
const RUN_CJK = 10;
const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const IS_CJK = new RegExp(`[${CJK}]`, "u");
const TOKEN = new RegExp(`[${CJK}]|(?:(?![${CJK}])[\\p{L}\\p{N}])+`, "gu");

/** Why an asks.json entry is malformed, or null. @param {any} a */
function askProblem(a) {
  if (!a || typeof a !== "object") return "not an object";
  if (typeof a.ask !== "string" || !a.ask.trim()) return "ask must be the request in short words";
  if (!FROM.includes(a.from)) return `from must be one of ${FROM.join(", ")}; got ${a.from}`;
  if (a.met === null) return null;
  if (typeof a.met?.how !== "string" || !a.met.how.trim() || typeof a.met.at !== "string")
    return 'met must be null or {"at": "12.0-15.5" or "whole", "how": "<one line of evidence>"}';
  return a.met.at === "whole" || /^\d+(\.\d+)?-\d+(\.\d+)?$/.test(a.met.at)
    ? null
    : `met.at must be seconds like 12.0-15.5 or "whole"; got "${a.met.at}"`;
}

/** asks.json's entries; a missing or malformed file throws saying what is wrong. @param {string} root */
export function readAsks(root) {
  const path = join(root, ASKS);
  if (!existsSync(path))
    throw new Error(
      `no ${ASKS}: write one entry per setup choice, brief line and follow-up request, met null until the film shows it`,
    );
  let list;
  try {
    list = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${ASKS} is not JSON: ${/** @type {Error} */ (e).message}`);
  }
  if (!Array.isArray(list)) throw new Error(`${ASKS} must be a list of {ask, from, met}`);
  for (const [i, a] of list.entries()) {
    const why = askProblem(a);
    if (why) throw new Error(`${ASKS} entry ${i + 1}: ${why}`);
  }
  return list;
}

/** `vc asks`: the open asks, exit 1 while any is open or the file is missing or malformed. @param {string} root */
export function asksReport(root) {
  try {
    const open = readAsks(root).filter((a) => a.met === null);
    if (!open.length) return { code: 0, text: "Every ask is met." };
    return {
      code: 1,
      text: [
        `${open.length} ask${open.length > 1 ? "s" : ""} open:`,
        ...open.map((a) => `- ${a.ask} (${a.from})`),
        `Fill each one's met in ${ASKS} with the seconds and the evidence once the film shows it.`,
      ].join("\n"),
    };
  } catch (e) {
    return { code: 1, text: /** @type {Error} */ (e).message };
  }
}

/** Words and CJK characters, lower case, without punctuation or apostrophes. @param {string} text */
export const tokens = (text) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’]/g, "")
    .match(TOKEN) ?? [];

const copied = (/** @type {string[]} */ run) => {
  const cjk = run.filter((t) => IS_CJK.test(t)).length;
  return cjk / RUN_CJK + (run.length - cjk) / RUN_WORDS >= 1;
};

const spoken = (/** @type {string[]} */ run) =>
  run.map((t, k) => (k && !(IS_CJK.test(t) && IS_CJK.test(run[k - 1])) ? ` ${t}` : t)).join("");

/** Each longest run of `ours` that also appears in one of `theirs` and is long enough to read as copied, except runs
 * inside one of `asked` (the person asked for those words). @param {string} ours @param {string[]} theirs
 * @param {string[]} [asked] */
export function sharedRuns(ours, theirs, asked = []) {
  const a = tokens(ours);
  const allowed = asked.map((x) => ` ${tokens(x).join(" ")} `);
  const found = new Set();
  // ponytail: O(n·m) per text pair; fine for a film's text against a transcript, suffix automaton if it ever is not
  for (const b of theirs.map(tokens)) {
    let prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      const row = new Array(b.length + 1).fill(0);
      for (let j = 1; j <= b.length; j++) {
        if (a[i - 1] !== b[j - 1]) continue;
        row[j] = prev[j - 1] + 1;
        if (i < a.length && j < b.length && a[i] === b[j]) continue;
        const run = a.slice(i - row[j], i);
        if (copied(run) && !allowed.some((x) => x.includes(` ${run.join(" ")} `)))
          found.add(spoken(run));
      }
      prev = row;
    }
  }
  return [...found].sort((x, y) => y.length - x.length);
}

/** What a viewer could read in a page: its text without scripts, styles, comments or tags. @param {string} html */
export const visibleText = (html) =>
  html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#39|#x27|apos|rsquo);/g, "'")
    .replace(/&[#\w]+;/g, " ");

const readJson = (/** @type {string} */ path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const filesUnder = (/** @type {string} */ dir) =>
  existsSync(dir) ? readdirSync(dir, { recursive: true }).map((f) => join(dir, String(f))) : [];

/** The reference's words: each transcript watch saved, each graphic's text Gemini read and each beat's words.
 * @param {string} root @param {string} slug */
export function referenceTexts(root, slug) {
  const rec = join(root, "templates", slug, "reference");
  const read = readJson(join(rec, "gemini-read.json"));
  const texts = [
    ...(read?.kinds ?? []).flatMap((/** @type {any} */ k) => k.instances ?? []).map((i) => i.text),
    ...(readJson(join(rec, "gemini-perform.json"))?.beats ?? []).map((b) => b.words),
  ];
  for (const file of [...filesUnder(join(root, ".viral-clone", slug)), ...filesUnder(rec)])
    if (/\.(transcript|words)\.json$/.test(file))
      try {
        texts.push(
          loadWords(file)
            .map((w) => w.text)
            .join(" "),
        );
      } catch {}
  return texts.filter((t) => typeof t === "string" && t.trim());
}

// Folders the render writes or never reads; every other file in the project may be one the film loads.
const NOT_SOURCE = new Set(["renders", "templates", "node_modules"]);

/** Every file the film could load: the whole project but its outputs, hidden folders, notes and saved transcripts.
 * @param {string} root @returns {string[]} */
const filmFiles = (root, dir = root) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.name.startsWith(".")) return [];
    if (e.isDirectory()) return dir === root && NOT_SOURCE.has(e.name) ? [] : filmFiles(root, path);
    return e.isFile() && !/\.md$|\.transcript\.json$/.test(e.name) ? [path] : [];
  });

/** Each run of the film's pages copied from the reference, as `file: "run"`. @param {string} root
 * @param {string} slug */
export function copyRuns(root, slug) {
  const theirs = referenceTexts(root, slug);
  let asked = [];
  try {
    asked = readAsks(root).map((a) => a.ask);
  } catch {}
  if (!theirs.length) return [];
  return filmFiles(root)
    .filter((f) => f.endsWith(".html"))
    .flatMap((f) =>
      sharedRuns(visibleText(readFileSync(f, "utf8")), theirs, asked).map(
        (run) => `${relative(root, f)}: "${run}"`,
      ),
    );
}

/** When the film's source last changed, 0 when it has none. @param {string} root */
export function lastEdit(root) {
  return Math.max(0, ...filmFiles(root).map((f) => statSync(f).mtimeMs));
}

const FINAL = "renders/final.mp4";
const V0 = "renders/v0.mp4";
/** Written after each whole-film render into final.mp4: patches keep their base's sound, so the mix is current only
 * when no edit came after this or v0. */
export const WHOLE_RENDER = ".viral-clone/work/whole-render";
/** The spans patched into final.mp4 since the film's last edit, as `{ edited, spans: [[start, end]] }` in seconds. */
const PATCHED = ".viral-clone/work/patched.json";

/** Records `spans` as rendered for the source as it stood at `edited` (read before the render started, so an edit
 * made during it is not counted as rendered), beside earlier patches of that same source.
 * @param {string} root @param {string} spans as `vc verify` takes them @param {number} edited */
export function markPatched(root, spans, edited) {
  const was = readJson(join(root, PATCHED));
  const done = was?.edited === edited ? was.spans : [];
  const added = frameSpans(spans, 1000, Infinity).map(([a, b]) => [a / 1000, b / 1000]);
  mkdirSync(join(root, ".viral-clone", "work"), { recursive: true });
  writeFileSync(join(root, PATCHED), JSON.stringify({ edited, spans: [...done, ...added] }));
}
const finalStale = (/** @type {string} */ root) => {
  if (!existsSync(join(root, FINAL))) return false;
  const rendered = Math.max(
    existsSync(join(root, WHOLE_RENDER)) ? statSync(join(root, WHOLE_RENDER)).mtimeMs : 0,
    readJson(join(root, PATCHED))?.edited ?? 0,
  );
  return lastEdit(root) > (rendered || statSync(join(root, FINAL)).mtimeMs);
};

/** Spans a verify left to fix or unchecked, as `[{ name, start, end }]`: each stays until a later verify checks a
 * span holding it and finds it clean. */
const OPEN = ".viral-clone/work/verify-open.json";

/** Carries the open spans over this verify's results: a clean span clears those it covers, but a span opened with
 * --sound only when this check heard the sound too. @param {string} root
 * @param {{ name: string, start: number, end: number, open: boolean, sound: boolean }[]} results */
function keepOpen(root, results) {
  const was = readJson(join(root, OPEN)) ?? [];
  const clears = (/** @type {any} */ r, /** @type {any} */ o) =>
    r.open ? r.name === o.name : r.start <= o.start && o.end <= r.end && (r.sound || !o.sound);
  const open = [
    ...was.filter((/** @type {any} */ o) => !results.some((r) => clears(r, o))),
    ...results
      .filter((r) => r.open)
      .map(({ name, start, end, sound }) => ({
        name,
        start,
        end,
        sound: sound || was.some((/** @type {any} */ o) => o.name === name && o.sound),
      })),
  ];
  writeFileSync(join(root, OPEN), JSON.stringify(open));
}

/** Whether an open span needs --sound to clear. @param {string} root */
export const openNeedsSound = (root) =>
  (readJson(join(root, OPEN)) ?? []).some((/** @type {any} */ o) => o.sound);

/** null when verify cleared final.mp4; else the spans still to fix or unchecked, or [] when verify has not run on
 * this render. @param {string} root @returns {string[] | null} */
export function verifyHold(root) {
  const md = join(root, ".viral-clone", "work", "verify.md");
  const render = [FINAL, V0].map((p) => join(root, p)).find((p) => existsSync(p));
  if (!render || !existsSync(md) || statSync(md).mtimeMs < statSync(render).mtimeMs) return [];
  const open = (readJson(join(root, OPEN)) ?? []).map((/** @type {any} */ o) => o.name);
  return open.length ? open : null;
}

/** `nextStep`'s readers of the project's holds. @param {string} root @param {string | null} slug */
export const projectHolds = (root, slug) => ({
  finalStale: () => finalStale(root),
  verifyHold: () => verifyHold(root),
  verifySound: () => openNeedsSound(root),
  openAsks: () => {
    try {
      return readAsks(root)
        .filter((a) => a.met === null)
        .map((a) => a.ask);
    } catch (e) {
      return [/** @type {Error} */ (e).message];
    }
  },
  copyRuns: () => (slug ? copyRuns(root, slug) : []),
});

/** Where a span of ours sits in the reference: by the review's nearest moment inside it, else the same seconds.
 * @param {number[]} span @param {any[]} moments gemini-review.json's */
export function refSpan([a, b], moments) {
  const mid = (a + b) / 2;
  const near = moments
    .filter(
      (m) =>
        Number.isFinite(m?.ref_time) &&
        Number.isFinite(m?.ours_time) &&
        m.ours_time >= a - 1 &&
        m.ours_time <= b + 1,
    )
    .sort((x, y) => Math.abs(x.ours_time - mid) - Math.abs(y.ours_time - mid))[0];
  if (!near) return { start: a, end: b, how: "the same seconds: no review moment maps this span" };
  const start = Math.max(0, round(a + near.ref_time - near.ours_time, 2));
  return {
    start,
    end: round(start + b - a, 2),
    how: `review's moment ours ${near.ours_time} s = reference ${near.ref_time} s`,
  };
}

/** What `vc verify` renders: `redo` "patch" (onto the latest render), "whole" (--sound after an edit the soundtrack
 * missed) or null when a whole render, or a patch since the last edit, covers every span.
 * @param {{ spans: string, has: (p: string) => boolean, mtime: (p: string) => number, edited: number,
 * sound?: boolean, moments?: any[], patched?: { edited: number, spans: number[][] } | null }} p */
export function verifyPlan({
  spans,
  has,
  mtime,
  edited,
  sound = false,
  moments = [],
  patched = null,
}) {
  const base = has(FINAL) ? FINAL : has(V0) ? V0 : null;
  if (!base) throw new Error("no render yet: node vc.mjs film renders v0 first");
  const wholeAt = Math.max(has(V0) ? mtime(V0) : 0, has(WHOLE_RENDER) ? mtime(WHOLE_RENDER) : 0);
  const oldSound = edited > wholeAt;
  const asked = frameSpans(spans, 1000, Infinity).map(([a, b]) => [a / 1000, b / 1000]);
  const covered = (/** @type {number[]} */ [a, b]) =>
    !oldSound || (patched?.edited === edited && patched.spans.some(([s, e]) => s <= a && b <= e));
  const redo = sound && oldSound ? "whole" : asked.every(covered) ? null : "patch";
  return {
    base,
    redo,
    oldSound: oldSound && redo !== "whole",
    render: redo ? FINAL : base,
    spans: asked.map(([start, end]) => {
      const name = `${start}-${end}`;
      return {
        name,
        start,
        end,
        times: Array.from({ length: Math.max(1, Math.round((end - start) * STRIP_FPS)) }, (_, k) =>
          round(start + k / STRIP_FPS, 3),
        ),
        ref: refSpan([start, end], moments),
      };
    }),
  };
}

const exec = promisify(execFile);

/** hf-media's frames call for a span's strip, its times in a file of the span's folder: inline, a whole film's list
 * outgrows Windows' 8191-character command line (hf-media is a .cmd there, started through cmd.exe).
 * @param {string} video @param {number[]} times @param {string} dir */
export function stripArgs(video, times, dir) {
  const file = join(dir, "strip-times.json");
  writeFileSync(file, JSON.stringify(times));
  return [
    "frames",
    video,
    "--times",
    `@${file}`,
    "--max-width",
    "240",
    "--sheet-columns",
    "8",
    "--out",
    join(dir, "strip"),
  ];
}

/** `hyperframes audio --read`'s voice, effect and music lines for one span of a file, or why there are none. Desktop
 * saves a transcript as <name>.transcript.json, and the CLI looks for <file>.transcript.json, so it is passed.
 * @param {string} file @param {[number, number]} span @param {string} root */
export function audioRead(file, [start, end], root, { launch = hyperframes, run = exec } = {}) {
  const transcript = `${file.replace(/\.[^./\\]+$/, "")}.transcript.json`;
  const cmd = launch(
    ["audio", file, "--read", "--range", `${start},${end}`].concat(
      existsSync(transcript) ? ["--transcript", transcript] : [],
    ),
  );
  return run(cmd.file, cmd.args, { cwd: root, shell: cmd.shell, maxBuffer: 1 << 24 }).then(
    ({ stdout }) => stdout.trim().split("\n"),
    (e) => [`failed: ${String(e?.message ?? e).slice(0, 200)}`],
  );
}

const NO_AUDIO = { noAudio: true }; // a file with no audio stream: nothing to measure, not a failed measurement
const lufsText = (/** @type {any} */ v) =>
  v === NO_AUDIO ? "no audio stream" : v === null || v === undefined ? "silent" : `${v} LUFS`;

/** One span's verify.md section and whether it needs a fix. */
function spanSection(s, { strip, gemini, heard, ours, theirs, sound }) {
  const lines = [];
  const diff = Number.isFinite(ours) && Number.isFinite(theirs) ? round(ours - theirs, 1) : null;
  // a string is a failed or too-short measurement; null is silence; NO_AUDIO on the reference leaves nothing to match
  const measured = typeof ours !== "string" && typeof theirs !== "string";
  const silentOurs = ours === null || ours === NO_AUDIO;
  const silentOnOneSide = measured && theirs !== NO_AUDIO && silentOurs !== (theirs === null);
  const loud = sound && (silentOnOneSide || (diff !== null && Math.abs(diff) > LU));
  const issues = gemini?.issues ?? [];
  const checked = Array.isArray(gemini?.issues) && Boolean(strip.path) && (!sound || measured);
  const fix = loud || issues.some((i) => i.severity === "major");
  lines.push(`## ${s.name} s: ${fix ? "fix" : checked ? "ok" : "not checked"}`, "");
  lines.push(`- strip, ${STRIP_FPS} fps: ${strip.path ?? `failed: ${strip.error}`}`);
  lines.push(
    `- loudness: ${typeof ours === "string" ? `failed: ${ours}` : lufsText(ours)}` +
      (sound
        ? `; reference ${typeof theirs === "string" ? `failed: ${theirs}` : lufsText(theirs)}` +
          `${diff === null ? "" : ` (${diff > 0 ? "+" : ""}${diff} LU${loud ? `, over ${LU}` : ""})`}` +
          (sound && silentOnOneSide ? " (silent on one side only)" : "")
        : ""),
  );
  lines.push(`- reference moment: ${s.ref.start}-${s.ref.end} s, ${s.ref.how}`);
  if (heard)
    for (const [who, said] of [
      ["ours", heard[0]],
      ["reference", heard[1]],
    ])
      lines.push(`- heard, ${who} (hyperframes audio --read):`, ...said.map((l) => `  ${l}`));
  for (const i of issues) lines.push(`- ${i.severity} ${i.kind} ${i.start}-${i.end} s: ${i.what}`);
  if (checked && gemini.summary) lines.push(`- Gemini: ${gemini.summary}`);
  if (!checked) lines.push(`- Gemini did not review: ${gemini?.why}`);
  return { lines: [...lines, ""], fix, checked };
}

/** Gemini's verify answer for a span, or why there is none. */
function geminiAnswer(ran, path, hasRef) {
  if (!hasRef) return { why: "no reference video to compare with" };
  if (!ran?.ok) return { why: ran?.error ?? "it did not run" };
  const g = readJson(path);
  return g?.issues ? g : { why: g?.skipped ?? "no answer" };
}

/** @typedef {{ slug: string | null, patch: (spans: string, base: string) => Promise<void> | void,
 *   whole: (base: string) => Promise<void> | void, film?: () => Promise<void> | void, hf?: typeof hfMedia,
 *   heard?: typeof audioRead, root?: string,
 *   gemini: (args: string[]) => Promise<{ ok: boolean, error?: string } | null> }} VerifyDeps */

/** `vc verify SPANS [--sound]`: with no render yet, the whole film first (`film`, as `vc film`), then a re-render if
 * the film changed (`patch` onto base, or `whole` for the current sound, into final.mp4), then each span's strip,
 * Gemini's review and loudness, with --sound what the CLI hears in both films, into .viral-clone/work/verify.md.
 * Exit 1 when a span needs a fix or text copies the reference. @param {string[]} args @param {VerifyDeps} deps */
export async function verify(
  args,
  { slug, patch, whole, film, gemini, hf = hfMedia, heard = audioRead, root = "." },
) {
  const text = args.find((a) => !a.startsWith("--"));
  if (!text) throw new Error("usage: node vc.mjs verify 9.5-15.3[,25-30] [--sound]");
  const sound = args.includes("--sound");
  const at = (/** @type {string} */ p) => join(root, p);
  if (film && !existsSync(at(FINAL)) && !existsSync(at(V0))) {
    console.log(`no render yet: rendering the whole film into ${V0} first`);
    await film();
  }
  const revision = lastEdit(root);
  const plan = verifyPlan({
    spans: text,
    has: (p) => existsSync(at(p)),
    mtime: (p) => statSync(at(p)).mtimeMs,
    edited: revision,
    sound,
    moments: readJson(at(".viral-clone/work/gemini-review.json"))?.moments ?? [],
    patched: readJson(at(PATCHED)),
  });
  const list = plan.spans.map((s) => `${s.start}-${s.end}`).join(",");
  if (plan.redo === "patch") {
    await patch(list, plan.base);
    markPatched(root, list, revision);
  }
  if (plan.redo === "whole") await whole(plan.base);
  const ours = at(plan.render);
  const examined = statSync(ours).mtimeMs;
  // each run writes its strips and Gemini's answers in a folder of its own, so a concurrent verify of the same span
  // never reads another's files. ponytail: old run folders stay; prune them if .viral-clone/work grows too large
  mkdirSync(at(join(".viral-clone", "work", "verify")), { recursive: true });
  const run = mkdtempSync(at(join(".viral-clone", "work", "verify", "run-")));
  const ref = at(join(".viral-clone", String(slug), "ref.mp4"));
  const hasRef = existsSync(ref);
  const lufs = (/** @type {string} */ file, /** @type {any[]} */ spans) =>
    hf(["loudness", file, "--windows", JSON.stringify(spans.map((w) => [w.start, w.end]))]).then(
      (j) =>
        j.windows.map((/** @type {any} */ w) =>
          w.integrated_lufs === null && w.end - w.start < 0.4
            ? "too short to measure (under 0.4 s)"
            : w.integrated_lufs,
        ),
      (e) =>
        spans.map(() =>
          /has no audio stream/.test(String(e?.message))
            ? NO_AUDIO
            : String(e?.message ?? e).slice(0, 200),
        ),
    );
  const [oursLufs, refLufs, ...perSpan] = await Promise.all([
    lufs(ours, plan.spans),
    sound && hasRef
      ? lufs(
          ref,
          plan.spans.map((s) => s.ref),
        )
      : [],
    ...plan.spans.map(async (s) => {
      const dir = join(run, s.name);
      mkdirSync(dir, { recursive: true });
      const [strip, ran, read] = await Promise.all([
        hf(stripArgs(ours, s.times, dir)).then(
          (j) => ({ path: j.contact_sheet?.path ?? j.images?.[0]?.path }),
          (e) => ({ error: String(e?.message ?? e).slice(0, 200) }),
        ),
        hasRef
          ? gemini(
              ["verify", ref, ours, "--at", `${s.ref.start},${s.start}`, "--seconds"].concat(
                [String(round(s.end - s.start, 3)), ...(sound ? ["--sound"] : [])],
                ["--out", join(dir, "gemini.json")],
              ),
            )
          : null,
        sound && hasRef
          ? Promise.all([
              heard(ours, [s.start, s.end], root),
              heard(ref, [s.ref.start, s.ref.end], root),
            ])
          : null,
      ]);
      return {
        strip,
        heard: read,
        gemini: geminiAnswer(ran, join(dir, "gemini.json"), hasRef),
      };
    }),
  ]);
  const sections = plan.spans.map((s, i) =>
    spanSection(s, { ...perSpan[i], ours: oursLufs[i], theirs: refLufs[i], sound }),
  );
  const copies = slug ? copyRuns(root, slug) : [];
  const unchecked = sections.filter((s) => !s.checked).length;
  const lines = [
    `# Verify: ${plan.render} at ${plan.spans.map((s) => s.name).join(", ")} s${sound ? " (with sound)" : ""}`,
    "",
    {
      patch: `Re-rendered ${list} s onto ${plan.base} into ${FINAL}: the film changed after it.`,
      whole: `Re-rendered the whole film into ${FINAL}: --sound hears the current mix, and patches keep their base's sound.`,
      none: `Not re-rendered: ${plan.render} is newer than every edit.`,
    }[plan.redo ?? "none"],
    sound
      ? "Sound reviewed: the current mix, rendered whole after the last edit."
      : plan.oldSound
        ? `Sound: ${plan.render} carries the soundtrack from before the last edit (patches keep it); verify --sound renders the current mix.`
        : `Sound: ${plan.render}'s soundtrack is current.`,
    "",
    ...sections.flatMap((s) => s.lines),
    "## On-screen text copied from the reference",
    "",
    ...(copies.length
      ? copies.map((c) => `- ${c}`)
      : ["- none: no run of 8+ words or 10+ CJK characters matches the reference's words"]),
    "",
    ...(unchecked
      ? [
          `Not checked: ${unchecked} span${unchecked > 1 ? "s" : ""} (Gemini's review${sound ? " or the loudness" : ""}); open each strip and judge it yourself.`,
          "",
        ]
      : []),
  ];
  return withLock(root, () => {
    if (lastEdit(root) !== revision || statSync(ours).mtimeMs !== examined) {
      const note = `Not published: the film or ${plan.render} changed while this verify ran; run it again.`;
      console.log(note);
      return { md: note, code: 1 };
    }
    keepOpen(
      root,
      plan.spans.map((s, i) => ({ ...s, sound, open: sections[i].fix || !sections[i].checked })),
    );
    writeFileSync(at(join(".viral-clone", "work", "verify.md")), lines.join("\n"));
    return {
      md: lines.join("\n"),
      code: copies.length || sections.some((s) => s.fix || !s.checked) ? 1 : 0,
    };
  });
}

const LOCK = ".viral-clone/work/verify.lock";
const LOCK_WAIT_MS = 30_000;
const pause = (/** @type {number} */ ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs `publish` holding the project's verify lock, so verifies in other processes read, merge and write the open
 * spans one at a time. A lock is only ever removed by its owner: one still held after `waitMs` (a crashed run's)
 * fails this publish with how to clear it, rather than being taken over.
 * @template T @param {string} root @param {() => T} publish @returns {T} */
export function withLock(root, publish, waitMs = LOCK_WAIT_MS) {
  const lock = join(root, LOCK);
  mkdirSync(join(root, ".viral-clone", "work"), { recursive: true });
  for (const until = Date.now() + waitMs; ; pause(20)) {
    try {
      mkdirSync(lock);
      break;
    } catch (e) {
      if (/** @type {any} */ (e).code !== "EEXIST") throw e;
      if (Date.now() > until) {
        let owner = "";
        try {
          owner = ` (pid ${readFileSync(join(lock, "owner"), "utf8").trim()})`;
        } catch {}
        throw new Error(
          `another vc verify holds ${LOCK}${owner}; if none is running, delete that folder and verify again`,
        );
      }
    }
  }
  writeFileSync(join(lock, "owner"), String(process.pid));
  try {
    return publish();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
