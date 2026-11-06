// The fields of templates/<slug>/template.json: the template's one source, which `vc template render` writes out as
// TEMPLATE.md, frame.md, editing.md and voice.md. Each field says where template.md asks for it, so a run never
// invents its own structure. Boxes are pixels on the reference's canvas; times are seconds on its clock.

/** Every top-level field, with the md file it renders into and what it holds. */
export const FIELDS = {
  version: { md: null, holds: "1" },
  name: { md: "TEMPLATE.md", holds: "the format's name" },
  slug: { md: "TEMPLATE.md", holds: "the folder name under templates/" },
  depth: { md: "TEMPLATE.md", holds: '"single" or "creator"' },
  sources: { md: "TEMPLATE.md", holds: "the reference videos, project-relative" },
  canvas: { md: "TEMPLATE.md", holds: "{width, height, fps}" },
  runtime_s: { md: "TEMPLATE.md", holds: "[min, typical, max]" },
  slots: { md: "TEMPLATE.md", holds: "[{key, kind, required, note}]: what the person brings" },
  about: { md: "TEMPLATE.md", holds: "what the format is and who uses it, one paragraph" },
  kept: {
    md: "TEMPLATE.md",
    holds: "[{what, kept: true|false, note}]: the kept-versus-swapped table",
  },
  limits: { md: "TEMPLATE.md", holds: "[text]: known limits" },
  rights: { md: "frame.md", holds: "the Rights: line (answer, who gave it, date)" },
  tokens: {
    md: "frame.md",
    holds: "{colors: {name: #hex}, fonts: [{family, file, use}], grid, caption_skin}",
  },
  form: {
    md: "frame.md",
    holds:
      "[{name, start, end, role, share, layout, footage, mg_density, slots, script}]: the segments in order",
  },
  trick: { md: "frame.md", holds: "trick reels: {start, end, mechanism}" },
  rules: {
    md: "editing.md",
    holds: "[{trigger, treatment, measured, evidence}]: rules, never a timeline",
  },
  mg_density: {
    md: "editing.md",
    holds: '[{segment, events, mode: "one evolves" | "several replace", note}]',
  },
  motion_rhythm: {
    md: "editing.md",
    holds:
      '[{segment, moving_share, longest_hold_s, median_hold_s, update: "ones" | "twos" | "threes", camera}]',
  },
  person_shots: {
    md: "editing.md",
    holds:
      "[{segment, face_height, subject_box, camera, place, light, actions: [{action, on}]}]: framing and actions",
  },
  footage: {
    md: "editing.md",
    holds: "[{segment, kind, era, does, specificity, hold_s, treatment, look, share}]",
  },
  captions: {
    md: "editing.md",
    holds:
      "{rule, font, weight, size_px, color, case, x, y, max_words, max_chars, break_after_punctuation, " +
      "reveal: word | group, entry: {style: fade | pop | cut | type, frames}, highlight, stroke, shadow, component, " +
      "evidence}",
  },
  transitions: {
    md: "editing.md",
    holds: "[{where, treatment, measured, evidence}], camera included",
  },
  sound: {
    md: "editing.md",
    holds:
      "{music: [{segment, mood, tempo_bpm, duck_db, changes}], rules: [{anchor, when, sound, function, share, " +
      "level, evidence}], targets: {event_lift, phrase_lift, palette_size, effects_per_min, max_repeat_per_min}, " +
      "not_effects: [{at, why}]: each reference hit on a picture event that is not rebuilt as an effect}",
  },
  vocabulary: { md: "editing.md", holds: "[type]: the MG vocabulary, one reusable type each" },
  hero_scenes: { md: "editing.md", holds: "[type + {art_style, segments}]" },
  not_taken: { md: "editing.md", holds: "[{what, why}]: what we will not take" },
  kinds_not_taken: { md: "editing.md", holds: "[{kind, why}]: Gemini kinds no type covers" },
  voice: {
    md: "voice.md",
    holds:
      "{fingerprint: {...} or a reference/ path, delivery: [{passage, ...prosody}], moves: [{segment, move, " +
      "function, examples}], recipe: [step]}",
  },
};

/** One vocabulary type's fields. box {x, y, w, h}; anchor {to: "face" | "frame", dx, dy, scale_with_face}: the box's
 * centre minus the face box's centre in face widths and heights; face {relation, share}. */
export const TYPE_FIELDS = {
  name: "a reusable name, not one instance's text",
  kinds: "the Gemini kinds this type covers",
  trigger: "what in the speech or picture brings it on",
  frequency: "how often, per segment kind (median and range at creator depth)",
  layers: "what sits under and around it",
  box: "{x, y, w, h} in reference pixels",
  anchor:
    '{to: "face" | "frame", dx, dy, scale_with_face, face_w: the reference face width when it scales}',
  face: '{relation: "clear" | "crosses" | "covers" | "none", share}',
  look: "colors (sampled), fonts, tokens",
  build: "[item]: what it is made of, each item one a rebuild does or does not do",
  entry: "how it arrives, with times and ease",
  hold: "what it does while on screen",
  exit: "how it leaves",
  update: "on ones or twos",
  evidence: "{times: [s], windows: [motion-windows.json names]}",
  component: "components/<file>.html, relative to the template folder",
  preset: "{variable: value} for a type that shares another's component",
  score: "G0.5's verdict with numbers, or what differs",
  status: '"measured" or "unmeasured" (not built until measured)',
};

/** What a measured type needs before G0.5 builds it; `score` joins once the pieces are scored. */
export const REQUIRED = [
  "name",
  "trigger",
  "frequency",
  "box",
  "face",
  "look",
  "build",
  "entry",
  "hold",
  "exit",
  "evidence",
  "component",
];

/** An unmeasured type says what would bring it on and where it was seen; nothing more is believed. */
export const REQUIRED_UNMEASURED = ["name", "trigger", "evidence"];

export const FACE_RELATIONS = ["clear", "crosses", "covers", "none"];
