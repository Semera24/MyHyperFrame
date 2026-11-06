#!/usr/bin/env node
// Cuts a finished HyperFrames project into Moments, then packs them. Node 22+, no npm dependencies.
//   node harvest.mjs cut  --project <dir> [--video <film.mp4>] [--min 1.5] [--target 4] [--max 8] [--json]
//   node harvest.mjs pack --project <dir>
// cut renders the film once (unless --video), finds windows of min..max seconds at hard cuts, timeline boundaries and
// the ends of holds, and writes <project>/moments/M01… (clip.mp4, still.jpg, code/, dense.md, moment.json). Each
// code/ is the film's index.html retimed to the window (retime), so a Moment plays exactly the film's frames there. moments/.work/<id>-sheet.jpg holds six frames of each window for naming it. pack refuses any TODO left in moment.json, dense.md or code/REMIX.md, then writes
// bundle.tar.gz (code/ + dense.md) and its sha256 into moment.json.

import { execFileSync, spawnSync } from "node:child_process";
import { cliCall } from "./hfCli.mjs";
import {
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const CMD = argv[0];
const flag = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const PROJECT = resolve(flag("project", "."));
const OUT = join(PROJECT, "moments");
const FFMPEG = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
export const ROLES = ["hook", "setup", "proof", "turn", "payoff", "cta"];
// Files and folders a film needs beside index.html; anything else at the top is copied only when the film names it.
const ALWAYS = ["compositions", "assets", "vendor", "hyperframes.json", "package.json"];
const NEVER = new Set([
  "moments",
  "renders",
  "snapshots",
  "node_modules",
  "templates",
  "boards",
  "output.mp4",
]);

const die = (msg) => {
  console.error(`harvest: ${msg}`);
  process.exit(1);
};

/** The root composition's numbers, read from index.html's data-composition-id element. */
export function rootOf(html) {
  const tag = html.match(/<[^>]*data-composition-id=[^>]*>/)?.[0];
  if (!tag) throw new Error("index.html has no data-composition-id root");
  const attr = (n) => tag.match(new RegExp(`data-${n}="([^"]+)"`))?.[1];
  const root = {
    duration: Number(attr("duration")),
    fps: Number(attr("fps") || 30),
    width: Number(attr("width")),
    height: Number(attr("height")),
  };
  if (!(root.duration > 0 && root.width > 0 && root.height > 0))
    throw new Error("the root needs data-duration, data-width and data-height");
  return root;
}

/** Start and end of every element the root timeline places (data-start + data-duration), as strong cut candidates. */
export function timelineCuts(html, duration) {
  const cuts = [];
  for (const tag of html.match(/<[^>]*data-start="[^"]*"[^>]*>/g) ?? []) {
    if (/data-composition-id=/.test(tag) && !/data-composition-src=/.test(tag)) continue; // the root itself
    if (/<(audio)\b/.test(tag)) continue; // a soundtrack spans the film and says nothing about scenes
    const s = Number(tag.match(/data-start="([^"]+)"/)[1]);
    const d = Number(tag.match(/data-duration="([^"]+)"/)?.[1]);
    for (const t of [s, s + d]) if (t > 0.05 && t < duration - 0.05) cuts.push(t);
  }
  return [...new Set(cuts.map((t) => Math.round(t * 100) / 100))];
}

/** Per-frame scene scores from FFmpeg, [[t, score]…]. */
function sceneScores(video) {
  const r = spawnSync(
    FFMPEG,
    [
      "-v",
      "error",
      "-i",
      video,
      "-an",
      "-vf",
      "scale=240:-2,select='gte(scene,0)',metadata=print:file=-",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 1 << 28 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg scene scores: ${r.stderr.slice(-300)}`);
  const out = [];
  let t = 0;
  for (const line of r.stdout.split("\n")) {
    const pt = line.match(/pts_time:([\d.]+)/);
    if (pt) t = Number(pt[1]);
    const sc = line.match(/scene_score=([\d.]+)/);
    if (sc) out.push([t, Number(sc[1])]);
  }
  return out;
}

/** Candidate cut points with a strength: hard cuts and timeline boundaries (2), the end of a hold (up to 1). */
export function candidates(scores, timeline, { hard = 0.3, still = 0.002, hold = 0.2 } = {}) {
  const c = timeline.map((t) => ({ t, w: 2 }));
  let since = null;
  for (const [t, s] of scores) {
    if (s >= hard) c.push({ t, w: 2 });
    if (s < still) since ??= t;
    else {
      if (since !== null && t - since >= hold) c.push({ t, w: Math.min((t - since) / 0.5, 1) });
      since = null;
    }
  }
  return c.sort((a, b) => a.t - b.t);
}

/** Windows of min..max seconds covering the film, each ending at the best candidate near `target` seconds long. */
export function windows(duration, cands, { min = 1.5, target = 4, max = 8 } = {}) {
  const out = [];
  let s = 0;
  while (duration - s > max) {
    const near = cands.filter((c) => c.t >= s + min && c.t <= s + max);
    const best = near.sort(
      (a, b) =>
        b.w - Math.abs(b.t - s - target) / target - (a.w - Math.abs(a.t - s - target) / target),
    )[0];
    const e = best ? best.t : s + target;
    out.push([s, e]);
    s = e;
  }
  if (out.length && duration - s < min)
    out[out.length - 1][1] = duration; // a short tail joins the window before it
  else out.push([s, duration]);
  return out.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]);
}

/** A settled frame for the still: the middle of the window's last hold, else its middle. */
function stillAt(scores, [a, b]) {
  let best = null;
  let since = null;
  for (const [t, s] of scores) {
    if (t < a || t > b) continue;
    if (s < 0.002) since ??= t;
    else if (since !== null) {
      if (t - since >= 0.2) best = (since + t) / 2;
      since = null;
    }
  }
  if (since !== null && b - since >= 0.2) best = (since + b) / 2;
  return best ?? (a + b) / 2;
}

/** The top-level entries a film needs: ALWAYS, plus any top-level folder or file its HTML names by relative path. */
function filmEntries(project) {
  const html = [join(project, "index.html"), ...listHtml(join(project, "compositions"))]
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const named = new Set();
  for (const m of html.matchAll(
    /(?:src|href)="(?!https?:|data:|#|\/)([^"/]+)\/?|url\(["']?(?!https?:|data:)([^"')/]+)/g,
  ))
    named.add(m[1] ?? m[2]);
  return readdirSync(project).filter(
    (e) =>
      !e.startsWith(".") &&
      !NEVER.has(e) &&
      e !== "index.html" &&
      (ALWAYS.includes(e) || named.has(e)),
  );
}
function listHtml(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .filter((f) => String(f).endsWith(".html"))
    .map((f) => join(dir, String(f)));
}

const MEDIA = /^<(video|audio|img)\b/;
// REMIX.md's Media section starts after this line; pack rewrites everything below it from moment.json.
const MEDIA_MARK = "<!-- Media: written by harvest pack from moment.json -->";
const round = (n) => Math.round(n * 1e6) / 1e6;

/** index.html of a Moment: the film's own index.html, retimed to start at `inS` and last `dur` seconds.
 * Every element the timeline places moves by -inS. One that covers none of the window's frame samples is dropped when
 * it is media or an empty composition host (its file is then not copied) and parked after the last frame otherwise;
 * one cut by an edge is trimmed (data-media-start carries the skipped part); the root's GSAP timeline is played from
 * `inS` through a wrapper registered in its place. Retimed rather than nested, because a renderer reads a nested
 * composition's videos without its host's data-media-start. Returns the html and the relative paths only the dropped
 * elements named. */
export function retime(html, root, inS, dur) {
  const rootTag = html.match(/<[^>]*data-composition-id=[^>]*>/)[0];
  const rootId = rootTag.match(/data-composition-id="([^"]+)"/)[1];
  const dropped = [];
  // The window samples local times k/fps for k = 0 … n-1; an element is in it when it covers one of those samples.
  const frame = 1 / root.fps;
  const last = (Math.round(dur * root.fps) - 1) * frame;
  const eps = 1e-6;
  let out = html.replace(
    rootTag,
    rootTag.replace(/data-duration="[^"]*"/, `data-duration="${dur}"`),
  );
  for (const tag of html.match(/<[^>]*data-start="[^"]*"[^>]*>/g) ?? []) {
    if (tag === rootTag) continue;
    const num = (n) => Number(tag.match(new RegExp(`data-${n}="([^"]*)"`))?.[1]);
    const s = num("start");
    const d = Number.isFinite(num("duration")) ? num("duration") : Infinity;
    const ns = s - inS;
    const ne = s + d - inS;
    const host = /data-composition-src=/.test(tag);
    if (ne <= eps || ns > last + eps) {
      const name = tag.match(/^<(\w+)/)[1];
      const whole = new RegExp(`${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(</${name}>)?`);
      if (MEDIA.test(tag) || (host && whole.test(out))) {
        out = out.replace(whole, "");
        const src = tag.match(/\bsrc="([^"]+)"/)?.[1];
        if (src && !/^(https?:|data:|\/)/.test(src)) dropped.push(src);
        continue;
      }
      // Kept (it may hold children the film's script targets) but parked after the window's last frame: a clip whose
      // data-duration is 0 shows for the whole composition.
      out = out.replace(
        tag,
        tag
          .replace(/data-start="[^"]*"/, `data-start="${dur}"`)
          .replace(/data-duration="[^"]*"/, `data-duration="${round(frame)}"`),
      );
      continue;
    }
    let t = tag.replace(/data-start="[^"]*"/, `data-start="${round(Math.max(ns, 0))}"`);
    const len = round(Math.min(ne, dur) - Math.max(ns, 0));
    if (Number.isFinite(d) || ns < 0)
      t = /data-duration=/.test(t)
        ? t.replace(/data-duration="[^"]*"/, `data-duration="${Math.max(len, 0)}"`)
        : t.replace(/data-start=/, `data-duration="${Math.max(len, 0)}" data-start=`);
    if (ns < 0 && (MEDIA.test(tag) || host)) {
      const ms = round((num("media-start") || 0) - ns);
      t = /data-media-start=/.test(t)
        ? t.replace(/data-media-start="[^"]*"/, `data-media-start="${ms}"`)
        : t.replace(/data-start=/, `data-media-start="${ms}" data-start=`);
    }
    out = out.replace(tag, t);
  }
  // Runs before the film's own scripts: whatever they register as the root's timeline is wrapped to play from inS.
  const shift = `<script>
      // Moment window: the film's timeline from ${inS} s for ${dur} s (moment-harvest).
      (function () {
        var tls = (window.__timelines = window.__timelines || {}), real;
        Object.defineProperty(tls, ${JSON.stringify(rootId)}, {
          configurable: true, enumerable: true,
          get: function () { return real; },
          set: function (tl) {
            tl.pause();
            real = gsap.timeline({ paused: true });
            real.add(tl.tweenFromTo(${inS}, ${round(inS + dur)}, { ease: "none" }), 0);
          },
        });
      })();
    </script>`;
  out = out.replace(/<head>/, `<head>\n    ${shift}`);
  return { html: out, dropped: dropped.filter((src) => !out.includes(src)) };
}

const VOID = new Set([
  "img",
  "br",
  "hr",
  "input",
  "meta",
  "link",
  "source",
  "track",
  "wbr",
  "area",
  "base",
  "col",
  "embed",
  "param",
]);

/** Every footage, image or audio file a retimed Moment plays, with the interval it plays in. An untimed media tag
 * plays when its nearest timed ancestor does (a Desktop cutout is a timed <div> around an untimed <img>), and one with
 * no timed ancestor plays for the whole window; one that covers none of the window's frame samples is left out.
 * Reads index.html only: media inside a nested composition's own file is not listed. */
export function mediaCensus(html, root, dur) {
  const eps = 1e-6;
  const last = (Math.round(dur * root.fps) - 1) / root.fps;
  const body = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  /** @type {{ name: string, from: number, to: number, id: string }[]} */
  const stack = [{ name: "", from: 0, to: dur, id: "" }];
  const found = [];
  for (const [tag, close, rawName] of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*>/g)) {
    const name = rawName.toLowerCase();
    if (close) {
      const at = stack.findLastIndex((e) => e.name === name);
      if (at > 0) stack.length = at;
      continue;
    }
    const parent = stack[stack.length - 1];
    const start = Number(tag.match(/data-start="([^"]*)"/)?.[1]);
    const length = Number(tag.match(/data-duration="([^"]*)"/)?.[1]);
    const from = Number.isFinite(start) ? start : parent.from;
    const to = Number.isFinite(start)
      ? Number.isFinite(length)
        ? start + length
        : parent.to
      : parent.to;
    const id = tag.match(/\sid="([^"]+)"/)?.[1] ?? "";
    const src = tag.match(/\ssrc="([^"]+)"/)?.[1];
    if (
      /^(video|audio|img)$/.test(name) &&
      src &&
      !/^(https?:|data:)/.test(src) &&
      to > eps &&
      from <= last + eps
    ) {
      const a = Math.max(from, 0);
      found.push({
        id: id || `${parent.id || "root"} ${name}`,
        kind: name === "img" ? "image" : name,
        file: src,
        start_s: round(a),
        duration_s: round(Math.min(to, dur) - a),
      });
    }
    if (!VOID.has(name) && !tag.endsWith("/>")) stack.push({ name, from, to, id: id || parent.id });
  }
  return found;
}

/** What the project already records about its media, by relative path: media-use's `.media/manifest.jsonl` (the
 * last record for a path wins; it carries the generator and its prompts) and a Viral Clone's `work/plan.json` shots
 * (the source video and time each clip was cut from). */
export function provenance(project) {
  const known = new Map();
  const plan = join(project, "work", "plan.json");
  if (existsSync(plan))
    for (const shot of JSON.parse(readFileSync(plan, "utf8")).shots ?? [])
      if (shot.file && shot.source)
        known.set(shot.file, {
          origin: "footage",
          source: `${shot.source} at ${shot.ss ?? 0} s for ${shot.srcdur ?? "?"} s`,
          what: shot.label ?? "",
        });
  const ledger = join(project, ".media", "manifest.jsonl");
  if (existsSync(ledger))
    for (const line of readFileSync(ledger, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(line);
      const prompts = r.provenance?.prompts;
      const prompt = Array.isArray(prompts)
        ? prompts.join(" / ")
        : typeof prompts === "string"
          ? prompts
          : "";
      known.set(r.path, {
        origin: prompt ? "generated" : r.source || "unknown",
        source: [
          r.provenance?.provider,
          r.provenance?.model,
          r.provenance?.parentOf && `from ${r.provenance.parentOf}`,
        ]
          .filter(Boolean)
          .join(" · "),
        what: r.description ?? "",
        ...(prompt ? { prompt } : {}),
      });
    }
  return known;
}

/** One row per media file a Moment plays: where it sits, what the project records about it, and what to swap in.
 * `what` and `prompt` stay TODO for the agent when the project has no record of them. */
export function mediaRows(kept, known, root) {
  const aspect = root.width === root.height ? "1:1" : root.width > root.height ? "16:9" : "9:16";
  return kept.map((m) => {
    const k = known.get(m.file) ?? known.get(m.file.replace(/^\.\//, "")) ?? {};
    const secs = Math.round(m.duration_s * 10) / 10;
    const swap =
      m.kind === "audio"
        ? `audio, about ${secs} s`
        : `${m.kind === "image" ? "an image" : "footage"}, ${aspect}, about ${secs} s on screen`;
    return {
      ...m,
      origin: k.origin ?? "unknown",
      source: k.source ?? "",
      what: k.what || "TODO",
      prompt: k.prompt ?? "TODO",
      swap,
    };
  });
}

/** REMIX.md's Media section, written from moment.json so the two never disagree. */
export function mediaSection(media) {
  if (!media.length)
    return "## Media\nNo footage, images or audio: everything on screen is code.\n";
  const cell = (v) => String(v).replace(/\|/g, "·").replace(/\n/g, " ");
  const rows = media.map(
    (m) =>
      `| \`#${cell(m.id)}\` | \`${cell(m.file)}\` | ${m.start_s.toFixed(2)}–${(m.start_s + m.duration_s).toFixed(2)} s | ${cell(m.origin)}${m.source ? ` (${cell(m.source)})` : ""} | ${cell(m.what)} | ${cell(m.swap)} | ${cell(m.prompt)} |`,
  );
  return `## Media\n| element | file | at | origin | what | swap for | prompt to generate it |\n|---|---|---|---|---|---|---|\n${rows.join("\n")}\n`;
}

/** The file under `code` that a dropped element's relative `src` names, or null when it would leave `code`: by `..`, an
 * absolute path, or a symlink anywhere on the way (its real folder must still be inside `code`'s real folder). */
export function pruneTarget(code, src) {
  const base = resolve(code);
  const file = resolve(base, src);
  if (
    src.includes("..") ||
    file === base ||
    !file.startsWith(base + sep) ||
    !existsSync(dirname(file))
  )
    return null;
  const realBase = realpathSync(base);
  const realDir = realpathSync(dirname(file));
  if (realDir !== realBase && !realDir.startsWith(realBase + sep)) return null;
  return existsSync(file) && lstatSync(file).isSymbolicLink() ? null : file;
}

/** Every generated Moment folder in `out` (M01 … M99, M100 …), in order. */
export function momentIds(out) {
  if (!existsSync(out)) return [];
  return readdirSync(out)
    .filter((d) => /^M\d{2,}$/.test(d))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

/** Removes every generated Moment folder in `out`, so a cut with fewer windows leaves none behind. */
export function clearMoments(out) {
  for (const id of momentIds(out)) rmSync(join(out, id), { recursive: true, force: true });
}

/** The colours a film declares, most used first (for REMIX.md's table). */
export function colours(html) {
  const n = {};
  for (const m of html.matchAll(/#[0-9a-fA-F]{6}\b/g))
    n[m[0].toUpperCase()] = (n[m[0].toUpperCase()] ?? 0) + 1;
  return Object.entries(n)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([c]) => c);
}

function remix(id, root, inS, dur, html) {
  return `**Start here:** this \`code/\` folder is a finished HyperFrames composition: the film's own \`index.html\`, retimed to play its ${inS}–${round(inS + dur)} s window as 0–${dur} s (the script at the top of \`<head>\` plays the film's timeline from ${inS} s). Copy the folder into your project as the starting point (keep \`assets/\` and \`compositions/\` beside \`index.html\`), then change text, images and colours. Times inside the film's own script are film times: an animation at 9 s plays at ${round(9 - inS)} s here.

# ${id} · TODO name — remix guide
${dur} s · ${root.fps} fps · ${root.width}x${root.height}
Signature: TODO one sentence: what moves, on which axis, over how long, and what it reveals.
## Text on screen in this window
TODO the words the viewer reads, and the element id or selector that holds each in index.html.
## Colours
| colour | role |
|---|---|
${colours(html)
  .map((c) => `| ${c} | TODO |`)
  .join("\n")}
`;
}

function dense(id, root, inS, outS, project) {
  return `# ${id} · TODO name
Source: ${root.width}x${root.height}, ${root.fps} fps, ${Math.round((outS - inS) * 1000) / 1000} s, cut from "${basename(project)}" at ${inS}–${outS} s.

## Brief
Storyline: TODO what happens, in order, in 2-4 sentences.
Look: TODO ground, palette, type.
Motion rules: TODO how things move (easing, speed, cuts).
`;
}

function sh(cmd, args) {
  const r = spawnSync(...cliCall(cmd, args, { encoding: "utf8", maxBuffer: 1 << 26 }));
  if (r.status !== 0)
    throw new Error(
      `${basename(cmd)} ${args.slice(0, 3).join(" ")}: ${(r.stderr || r.stdout).slice(-400)}`,
    );
  return r.stdout;
}

function cut() {
  const html = readFileSync(join(PROJECT, "index.html"), "utf8");
  const root = rootOf(html);
  const work = join(OUT, ".work");
  mkdirSync(work, { recursive: true });
  const video = flag("video") ? resolve(flag("video")) : join(work, "film.mp4");
  if (!flag("video")) sh("hyperframes", ["render", PROJECT, "-o", video, "--quiet"]);
  const scores = sceneScores(video);
  const opts = {
    min: Number(flag("min", 1.5)),
    target: Number(flag("target", 4)),
    max: Number(flag("max", 8)),
  };
  // Windows start and end on the film's frame grid: one starting between two frames renders every cut a frame late.
  const onGrid = (t) => Math.round((Math.round(t * root.fps) / root.fps) * 1e6) / 1e6;
  const wins = windows(
    root.duration,
    candidates(scores, timelineCuts(html, root.duration)),
    opts,
  ).map(([a, b]) => [onGrid(a), b === root.duration ? b : onGrid(b)]);
  const entries = filmEntries(PROJECT);
  const known = provenance(PROJECT);
  clearMoments(OUT);
  const made = wins.map(([a, b], i) => {
    const id = `M${String(i + 1).padStart(2, "0")}`;
    const dir = join(OUT, id);
    const dur = Math.round((b - a) * 1e6) / 1e6;
    mkdirSync(join(dir, "code"), { recursive: true });
    sh(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-ss",
      String(a),
      "-i",
      video,
      "-t",
      String(dur),
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      join(dir, "clip.mp4"),
    ]);
    sh(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-ss",
      String(stillAt(scores, [a, b])),
      "-i",
      video,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      join(dir, "still.jpg"),
    ]);
    // Six frames across the window, for the agent to read before it names the Moment (not shipped in the bundle).
    sh(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-ss",
      String(a),
      "-t",
      String(dur),
      "-i",
      video,
      "-vf",
      `fps=6/${dur},scale=320:-2,tile=6x1`,
      "-frames:v",
      "1",
      join(work, `${id}-sheet.jpg`),
    ]);
    // Dereferenced: a Moment holds real files, never a link back into the project (or wherever it points).
    for (const e of entries)
      cpSync(join(PROJECT, e), join(dir, "code", e), { recursive: true, dereference: true });
    const moment = retime(html, root, a, dur);
    writeFileSync(join(dir, "code", "index.html"), moment.html);
    for (const src of moment.dropped) {
      const file = pruneTarget(join(dir, "code"), src);
      if (file) rmSync(file, { force: true });
    }
    writeFileSync(
      join(dir, "code", "REMIX.md"),
      `${remix(id, root, a, dur, html)}\n${MEDIA_MARK}\n`,
    );
    writeFileSync(join(dir, "dense.md"), dense(id, root, a, b, PROJECT));
    const role = i === 0 ? "hook" : i === wins.length - 1 && wins.length > 1 ? "cta" : "proof";
    const row = {
      id,
      name: "TODO",
      role,
      why: "TODO",
      mechanic: [],
      duration_s: dur,
      start_s: a,
      end_s: b,
      fps: root.fps,
      width: root.width,
      height: root.height,
      film: basename(PROJECT),
      clip: "clip.mp4",
      still: "still.jpg",
      media: mediaRows(mediaCensus(moment.html, root, dur), known, root),
      bundle: null,
    };
    writeFileSync(join(dir, "moment.json"), JSON.stringify(row, null, 2) + "\n");
    return row;
  });
  writeFileSync(
    join(OUT, "moments.json"),
    JSON.stringify(
      {
        film: basename(PROJECT),
        duration_s: root.duration,
        moments: made.map(({ id, start_s, end_s, role }) => ({ id, start_s, end_s, role })),
      },
      null,
      2,
    ) + "\n",
  );
  if (flag("json") !== undefined || argv.includes("--json")) console.log(JSON.stringify(made));
  else
    for (const m of made)
      console.log(
        `${m.id}  ${m.start_s.toFixed(2)}–${m.end_s.toFixed(2)} s  (${m.duration_s.toFixed(2)} s)  ${m.role}  moments/.work/${m.id}-sheet.jpg`,
      );
}

async function sha256(file) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}

async function pack() {
  if (!existsSync(OUT)) die(`no moments/ in ${PROJECT}: run cut first`);
  const ids = momentIds(OUT);
  const todo = [];
  for (const id of ids) {
    const dir = join(OUT, id);
    for (const f of ["moment.json", "dense.md", join("code", "REMIX.md")])
      if (readFileSync(join(dir, f), "utf8").includes("TODO")) todo.push(`${id}/${f}`);
    const row = JSON.parse(readFileSync(join(dir, "moment.json"), "utf8"));
    if (!ROLES.includes(row.role))
      todo.push(`${id}/moment.json role "${row.role}" is not one of ${ROLES.join(", ")}`);
  }
  if (todo.length) die(`fill these first:\n  ${todo.join("\n  ")}`);
  for (const id of ids) {
    const dir = join(OUT, id);
    const remixFile = join(dir, "code", "REMIX.md");
    const media = mediaSection(
      JSON.parse(readFileSync(join(dir, "moment.json"), "utf8")).media ?? [],
    );
    const remixText = readFileSync(remixFile, "utf8");
    writeFileSync(
      remixFile,
      remixText.slice(0, remixText.indexOf(MEDIA_MARK) + MEDIA_MARK.length) + "\n" + media,
    );
    const file = join(dir, "bundle.tar.gz");
    // Inside `dir`, so tar gets no backslash path from join, which Git Bash's GNU tar can't open.
    execFileSync("tar", ["-czf", "bundle.tar.gz", "dense.md", "code"], { cwd: dir });
    const row = JSON.parse(readFileSync(join(dir, "moment.json"), "utf8"));
    const digest = await sha256(file);
    row.bundle = {
      key: `${id}/${digest}/bundle.tar.gz`,
      sha256: digest,
      bytes: statSync(file).size,
    };
    writeFileSync(join(dir, "moment.json"), JSON.stringify(row, null, 2) + "\n");
    console.log(`${id}  bundle ${(row.bundle.bytes / 1e6).toFixed(1)} MB  ${digest.slice(0, 12)}`);
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  try {
    if (CMD === "cut") cut();
    else if (CMD === "pack") await pack();
    else die("usage: harvest cut|pack --project <dir>");
  } catch (e) {
    die(e.message);
  }
}
