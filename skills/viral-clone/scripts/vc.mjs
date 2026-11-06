#!/usr/bin/env node
// One command per stage of a viral clone. The mechanics live here: what to run, in parallel, where it lands, what
// to open next. The judgment stays with the agent: what the reference does, how to build it, what to fix. A Cindy run
// took 170 tool calls to reach v1 when each measurement was its own call.
import { execFile, execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { geminiAccess, look } from "./gemini.mjs";
import {
  ffmpegBin,
  ffprobeBin,
  hfMediaCall,
  hasAudio,
  hfMediaCommand,
  NEEDS_UV,
  hyperframes,
} from "./media.mjs";
import { NOT_NESTABLE, rateOf } from "./patch-render.mjs";
import { clock, cutWindow, watchWindow } from "./watchWindow.mjs";
import { judge } from "./pieces-judge.mjs";
import { pool, report } from "./pieces-score.mjs";
import { g2Rows, soundMapArgs } from "./review-rows.mjs";
import { draftTemplate, templateStep } from "./template.mjs";
import {
  asksReport,
  lastEdit,
  markPatched,
  projectHolds,
  verify,
  WHOLE_RENDER,
} from "./verify.mjs";

const USAGE = `usage (from the project folder):
  node vc.mjs next                         where the project stands and the one command to run next
  node vc.mjs watch REF [--slug cindy] [--from M:SS --to M:SS]
                                           G0: every measurement at once, Gemini's read, a zoomed crop per graphic,
                                           draft motion windows -> .viral-clone/<slug>/watch.md. Over two minutes it
                                           watches the first two minutes, or the stretch --from/--to names
  node vc.mjs pieces [--changed a,b]       G0.5: render the pieces on green, score, Gemini's look (only the named
                                           windows again when given), -> .viral-clone/pieces/report.md
  node vc.mjs film [--patch 9.5-15.3,...]  G2: render v0 once; after the fixes, re-render only those seconds -> final
  node vc.mjs review [renders/v0.mp4] [--words W.json] [--caption-roi x,y,w,h]
                                           G2: lip-sync, loudness, holds per segment, captions at word starts, each
                                           piece against the face, sound on picture events and the palette, rhythm,
                                           Gemini's structure and looks
                                           -> .viral-clone/work/review.md
  node vc.mjs verify 9.5-15.3[,25-30] [--sound]
                                           after any change: re-render those seconds if the film changed since its
                                           render, a strip at 8 fps, Gemini's review (--sound: the soundtrack against
                                           the reference's), loudness -> .viral-clone/work/verify.md
  node vc.mjs asks                         the open asks in .viral-clone/asks.json; exit 1 while any is open
tools (each prints a runnable example with --help):
  compare REF OURS --at t,…                one ref|ours pair sheet and SSIM per pair
  box VIDEO --at t | --start --end         a graphic's box, colors, ink and cap height; --track fits its move
  events VIDEO [--roi | --grid 6x10]       when things appear, disappear, cut and hold, with a strip per event
  align A B [--words a.json b.json]        lag and a piecewise map for retime.mjs
  voice tighten|split IN.wav WORDS.json    cut silences / segment at sentence ends, words remapped
  template draft|check|render              template.json: drafted from the watch, checked, rendered to md
  assemble TIMELINE.json                   person takes, template components, captions, audio -> compositions`;
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
// The first call waits for the app to set hf-media up (about 1 GB), which can take minutes; past this it is stuck.
const HF_MEDIA_WAIT_MS = 5 * 60_000;
/** Why the stages that measure with hf-media cannot run, or null. Its first call waits for the app's setup and fails
 * with why that failed; an agent that finds another profile's runtime runs it without the launcher that keeps a shell
 * HeyGen key from paying. @param {NodeJS.ProcessEnv} env */
export function hfMediaRefusal(env, limitMs = HF_MEDIA_WAIT_MS) {
  const command = hfMediaCommand(env);
  if (!command)
    return "hf-media is not on this run's PATH. Never install it yourself or put another app's runtime on PATH.";
  // A .cmd starts only through cmd.exe.
  const ran = command.toLowerCase().endsWith(".cmd")
    ? spawnSync(`"${command}" --help`, { env, shell: true, encoding: "utf8", timeout: limitMs })
    : spawnSync(command, ["--help"], { env, encoding: "utf8", timeout: limitMs });
  if (ran.status === 0) return null;
  if (/** @type {any} */ (ran.error)?.code === "ETIMEDOUT")
    return `hf-media did not answer in ${Math.round(limitMs / 60000)} minutes, so the media tools are not ready. Open the app, wait for its media tools to finish setting up, and run this again.`;
  return ran.stderr?.trim() || ran.error?.message || `hf-media exited with ${ran.status}`;
}

/** Stops before a batch that runs hf-media, rather than failing each of its steps. */
const requireHfMedia = () => {
  const refused = hfMediaRefusal(process.env);
  if (refused) throw new Error(refused);
};

/** @param {(args: string[]) => Promise<void>} stage */
const measuring = (stage) => async (/** @type {string[]} */ args) => {
  requireHfMedia();
  return stage(args);
};
// A crop this wide shows how a graphic is built: paper scraps, gaps, fonts. 1 FPS sheets at 320 px do not.
const ZOOM_W = 1600;
// checks.md: a gate gets three rounds at most, then stops and reports what is left as a failure
const PIECES_ROUNDS = 3;

/** step's command, arguments and shell for `hf-media args`.
 * @param {string[]} args @returns {[string, string[], boolean]} */
const hfMediaStep = (args) => {
  const { file, args: rest, shell } = hfMediaCall(args);
  return [file, rest, shell];
};
/** What a failed step said: from the error's own line when it crashed with a trace (never the trace's frames or the
 * Node version line it ends on), else the last lines. @param {string} text */
export function failureWhy(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^at |^Node\.js v\d/.test(l));
  const at = lines.findIndex((l) => /^[A-Za-z]*Error\b/.test(l));
  if (at < 0) return lines.slice(-3).join(" ");
  // "Error: Command failed: <the whole command>" fills the line with paths; the reason is what follows it.
  const [first = "", ...rest] = lines.slice(at);
  return (
    /^Error: Command failed: /.test(first)
      ? rest.length
        ? rest
        : ["Command failed"]
      : [first, ...rest]
  )
    .slice(0, 3)
    .join(" ");
}
/** Runs a command, never throwing: the batch reports what failed beside what worked. @param {string} cmd
 * @param {string[]} args @param {boolean} [shell] */
async function step(name, cmd, args, shell = false) {
  const t0 = Date.now();
  try {
    const { stdout } = await run(cmd, args, { maxBuffer: 1 << 28, shell });
    return { name, ok: true, seconds: (Date.now() - t0) / 1000, stdout };
  } catch (e) {
    const err = /** @type {any} */ (e);
    const why = failureWhy(String(err.stderr || err.message || e));
    return {
      name,
      ok: false,
      code: err.code,
      seconds: (Date.now() - t0) / 1000,
      error: why.slice(0, 300),
    };
  }
}

/** The voice split; a reference with no audio track has nothing to split, so it is skipped and the table says so.
 * @param {string} video @param {string} out */
export async function stemsStep(video, out) {
  const name = "stems (Demucs)";
  if (!hasAudio(video))
    return { name, ok: true, skipped: "no audio track", seconds: 0, stdout: "" };
  const done = await step(name, ...node("separate.mjs", [video, out]));
  // The app has no uv to run Demucs with: the table says so, and the sound map waits for a stem.
  return done.code === NEEDS_UV
    ? {
        name,
        ok: true,
        skipped: "needs uv, which this app does not include",
        seconds: done.seconds,
        stdout: "",
      }
    : done;
}

const node = (/** @type {string} */ script, /** @type {string[]} */ args) => [
  process.execPath,
  [join(SCRIPTS, script), ...args],
];

/** The file's size and duration, and where its picture ends: `videoEnd` (a longer soundtrack runs past it) and one
 * frame's `frame` seconds. @param {string} path */
const probe = (path) => {
  const entries = "stream=width,height,duration,avg_frame_rate:format=duration";
  const out = execFileSync(
    ffprobeBin(),
    ["-v", "error", "-select_streams", "v:0", "-show_entries", entries].concat([
      "-of",
      "json",
      path,
    ]),
  );
  const { streams: [v] = [], format } = JSON.parse(out.toString());
  const [num, den] = String(v?.avg_frame_rate).split("/").map(Number);
  const duration = Number(format?.duration);
  return {
    width: v?.width,
    height: v?.height,
    duration,
    videoEnd: Number(v?.duration) || duration,
    frame: den / num || 0,
  };
};

/** The overview's one frame a second through the picture's end, 20 to a sheet; the last sits mid final frame.
 * @param {string} video */
export function overviewTimes(video) {
  const { videoEnd, frame } = probe(video);
  const times = Array.from({ length: Math.floor(videoEnd) + 1 }, (_, t) =>
    Math.min(t, videoEnd - frame / 2),
  );
  return Array.from({ length: Math.ceil(times.length / 20) }, (_, n) =>
    times.slice(n * 20, n * 20 + 20),
  );
}

const slugOf = (/** @type {string} */ text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "window";

/** The project's one template slug, or null. */
function templateSlug() {
  if (!existsSync("templates")) return null;
  const slugs = readdirSync("templates", { withFileTypes: true }).filter((d) => d.isDirectory());
  return slugs.length === 1 ? slugs[0].name : null;
}

/** A Gemini box in percent as pixels, padded a little and kept inside the frame.
 * @param {{left: number, top: number, width: number, height: number}} box @param {number} fw @param {number} fh */
export function boxToRoi(box, fw, fh, pad = 6) {
  const x0 = Math.max(0, ((box.left - pad) * fw) / 100);
  const y0 = Math.max(0, ((box.top - pad) * fh) / 100);
  const x1 = Math.min(fw, ((box.left + box.width + pad) * fw) / 100);
  const y1 = Math.min(fh, ((box.top + box.height + pad) * fh) / 100);
  const even = (/** @type {number} */ v) => Math.max(2, Math.round(v / 2) * 2);
  return [even(x0), even(y0), even(x1 - x0), even(y1 - y0)];
}

/** One frame's box, scaled up to read construction from. @param {number[]} roi */
function zoom(video, at, [x, y, w, h], out) {
  execFileSync(ffmpegBin(), [
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-ss",
    String(at),
    "-i",
    video,
    "-vf",
    `crop=${w}:${h}:${x}:${y},scale=${ZOOM_W}:-2:flags=lanczos`,
    "-frames:v",
    "1",
    out,
  ]);
  return out;
}

// Captions follow the caption rule and G2's check, not a G0.5 window.
const CAPTION = /\b(captions?|subtitles?)\b/i;

/** Draft motion windows from Gemini's read: one per kind but captions, at its first instance, with Gemini's words as
 * the first build items. The agent confirms each on frames and rewrites its build items from the zoom before G0.5
 * reads them. @param {any[]} grouped kinds() output @param {number} fw @param {number} fh */
export function draftWindows(grouped, fw, fh) {
  const names = new Set();
  return grouped.flatMap(({ kind, count, instances }) => {
    const e = instances.find((i) => i.box) ?? instances[0];
    if (!e?.box || CAPTION.test(kind)) return [];
    let name = slugOf(kind);
    while (names.has(name)) name += "-2";
    names.add(name);
    const start = Math.max(0, Math.round((e.start - 0.2) * 100) / 100);
    return [
      {
        name,
        start,
        seconds: Math.round(Math.min(4, Math.max(0.6, e.end - e.start + 0.4)) * 100) / 100,
        roi: boxToRoi(e.box, fw, fh),
        build: [e.build, `holds: ${e.hold}`, `enters: ${e.entry}`, `exits: ${e.exit}`].filter(
          Boolean,
        ),
        instances: count,
        draft: true,
      },
    ];
  });
}

/** Writes why G0.5 has no pieces to `noPieces` and returns watch.md's line, or null and writes nothing: only when
 * this run's Gemini read saw no graphic but captions and its perform read saw no one talk on camera. A file an
 * earlier run left is never read, since a failed step keeps it. @param {string} rec
 * @param {{ name: string, ok: boolean }[]} results this run's steps @param {string} noPieces */
export function markNoPieces(rec, results, noPieces = join(".viral-clone", "no-pieces")) {
  const ran = (/** @type {string} */ name) => results.find((r) => r.name === name)?.ok === true;
  if (existsSync(noPieces) || !ran("gemini read") || !ran("gemini perform")) return null;
  const answer = (/** @type {string} */ file) => {
    try {
      return JSON.parse(readFileSync(join(rec, file), "utf8"));
    } catch {
      return null;
    }
  };
  const kinds = answer("gemini-read.json")?.kinds;
  const noGraphics = Array.isArray(kinds) && kinds.every((k) => CAPTION.test(k?.kind));
  if (!noGraphics || answer("gemini-perform.json")?.talking_person !== false) return null;
  writeFileSync(
    noPieces,
    "Gemini saw no graphic but captions in the reference and no one talking on camera, so nothing sits over a host.\n",
  );
  return `Wrote ${noPieces}, so G0.5 is skipped; delete it if a graphic Gemini missed sits over a person.`;
}

async function watch(args) {
  const ref = args[0];
  if (!ref || !existsSync(ref)) throw new Error(USAGE);
  requireHfMedia();
  const slugFlag = args.indexOf("--slug");
  const slug =
    slugFlag >= 0 ? args[slugFlag + 1] : templateSlug() || slugOf(basename(ref, extname(ref)));
  const dir = join(".viral-clone", slug);
  const rec = join("templates", slug, "reference");
  mkdirSync(dir, { recursive: true });
  mkdirSync(rec, { recursive: true });
  const video = join(dir, "ref.mp4");
  const whole = probe(ref).duration;
  const watched = watchWindow(whole, args);
  if (!watched && resolve(ref) !== resolve(video)) copyFileSync(ref, video);
  if (watched) {
    if (resolve(ref) === resolve(video))
      throw new Error("Run vc watch on the original file to watch another stretch.");
    cutWindow(ref, video, watched);
  }
  // Watching the kept cut again must not replace the record of where in the whole reference it came from.
  if (resolve(ref) !== resolve(video) || !existsSync(join(rec, "watched.json")))
    writeFileSync(
      join(rec, "watched.json"),
      `${JSON.stringify({ source: resolve(ref), total: whole, ...(watched ?? { from: 0, to: whole }) })}\n`,
    );
  const { width, height, duration } = probe(video);
  const fresh = (/** @type {string} */ out) =>
    (rmSync(out, { recursive: true, force: true }), out);
  const sheets = [];
  for (const [n, times] of overviewTimes(video).entries())
    sheets.push(
      step(
        `overview ${n * 20}-${Math.min(duration, n * 20 + 20)} s`,
        ...hfMediaStep([
          "evidence",
          "frames",
          video,
          "--times",
          JSON.stringify(times),
          "--max-width",
          "320",
          "--sheet-columns",
          "5",
          "--out",
          fresh(join(dir, `overview-${String(n).padStart(2, "0")}`)),
        ]),
      ),
    );
  const read = step(
    "gemini read",
    ...node("gemini.mjs", ["read", video, "--out", join(rec, "gemini-read.json")]),
  );
  const results = await Promise.all([
    ...sheets,
    step(
      "temporal-scan",
      ...hfMediaStep(["evidence", "temporal-scan", video, "--out", fresh(join(dir, "scan"))]),
    ),
    step("motion rhythm", ...node("motion-rhythm.mjs", [video])),
    // The template draft reads each graphic's face relation and anchor from these boxes.
    step("face boxes", ...hfMediaStep(["evidence", "face-size", video, "--samples", "12"])),
    stemsStep(video, join(dir, "sep")),
    read,
    step(
      "gemini perform",
      ...node("gemini.mjs", ["perform", video, "--out", join(rec, "gemini-perform.json")]),
    ),
  ]);
  const stems = results.find((r) => r.name === "stems (Demucs)");
  const scanned = results.find((r) => r.name === "temporal-scan");
  if (stems?.ok && !stems.skipped && scanned?.ok) {
    const sound = await step(
      "sound map (picture anchors)",
      ...node("sound-map.mjs", soundMapArgs(video, stems.stdout, join(dir, "scan"), dir)),
    );
    if (sound.ok) {
      mkdirSync(join(rec, "sound"), { recursive: true });
      copyFileSync(join(dir, "sound", "sound-map.json"), join(rec, "sound", "sound-map.json"));
    }
    results.push(sound);
  }
  const rhythm = results.find((r) => r.name === "motion rhythm");
  if (rhythm?.ok) writeFileSync(join(rec, "motion-rhythm.json"), rhythm.stdout);
  const faces = results.find((r) => r.name === "face boxes");
  if (faces?.ok) writeFileSync(join(rec, "face-size.json"), faces.stdout);
  const drafted = (() => {
    try {
      return draftTemplate({ slug, refVideo: video, rec });
    } catch (e) {
      return { error: String(/** @type {any} */ (e)?.message ?? e).slice(0, 200) };
    }
  })();
  const lines = [
    `# Watch: ${slug} (${duration.toFixed(1)} s, ${width}x${height})`,
    "",
    ...(watched
      ? [
          `**Watched ${clock(watched.from)}-${clock(watched.to)} of ${clock(whole)}.** Every time below counts from ${clock(watched.from)}, and the rest was not watched.`,
          `Tell the person which stretch you watched and offer another: \`vc watch REF --from M:SS --to M:SS\`.`,
          "",
        ]
      : []),
    "| step | ok | s |",
    "|---|---|---|",
  ];
  for (const r of results)
    lines.push(
      `| ${r.name} | ${r.skipped ? `skipped: ${r.skipped}` : r.ok ? "yes" : `no: ${r.error}`} | ${r.seconds.toFixed(0)} |`,
    );
  const readPath = join(rec, "gemini-read.json");
  const answer = existsSync(readPath) ? JSON.parse(readFileSync(readPath, "utf8")) : null;
  if (answer?.kinds) {
    mkdirSync(join(dir, "zoom"), { recursive: true });
    const windows = draftWindows(answer.kinds, width, height);
    lines.push(
      "",
      "## Graphics Gemini saw, by kind (confirm each on frames; its times are about ±1 s)",
      "",
    );
    for (const w of windows) {
      const z = zoom(video, w.start + w.seconds / 2, w.roi, join(dir, "zoom", `${w.name}.png`));
      w.zoom = z;
      lines.push(
        `- **${w.name}** ×${w.instances} at ${w.start} s, box ${w.roi.join(",")}: open ${z}`,
      );
    }
    writeFileSync(join(rec, "motion-windows.draft.json"), `${JSON.stringify(windows, null, 1)}\n`);
    lines.push(
      "",
      `Draft windows: ${join(rec, "motion-windows.draft.json")}. Copy it to motion-windows.json after checking each`,
      "window on native-rate frames and rewriting its build items from its zoom (count pieces, letters per piece, gaps,",
      "tilt, font); add a window for each other entry or exit style and each graphic Gemini missed on the sheets.",
    );
  } else if (answer?.skipped) lines.push("", `Gemini: ${answer.skipped}`);
  const performPath = join(rec, "gemini-perform.json");
  const perform = existsSync(performPath) ? JSON.parse(readFileSync(performPath, "utf8")) : null;
  if (perform?.beats?.length)
    lines.push(
      "",
      `## The presenter, beat by beat: ${perform.beats.length} beats in ${performPath}`,
      "",
      "Write each person shot's Video 1 or H3 Max action from its beats, after checking each beat you use on frames",
      "(media.md, speaking footage): it misses actions under graphic overlays and sometimes names the wrong hand.",
    );
  else if (perform && !perform.skipped) lines.push("", "Gemini perform: no one talks on camera.");
  const skipped = markNoPieces(rec, results);
  if (skipped) lines.push(skipped);
  lines.push(
    "",
    "## Yours next (watch.md)",
    `- Template: ${"error" in drafted ? `draft failed: ${drafted.error}` : `templates/${slug}/template.draft.json`}; consolidate its kinds into reusable types in template.json (template.md), then node vc.mjs template check.`,
    "- Read every overview sheet; open the scan's candidates in real frames.",
    `- Sound map: ${existsSync(join(rec, "sound", "sound-map.json")) ? `${join(dir, "sound", "sound-map.html")} holds the picture anchors.` : "it did not run (see the table)."} Transcribe the reference video itself (voice.transcribeAudio takes video), run sound-map.mjs again with --words so phrases count, copy it to ${join(rec, "sound")}, then confirm a dozen hits on frames (watch.md, Sound).`,
    "- Captions rule, typography, layer inventory and footage log from full-size frames.",
  );
  writeFileSync(join(dir, "watch.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

/** The pieces page with the reference under it removed and the page on green, for the solo render.
 * @param {string} html @param {string} refSrc */
export function soloPage(html, refSrc) {
  const esc = refSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const without = html.replace(
    new RegExp(`<video\\b[^>]*\\bsrc="(?:\\./)?${esc}"[^>]*>(?:\\s*</video>)?`, "g"),
    "",
  );
  if (without === html) throw new Error(`the pieces page has no <video src="${refSrc}"> to hide`);
  return without.replace(
    "</head>",
    "<style>html,body{background:#00ff00!important}</style></head>",
  );
}

/** Why another G0.5 round may not run, or null: each round renders the whole pieces page and is read by the model,
 * so rounds past checks.md's three are where G0.5's time goes. @param {number} scored the round scores.json holds,
 * 0 before the first */
export function piecesRoundRefusal(scored) {
  return scored >= PIECES_ROUNDS
    ? `G0.5 has scored ${scored} rounds, the most it gets (checks.md). The pieces' accepted lines in pieces.json are recorded and judged again; put each problem still in report.md at the top of RESULT.md as a failure, with its zoom; a piece still held is asked about once, only when the person can answer. Then node vc.mjs next.`
    : null;
}

/** The last round's scores with each piece's `accepted` as pieces.json now says, so a stand-in written after the
 * last round reaches the judge (and the app's hold on paid work) without another round. @param {any} scores
 * @param {any} spec pieces.json */
export function withAccepted(scores, spec) {
  const said = new Map((spec.pieces ?? []).map((/** @type {any} */ p) => [p?.name, p?.accepted]));
  return {
    ...scores,
    pieces: (scores.pieces ?? []).map((/** @type {any} */ p) => {
      const { accepted: _, ...rest } = p;
      const accepted = said.get(p?.name);
      return accepted && typeof accepted === "object" ? { ...rest, accepted } : rest;
    }),
  };
}

async function pieces(args) {
  const dir = join(".viral-clone", "pieces");
  const scoresPath = join(dir, "scores.json");
  const last = existsSync(scoresPath) ? JSON.parse(readFileSync(scoresPath, "utf8")) : null;
  const refused = piecesRoundRefusal(last ? Number(last.round) || 1 : 0);
  if (refused) {
    const windows = JSON.parse(
      readFileSync(
        join("templates", String(last.template), "reference", "motion-windows.json"),
        "utf8",
      ),
    );
    const scores = withAccepted(last, JSON.parse(readFileSync(join(dir, "pieces.json"), "utf8")));
    const verdict = judge(scores, windows);
    writeFileSync(scoresPath, `${JSON.stringify(scores, null, 1)}\n`);
    writeFileSync(join(dir, "report.md"), report(scores.pieces, verdict, scores.round, dir));
    console.log(
      JSON.stringify(
        {
          pass: verdict.pass,
          problems: verdict.problems.length,
          accepted: verdict.accepted.length,
          rescored: 0,
        },
        null,
        1,
      ),
    );
    console.log(`Nothing rendered or scored: ${refused}`);
    process.exitCode = verdict.pass ? 0 : 1;
    return;
  }
  const page = join(dir, "index.html");
  if (!existsSync(page))
    throw new Error(`no ${page}: build the pieces project first (template.md)`);
  const specPath = join(dir, "pieces.json");
  const html = readFileSync(page, "utf8");
  const slug = templateSlug();
  const windowsPath = join("templates", String(slug), "reference", "motion-windows.json");
  if (!existsSync(specPath)) {
    if (!existsSync(windowsPath)) throw new Error(`no ${windowsPath}: confirm G0's windows first`);
    const ref = html.match(/<video\b[^>]*\bsrc="([^"]+)"/)?.[1];
    const windows = JSON.parse(readFileSync(windowsPath, "utf8"));
    const spec = {
      template: slug,
      ref,
      solo: "pieces-solo.mp4",
      pieces: windows.map((w) => ({ name: w.name, kind: "overlay", ink: "light" })),
    };
    writeFileSync(specPath, `${JSON.stringify(spec, null, 1)}\n`);
    console.log(
      `wrote ${specPath}: set each piece's kind (opaque when it covers its box) and ink (dark text)`,
    );
  }
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const changedAt = args.indexOf("--changed");
  const changed = changedAt >= 0 ? args[changedAt + 1] : "";
  const solo = join(dir, spec.solo ?? "pieces-solo.mp4");
  // The whole pass renders each round (about 2 min for Cindy at draft quality): nesting the page to render only the
  // changed seconds broke its components' scripts, so --changed only spares unchanged windows the scoring and look.
  writeFileSync(join(dir, ".solo.html"), soloPage(html, spec.ref));
  try {
    const render = hyperframes([
      "render",
      dir,
      "-c",
      ".solo.html",
      "-o",
      resolve(solo),
      "--quality",
      "draft",
    ]);
    execFileSync(render.file, render.args, {
      shell: render.shell,
      stdio: ["ignore", "ignore", "inherit"],
    });
  } finally {
    rmSync(join(dir, ".solo.html"), { force: true });
  }
  const [cmd, a] = node("pieces-score.mjs", [specPath, ...(changed ? ["--changed", changed] : [])]);
  try {
    process.stdout.write(execFileSync(cmd, a, { maxBuffer: 1 << 26 }));
  } catch (e) {
    process.stdout.write(/** @type {any} */ (e).stdout ?? "");
    process.exitCode = 1;
  }
}

/** Why a whole-film render may not run, or null: the film renders once as v0, and every fix after it re-renders only
 * its own seconds (patch-render renders the whole film itself when the page cannot be nested).
 * @param {(p: string) => boolean} has */
export function filmRenderRefusal(has) {
  return has("renders/v0.mp4")
    ? "renders/v0.mp4 exists and the whole film renders once (checks.md, G2): fix what review.md lists, then node vc.mjs film --patch <the seconds you changed>. A change that moves the whole timeline or the sound belongs before v0."
    : null;
}

/** Renders the whole film into renders/final.mp4 at `base`'s frame rate, its current sound with it, and marks when.
 * @param {string} base */
function wholeFilm(base) {
  const started = new Date();
  const render = hyperframes([
    ...["render", ".", "-o", resolve("renders/final.mp4")],
    ...["--fps", rateOf(base)],
  ]);
  execFileSync(render.file, render.args, {
    shell: render.shell,
    stdio: ["ignore", "inherit", "inherit"],
  });
  mkdirSync(dirname(WHOLE_RENDER), { recursive: true });
  writeFileSync(WHOLE_RENDER, `${started.toISOString()}\n`);
  // dated when the render read the source, so an edit made while it ran stays unrendered
  utimesSync(WHOLE_RENDER, started, started);
}

/** Re-renders `spans` of `base` into renders/final.mp4, the whole film when the page cannot render nested.
 * @param {string} spans @param {string} base */
function patchFilm(spans, base) {
  const [cmd, a] = node("patch-render.mjs", [
    ".",
    base,
    "--spans",
    spans,
    "--out",
    "renders/final.mp4",
  ]);
  const patched = spawnSync(cmd, a, { stdio: "inherit" });
  if (patched.status === NOT_NESTABLE) wholeFilm(base);
  else if (patched.status !== 0) throw new Error(`patch-render exited ${patched.status}`);
}

async function film(args) {
  const patchAt = args.indexOf("--patch");
  mkdirSync("renders", { recursive: true });
  if (patchAt < 0) {
    const refused = filmRenderRefusal(existsSync);
    if (refused) throw new Error(refused);
    const render = hyperframes(["render", ".", "-o", resolve("renders/v0.mp4")]);
    execFileSync(render.file, render.args, {
      shell: render.shell,
      stdio: ["ignore", "inherit", "inherit"],
    });
    console.log("renders/v0.mp4: next, node vc.mjs review");
    return;
  }
  const revision = lastEdit(".");
  patchFilm(
    args[patchAt + 1],
    existsSync("renders/final.mp4") ? "renders/final.mp4" : "renders/v0.mp4",
  );
  markPatched(".", args[patchAt + 1], revision);
}

/** Gemini's structure review and its look at each window's matching second, as review.md lines.
 * @param {any} g gemini-review.json @param {any} structure its step @param {any[]} windows */
async function geminiLines(g, structure, windows, ref, draft) {
  const lines = [];
  if (g?.issues) {
    lines.push("## Structure (Gemini; check each on frames before it goes in fixes.md)", "");
    for (const i of g.issues)
      lines.push(
        `- ${i.severity}: ${i.element} (ref ${i.ref_time}, ours ${i.ours_time}): ${i.observed}`,
      );
    lines.push("");
  } else
    lines.push(
      `Gemini review: ${structure.ok ? (g?.skipped ?? "no answer") : structure.error}`,
      "",
    );
  const sa = geminiAccess();
  const mapped = (g?.moments ?? []).filter((m) => Number.isFinite(m.ours_time));
  if (!sa || !mapped.length) return lines;
  lines.push("## Each window at its matching second (Gemini's look; times are about ±1 s)", "");
  const scale = probe(draft).width / probe(ref).width;
  const looks = await pool(windows, 4, async (w) => {
    const mid = w.start + w.seconds / 2;
    const m = mapped.reduce((best, x) =>
      Math.abs(x.ref_time - mid) < Math.abs(best.ref_time - mid) ? x : best,
    );
    if (Math.abs(m.ref_time - mid) > 1) return null;
    const ours = Math.max(0, m.ours_time - (mid - w.start));
    try {
      const r = await look(sa, mkdtempDir(), {
        ref,
        refStart: w.start,
        ours: draft,
        oursStart: ours,
        seconds: w.seconds,
        refRoi: w.roi,
        oursRoi: w.roi.map((v) => Math.round(v * scale)),
      });
      return { w, ours, majors: r.differences.filter((d) => d.severity === "major") };
    } catch (e) {
      return { w, ours, error: String(/** @type {any} */ (e)?.message ?? e).slice(0, 200) };
    }
  });
  for (const l of looks.filter(Boolean))
    lines.push(
      `- ${l.w.name} (ref ${l.w.start} s, ours ${l.ours.toFixed(1)} s): ${l.error ?? (l.majors.length ? l.majors.map((d) => d.what).join(" | ") : "same")}`,
    );
  return [...lines, ""];
}

async function review(args) {
  const flag = (/** @type {string} */ f) =>
    args.includes(f) ? args[args.indexOf(f) + 1] : undefined;
  const draft = args[0] && !args[0].startsWith("--") ? args[0] : "renders/v0.mp4";
  const slug = templateSlug();
  const ref = join(".viral-clone", String(slug), "ref.mp4");
  if (!existsSync(draft) || !existsSync(ref)) throw new Error(`need ${draft} and ${ref}`);
  requireHfMedia();
  const windows = JSON.parse(
    readFileSync(join("templates", String(slug), "reference", "motion-windows.json"), "utf8"),
  );
  const out = join(".viral-clone", "work");
  mkdirSync(out, { recursive: true });
  const at = windows.map((w) => Math.round((w.start + w.seconds / 2) * 10) / 10);
  const [rhythm, structure, g2] = await Promise.all([
    step("motion rhythm", ...node("motion-rhythm.mjs", [ref, "--compare", draft])),
    step(
      "gemini review",
      ...node("gemini.mjs", [
        "review",
        ref,
        draft,
        "--at",
        at.join(","),
        "--out",
        join(out, "gemini-review.json"),
      ]),
    ),
    g2Rows({
      ref,
      draft,
      slug,
      words: flag("--words"),
      captionRoi: flag("--caption-roi")?.split(",").map(Number),
    }),
  ]);
  const lines = [`# G2 review of ${draft}`, "", g2.md, ""];
  if (rhythm.ok) {
    const r = JSON.parse(rhythm.stdout).ratio;
    lines.push(
      "## Motion rhythm, whole film (draft ÷ reference)",
      "",
      ...Object.entries(r).map(([k, v]) => `- ${k}: ${v}`),
      "",
    );
  } else lines.push(`motion rhythm failed: ${rhythm.error}`, "");
  const g = existsSync(join(out, "gemini-review.json"))
    ? JSON.parse(readFileSync(join(out, "gemini-review.json"), "utf8"))
    : null;
  lines.push(...(await geminiLines(g, structure, windows, ref, draft)));
  lines.push(
    "## Not covered here (checks.md G2): voice prosody, word drift, hero scenes. Run those whose rows",
    "apply, then write fixes.md with the seconds each fix touches, and `node vc.mjs film --patch <spans>`.",
  );
  writeFileSync(join(out, "review.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

const mkdtempDir = () => {
  const d = join(
    ".viral-clone",
    "work",
    "look",
    String(Date.now() + Math.random()).replace(".", ""),
  );
  mkdirSync(d, { recursive: true });
  return d;
};

const NO_HOLDS = {
  finalStale: () => false,
  verifyHold: /** @type {() => string[] | null} */ (() => null),
  verifySound: () => false,
  openAsks: () => [],
  copyRuns: () => [],
};

/** Where the project stands, from its files, and what to run next. @param {(p: string) => boolean} has
 * @param {typeof import("./template.mjs").checkTemplate} [check]
 * @param {typeof NO_HOLDS} [holds] what keeps a written final.mp4 from Done: verify.mjs's projectHolds */
export function nextStep(has, slug, check, holds = NO_HOLDS) {
  const rec = `templates/${slug}/reference`;
  if (!slug || (!has(`${rec}/gemini-read.json`) && !has(`${rec}/motion-rhythm.json`)))
    return "G0: node vc.mjs watch <reference.mp4> --slug <name>, then read .viral-clone/<slug>/watch.md";
  if (!has(`${rec}/motion-windows.json`))
    return `G0: confirm ${rec}/motion-windows.draft.json on frames, rewrite its build items from the zooms, save as motion-windows.json (watch.md step 4)`;
  if (!has(`${rec}/sound/sound-map.json`))
    return `G0: no ${rec}/sound/sound-map.json — node scripts/sound-map.mjs on the voice-free stem, the scan and the words, then copy it there (watch.md, Sound)`;
  const template = templateStep(has, slug, check);
  if (template) return template;
  // A reference with no pieces to build skips G0.5 for good, not only until its first film.
  const noPieces = has(".viral-clone/no-pieces");
  if (noPieces && !has("renders/v0.mp4")) return "Build the film, then: node vc.mjs film";
  if (!noPieces && !has(".viral-clone/pieces/scores.json"))
    return "G0.5: build .viral-clone/pieces (template.md), then node vc.mjs pieces";
  if (!noPieces && !has(".viral-clone/pieces/rounds/r1"))
    return "G0.5 v0 scored: fix everything in .viral-clone/pieces/report.md, then node vc.mjs pieces --changed <windows you changed>";
  if (!has("renders/v0.mp4")) return "G1, G1.5 and the remix (media.md), then: node vc.mjs film";
  if (!has(".viral-clone/work/review.md")) return "G2: node vc.mjs review";
  if (!has("renders/final.mp4"))
    return "G2: fix .viral-clone/work/review.md's list, then node vc.mjs film --patch <spans you changed>";
  if (holds.finalStale())
    return "final.mp4 is older than your last edit: node vc.mjs verify <spans you changed>";
  const fixes = holds.verifyHold();
  if (fixes?.length)
    return `verify.md has spans to fix or not checked at ${fixes.join(", ")} s: fix what it names, then node vc.mjs verify ${fixes.join(",")}${holds.verifySound() ? " --sound" : ""}`;
  if (fixes) return "final.mp4 is not verified yet: node vc.mjs verify <spans you changed>";
  const open = holds.openAsks();
  if (open.length) return `Asks open: ${open.join("; ")} (node vc.mjs asks)`;
  const copies = holds.copyRuns();
  if (copies.length)
    return `On-screen text copies the reference's words; write the person's own: ${copies.join("; ")}`;
  if (!has("RESULT.md")) return "Done but for RESULT.md: write it (checks.md#resultmd)";
  return "Done: renders/final.mp4 and RESULT.md are written";
}

export const COMMANDS = {
  watch: measuring(watch),
  pieces: measuring(pieces),
  film,
  review: measuring(review),
  next: async () =>
    console.log(
      nextStep((p) => existsSync(p), templateSlug(), undefined, projectHolds(".", templateSlug())),
    ),
  asks: async () => {
    const { code, text } = asksReport(".");
    console.log(text);
    process.exitCode = code;
  },
  verify: measuring(async (args) => {
    const { md, code } = await verify(args, {
      slug: templateSlug(),
      patch: patchFilm,
      whole: wholeFilm,
      film: () => film([]),
      gemini: (a) => step("gemini verify", ...node("gemini.mjs", a)),
    });
    console.log(md);
    process.exitCode = code;
  }),
};

// Measurement and build tools, one module each with `main(args)`; `vc <tool> --help` prints a runnable example.
const TOOLS = {
  compare: "compare.mjs",
  box: "box.mjs",
  events: "events.mjs",
  align: "align.mjs",
  voice: "voice-cut.mjs",
  template: "template.mjs",
  assemble: "assemble.mjs",
};

/** A command's own lines of USAGE: its line and the ones wrapped under it. @param {string} cmd */
export function usageOf(cmd) {
  const lines = USAGE.split("\n");
  const at = lines.findIndex((line) => new RegExp(`^  node vc\\.mjs ${cmd}( |$)`).test(line));
  const end = lines.findIndex((line, i) => i > at && !/^ {20,}/.test(line));
  return [lines[0], ...lines.slice(at, end)].join("\n");
}

/** A command given --help or -h prints its usage and runs nothing; a tool prints its own runnable example.
 * @param {string} cmd @param {string[]} args */
const commandFor = (cmd, args) =>
  COMMANDS[cmd] && args.some((arg) => arg === "--help" || arg === "-h")
    ? async () => console.log(usageOf(cmd))
    : (COMMANDS[cmd] ??
      (TOOLS[cmd] &&
        (async (/** @type {string[]} */ rest) =>
          (await import(pathToFileURL(join(SCRIPTS, TOOLS[cmd])).href)).main(rest))));

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [cmd, ...args] = process.argv.slice(2);
  const command = commandFor(cmd, args);
  if (!command) {
    console.error(USAGE);
    process.exit(2);
  }
  await command(args).catch((e) => {
    console.error(e.message);
    process.exit(2);
  });
}
