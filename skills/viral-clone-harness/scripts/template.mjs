// `node scripts/template.mjs check|render`: templates/<slug>/template.json is the template's one source. check names
// what template.json still lacks with the fix for each, render writes the md files from it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { renderTemplate } from "./template-render.mjs";
import {
  FACE_RELATIONS,
  FIELDS,
  REQUIRED,
  REQUIRED_UNMEASURED,
  TYPE_FIELDS,
} from "./template-schema.mjs";
import { Fix, parseTool, probe, runMain } from "./tool.mjs";

const USAGE = `usage (from the project folder): node scripts/template.mjs check|render [--slug S] [--ref VIDEO]
  check   what template.json still lacks, each with its fix; exits 1 on errors
  render  TEMPLATE.md, frame.md, editing.md, voice.md from template.json (check's errors printed first)
  --ref   the reference video, so evidence times are checked against its length (default .viral-clone/<slug>/ref.mp4)`;

const VERSION = 1;

/** @param {any} v */
const empty = (v) =>
  v == null || v === "" || (typeof v === "object" && Object.keys(v).length === 0);
/** The project's one template slug, or null. */
function templateSlug() {
  if (!existsSync("templates")) return null;
  const slugs = readdirSync("templates", { withFileTypes: true }).filter((d) => d.isDirectory());
  return slugs.length === 1 ? slugs[0].name : null;
}

const SLUG_HINT = "<slug>";
/** How to fill a missing type field; the rest say what TYPE_FIELDS says the field holds. */
const FIX = {
  box: "read its position from read_video's graphic line and a saved frame (frames with crop), then {x, y, w, h} in reference pixels",
  face: "look at its span with frames and write clear|crosses|covers, or none with no presenter",
  build:
    "list what it is made of from a close crop (frames with crop), each item one a rebuild does or does not do",
  entry: "read_video's motion into it: what moves, from where to where, seconds, ease, overshoot",
  hold: "read_video's keyframes while it holds: still, or what keeps moving",
  exit: "read_video's motion out of it: what moves, from where to where, seconds, ease, overshoot",
  evidence: "cite its seconds on the reference, from read_video's keyframes",
  component: `copy its rebuilt block to templates/${SLUG_HINT}/components/<name>.html and point at it`,
};

/** One vocabulary type's or hero scene's errors. @param {any} v @param {string} what @param {any} ctx */
function checkType(v, what, { dir, end }) {
  const label = `${what} '${v.name ?? "?"}'`;
  const need = v.status === "unmeasured" ? REQUIRED_UNMEASURED : REQUIRED;
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
  for (const t of v.evidence?.times ?? []) {
    const s = Number(String(t).replace(/^ref@/, ""));
    if (!Number.isFinite(s) || s < 0 || (end && s > end))
      out.push(
        `${label}: evidence time ${t} is outside the reference (0–${end} s) — cite a time on its clock`,
      );
  }
  return out;
}

/** What template.json still lacks, each error with its fix. @param {string} dir templates/<slug>
 * @param {{refDuration?: number}} [o] @returns {{errors: string[], warnings: string[]}} */
export function checkTemplate(dir, { refDuration } = {}) {
  const path = join(dir, "template.json");
  const warnings = [];
  if (!existsSync(path))
    return { errors: [`no ${path} — write it (references/template.md)`], warnings };
  let t;
  try {
    t = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return {
      errors: [`${path} does not parse: ${/** @type {Error} */ (e).message} — fix the JSON`],
      warnings,
    };
  }
  const top = ["name", "slug", "depth", "sources", "canvas", "runtime_s", "slots", "form"];
  const errors = top
    .filter((k) => empty(t[k]))
    .map((k) => `no ${k} — ${FIELDS[k].holds} (${FIELDS[k].md})`);
  if (!empty(t.captions) && empty(t.captions.rule))
    errors.push("captions has no rule — write the caption rule in one line, or none");
  if (t.version !== VERSION)
    errors.push(
      `version is ${JSON.stringify(t.version)}, this script reads version ${VERSION} — write "version": ${VERSION}`,
    );
  if (!Array.isArray(t.vocabulary))
    errors.push("vocabulary must be a list of types, [] when the film has none");
  const ctx = {
    dir,
    end: refDuration ?? Math.max(0, ...(Array.isArray(t.runtime_s) ? t.runtime_s : [])),
  };
  for (const v of Array.isArray(t.vocabulary) ? t.vocabulary : [])
    errors.push(...checkType(v, "type", ctx));
  for (const v of t.hero_scenes ?? []) errors.push(...checkType(v, "hero scene", ctx));
  for (const v of Array.isArray(t.vocabulary) ? t.vocabulary : [])
    if (v.status !== "unmeasured" && empty(v.anchor))
      warnings.push(`type '${v.name}': no anchor — a remix with other framing cannot place it`);
  return { errors, warnings };
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
    example: "node scripts/template.mjs check --slug cindy",
    options: { slug: { type: "string" }, ref: { type: "string" } },
  });
  if (!a) return;
  const [cmd] = a.positionals;
  if (cmd !== "check" && cmd !== "render")
    throw new Fix(`unknown subcommand "${cmd ?? ""}"`, "node scripts/template.mjs check|render");
  const slug = a.values.slug ?? templateSlug();
  if (!slug)
    throw new Fix(
      "no single templates/<slug>/ folder here",
      "run it from the project folder, or pass --slug <name>",
    );
  const dir = join("templates", slug);
  const ref = a.values.ref ?? join(".viral-clone", slug, "ref.mp4");
  const r = checkTemplate(dir, { refDuration: existsSync(ref) ? probe(ref).duration : undefined });
  report(r);
  if (cmd === "check") {
    console.log(
      r.errors.length
        ? `${r.errors.length} errors in ${dir}/template.json`
        : `${dir}/template.json: ok`,
    );
    if (r.errors.length) process.exitCode = 1;
  } else console.log(JSON.stringify({ wrote: renderTemplate(dir), errors: r.errors.length }));
}

await runMain(import.meta.url, main);
