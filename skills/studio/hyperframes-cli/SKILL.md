---
name: hyperframes-cli
description: The HyperFrames CLI by job - check, look at frames and motion, edit the timeline, capture, Figma, media, sound, registry - plus reading its JSON and recovering from failures.
---

# HyperFrames CLI

Run `hyperframes <command>` as is: the app puts the CLI version it ships first on the path. Never `npx hyperframes@<version>`. Every command has `--help`; most take `--json`, and a failure prints `✗ …`, a `Fix:` line, and exits non-zero.

## Commands by job

| Job               | Commands                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read a project    | `info`, `compositions`, `timeline --json`, `docs <topic>`                                                                                                               |
| Check it          | `check --json` (lint, runtime, layout, contrast), `lint`                                                                                                                |
| Look at it        | `snapshot` (`--at <t,…>`, `--range START,END`, `--composition <id>`, `--zoom`, `--angle`, `--against <video>`), `keyframes` (motion), `compare` (variants side by side) |
| Edit the timeline | `timeline` with `move`, `trim`, `split`, `set`, `duplicate`, `delete`, `apply`, `undo`, `ids`                                                                           |
| Bring inputs in   | `capture <url>`, `figma asset`, `figma tokens`, `figma component`                                                                                                       |
| Media             | `media-treatment`, `grade-compare`, `remove-background`                                                                                                                 |
| Voice and sound   | `transcribe`, `beats`, `normalize-audio`                                                                                                                                |
| Reuse             | `catalog`, `add` (`hyperframes-registry`)                                                                                                                               |
| Report            | `feedback`                                                                                                                                                              |

`hyperframes docs` lists its topics: data-attributes, compositions, gsap, examples, rendering, troubleshooting.

## Edit the timeline

These are the edits Studio itself makes, so the result stays in Studio's shape.

- `hyperframes timeline --json` lists the clips, one level of nesting deep, with `absStart`, `absEnd`, `file`, `src` and the ref the edit commands take (`#id`; `timeline ids` stamps ids on clips without one).
- `hyperframes timeline move|trim|split|set|duplicate|delete <ref> … --plan --json` previews one edit; run it again without `--plan`. Times are seconds in the clip's own composition; `--start`, `--end` and `--duration` set one edge or the length.
- An edit is refused when the clip would overlap a neighbour on its track (pass `--overwrite`, or move the neighbour first) or end past its composition: raise the root's `data-duration` before moving a clip later.
- Several edits as one change: a file holding a JSON array such as `[{"verb": "move", "ref": "#outro", "time": "9"}]` (verbs `move`, `trim`, `split`, `set`, `duplicate`, `delete`; the other keys are that command's options, the time as a string), then `hyperframes timeline apply plan.json --json` (`--plan` previews). Give every clip sharing a `data-link` the same edit in the same plan.
- Each run prints a `receipt`; save it to a file and `hyperframes timeline undo receipt.json` reverts that edit.
- No command changes a composition's `data-duration`; set the root's yourself.

## Reading results

- `check --json`: fix every error first. While a lint error remains, the layout and contrast audits don't run; "0 samples" means nothing was checked. `--at 1.5,4` samples exact times; `--at-transitions` samples every tween boundary.
- Contrast failures are errors (WCAG AA: 4.5:1, or 3:1 for text 24 px+ or 19 px+ bold); each carries a `suggestedColor` in the same palette direction. `--no-contrast` skips the pass while you iterate.
- A finding seen at only one sample (an entrance or exit in flight) is info and never fails the check. A 3 s+ video with no visible change fails with `sweep_static`.
- Layout opt-outs and lint fixes: the `hyperframes` skill's `references/format.md`.
- `snapshot` writes PNGs under `.hyperframes/artifacts/snapshots/` (`-o` to choose) and adds an end frame unless `--no-end`. Read the images: that is how you see the video.

## When a command fails

| Symptom                                                             | Fix                                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Chrome missing or won't start                                       | `hyperframes browser ensure`                                            |
| A heavy page isn't ready in time                                    | Raise `--timeout` on `check` or `snapshot`                              |
| Video with an unusual codec looks blank                             | Keep `--proxy` on (the default)                                         |
| A tool isn't installed here                                         | `hyperframes doctor`; use your own approach and say so                  |
| `capture` exits non-zero, prints `ok: false` or writes `BLOCKED.md` | Stop: take nothing from its partial files; retry into a new `-o` folder |
