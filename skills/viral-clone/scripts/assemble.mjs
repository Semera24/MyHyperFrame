// `vc assemble`: one timeline of person takes, template pieces placed on words, captions and audio, written as a
// HyperFrames project (index.html, compositions/), so no run writes a film builder of its own. It records every overlay
// as placed (time, box in canvas pixels, the take's face box) in .viral-clone/work/assembled.json for `vc review`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { captionsPage, groupWords } from "./assemble-captions.mjs";
import { ffmpegBin, round } from "./media.mjs";
import { Fix, loadWords, parseTool, probe } from "./tool.mjs";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";
const ASSEMBLED = join(".viral-clone", "work", "assembled.json");
const TRACK = { take: 0, overlay: 1, captions: 2, voice: 3, music: 4, sfx: 5 };

const USAGE = `usage: node scripts/vc.mjs assemble TIMELINE.json [--out .]
Writes the film as a HyperFrames project in --out, the project folder (every timeline path is relative to it):
index.html (takes on track 0, a host per overlay, captions, audio); compositions/ (the template's components and
captions.html, rewritten each run: edit the template's, never the copy); the files the components name (fonts,
images, lib/*.js) at the same paths, when the project lacks them ("missing" lists any neither has);
${ASSEMBLED}: each overlay's start, end, canvas box and the face box under it (vc review).
TIMELINE.json:
{
  "template": "templates/cindy",                         template.json: canvas, vocabulary, captions
  "canvas": {"width": 1080, "height": 1920, "fps": 30},  default: the template's canvas
  "words": "assets/voice/vo.words.json",                 composition-time words (after voice tighten)
  "takes": [{"src": "assets/takes/t1.mp4", "at": 0, "in": 0.4, "out": 5.2,
             "retime": "0.4:5.2=0:4.6",   retime.mjs --map: plays assets/takes/t1-retimed-<hash>.mp4 whole (in/out unused)
             "face": [x, y, w, h],        its face box, canvas pixels or face-size's shares, for face anchors
             "zoom": [1, 1.035]}],        a slow push across the take
  "overlays": [{"type": "step title",     a vocabulary type's name
                "at": {"word": 12, "offset": -0.05} | 3.4 | {"text": "step one", "nth": 2},
                "until": {"word": 15} | "duration": 1.2,
                "vars": {"text": "Step 1"}}],   over the type's preset and the computed layout
  "captions": true | false | {"component": "components/vc-captions.html"},
  "audio": [{"src": "assets/voice/vo.wav", "kind": "voice"},
            {"src": "assets/music/bed.wav", "kind": "music", "volume": 0.25, "fade_out": 0.8},
            {"src": "assets/sfx/whoosh.wav", "kind": "sfx", "at": {"word": 3}, "volume": 0.5}]
}
Word refs: {"word": i} is the i-th word, 0-based; {"text", "nth"} the nth occurrence (1 = the first), case and
punctuation ignored, several words allowed. "at" is the word's start, "until" its end, "offset" seconds added.
A take's "at" defaults to the previous take's end and it plays to "out" or its file's end; a voice track mutes takes.
The film ends at the last take, overlay, voice or word; music and effects are cut there.
Layout: a face-anchored type centres its box on the face of the take playing at its start + (dx, dy) face sizes,
scaled by the take's face width over anchor.face_w (reference pixels) when scale_with_face; other types keep the
template box, scaled to the canvas. The box goes into the component's layout variables x, y, w, h (top-left and size)
and cx, cy (centre), in the component's design pixels (its root's data-width); each overlay gets its own copy, its
root sized to the canvas, so a block draws in cqw. A declared "dur" gets the overlay's length.
Captions: generated from template.json's captions (grouping, case, font, size, color, x and y as the line's centre,
entry) unless a captions component is named (in the timeline, else the template), which gets the words as "words".`;
const EXAMPLE = "node scripts/vc.mjs assemble .viral-clone/work/timeline.json --out .";

/** @typedef {{text: string, start: number, end: number}} Word */
/** @typedef {{id: string, tag: string, width: number, height: number, vars: {id: string, role?: string}[]}} Block */

/** "a:b=c:d,..." as the length of the reference spans, which is how long the retimed file plays. @param {string} map */
const mapTotal = (map) =>
  round(
    map.split(",").reduce((sum, piece) => {
      const [rin, rout] = piece.split("=")[1]?.split(":").map(Number) ?? [];
      if (!(rout > rin)) throw new Fix(`bad retime piece "${piece}"`, '"retime": "0.4:5.2=0:4.6"');
      return sum + rout - rin;
    }, 0),
  );

/** A take with "retime" plays its derived file from the start for the map's total; the file is named by source and
 * map, so two retimes of one take never write one file. @param {any} take */
export function retimed(take) {
  if (!take.retime) return take;
  const name = basename(take.src, extname(take.src));
  const hash = createHash("sha1").update(`${take.src}\n${take.retime}`).digest("hex").slice(0, 8);
  return {
    ...take,
    src: posix.join("assets", "takes", `${name}-retimed-${hash}.mp4`),
    retimed_from: take.src,
    in: 0,
    out: mapTotal(take.retime),
  };
}

/** name, else name-2, name-3...: the first no earlier instance took, ignoring case, since macOS and Windows file
 * systems do. @param {Set<string>} used lower-cased @param {string} name */
function unused(used, name) {
  let k = 1;
  let pick = name;
  while (used.has(pick.toLowerCase())) pick = `${name}-${++k}`;
  used.add(pick.toLowerCase());
  return pick;
}

const norm = (/** @type {string} */ s) =>
  String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** A time in seconds, or a word ref's start ("at") or end ("until"), plus its offset.
 * @param {any} ref @param {Word[]} words @param {"start" | "end"} edge @param {string} what */
export function wordTime(ref, words, edge, what) {
  if (typeof ref === "number") return ref;
  if (!ref || typeof ref !== "object")
    throw new Fix(
      `${what} must be seconds or a word ref, got ${JSON.stringify(ref)}`,
      '{"word": 12}',
    );
  if (!words.length)
    throw new Fix(
      `${what} names a word but the timeline has no words`,
      '"words": "assets/voice/vo.words.json"',
    );
  let first = -1;
  let last = -1;
  if (Number.isInteger(ref.word)) {
    if (ref.word < 0 || ref.word >= words.length)
      throw new Fix(
        `${what}: word ${ref.word} is past the end: the words file has ${words.length} words`,
        `use a word index from 0 to ${words.length - 1}`,
      );
    first = last = ref.word;
  } else if (typeof ref.text === "string") {
    const want = ref.text.split(/\s+/).map(norm).filter(Boolean);
    const hits = [];
    for (let i = 0; i + want.length <= words.length; i++)
      if (want.length && want.every((t, k) => norm(words[i + k].text) === t)) hits.push(i);
    const nth = ref.nth ?? 1;
    if (hits[nth - 1] === undefined)
      throw new Fix(
        `${what}: "${ref.text}" occurs ${hits.length} times in the words` +
          (hits.length ? ` (at ${hits.map((i) => words[i].start).join(", ")} s), not ${nth}` : ""),
        hits.length
          ? `"nth" from 1 to ${hits.length}`
          : 'match a word the words file holds, or use {"word": i}',
      );
    first = hits[nth - 1];
    last = first + want.length - 1;
  } else
    throw new Fix(
      `${what} names neither "word" nor "text"`,
      '{"word": 12} or {"text": "step", "nth": 2}',
    );
  return (edge === "start" ? words[first].start : words[last].end) + (ref.offset ?? 0);
}

const entity = (/** @type {string} */ s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** A component's composition id, design size and declared variables. @param {string} html @param {string} file */
export function blockOf(html, file) {
  const root = /<[a-z]+\b[^>]*\bdata-composition-id\s*=\s*["']([^"']+)["'][^>]*>/i.exec(html);
  if (!root)
    throw new Fix(
      `${file} has no element with data-composition-id`,
      "build it as a HyperFrames block",
    );
  const size = (/** @type {string} */ name) =>
    Number(new RegExp(`\\bdata-${name}\\s*=\\s*["']?(\\d+)`).exec(root[0])?.[1]) || 0;
  const declared = /data-composition-variables\s*=\s*(['"])([\s\S]*?)\1/.exec(html);
  return {
    id: root[1],
    tag: root[0],
    width: size("width"),
    height: size("height"),
    vars: declared ? JSON.parse(entity(declared[2])) : [],
  };
}

/** The template box on this canvas: kept for frame anchors, centred on the take's face for face anchors.
 * @param {any} type @param {{sx: number, sy: number}} scale @param {number[] | undefined} face @param {string} what */
export function placeBox(type, { sx, sy }, face, what) {
  const b = type.box;
  if (!b) return null;
  const box = { x: b.x * sx, y: b.y * sy, w: b.w * sx, h: b.h * sy };
  const a = type.anchor;
  if (a?.to !== "face") return box;
  if (!face)
    throw new Fix(
      `${what} is anchored to the face, but no take with a face box plays then`,
      'give that take "face": [x, y, w, h] in canvas pixels (hf-media evidence face-size)',
    );
  const [fx, fy, fw, fh] = face;
  let k = 1;
  if (a.scale_with_face) {
    if (!(a.face_w > 0))
      throw new Fix(
        `${what} scales with the face, but its anchor has no face_w`,
        "add anchor.face_w: the reference's face box width in reference pixels",
      );
    k = fw / (a.face_w * sx);
  }
  const [w, h] = [box.w * k, box.h * k];
  const [cx, cy] = [fx + fw / 2 + (a.dx ?? 0) * fw, fy + fh / 2 + (a.dy ?? 0) * fh];
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** The box as the component's layout variables, in its own design pixels.
 * @param {Block} block @param {{x: number, y: number, w: number, h: number}} box
 * @param {{width: number, height: number}} canvas */
function layoutVars(block, box, canvas) {
  const kx = block.width / canvas.width;
  const ky = block.height / canvas.height;
  const all = {
    x: box.x * kx,
    y: box.y * ky,
    w: box.w * kx,
    h: box.h * ky,
    cx: (box.x + box.w / 2) * kx,
    cy: (box.y + box.h / 2) * ky,
  };
  return Object.fromEntries(
    block.vars
      .filter((v) => v.role === "layout" && v.id in all)
      .map((v) => [v.id, round(all[/** @type {keyof typeof all} */ (v.id)], 1)]),
  );
}

/** Refuses a variable the component does not declare: it would be ignored and the piece keep its default.
 * @param {Record<string, any>} values @param {Block} block @param {string} file @param {string} what */
function declaredOnly(values, block, file, what) {
  const ids = block.vars.map((v) => v.id);
  const unknown = Object.keys(values).filter((k) => !ids.includes(k));
  if (unknown.length)
    throw new Fix(
      `${what} sets ${unknown.join(", ")}, which ${file} does not declare`,
      `use its variables: ${ids.join(", ")}`,
    );
}

const attr = (/** @type {string} */ s) =>
  String(s).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");

/** Seconds as a frame on `fps`, written just before the frame so a cut never lands a frame late. */
const clock = (/** @type {number} */ frame, /** @type {number} */ fps) =>
  frame > 0 ? round(frame / fps - 0.002) : 0;

/** Relative paths a component names (src, href, url(), lib/*.js), which resolve against the project root.
 * @param {string} html */
export function namedFiles(html) {
  const found = new Set();
  for (const re of [
    /\b(?:src|href)\s*=\s*["']([^"']+)["']/g,
    /url\(\s*["']?([^"')]+)["']?\s*\)/g,
    /\b(lib\/[\w.-]+\.js)\b/g,
  ])
    for (const m of html.matchAll(re))
      if (!/^([a-z]+:|\/|#|data:)/i.test(m[1]) && /\.\w+$/.test(m[1])) found.add(m[1]);
  return [...found];
}

/** The project files for a timeline: pure, so the tests assemble without a render.
 * @param {any} timeline @param {{template: any, components: Record<string, string>, words?: Word[],
 *   media?: Record<string, {duration: number, audio?: boolean}>}} input */
export function assemble(timeline, { template, components, words = [], media = {} }) {
  const ref = template.canvas ?? {};
  const canvas = { ...ref, ...timeline.canvas };
  const fps = canvas.fps || 30;
  if (!(canvas.width > 0 && canvas.height > 0))
    throw new Fix(
      "no canvas size in the timeline or template.json",
      '"canvas": {"width": 1080, "height": 1920, "fps": 30}',
    );
  const scale = {
    sx: canvas.width / (ref.width || canvas.width),
    sy: canvas.height / (ref.height || canvas.height),
  };
  const frame = (/** @type {number} */ t) => Math.max(0, Math.round(t * fps));
  const length = (/** @type {string} */ src, /** @type {string} */ what) => {
    const d = media[src]?.duration;
    if (!(d > 0))
      throw new Fix(`${what}: no duration for ${src}`, `check the file exists, or give "out"`);
    return d;
  };
  const audio = (timeline.audio ?? []).map((a, i) => ({
    ...a,
    kind: a.kind ?? "sfx",
    start: wordTime(a.at ?? 0, words, "start", `audio ${i}`),
    natural: a.duration ?? length(a.src, `audio ${i}`) - (a.in ?? 0),
  }));
  const voiced = audio.some((a) => a.kind === "voice");

  let next = 0;
  const takes = (timeline.takes ?? []).map((raw, i) => {
    const take = retimed(raw);
    const start = take.at ?? next;
    const from = take.in ?? 0;
    const end = start + (take.out ?? length(take.src, `take ${i}`)) - from;
    if (!(end > start)) throw new Fix(`take ${i} ends before it starts`, '"out" after "in"');
    next = end;
    // hf-media face-size's face_boxes are shares of the frame; the layout works in canvas pixels
    const face =
      take.face && take.face.every((/** @type {number} */ v) => v <= 1)
        ? take.face.map((/** @type {number} */ v, /** @type {number} */ j) =>
            round(v * (j % 2 ? canvas.height : canvas.width), 1),
          )
        : take.face;
    return { ...take, face, id: `take-${i}`, start, end, from };
  });
  const takeAt = (/** @type {number} */ t) => takes.find((k) => k.start <= t && t < k.end);

  const types = [...(template.vocabulary ?? []), ...(template.hero_scenes ?? [])];
  /** @type {Record<string, string>} */
  const files = {};
  /** @type {Set<string>} */
  const instances = new Set();
  // the generated captions' file and id, and the root page's id, whose timeline a block must not replace
  const usedFiles = new Set(["captions"]);
  const usedIds = new Set(["main", "captions"]);
  // A copy per instance under its own id: blocks find their root by their own composition id, which the runtime
  // renames (id__hf2) when two hosts share one, so a shared file's script finds nothing.
  const blockFor = (/** @type {string} */ path, /** @type {string} */ what) => {
    const html = components[path];
    if (html === undefined)
      throw new Fix(
        `${what}: no component at ${path} in the template`,
        "build it, or fix the path",
      );
    const block = blockOf(html, path);
    instances.add(path);
    const id = unused(usedIds, block.id);
    const file = posix.join(
      "compositions",
      `${unused(usedFiles, posix.basename(path, ".html"))}.html`,
    );
    // The runtime sizes a block's root by its own data-width in pixels; blocks draw in design pixels scaled by cqw.
    const sized = block.tag
      .replace(/\bdata-width\s*=\s*["']?\d+["']?/, `data-width="${canvas.width}"`)
      .replace(/\bdata-height\s*=\s*["']?\d+["']?/, `data-height="${canvas.height}"`);
    const quoted = new RegExp(`(["'])${block.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`, "g");
    files[file] = html.replace(block.tag, sized).replace(quoted, `$1${id}$1`);
    const design = {
      width: block.width || ref.width || canvas.width,
      height: block.height || ref.height || canvas.height,
    };
    return { file, block: { ...block, ...design, id } };
  };

  const overlays = (timeline.overlays ?? []).map((o, i) => {
    const what = `overlay ${i} (${o.type})`;
    const type = types.find((t) => norm(t.name) === norm(o.type));
    if (!type)
      throw new Fix(
        `${what}: no such type in template.json`,
        `use one of: ${types.map((t) => t.name).join(", ")}`,
      );
    if (type.status === "unmeasured")
      throw new Fix(
        `${what}: "${type.name}" is unmeasured`,
        "measure and score it (G0.5) before placing it",
      );
    if (!type.component)
      throw new Fix(`${what}: "${type.name}" has no component`, "build it and set its component");
    const start = Math.max(0, wordTime(o.at, words, "start", `${what} at`));
    const end =
      o.until !== undefined
        ? wordTime(o.until, words, "end", `${what} until`)
        : start + (o.duration ?? NaN);
    if (!(end > start))
      throw new Fix(
        `${what} has no length`,
        '"until": {"word": i} after "at", or "duration": seconds',
      );
    const [f0, f1] = [frame(start), Math.max(frame(start) + 1, frame(end))];
    const { file, block } = blockFor(type.component, what);
    const take = takeAt(start);
    const box = placeBox(type, scale, take?.face, what);
    const values = { ...type.preset, ...(box && layoutVars(block, box, canvas)), ...o.vars };
    if (block.vars.some((v) => v.id === "dur") && o.vars?.dur === undefined)
      values.dur = round((f1 - f0) / fps);
    declaredOnly({ ...type.preset, ...o.vars }, block, file, what);
    return {
      id: `ov-${i}`,
      type: type.name,
      file,
      block,
      f0,
      f1,
      box,
      take,
      values,
      relation: type.face?.relation ?? null,
    };
  });

  const wordsEnd = words.length ? words[words.length - 1].end : 0;
  const spoken = audio.filter((a) => a.kind === "voice").map((a) => a.start + a.natural);
  const total = Math.max(
    ...takes.map((k) => k.end),
    ...overlays.map((o) => o.f1 / fps),
    ...spoken,
    wordsEnd,
  );
  if (!(total > 0))
    throw new Fix("the timeline has nothing to play", "add takes, overlays or a voice track");
  const totalFrames = Math.round(total * fps);

  const html = [];
  const zooms = [];
  for (const k of takes) {
    const [f0, f1] = [frame(k.start), Math.min(totalFrames, frame(k.end))];
    const origin = k.face
      ? `${round(k.face[0] + k.face[2] / 2, 1)}px ${round(k.face[1] + k.face[3] / 2, 1)}px`
      : "50% 50%";
    const sound =
      !voiced && media[k.src]?.audio && !k.retimed_from
        ? 'data-has-audio="true" data-volume="1"'
        : "muted";
    html.push(
      `<div id="${k.id}-cam" class="cam" style="transform-origin: ${origin}">`,
      `  <video id="${k.id}" class="clip take" src="${attr(k.src)}" data-start="${clock(f0, fps)}" data-duration="${round((f1 - f0) / fps)}" data-media-start="${round(k.from)}" data-track-index="${TRACK.take}" ${sound} playsinline></video>`,
      "</div>",
    );
    if (k.zoom)
      zooms.push(
        `tl.fromTo("#${k.id}-cam", { scale: ${k.zoom[0]} }, { scale: ${k.zoom[1]}, duration: ${round((f1 - f0) / fps)}, ease: "none" }, ${clock(f0, fps)});`,
      );
  }
  for (const o of overlays)
    html.push(
      `<div id="${o.id}" data-composition-id="${o.block.id}" data-composition-src="${o.file}" data-label="${attr(o.type)}" data-start="${clock(o.f0, fps)}" data-duration="${round((o.f1 - o.f0) / fps)}" data-track-index="${TRACK.overlay}" data-track-kind="graphics" data-width="${canvas.width}" data-height="${canvas.height}" data-variable-values='${attr(JSON.stringify(o.values))}'></div>`,
    );

  const captions = captionsFor(timeline, template, words, canvas, scale, totalFrames, blockFor);
  if (captions?.page) files["compositions/captions.html"] = captions.page;
  if (captions) html.push(captions.host);

  const audioOut = audio.map((a) => {
    const id = `${a.kind}-${audio.filter((b) => b.kind === a.kind).indexOf(a)}`;
    const f0 = frame(a.start);
    const f1 = Math.min(totalFrames, frame(a.start + a.natural));
    const d = round((f1 - f0) / fps);
    const volume = a.volume ?? 1;
    const lane = [];
    // The render multiplies a lane by data-volume, which carries the level: lane points are 0..1 of it.
    if (a.fade_in) lane.push({ t: 0, v: 0 }, { t: a.fade_in, v: 1 });
    if (a.fade_out) lane.push({ t: round(Math.max(0, d - a.fade_out)), v: 1 }, { t: d, v: 0 });
    const automation = lane.length
      ? ` data-automation='${JSON.stringify({ version: 1, lanes: [{ target: "volume", points: lane }] })}'`
      : "";
    html.push(
      `<audio id="${id}" class="clip" src="${attr(a.src)}" data-start="${clock(f0, fps)}" data-duration="${d}"${a.in ? ` data-media-start="${a.in}"` : ""} data-volume="${volume}"${automation} data-track-index="${TRACK[a.kind] ?? TRACK.sfx}"></audio>`,
    );
    return { id, src: a.src, kind: a.kind, start: round(f0 / fps), end: round(f1 / fps), volume };
  });

  const named = [...new Set([...instances].flatMap((path) => namedFiles(components[path])))];
  files["index.html"] = rootPage({
    canvas,
    duration: round(totalFrames / fps),
    body: html,
    zooms,
    libs: named.filter((p) => /^lib\/.+\.js$/.test(p)),
  });

  const assembled = {
    template: timeline.template,
    canvas: { width: canvas.width, height: canvas.height, fps },
    duration: round(totalFrames / fps),
    takes: takes.map((k) => ({
      id: k.id,
      src: k.src,
      ...(k.retimed_from && { retimed_from: k.retimed_from, map: k.retime }),
      start: round(frame(k.start) / fps),
      end: round(Math.min(totalFrames, frame(k.end)) / fps),
      media_start: round(k.from),
      face: k.face ?? null,
    })),
    overlays: overlays.map((o) => ({
      id: o.id,
      type: o.type,
      component: o.file,
      start: round(o.f0 / fps),
      end: round(o.f1 / fps),
      box: o.box && Object.fromEntries(Object.entries(o.box).map(([k, v]) => [k, round(v, 1)])),
      face: o.take?.face ?? null,
      relation: o.relation,
      take: o.take?.id ?? null,
      vars: o.values,
    })),
    captions: captions?.summary ?? null,
    audio: audioOut,
  };
  return { files, copy: [...named, ...(captions?.fonts ?? [])], assembled };
}

/** Captions: the named component with the words as a variable, or captions.html built from template.json's rule. */
function captionsFor(timeline, template, words, canvas, scale, totalFrames, blockFor) {
  const rule = template.captions;
  const want = timeline.captions ?? Boolean(rule);
  if (!want) return null;
  if (!words.length)
    throw new Fix(
      "captions need words",
      '"words": "assets/voice/vo.words.json", or "captions": false',
    );
  const fps = canvas.fps || 30;
  const duration = round(totalFrames / fps);
  const host = (/** @type {string} */ id, /** @type {string} */ src, extra = "") =>
    `<div id="captions" data-composition-id="${id}" data-composition-src="${src}" data-label="captions" data-start="0" data-duration="${duration}" data-track-index="${TRACK.captions}" data-track-kind="captions" data-width="${canvas.width}" data-height="${canvas.height}"${extra}></div>`;
  const component = timeline.captions?.component ?? rule?.component;
  if (component) {
    const { file, block } = blockFor(component, "captions");
    if (!block.vars.some((v) => v.id === "words"))
      throw new Fix(
        `${component} declares no "words" variable`,
        "declare words (JSON [{text, start, end}]) or generate captions",
      );
    const values = {
      words: JSON.stringify(
        words.map((w) => ({ text: w.text, start: round(w.start), end: round(w.end) })),
      ),
    };
    if (block.vars.some((v) => v.id === "dur")) values.dur = duration;
    return {
      host: host(block.id, file, ` data-variable-values='${attr(JSON.stringify(values))}'`),
      summary: { component: file, words: words.length },
    };
  }
  if (!rule)
    throw new Fix(
      "template.json has no captions rule",
      'name a component: "captions": {"component": "components/…"}',
    );
  const font = (template.tokens?.fonts ?? []).find((f) => f.family === rule.font && f.file);
  const groups = groupWords(words, rule);
  return {
    page: captionsPage({ groups, rule, canvas, scale, totalFrames, font }),
    host: host("captions", "compositions/captions.html"),
    fonts: font ? [font.file] : [],
    summary: {
      component: "compositions/captions.html",
      groups: groups.length,
      words: words.length,
      // the seconds the caption changes on screen, which vc review checks
      cues: (rule.reveal === "group" ? groups.map((g) => g[0]) : words).map((w) => round(w.start)),
      ...(rule.font &&
        !font && {
          font_missing: `${rule.font}: add its file to tokens.fonts, or it renders in a stand-in`,
        }),
    },
  };
}

/** The root composition. */
function rootPage({ canvas, duration, body, zooms, libs }) {
  const { width: w, height: h } = canvas;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${w}, height=${h}" />
<script src="${GSAP}"></script>
${libs.map((l) => `<script src="${l}"></script>\n`).join("")}<style>
html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: #000; }
#root { position: relative; width: 100%; height: 100%; overflow: hidden; }
.cam { position: absolute; inset: 0; }
.take { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${w}" data-height="${h}">
${body.join("\n")}
</div>
<script>
const tl = gsap.timeline({ paused: true });
${zooms.join("\n")}
window.__timelines["main"] = tl;
</script>
</body>
</html>
`;
}

/** retime.mjs runs ffmpeg by name: put the app's own first on its PATH. */
function ffmpegEnv() {
  const bin = ffmpegBin();
  return isAbsolute(bin)
    ? { ...process.env, PATH: `${dirname(bin)}:${process.env.PATH ?? ""}` }
    : process.env;
}

/** Runs retime.mjs for each take with a map, unless the last run made the same file from the same source and map.
 * @param {any[]} takes @param {string} out @param {number} fps */
function retimeTakes(takes, out, fps) {
  const before = existsSync(join(out, ASSEMBLED))
    ? (JSON.parse(readFileSync(join(out, ASSEMBLED), "utf8")).takes ?? [])
    : [];
  for (const take of takes.filter((t) => t.retime)) {
    const made = retimed(take);
    const [src, dst] = [join(out, take.src), join(out, made.src)];
    if (!existsSync(src))
      throw new Fix(`no take at ${src}`, "pass the take's path from the project folder");
    const same = before.some(
      (/** @type {any} */ b) =>
        b.src === made.src && b.retimed_from === take.src && b.map === take.retime,
    );
    if (same && existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs) continue;
    mkdirSync(dirname(dst), { recursive: true });
    execFileSync(
      process.execPath,
      [join(SCRIPTS, "retime.mjs"), src, dst, "--map", take.retime, "--fps", String(fps)],
      {
        env: ffmpegEnv(),
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
  }
}

/** @param {string[]} args */
export async function main(args) {
  const parsed = parseTool(args, {
    usage: USAGE,
    example: EXAMPLE,
    options: { out: { type: "string", default: "." } },
  });
  if (!parsed) return;
  const [timelinePath] = parsed.positionals;
  if (!timelinePath || !existsSync(timelinePath))
    throw new Fix(`no timeline at ${timelinePath ?? "(none given)"}`, `run it as: ${EXAMPLE}`);
  const out = String(parsed.values.out);
  const timeline = JSON.parse(readFileSync(timelinePath, "utf8"));
  if (!timeline.template)
    throw new Fix("the timeline names no template", '"template": "templates/<slug>"');
  const dir = join(out, timeline.template);
  const templateFile = join(dir, "template.json");
  if (!existsSync(templateFile))
    throw new Fix(`no ${templateFile}`, "save the template as template.json (vc template check)");
  const template = JSON.parse(readFileSync(templateFile, "utf8"));
  const components = {};
  for (const path of [
    ...[...(template.vocabulary ?? []), ...(template.hero_scenes ?? [])].map((t) => t.component),
    timeline.captions?.component,
    template.captions?.component,
  ])
    if (path && existsSync(join(dir, path)))
      components[path] = readFileSync(join(dir, path), "utf8");
  const words = timeline.words ? loadWords(join(out, timeline.words)) : [];
  const fps = timeline.canvas?.fps ?? template.canvas?.fps ?? 30;
  retimeTakes(timeline.takes ?? [], out, fps);
  const media = {};
  for (const src of [
    ...(timeline.takes ?? []).map((t) => retimed(t).src),
    ...(timeline.audio ?? []).map((a) => a.src),
  ])
    media[src] ??= probe(join(out, src));

  const { files, copy, assembled } = assemble(timeline, { template, components, words, media });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), text);
  }
  const copied = [];
  const missing = [];
  for (const path of copy) {
    const library = path.startsWith("lib/") ? [join(SCRIPTS, "..", "library", basename(path))] : [];
    const from = [join(dir, path), join(dir, "components", path), ...library].find((p) =>
      existsSync(p),
    );
    if (existsSync(join(out, path))) continue;
    if (!from) {
      missing.push(path);
      continue;
    }
    mkdirSync(dirname(join(out, path)), { recursive: true });
    copyFileSync(from, join(out, path));
    copied.push(path);
  }
  mkdirSync(dirname(join(out, ASSEMBLED)), { recursive: true });
  writeFileSync(join(out, ASSEMBLED), `${JSON.stringify(assembled, null, 1)}\n`);
  console.log(
    JSON.stringify({
      wrote: Object.keys(files),
      copied,
      ...(missing.length && {
        missing,
        fix: "a block names these and neither the template nor the project has them: add them, or the block renders blank",
      }),
      duration: assembled.duration,
      takes: assembled.takes.length,
      overlays: assembled.overlays.length,
      captions: assembled.captions,
      audio: assembled.audio.length,
      assembled: ASSEMBLED,
      next: `npx hyperframes lint ${out} && npx hyperframes check ${out}`,
    }),
  );
}
