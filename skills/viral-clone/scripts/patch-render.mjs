#!/usr/bin/env node
// After v0, a fix re-renders only the seconds it touches: the whole film nests in a page that starts its timeline at
// the span, and those frames replace v0's. On Cindy's v3 a nested 10-12 s render matched the full render frame for
// frame (SSIM 0.994; one frame late, 0.980). v0's sound is kept: a truncated clip would fade out at the span's end.
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ffmpegBin, ffprobeBin, hyperframes } from "./media.mjs";

const USAGE = `usage: node patch-render.mjs PROJECT renders/v0.mp4 --spans 9.5-15.3,25.9-30.8 --out renders/final.mp4
       Re-renders each span (seconds, snapped out to whole frames) of PROJECT/index.html and splices it into v0.
       --page FILE: another page of PROJECT than index.html; --quality: the render's (default its default). --out may
       be v0 itself.
       node patch-render.mjs --selftest`;
const MAIN = ".patch-main.html";
const SPAN = ".patch-span.html";
// Exit code for a film that does not render nested: `vc film --patch` renders the whole film instead.
export const NOT_NESTABLE = 3;

/** "9.5-15.3,25.9-30.8" as frame ranges [first, end) at `fps`, sorted, merged, inside the film.
 * @param {string} text @param {number} fps @param {number} frames */
export function spans(text, fps, frames) {
  const ranges = text.split(",").map((s) => {
    const [a, b] = s.split("-").map(Number);
    if (!(Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > a))
      throw new Error(`--spans takes start-end seconds, e.g. 9.5-15.3; got "${s}"`);
    return [Math.floor(a * fps + 1e-6), Math.min(frames, Math.ceil(b * fps - 1e-6))];
  });
  const merged = [];
  for (const r of ranges.sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else if (r[1] > r[0]) merged.push([...r]);
  }
  return merged;
}

// What this check cannot read, so a film using it renders whole: a stylesheet it would have to fetch, a script that
// styles the document, and sub-compositions, which went black nested on a b438 film with nothing to tell it apart.
const UNREAD = /** @type {[RegExp, string][]} */ ([
  [/\bdata-composition-src\s*=/i, "it plays sub-compositions"],
  [/<link\b[^>]*\bstylesheet\b/i, "it links a stylesheet"],
  [/@import\b/i, "its CSS imports a stylesheet"],
  [
    /document\.(body|documentElement)\b|querySelector(All)?\(\s*["'`](html|body|:root)\b/,
    "a script reaches the document",
  ],
]);

/** The first rule in `css` that hangs on the document (`body.dark .caption`); bare `html`, `body` and `:root` rules
 * are remapped to the composition's box when nested, so they are fine. @param {string} css */
function documentRule(css) {
  const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].flatMap(
    ([, s]) => s.split(",").map((x) => x.trim()),
  );
  return selectors.find(
    (s) =>
      !s.startsWith("@") &&
      !/^(html|body|:root)$/i.test(s) &&
      /(^|[\s>+~(])(html|body|:root)(?![\w-])/i.test(s),
  );
}

/** The attributes on the film's own <html> and <body>, by tag. @param {string} html
 * @returns {Record<"html" | "body", Record<string, string>>} */
export function docAttrs(html) {
  const of = (/** @type {string} */ tag) =>
    Object.fromEntries(
      [
        ...(html.match(new RegExp(`<${tag}(\\s[^>]*)>`, "i"))?.[1] ?? "").matchAll(
          /([^\s=/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g,
        ),
      ].map(([, name, value = ""]) => [name.toLowerCase(), value.replace(/^["']|["']$/g, "")]),
    );
  return { html: of("html"), body: of("body") };
}

// Inherited, so the span page passes them down by carrying them; any other document attribute is lost when nested.
const CARRIED = ["lang", "dir"];

/** Why `html` cannot nest, or "": nested, its CSS is scoped under the host, so a rule that hangs on the document
 * (`body.dark .caption`, `:root .x`, `html[lang] p`) or a style on <html> or <body> no longer applies, and what this
 * cannot read is taken to do the same. @param {string} html */
export function cannotNest(html) {
  const unread = UNREAD.find(([pattern]) => pattern.test(html));
  if (unread) return unread[1];
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const rule = documentRule(css);
  if (rule) return `its CSS hangs on the document: ${rule}`;
  const lost = Object.entries(docAttrs(html)).flatMap(([tag, attrs]) =>
    Object.keys(attrs)
      .filter((name) => !CARRIED.includes(name))
      .map((name) => `its <${tag}> carries ${name}`),
  );
  return lost[0] ?? "";
}

/** index.html as a sub-composition: its head and body inside a template. @param {string} html */
export function nested(html) {
  const head = (html.match(/<head[^>]*>([\s\S]*)<\/head>/i)?.[1] ?? "").replace(
    /<meta[^>]*>|<title>[\s\S]*?<\/title>/gi,
    "",
  );
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1];
  if (!body) throw new Error("index.html has no <body>");
  return `<template id="patch-main-template">${head}${body}</template>`;
}

/** The page that plays the film from `start` for `seconds`, with the film's `lang` and `dir` on its <html>. */
export function spanPage({ id, width, height, start, seconds, carried = {} }) {
  const attrs = Object.entries(carried)
    .map(([name, value]) => ` ${name}="${String(value).replace(/"/g, "&quot;")}"`)
    .join("");
  return `<!doctype html><html${attrs}><head><meta charset="utf-8"><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#000}</style></head><body>
<div id="root" data-composition-id="patch" data-start="0" data-duration="${seconds}" data-width="${width}" data-height="${height}">
<div id="patch-film" data-composition-id="${id}" data-composition-src="${MAIN}" data-start="0" data-playback-start="${start}" data-duration="${seconds}" data-track-index="0" data-width="${width}" data-height="${height}"></div>
</div><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>window.__timelines["patch"]=gsap.timeline({paused:true}).to({},{duration:${seconds}});</script></body></html>`;
}

/** ffmpeg's filter that cuts v0 around the patches and joins them in order. @param {number[][]} ranges frame ranges
 * @param {number} frames v0's frame count */
export function spliceFilter(ranges, frames) {
  const pieces = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) pieces.push({ keep: [at, a] });
    pieces.push({ patch: i + 1 });
    at = b;
  });
  if (at < frames) pieces.push({ keep: [at, frames] });
  const keeps = pieces.filter((p) => p.keep).length;
  const chains = keeps
    ? [`[0:v]split=${keeps}${Array.from({ length: keeps }, (_, j) => `[s${j}]`).join("")}`]
    : [];
  let k = 0;
  pieces.forEach((p, j) =>
    chains.push(
      p.patch
        ? `[${p.patch}:v]setpts=PTS-STARTPTS[c${j}]`
        : `[s${k++}]trim=start_frame=${p.keep[0]}:end_frame=${p.keep[1]},setpts=PTS-STARTPTS[c${j}]`,
    ),
  );
  const labels = pieces.map((_, j) => `[c${j}]`).join("");
  return `${chains.join(";")};${labels}concat=n=${pieces.length}:v=1:a=0[v]`;
}

/** Writes v0 with each range replaced by its patch, at v0's frame rate (ffmpeg's filter output otherwise falls to
 * 25 fps), with v0's sound. @param {{ v0: string, patches: string[], ranges: number[][], frames: number,
 * rate: string, out: string }} p */
export function splice({ v0, patches, ranges, frames, rate, out }) {
  execFileSync(ffmpegBin(), [
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-i",
    v0,
    ...patches.flatMap((p) => ["-i", p]),
    "-filter_complex",
    spliceFilter(ranges, frames),
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:a",
    "copy",
    "-c:v",
    "libx264",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-r",
    rate,
    out,
  ]);
}

/** A video's frame rate as ffprobe gives it, e.g. "60/1": renders take it as --fps so every frame lines up with v0's.
 * @param {string} path */
export const rateOf = (path) =>
  execFileSync(ffprobeBin(), [
    ...["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate"],
    ...["-of", "csv=p=0", path],
  ])
    .toString()
    .trim();

const probe = (path, entries) =>
  execFileSync(ffprobeBin(), [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-count_frames",
    "-show_entries",
    entries,
    "-of",
    "csv=p=0",
    path,
  ])
    .toString()
    .trim()
    .split(",");

function main(argv) {
  if (argv[0] === "--selftest") return selftest();
  const value = (name) => argv[argv.indexOf(name) + 1];
  const [project, v0] = argv.filter(
    (a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"),
  );
  const out = argv.includes("--out") ? value("--out") : "";
  if (!project || !v0 || !out || !argv.includes("--spans")) {
    console.error(USAGE);
    process.exit(2);
  }
  const page = argv.includes("--page") ? value("--page") : "index.html";
  // The scratch pages are written and deleted in PROJECT, so neither may be the page or an existing file.
  const taken = [MAIN, SPAN].filter((s) => basename(page) === s || existsSync(join(project, s)));
  if (taken.length) {
    console.error(
      `${taken.join(", ")} in ${project} is the page or already exists; rename or move it first`,
    );
    process.exit(2);
  }
  const index = readFileSync(join(project, page), "utf8");
  const why = cannotNest(index);
  if (why) {
    console.error(`${page} cannot render a span nested (${why}); render the whole film instead`);
    process.exit(NOT_NESTABLE);
  }
  const [width, height, rate, frameCount] = probe(
    v0,
    "stream=width,height,r_frame_rate,nb_read_frames",
  );
  const [num, den] = rate.split("/").map(Number);
  const fps = num / (den || 1);
  const frames = Number(frameCount);
  const ranges = spans(value("--spans"), fps, frames);
  const quality = argv.includes("--quality") ? ["--quality", value("--quality")] : [];
  const id = index.match(/id="root"[^>]*data-composition-id="([^"]+)"/)?.[1] ?? "main";
  const dir = mkdtempSync(join(tmpdir(), "patch-"));
  writeFileSync(join(project, MAIN), nested(index));
  const { html: htmlAttrs, body: bodyAttrs } = docAttrs(index);
  const carried = Object.fromEntries(
    CARRIED.filter((n) => (bodyAttrs[n] ?? htmlAttrs[n]) !== undefined).map((n) => [
      n,
      bodyAttrs[n] ?? htmlAttrs[n],
    ]),
  );
  const patches = [];
  const spliced = resolve(out) === resolve(v0) ? join(dir, "spliced.mp4") : out;
  try {
    for (const [i, [a, b]] of ranges.entries()) {
      writeFileSync(
        join(project, SPAN),
        spanPage({ id, width, height, start: a / fps, seconds: (b - a) / fps, carried }),
      );
      const mp4 = join(dir, `patch-${i}.mp4`);
      const command = hyperframes([
        "render",
        project,
        "-c",
        SPAN,
        "-o",
        mp4,
        ...["--fps", rate],
        ...quality,
      ]);
      const render = spawnSync(command.file, command.args, {
        shell: command.shell,
        encoding: "utf8",
        maxBuffer: 1 << 26,
      });
      if (render.status !== 0) {
        console.error(
          `render of ${a / fps}-${b / fps} s failed nested; render the whole film instead:`,
        );
        console.error(String(render.stderr).slice(-2000));
        process.exitCode = NOT_NESTABLE;
        return;
      }
      const got = Number(probe(mp4, "stream=nb_read_frames")[0]);
      if (got !== b - a)
        throw new Error(`span ${a / fps}-${b / fps} s rendered ${got} frames, not ${b - a}`);
      patches.push(mp4);
    }
  } finally {
    rmSync(join(project, MAIN), { force: true });
    rmSync(join(project, SPAN), { force: true });
  }
  splice({ v0, patches, ranges, frames, rate, out: spliced });
  if (spliced !== out) copyFileSync(spliced, out);
  const made = Number(probe(out, "stream=nb_read_frames")[0]);
  console.log(
    JSON.stringify({
      out,
      spans: ranges.map(([a, b]) => [a / fps, b / fps]),
      frames: made,
      v0_frames: frames,
    }),
  );
  if (made !== frames) {
    console.error(`the patched film has ${made} frames, v0 has ${frames}`);
    process.exit(1);
  }
}

function selftest() {
  const check = (ok, what) => {
    if (!ok) throw new Error(`selftest failed: ${what}`);
  };
  check(JSON.stringify(spans("10-12", 30, 1118)) === "[[300,360]]", "a span snaps to whole frames");
  check(
    JSON.stringify(spans("25-30,9.5-15.3,14-16", 30, 1118)) === "[[285,480],[750,900]]",
    "spans sort and merge",
  );
  check(
    JSON.stringify(spans("36-40", 30, 1118)) === "[[1080,1118]]",
    "a span stops at the film's end",
  );
  const f = spliceFilter([[300, 360]], 1118);
  check(
    f.includes("trim=start_frame=0:end_frame=300") &&
      f.includes("trim=start_frame=360") &&
      f.endsWith("concat=n=3:v=1:a=0[v]"),
    "v0 is cut around the patch",
  );
  check(
    spliceFilter([[0, 1118]], 1118).endsWith(";[c0]concat=n=1:v=1:a=0[v]"),
    "a whole-film patch",
  );
  check(
    nested(
      "<html><head><title>x</title><style>a{}</style></head><body><div id=root></div></body></html>",
    ) === '<template id="patch-main-template"><style>a{}</style><div id=root></div></template>',
    "index.html nests in a template",
  );
  check(
    cannotNest(
      "<html><head><style>body.dark .caption{color:#fff}</style></head><body class=dark></body></html>",
    ) !== "" &&
      cannotNest('<html><body style="background:red"></body></html>') !== "" &&
      cannotNest(
        "<html><head><style>body,html{margin:0}:root{--a:1}.bodytext{}</style></head><body></body></html>",
      ) === "",
    "a page whose CSS hangs on the document does not nest; bare html, body and :root rules do",
  );
  console.log(JSON.stringify({ selftest: "ok" }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  main(process.argv.slice(2));
