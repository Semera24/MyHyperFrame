// `vc template draft|check|render`: templates/<slug>/template.json is the template's one source. draft pre-fills
// template.draft.json from reference/'s measurements, check names what template.json still lacks with the fix for
// each, render writes the md files from it. Folding Gemini's per-instance kinds into reusable types stays the agent's.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { round } from "./media.mjs";
import { renderTemplate } from "./template-render.mjs";
import {
  FACE_RELATIONS,
  FIELDS,
  REQUIRED,
  REQUIRED_UNMEASURED,
  TYPE_FIELDS,
} from "./template-schema.mjs";
import { Fix, parseTool, probe } from "./tool.mjs";

const USAGE = `usage (from the project folder): node vc.mjs template draft|check|render [--slug S]
  draft   pre-fill templates/<slug>/template.draft.json from reference/ (never touches template.json)
  check   what template.json still lacks, each with its fix; exits 1 on errors
  render  TEMPLATE.md, frame.md, editing.md, voice.md from template.json (check's errors printed first)`;

const VERSION = 1;
// The same test as vc.mjs's CAPTION: captions follow the caption rule, not a vocabulary type.
const CAPTION = /\b(captions?|subtitles?)\b/i;
const TEXTS = ["build", "entry", "hold", "exit"];

/** @param {string} p */
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};
/** @param {any} v */
const empty = (v) =>
  v == null || v === "" || (typeof v === "object" && Object.keys(v).length === 0);
const norm = (/** @type {string} */ k) => String(k).trim().toLowerCase();
/** @param {number[]} xs */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** @param {string} dir */
const jsonFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];

/** `<prefix>.json` and `<prefix>-<passage>.json` in reference/, each with its passage name ("all" when bare).
 * @param {string} rec @param {string} prefix */
const records = (rec, prefix) =>
  jsonFiles(rec)
    .filter((f) => new RegExp(`^${prefix}(-.+)?\\.json$`).test(f))
    .map((f) => ({
      name: f.slice(prefix.length, -5).replace(/^-/, "") || "all",
      json: readJson(join(rec, f)),
    }))
    .filter((r) => r.json);

/** The project's one template slug, or null: vc.mjs's templateSlug, which it does not export. */
function templateSlug() {
  if (!existsSync("templates")) return null;
  const slugs = readdirSync("templates", { withFileTypes: true }).filter((d) => d.isDirectory());
  return slugs.length === 1 ? slugs[0].name : null;
}

/** A Gemini box in percent as reference pixels, kept inside the frame.
 * @param {{left: number, top: number, width: number, height: number}} b @param {number} w @param {number} h */
const pxBox = (b, w, h) => {
  const x0 = Math.max(0, (b.left * w) / 100);
  const y0 = Math.max(0, (b.top * h) / 100);
  const x1 = Math.min(w, ((b.left + b.width) * w) / 100);
  const y1 = Math.min(h, ((b.top + b.height) * h) / 100);
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
};
/** @typedef {{x: number, y: number, w: number, h: number}} Box */
/** @param {Box[]} boxes @returns {Box} */
const union = (boxes) => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
};
/** @param {Box} a @param {Box} b */
const inter = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
/** @param {Box} a @param {Box} b */
const iou = (a, b) => inter(a, b) / (a.w * a.h + b.w * b.h - inter(a, b) || 1);

/** Every face box in reference/'s face files (any JSON with face_boxes, normalized [x, y, w, h] per frame), in pixels
 * on the reference's clock. @param {string} rec @param {{width: number, height: number, fps: number}} canvas */
function faceSamples(rec, { width, height, fps }) {
  const files = [];
  const samples = [];
  for (const f of jsonFiles(rec)) {
    const j = readJson(join(rec, f));
    if (!Array.isArray(j?.face_boxes)) continue;
    files.push(f);
    const [a, b] = String(j.source?.video?.r_frame_rate ?? fps)
      .split("/")
      .map(Number);
    const rate = a / (b || 1) || fps;
    for (const { frame, box } of j.face_boxes)
      samples.push({
        t: frame / rate,
        box: { x: box[0] * width, y: box[1] * height, w: box[2] * width, h: box[3] * height },
      });
  }
  return { files, samples };
}

// ponytail: face boxes are a few sampled frames, so "crosses" here means partly on the face, not template.md's
// on-the-face-only-while-it-moves; the agent confirms the relation over the type's window.
/** @param {Box} box @param {any[]} instances @param {{t: number, box: Box}[]} samples */
function faceOf(box, instances, samples) {
  if (!samples.length) return { relation: "none" };
  const during = samples.filter((s) => instances.some((i) => s.t >= i.start && s.t <= i.end));
  const over = (during.length ? during : samples).map(
    (s) => inter(s.box, box) / (s.box.w * s.box.h),
  );
  const share = round(over.filter((o) => o > 0).length / over.length, 2);
  return { relation: share === 0 ? "clear" : median(over) >= 0.5 ? "covers" : "crosses", share };
}

/** The box's centre against the median face box's, in face widths and heights. @param {Box} box
 * @param {{box: Box}[]} samples */
function anchorOf(box, samples) {
  const [x, y, w, h] = ["x", "y", "w", "h"].map((k) => median(samples.map((s) => s.box[k])));
  return {
    to: "face",
    dx: round((box.x + box.w / 2 - (x + w / 2)) / w, 2),
    dy: round((box.y + box.h / 2 - (y + h / 2)) / h, 2),
  };
}

/** A Gemini box grown by 6% of the frame each way, as vc.mjs's boxToRoi pads it: its boxes are about that loose.
 * @param {{left: number, top: number, width: number, height: number}} b */
const padded = (b) => ({
  left: b.left - 6,
  top: b.top - 6,
  width: b.width + 12,
  height: b.height + 12,
});

/** Each window goes to an instance its box touches (Gemini's padded): first one starting within 1 s of it (Gemini's
 * times are about ±1 s), else one on screen, the best overlap winning. A window at a title's end is then the next
 * title's entry, and a film-long watermark does not collect every window. @param {any[]} windows
 * @param {any[]} groups @param {number} w @param {number} h @returns {Map<any, string[]>} */
function windowsByInstance(windows, groups, w, h) {
  const out = new Map();
  const instances = groups.flatMap((g) => g.instances).filter((i) => i.box);
  for (const win of windows) {
    if (!win.roi) continue;
    const roi = { x: win.roi[0], y: win.roi[1], w: win.roi[2], h: win.roi[3] };
    const best = instances
      .filter((i) => win.start >= i.start - 1 && win.start <= i.end)
      .filter((i) => inter(roi, pxBox(padded(i.box), w, h)) > 0)
      .map((i) => ({
        i,
        fit: iou(roi, pxBox(i.box, w, h)),
        near: Math.abs(win.start - i.start) <= 1,
      }))
      .sort((a, b) => Number(b.near) - Number(a.near) || b.fit - a.fit)[0];
    if (best) out.set(best.i, [...(out.get(best.i) ?? []), win.name]);
  }
  return out;
}

/** One draft vocabulary type from one Gemini kind; the agent merges kinds that share a look into one type.
 * @param {any} g @param {{w: number, h: number, samples: any[], windowsOf: Map<any, string[]>}} ctx */
function typeDraft(g, { w, h, samples, windowsOf }) {
  const [first, ...rest] = g.instances;
  const boxes = g.instances.filter((i) => i.box).map((i) => pxBox(i.box, w, h));
  const box = boxes.length ? union(boxes) : null;
  const alternatives = Object.fromEntries(
    TEXTS.map((k) => [
      k,
      [...new Set(rest.map((i) => i[k]).filter((v) => v && v !== first[k]))],
    ]).filter(([, v]) => v.length),
  );
  return {
    name: g.kind,
    kinds: [g.kind],
    draft: true,
    trigger: "",
    frequency: `${g.count} in the film`,
    layers: "",
    box,
    ...(box && samples.length ? { anchor: anchorOf(box, samples) } : {}),
    face: box ? faceOf(box, g.instances, samples) : { relation: "none" },
    look: "",
    build: first.build ? [first.build] : [],
    entry: first.entry ?? "",
    hold: first.hold ?? "",
    exit: first.exit ?? "",
    update: "",
    evidence: {
      times: g.instances.map((i) => i.start),
      windows: g.instances.flatMap((i) => windowsOf.get(i) ?? []),
    },
    component: "",
    ...(Object.keys(alternatives).length ? { alternatives } : {}),
  };
}

/** Per segment: the face height, the camera of its beats and each beat's hands tied to its words.
 * @param {any} perform @param {any[]} segs @param {any[]} samples @param {number} h */
function personShots(perform, segs, samples, h) {
  const beats = perform?.beats ?? [];
  const inside = (/** @type {any} */ s, /** @type {number} */ t) => t >= s.start && t < s.end;
  return segs
    .map((s) => {
      const own = beats.filter((b) => inside(s, b.start));
      const faces = samples.filter((f) => inside(s, f.t));
      return {
        segment: s.name,
        face_height: faces.length ? round(median(faces.map((f) => f.box.h / h)), 3) : null,
        subject_box: "",
        camera: [...new Set(own.map((b) => b.camera))].join("; "),
        place: "",
        light: "",
        actions: own.map((b) => ({ action: b.hands, on: b.words })),
      };
    })
    .filter((r) => r.actions.length || r.face_height != null);
}

/** The whole film's rhythm, then each shot's camera. @param {any} r */
function motionRhythm(r) {
  if (!r) return [];
  const step = r.fps / r.update_fps;
  return [
    {
      segment: "whole film",
      moving_share: r.moving_share,
      longest_hold_s: r.longest_hold_s,
      median_hold_s: r.median_hold_s,
      update: !step ? "" : step < 1.5 ? "ones" : step < 2.5 ? "twos" : "threes",
      camera: `${r.cuts_per_min} cuts/min, ${r.camera_moves_per_min} camera moves/min`,
    },
    ...(r.shots ?? []).map((/** @type {any} */ s) => ({
      segment: `shot ${s.start}–${s.end} s`,
      camera: s.zoom && s.zoom !== 1 ? `${s.camera}, zoom ${s.zoom}` : s.camera,
    })),
  ];
}

/** @param {string} rec */
function voiceOf(rec) {
  const delivery = records(rec, "prosody").map(({ name, json }) => {
    delete json.path;
    return { passage: name, ...json };
  });
  const fingerprint = existsSync(join(rec, "fingerprint.json"))
    ? "reference/fingerprint.json"
    : null;
  return delivery.length || fingerprint ? { fingerprint, delivery, moves: [], recipe: [] } : {};
}

/** @param {any} read */
const captionTexts = (read) => [
  ...new Set(
    [read?.captions ?? []]
      .flat()
      .map((s) => String(s).trim())
      .filter(Boolean),
  ),
];

/** The template's draft from reference/'s measurements; writes templates/<slug>/template.draft.json and never touches
 * template.json. @param {{slug: string, refVideo: string, rec: string}} o */
export function draftTemplate({ slug, refVideo, rec }) {
  const { width, height, fps, duration } = probe(refVideo);
  const canvas = { width, height, fps: round(fps, 3) };
  const d = round(duration, 2);
  const read = readJson(join(rec, "gemini-read.json"));
  const perform = readJson(join(rec, "gemini-perform.json"));
  const rhythm = readJson(join(rec, "motion-rhythm.json"));
  const soundMap =
    readJson(join(rec, "sound-map.json")) ?? readJson(join(rec, "sound", "sound-map.json"));
  const windows =
    readJson(join(rec, "motion-windows.json")) ??
    readJson(join(rec, "motion-windows.draft.json")) ??
    [];
  const groups = read?.kinds ?? [];
  const graphics = groups.filter((/** @type {any} */ g) => !CAPTION.test(g.kind));
  const face = faceSamples(rec, canvas);
  const form = (read?.sections ?? []).map((/** @type {any} */ s) => ({
    name: s.name,
    start: s.start,
    end: s.end,
    share: round((s.end - s.start) / duration, 2),
  }));
  const segs = form.length ? form : [{ name: "whole film", start: 0, end: Infinity }];
  const ctx = {
    w: width,
    h: height,
    samples: face.samples,
    windowsOf: windowsByInstance(windows, groups, width, height),
  };
  const shown = graphics.flatMap((/** @type {any} */ g) => g.instances);
  const source = relative(process.cwd(), resolve(refVideo));
  const voice = voiceOf(rec);
  const draft = {
    ...Object.fromEntries(
      Object.entries(FIELDS).map(([k, f]) => [
        k,
        f.holds.startsWith("[") ? [] : f.holds.startsWith("{") ? {} : "",
      ]),
    ),
    version: VERSION,
    name: slug,
    slug,
    depth: "single",
    sources: [source.startsWith("..") ? resolve(refVideo) : source],
    canvas,
    runtime_s: [d, d, d],
    form,
    captions: captionTexts(read).length ? { rule: captionTexts(read).join(" / ") } : {},
    vocabulary: graphics.map((/** @type {any} */ g) => typeDraft(g, ctx)),
    mg_density: segs.map((s) => ({
      segment: s.name,
      events: shown.filter((i) => i.start >= s.start && i.start < s.end).length,
      mode: "",
    })),
    motion_rhythm: motionRhythm(rhythm),
    person_shots: personShots(perform, segs, face.samples, height),
    footage: records(rec, "look").map(({ name, json }) => ({ segment: name, look: json })),
    sound: soundMap?.summary
      ? {
          targets: {
            event_lift: soundMap.summary.event_lift,
            phrase_lift: soundMap.summary.phrase_lift,
          },
        }
      : {},
    voice,
  };
  const path = join(dirname(rec), "template.draft.json");
  writeFileSync(path, `${JSON.stringify(draft, null, 2)}\n`);
  const inputs = {
    "gemini-read.json": read?.kinds,
    "motion-windows.json": windows.length,
    "a face file (face_boxes)": face.files.length,
    "gemini-perform.json": perform?.beats,
    "motion-rhythm.json": rhythm,
    "sound-map.json": soundMap,
    "prosody-*.json or fingerprint.json": !empty(voice),
  };
  return {
    path,
    draft,
    faces: face.files,
    captionKinds: groups
      .filter((/** @type {any} */ g) => CAPTION.test(g.kind))
      .map((/** @type {any} */ g) => g.kind),
    missing: Object.keys(inputs).filter((k) => !inputs[k]),
  };
}

const SLUG_HINT = "<slug>";
/** How to fill a missing type field; the rest say what TYPE_FIELDS says the field holds. */
const FIX = {
  box: `measure it: node vc.mjs box .viral-clone/${SLUG_HINT}/ref.mp4 --at <t>, then {x, y, w, h} in reference pixels`,
  face: "read the face box over its window (vc box …) and write clear|crosses|covers, or none with no presenter",
  build: "list what it is made of from its zoom, each item one a rebuild does or does not do",
  entry: "read its move over its window: node vc.mjs box … --track",
  hold: "read its move over its window: node vc.mjs box … --track",
  exit: "read its move over its window: node vc.mjs box … --track",
  evidence: "cite its times on the reference and its reference/motion-windows.json names",
  component: "build it as components/<name>.html (template.md, Components) and point at it",
  score: "copy G0.5's verdict with its numbers from .viral-clone/pieces/report.md",
};

/** One vocabulary type's or hero scene's errors. @param {any} v @param {string} what @param {any} ctx */
function checkType(v, what, { dir, windows, end, piecesScored }) {
  const label = `${what} '${v.name ?? "?"}'`;
  const need =
    v.status === "unmeasured"
      ? REQUIRED_UNMEASURED
      : [...REQUIRED, ...(piecesScored ? ["score"] : [])];
  const fix = (/** @type {string} */ f) =>
    (FIX[f] ?? `write ${TYPE_FIELDS[f]}`).replace(SLUG_HINT, basename(dir));
  const out = need.filter((f) => empty(v[f])).map((f) => `${label}: no ${f} — ${fix(f)}`);
  if (!empty(v.build) && !Array.isArray(v.build))
    out.push(`${label}: build must be a list — ${fix("build")}`);
  if (v.face && !FACE_RELATIONS.includes(v.face.relation))
    out.push(`${label}: face.relation "${v.face.relation}" — ${fix("face")}`);
  if (v.component && !existsSync(join(dir, v.component)))
    out.push(
      `${label}: no ${join(dir, v.component)} — ${fix("component")}, relative to the template folder`,
    );
  for (const name of v.evidence?.windows ?? [])
    if (!windows.has(name))
      out.push(
        `${label}: window "${name}" is not in reference/motion-windows.json — add it there or cite one that is`,
      );
  for (const t of v.evidence?.times ?? []) {
    const s = Number(String(t).replace(/^ref@/, ""));
    if (!Number.isFinite(s) || s < 0 || (end && s > end))
      out.push(
        `${label}: evidence time ${t} is outside the reference (0–${end} s) — cite a time on its clock`,
      );
  }
  if (v.draft)
    out.push(
      `${label}: still "draft": true — confirm it on frames, fill its fields, then delete "draft"`,
    );
  if (v.alternatives)
    out.push(
      `${label}: alternatives left from the draft — fold them into build/entry/hold/exit or split the type`,
    );
  return out;
}

/** Gemini kinds no type, hero scene, caption rule or kinds_not_taken covers. @param {any} t @param {any} read */
function unmappedKinds(t, read) {
  const types = [...(t.vocabulary ?? []), ...(t.hero_scenes ?? [])];
  const covered = new Set(
    [
      ...types.flatMap((v) => v.kinds ?? []),
      ...(t.kinds_not_taken ?? []).map((/** @type {any} */ k) => k.kind),
      ...(t.captions?.kinds ?? []),
    ].map(norm),
  );
  return (read?.kinds ?? [])
    .map((/** @type {any} */ k) => norm(k.kind))
    .filter((k) => !covered.has(k) && !(CAPTION.test(k) && !empty(t.captions)))
    .map(
      (k) =>
        `Gemini kind "${k}" is in no type — add it to a type's or hero scene's kinds, or to kinds_not_taken with why`,
    );
}

/** An error when the template rebuilds no effects while the reference's sound map has hits on picture events that
 * sound.not_effects does not explain one by one. @param {any} sound @param {any} map @returns {string[]} */
function unexplainedHits(sound, map) {
  if (!map || (sound?.targets?.palette_size ?? 0) > 0) return [];
  // a hit is explained only with its reason: a bare second would let every effect go unexplained
  const told = (sound?.not_effects ?? [])
    .filter((/** @type {any} */ n) => typeof n?.why === "string" && n.why.trim())
    .map((/** @type {any} */ n) => Number(n.at));
  const open = (map.rows ?? [])
    .filter((/** @type {any} */ r) => r.on_picture_event && !r.periodic)
    .map((/** @type {any} */ r) => r.t)
    .filter((/** @type {number} */ t) => !told.some((a) => Math.abs(a - t) <= 0.1));
  return open.length
    ? [
        `sound rebuilds no effects, but the reference's sound map has hits on picture events at ${open.join(", ")} s — write effect rules with targets.palette_size, or list each in sound.not_effects as {at, why} from its frame and clip in sound-map.html (watch.md, Sound)`,
      ]
    : [];
}

/** What template.json still lacks, each error with its fix. @param {string} dir templates/<slug>
 * @param {{refDuration?: number, piecesScored?: boolean}} [o] @returns {{errors: string[], warnings: string[]}} */
export function checkTemplate(dir, { refDuration, piecesScored = false } = {}) {
  const path = join(dir, "template.json");
  const warnings = [];
  if (!existsSync(path))
    return {
      errors: [`no ${path} — consolidate template.draft.json into it (template.md)`],
      warnings,
    };
  let t;
  try {
    t = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return {
      errors: [`${path} does not parse: ${/** @type {Error} */ (e).message} — fix the JSON`],
      warnings,
    };
  }
  const rec = join(dir, "reference");
  const read = readJson(join(rec, "gemini-read.json"));
  const hasCaptions =
    (read?.kinds ?? []).some((/** @type {any} */ k) => CAPTION.test(k.kind)) ||
    captionTexts(read).some((s) => !/^(none|no\b|n\/a|unsure)/i.test(s));
  const top = ["name", "slug", "depth", "sources", "canvas", "runtime_s", "slots", "form"];
  const errors = [...top, ...(hasCaptions ? ["captions"] : [])]
    .filter((k) => empty(t[k]))
    .map((k) => `no ${k} — ${FIELDS[k].holds} (template.md, ${FIELDS[k].md})`);
  if (!empty(t.captions) && empty(t.captions.rule))
    errors.push("captions has no rule — write the caption rule in one line, or none");
  if (t.version !== VERSION)
    errors.push(
      `version is ${JSON.stringify(t.version)}, this vc reads version ${VERSION} — keep "version": ${VERSION} from the draft`,
    );
  if (!Array.isArray(t.vocabulary))
    errors.push("vocabulary must be a list of types, [] when the film has none");
  const ctx = {
    dir,
    windows: new Set(
      (readJson(join(rec, "motion-windows.json")) ?? []).map((/** @type {any} */ w) => w.name),
    ),
    end: refDuration ?? Math.max(0, ...(Array.isArray(t.runtime_s) ? t.runtime_s : [])),
    piecesScored,
  };
  for (const v of Array.isArray(t.vocabulary) ? t.vocabulary : [])
    errors.push(...checkType(v, "type", ctx));
  for (const v of t.hero_scenes ?? []) errors.push(...checkType(v, "hero scene", ctx));
  errors.push(...unmappedKinds(t, read));
  errors.push(
    ...unexplainedHits(
      t.sound,
      readJson(join(rec, "sound", "sound-map.json")) ?? readJson(join(rec, "sound-map.json")),
    ),
  );
  if (t.draft)
    errors.push('template.json still has "draft": true — consolidate it, then delete "draft"');
  if (empty(t.motion_rhythm) && existsSync(join(rec, "motion-rhythm.json")))
    warnings.push(
      "no motion_rhythm — copy reference/motion-rhythm.json's numbers per segment (editing.md targets)",
    );
  if (
    empty(t.voice) &&
    (records(rec, "prosody").length || existsSync(join(rec, "fingerprint.json")))
  )
    warnings.push(
      "no voice — reference/ has prosody or a fingerprint; voice.md is skipped without it",
    );
  for (const v of Array.isArray(t.vocabulary) ? t.vocabulary : [])
    if (v.status !== "unmeasured" && empty(v.anchor))
      warnings.push(
        `type '${v.name}': no anchor — vc assemble then places it at its reference box`,
      );
  return { errors, warnings };
}

/** What `vc next` says about the template, or null once template.json passes check. File reads are injected:
 * `has` for existence, `check` for checkTemplate. @param {(p: string) => boolean} has @param {string} slug */
export function templateStep(has, slug, check = checkTemplate) {
  const dir = `templates/${slug}`;
  if (!has(`${dir}/template.json`))
    return has(`${dir}/template.draft.json`)
      ? "G0: consolidate template.draft.json into template.json (template.md), then node vc.mjs template check"
      : "G0: node vc.mjs template draft, consolidate template.draft.json into template.json (template.md), then node vc.mjs template check";
  // score lines join after G0.5's fix round, so `next` keeps v0, fix, r1 in order rather than asking for v0's scores
  const { errors } = check(dir, { piecesScored: has(".viral-clone/pieces/rounds/r1") });
  return errors.length
    ? `G0: template.json fails check (${errors.length}): ${errors[0]}; then node vc.mjs template check`
    : null;
}

/** Prints check's result short: one line per problem, naming every type it applies to.
 * @param {{errors: string[], warnings: string[]}} r */
const report = (r) => {
  for (const [kind, list] of [
    ["error", r.errors],
    ["warning", r.warnings],
  ]) {
    const byProblem = new Map();
    for (const e of list) {
      const [, who, problem] = /^((?:type|hero scene) '[^']*'): (.*)$/.exec(e) ?? ["", "", e];
      byProblem.set(problem, [...(byProblem.get(problem) ?? []), who].filter(Boolean));
    }
    for (const [problem, who] of byProblem)
      console.log(`${kind}: ${problem}${who.length ? ` (${who.join(", ")})` : ""}`);
  }
};

/** @param {string[]} args */
export async function main(args) {
  const a = parseTool(args, {
    usage: USAGE,
    example: "node vc.mjs template check --slug cindy",
    options: { slug: { type: "string" } },
  });
  if (!a) return;
  const [cmd] = a.positionals;
  const slug = a.values.slug ?? templateSlug();
  if (!slug)
    throw new Fix(
      "no single templates/<slug>/ folder here",
      "run it from the project folder, or pass --slug <name>",
    );
  const dir = join("templates", slug);
  const ref = join(".viral-clone", slug, "ref.mp4");
  if (cmd === "draft") {
    if (!existsSync(ref))
      throw new Fix(`no ${ref}`, `node vc.mjs watch <reference.mp4> --slug ${slug}`);
    const r = draftTemplate({ slug, refVideo: ref, rec: join(dir, "reference") });
    const { path, faces, captionKinds, missing } = r;
    console.log(
      JSON.stringify({
        wrote: path,
        types: r.draft.vocabulary.length,
        captionKinds,
        faces,
        missing,
      }),
    );
    return;
  }
  const opts = {
    refDuration: existsSync(ref) ? probe(ref).duration : undefined,
    piecesScored: existsSync(join(".viral-clone", "pieces", "scores.json")),
  };
  const r = checkTemplate(dir, opts);
  if (cmd === "check") {
    report(r);
    console.log(
      r.errors.length
        ? `${r.errors.length} errors in ${dir}/template.json`
        : `${dir}/template.json: ok`,
    );
    if (r.errors.length) process.exitCode = 1;
  } else if (cmd === "render") {
    // A view, not a gate: it renders what is there so the md can be read beside check's errors; vc next gates.
    report(r);
    console.log(JSON.stringify({ wrote: renderTemplate(dir), errors: r.errors.length }));
  } else
    throw new Fix(`unknown subcommand "${cmd ?? ""}"`, "node vc.mjs template draft|check|render");
}
