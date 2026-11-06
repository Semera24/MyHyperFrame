// template.json written out as the md files template.md names. Every file says it is generated, so edits go to
// template.json and survive the next render.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Fix } from "./tool.mjs";

const NOTE =
  "Generated from template.json by `vc template render`; edit template.json, then render again.";

/** @param {any} v */
const blank = (v) =>
  v == null || v === "" || (typeof v === "object" && Object.keys(v).length === 0);
/** @param {any} v */
const text = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
/** @param {any} v */
const cell = (v) => text(v).replace(/\|/g, "\\|").replace(/\n/g, " ");

/** A markdown table of `rows` over `cols`, nothing when there are no rows.
 * @param {any[]} rows @param {string[]} cols */
function table(rows, cols) {
  if (!rows?.length) return [];
  return [
    `| ${cols.map((c) => c.replace(/_/g, " ")).join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${cols.map((c) => cell(r[c])).join(" | ")} |`),
    "",
  ];
}

/** @param {string} title @param {string[]} lines */
const section = (title, lines) => (lines.length ? [`## ${title}`, "", ...lines] : []);
/** @param {any} o */
const bullets = (o) =>
  blank(o)
    ? []
    : [
        ...Object.entries(o)
          .filter(([, v]) => !blank(v))
          .map(([k, v]) => `- ${k}: ${text(v)}`),
        "",
      ];

/** Frontmatter in YAML: every value as JSON, which YAML reads as flow style. @param {[string, any][]} entries */
const frontmatter = (entries) => [
  "---",
  `# ${NOTE}`,
  ...entries.flatMap(([k, v]) =>
    Array.isArray(v) && v.some((x) => typeof x === "object")
      ? [`${k}:`, ...v.map((x) => `  - ${JSON.stringify(x)}`)]
      : [`${k}: ${JSON.stringify(v ?? "")}`],
  ),
  "---",
  "",
];

/** @param {any} t @param {Map<string, string[]>} components each component file and the types that use it */
function templateMd(t, components) {
  const files = [
    ["template.json", "the source of every file below"],
    ["frame.md", "tokens, rights, the form"],
    ["editing.md", "rules, rhythm, person shots, captions, sound, the MG vocabulary"],
    ...(blank(t.voice) ? [] : [["voice.md", "fingerprint, delivery, moves, recipe"]]),
    ...[...components].map(([c, names]) => [c, names.join(", ")]),
    ["reference/", "measurement records"],
  ].map(([file, holds]) => ({ file, holds }));
  return [
    ...frontmatter(
      ["name", "slug", "depth", "sources", "canvas", "runtime_s", "slots"].map((k) => [k, t[k]]),
    ),
    `# ${t.name}`,
    "",
    ...(t.about ? [t.about, ""] : []),
    ...section(
      "Kept and swapped",
      table(
        (t.kept ?? []).map((/** @type {any} */ k) => ({ ...k, kept: k.kept ? "kept" : "swapped" })),
        ["what", "kept", "note"],
      ),
    ),
    ...section("Files", table(files, ["file", "holds"])),
    ...section(
      "Limits",
      blank(t.limits) ? [] : [...t.limits.map((/** @type {string} */ l) => `- ${l}`), ""],
    ),
  ];
}

/** @param {any} t */
function frameMd(t) {
  const tokens = Object.entries(t.tokens ?? {});
  return [
    ...frontmatter(tokens),
    `# ${t.name}: frame`,
    "",
    `Rights: ${text(t.rights)}`,
    "",
    ...section(
      "Form",
      table(t.form, [
        "name",
        "start",
        "end",
        "role",
        "share",
        "layout",
        "footage",
        "mg_density",
        "slots",
        "script",
      ]),
    ),
    ...section(
      "Trick",
      blank(t.trick) ? [] : [`${t.trick.start}–${t.trick.end} s: ${t.trick.mechanism}`, ""],
    ),
  ];
}

/** One vocabulary type or hero scene in template.md's field-per-line format. @param {any} v */
function typeEntry(v) {
  const b = v.box;
  const a = v.anchor;
  const anchor = !a
    ? ""
    : a.to === "face"
      ? `; anchor: face, dx ${a.dx}, dy ${a.dy} (face widths, heights)${a.scale_with_face ? ", scales with the face" : ""}`
      : `; anchor: ${a.to}`;
  const share =
    v.face?.share == null
      ? ""
      : ` (on the face box in ${Math.round(v.face.share * 100)}% of sampled frames)`;
  const ev = v.evidence ?? {};
  const evidence = [
    ...(ev.times ?? []).map((/** @type {any} */ s) =>
      String(s).startsWith("ref@") ? s : `ref@${s}`,
    ),
    ...(ev.windows?.length
      ? [`windows ${ev.windows.map((/** @type {string} */ w) => `"${w}"`).join(", ")}`]
      : []),
  ].join(", ");
  return [
    `### ${v.name}`,
    "",
    "```",
    ...(v.status === "unmeasured" ? ["unmeasured: not built until measured"] : []),
    `trigger: ${text(v.trigger)}    frequency: ${text(v.frequency)}`,
    `layers: ${text(v.layers)}`,
    `box: ${b ? `x ${b.x}–${b.x + b.w}, y ${b.y}–${b.y + b.h} px` : ""}${anchor}`,
    `face: ${v.face?.relation ?? ""}${share}`,
    `look: ${text(v.look)}`,
    `build: ${(Array.isArray(v.build) ? v.build : [v.build ?? ""]).join("; ")}`,
    `entry: ${text(v.entry)}`,
    `hold: ${text(v.hold)}`,
    `exit: ${text(v.exit)}`,
    `update: ${text(v.update)}`,
    `evidence: ${evidence}    component: ${text(v.component)}${v.preset ? ` preset ${text(v.preset)}` : ""}`,
    `score: ${text(v.score)}`,
    ...(v.art_style ? [`art style: ${text(v.art_style)}`, `segments: ${text(v.segments)}`] : []),
    "```",
    "",
  ];
}

/** @param {any[]} shots */
const personLines = (shots) => [
  ...table(shots, ["segment", "face_height", "subject_box", "camera", "place", "light"]),
  ...(shots ?? []).flatMap((s) =>
    (s.actions ?? []).map((/** @type {any} */ x) => `- ${s.segment}: ${x.action} — on "${x.on}"`),
  ),
  ...(shots?.some((s) => s.actions?.length) ? [""] : []),
];

/** @param {any} t */
function editingMd(t) {
  const sound = t.sound ?? {};
  return [
    `<!-- ${NOTE} -->`,
    `# Editing rules: ${t.name}`,
    "",
    ...section("Rules", table(t.rules, ["trigger", "treatment", "measured", "evidence"])),
    ...section(
      "MG density per segment",
      table(t.mg_density, ["segment", "events", "mode", "note"]),
    ),
    ...section(
      "Motion rhythm",
      table(t.motion_rhythm, [
        "segment",
        "moving_share",
        "longest_hold_s",
        "median_hold_s",
        "update",
        "camera",
      ]),
    ),
    ...section("Person shots", personLines(t.person_shots)),
    ...section(
      "Footage rules",
      table(t.footage, [
        "segment",
        "kind",
        "era",
        "does",
        "specificity",
        "hold_s",
        "treatment",
        "look",
        "share",
      ]),
    ),
    ...section("Captions", bullets(t.captions)),
    ...section(
      "Transitions and camera",
      table(t.transitions, ["where", "treatment", "measured", "evidence"]),
    ),
    ...section("Sound", [
      ...table(sound.music, ["segment", "mood", "tempo_bpm", "duck_db", "changes"]),
      ...table(sound.rules, ["anchor", "when", "sound", "function", "share", "level", "evidence"]),
      ...bullets(sound.targets),
    ]),
    ...section("MG vocabulary", (t.vocabulary ?? []).flatMap(typeEntry)),
    ...section("Hero scenes", (t.hero_scenes ?? []).flatMap(typeEntry)),
    ...section("What we will not take", [
      ...(t.not_taken ?? []).map((/** @type {any} */ n) => `- ${n.what}: ${n.why}`),
      ...(t.kinds_not_taken ?? []).map(
        (/** @type {any} */ k) => `- Gemini kind \`${k.kind}\`: ${k.why}`,
      ),
      ...(blank(t.not_taken) && blank(t.kinds_not_taken) ? [] : [""]),
    ]),
  ];
}

/** @param {any} v */
function voiceMd(v) {
  const delivery = v.delivery ?? [];
  const cols = [
    ...new Set(["passage", ...delivery.flatMap((/** @type {any} */ d) => Object.keys(d))]),
  ];
  return [
    `<!-- ${NOTE} -->`,
    "# Voice",
    "",
    ...section(
      "Fingerprint",
      typeof v.fingerprint === "string"
        ? [`From \`${v.fingerprint}\` (G1's targets).`, ""]
        : bullets(v.fingerprint),
    ),
    ...section("Delivery", table(delivery, cols)),
    ...section("Moves", table(v.moves, ["segment", "move", "function", "examples"])),
    ...section(
      "Recipe",
      blank(v.recipe)
        ? []
        : [...v.recipe.map((/** @type {string} */ s, i) => `${i + 1}. ${s}`), ""],
    ),
  ];
}

/** Writes TEMPLATE.md, frame.md, editing.md and, when the template has a voice, voice.md from template.json alone.
 * @param {string} dir templates/<slug> @returns {string[]} the files written */
export function renderTemplate(dir) {
  const path = join(dir, "template.json");
  if (!existsSync(path))
    throw new Fix(`no ${path}`, "consolidate template.draft.json into template.json (template.md)");
  let t;
  try {
    t = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Fix(
      `${path} does not parse: ${/** @type {Error} */ (e).message}`,
      "fix the JSON, then render again",
    );
  }
  const components = new Map();
  for (const v of [
    ...(t.vocabulary ?? []),
    ...(t.hero_scenes ?? []),
    { ...t.captions, name: "captions" },
  ])
    if (v.component) components.set(v.component, [...(components.get(v.component) ?? []), v.name]);
  const files = {
    "TEMPLATE.md": templateMd(t, components),
    "frame.md": frameMd(t),
    "editing.md": editingMd(t),
    ...(blank(t.voice) ? {} : { "voice.md": voiceMd(t.voice) }),
  };
  return Object.entries(files).map(([name, lines]) => {
    const out = join(dir, name);
    writeFileSync(
      out,
      `${lines
        .map((l) => l.trimEnd())
        .join("\n")
        .trimEnd()}\n`,
    );
    return out;
  });
}
