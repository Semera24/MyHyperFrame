# Writing a Desktop skill

How the skills under `packages/desktop/skills/` are written, wired and checked. It records what the 13 skills already
agree on, the principles behind the newest ones, and the gaps still open (§12). When a skill disagrees with this file
and has a reason, write the reason in the skill; otherwise the skill is the one to change.

## 1. What a skill is for

A skill gets the person to a first cut they want to keep editing: about 80% of the film, finished in the editor. It
does that in two ways, and neither is "teach the person how to make videos":

1. **Help the person say what they want.** People find out what they want by reacting to something concrete. Offer
   sharply different options, listen to what the person says about them, and turn what they say into constraints the
   rest of the run follows. A questionnaire up front gets worse answers than three good options.
2. **Keep the creation diverse.** The same request should not always produce the same film. Defaults are a starting
   point, references the person likes or the agent finds can override them, and the person can pick more than one
   direction or mix them.

So a skill is three layers, each in its own place:

| Layer                 | What it holds                                                 | Can it be overridden?                     | Where                                       |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| **Floor**             | what every output keeps; mostly checked by the gate           | only by the person, in words              | `references/floor.md` + `scripts/<gate>`    |
| **Default direction** | moves measured in work that succeeded, with evidence          | yes: by a reference or the person; say so | `references/techniques.md` and domain files |
| **Way to learn**      | how to find, read and measure references for this one project | n/a (it is a method)                      | `references/study.md` + helper scripts      |

`moments/moment-film` is the reference implementation of all three. The talking-head formats are mostly floor and
default (a fixed format is the point); they still follow the rest of this file.

## 2. Layout

```
<group>/                      one folder per family (launch, moments, talking-head)
  SOURCE.md                   provenance, wiring, sha256 of every file (§10)
  <skill>/
    SKILL.md                  the run, in order; under ~250 lines
    references/               loaded when a step points to them; one job per file
    scripts/                  deterministic work; the gate lives here
    assets/                   templates the run copies into the project (plan, boards, fonts)
    NOTICE.md                 only when it bundles third-party material (fonts, measured data)
```

- SKILL.md is read on every run, so it holds the order of work and the decisions; everything that is lookup goes to
  `references/`. Move a long example or a schema to `assets/` (moment-film's `assets/film.json`).
- A reference over 300 lines starts with a contents list. File names are short and plain (`story.md`, `motion.md`).

## 3. Frontmatter

```yaml
---
name: moment-film # equals the folder name
description:
  "<What it makes, from what inputs.> <When to use it, in the person's words.> <What goes elsewhere
  instead (→ other-skill).> <The gate that must pass.> [keyword, keyword, …]"
---
```

- 300–800 characters. Skills undertrigger, so name the situations generously, including ones where the person never
  says the skill's own word.
- Routing belongs in the description, not only the body: say which messages the skill takes ("every message that
  carries Moments") and which go elsewhere.
- One style for new skills: a double-quoted line with a trailing bracketed keyword list. The talking-head formats'
  folded `>` block with `Trigger on:` phrases is fine where it already exists.

## 4. The body, in order

1. **Pitch** (2–5 lines): what a good result is, and the three layers with their files.
2. **`Order:`** one line, the whole pipeline (`read → study → angle (stop 1) → plan → … → gate → look → reply`).
3. **Modes**, if the person can choose how much they direct (moment-film's storyboard on/off and plan-only).
4. **Read before you ask**: every attachment, the product, earlier projects. Facts before anything creative.
5. **Study** (optional for fixed formats): references for this project (§7).
6. **Options**: the stop where the person chooses (§5).
7. **Plan file**: written before any HTML; the run's memory (§8).
8. **Build** steps, each naming the reference file that governs it.
9. **Gate**, then **look**, then **reply** (§6, §9).
10. **Notes**: how later turns are read and changed.
11. **References**: an index of every bundled file with a one-line gist.

Steps are numbered `## N.` and cited as `SKILL.md §N`; references are cited as `` `references/motion.md` §4 ``. Every
path the SKILL.md names in backticks must exist after unpacking; a test checks it (§10).

## 5. Helping the person say what they want

- **Read first, ask last.** Ask only what the material cannot answer.
- **Options, not questions.** Offer three directions that differ in what the viewer feels and in how they are made,
  recommended one first with a one-clause reason. Each names what it is built on (a finding, a reference).
- **One card.** Ask with one AskUserQuestion: the options plus at most two blockers only the person can answer (real
  UI you lack, narrated or silent). No AskUserQuestion available: end the turn after the options.
- **Never ask about craft** (easing, transitions, fonts) unless the person raised it. Everything else is one assumption
  line: "16:9 for X, about 25 s, silent over music, ends on Try Acme."
- **Unknowns do not block.** Use a labelled placeholder kept in one place, say so, and keep going.
- **Mixes and doubles are allowed.** "A's opening with C's middle" is one direction; two picks are two projects
  (`hf:projects` with `copy: true`) sharing the captured brand.
- **What the person says becomes a constraint**, written into the plan file's `notes`, and every later step follows
  it. The person never has to learn a workflow.
- **Ask once for their taste**: "Got a film whose feel you want? Paste the link or drop the file."

## 6. Floor and gate

- Every skill ships a gate script that must exit 0 before the reply, and the skill says so. A format with no gate
  (camera-3d today) is a gap.
- The gate prints one line per failure, `FAIL <rule>: <what and where>`, then `RESULT: PASS` or `RESULT: FAIL`, and
  exits non-zero on failure. A `--json` mode is welcome.
- `floor.md` lists only what is checked or checkable. A rule the gate cannot see yet is marked as such, not implied.
- After the gate, **look**: `hyperframes snapshot --describe false` at the moments that matter, read by the agent
  itself. Verify with numbers and frames; a sentence like "looks smooth" is not verification.
- Bans are concrete (`repeat: -1`, crossfades, bounce), each with what to do instead.

## 7. Default direction and the study loop

- **Every number has a source**: `<film>@<seconds>` (with a table of the films and their links), a registry block
  name, a measured note, or a named person's practice. A number with no source is removed, not softened.
- **Every default says when not to use it.** That sentence is what lets an agent deviate on purpose.
- **A default never contradicts the floor.** When a measured move breaks the floor, adapt it ("each card moving at
  its cut") or mark it "only when the person asks".
- **References win for their project.** The study loop (`moment-film/references/study.md`): find by what the project
  lacks, not by views; read code and measured notes before watching; measure with FFmpeg, never trust a model's
  numbers; write findings as `id@time → how built → for this project` in the project's boards/refs.md; open the frames before
  building the part that borrows them; compare after building.
- **Sources, best first**: the person's own films, Moments (each has a measured dense.md and its HTML source; `scripts/refs.mjs
moments <words>`), registry blocks, the brand's earlier films.
- **The skill learns through people.** A run ends with candidates for the default direction (seen in 2+ films,
  measured, built well here). A person merges them; an agent never edits a skill during a run.

## 8. The plan file

One JSON plan per project, written before any HTML and kept: it is the plan, the storyboard's source, the gate's input
and what a new session reads instead of the chat. It records the mode, the chosen direction, approval
(`"approved": "<ISO time>"`), what each part borrows, and every note with what changed for it. Today it is
the project's compositions/film.json (launch, moment) or `plan.json` (talking-head); a new skill picks one of those two names.

## 9. Handing off to the editor, and replying

- Build for editing: one composition per beat or scene, named and grouped layers, shared pieces (cursor, logo, outro)
  in single files, and a short project `README.md` saying which layers are locked and which are swappable.
- Write only `index.html`, `compositions/`, `assets/` and, for storyboards, `boards/`. Do not render or start servers:
  the app previews and exports.
- Reply in plain words: what the result says, its length, what is a placeholder, which defaults were broken and why,
  and that the person can comment or draw on the preview. Never claim what the gate or the snapshots did not show.
- Turn feelings into measured changes and change only what was named ("too fast" → 0.7× on every zoom and pan).

## 10. Scripts, money, wiring and checks

- **Scripts**: Node `.mjs`, cited as `node <SKILL_DIR>/scripts/<name>.mjs`: never `sh`, `bash` or a `.sh`, which
  Windows' PowerShell cannot run. A run's PATH always has a `node` (the app's own when the machine has none that
  works). Stdlib only; FFmpeg from `HYPERFRAMES_FFMPEG_PATH`; the app's `hyperframes` on PATH, not an `npx` pin.
  Everything seekable is a pure function of time.
- **Money and keys**: nothing paid before the person approves the plan; stand-ins are labelled. App tools first (HeyGen
  voice, music, generation). No key: degrade (silent over music) and say so in one line. Never put a key in a command
  line, a URL or a prompt.
- **Wiring** (`main/appGuides.mjs`): always-on skills go in the `hyperframes-desktop` plugin; a new skill ships behind
  a feature flag as its own plugin until it is proven; per-format skills load only when picked. A system-prompt
  sentence a skill needs is added behind the same flag (`main/chatRules.mjs`), never unconditionally. One exception, on
  purpose: moment-film took launch-film's content and ships to everyone unflagged (#3943), because launch-film's flag
  was never created and the same skill had already made 8 benchmark films in the app; its rollback is a revert and a
  Desktop release. That is not a precedent: the next new skill ships behind a flag.
- **SOURCE.md**: where the skill came from (person, handoff, date), how it is wired, and the sha256 list, regenerated
  after every edit: `find <skill> -type f | sort | xargs shasum -a 256 | sed 's#  <skill>#  ./<skill>#'`.
- **Checks**: a test that unpacks the skill and asserts every named file exists and the flag gates it
  (`tests/momentFilm.test.mjs` is the pattern for the unpack; a flagged skill also tests its flag). Skill scripts are run by agents, not imported, so the group is listed
  in `knip.jsonc` and `.fallowrc.jsonc` ignores; markdown written here passes `oxfmt --check`, and only folders copied
  verbatim from elsewhere go in `.prettierignore`.
- **Try it before merging a large change**: 2–3 real prompts run with the new and the old skill, outputs compared side
  by side (the launch film benchmark page is the pattern).

## 11. Writing style

- Imperative, plain words, short sentences. Say why a rule exists in one clause; capitals and "MUST" are a sign the
  why is missing.
- Numbers, names and examples instead of adjectives. An example is a real one, traced to its source.
- Tables for lookups, numbered steps for order, prose only for reasons.
- One fact lives in one file; others point to it (`floor.md` §2), never restate it.

## 12. Open gaps in moment-film

1. `avatar.generateVideo` takes a `voice_id` but no speech engine, so an avatar's voice is not held to HeyGen Voice 1.
2. The #Storyboard ability's menu preview (`public/ability-previews/storyboard.*`) is a stand-in built from a test
   film's stills.

Other skills' gaps belong to their owners and are not tracked here.
