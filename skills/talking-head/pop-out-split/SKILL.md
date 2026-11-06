---
name: pop-out-split
description: >
  Use when an agent edits the user's own recorded 9:16 talking-head take, with its word-level transcript, into
  a short film that hard-cuts between the full presenter, a full-frame graphic, and a split: the thing being
  named on top, the presenter in a rounded room panel below with their head breaking out above the panel edge
  over the graphic. Works for any take that names things it can show (a product, an idea, examples, a result,
  steps). Every graphic shows the real thing, picked per beat from a sourcing ladder (the user's files, an
  approved page capture, a recreated screen with real content, their output, a licensed image), and a numeric
  gate fails text standing in for a visual and any split shot whose head does not pop out. Trigger on:
  "pop-out split", "my head popping out over the screenshot", "background removal template", "talking head
  with the product above me". Ships a plan.json engine, the gate, capture and matte scripts, a fixture and
  verify.sh.
---

# Pop-out split

The user has recorded a take. This skill reads what was said into beats, finds a real visual for every thing
the take names, and edits the take: `plan.json` maps each shot to a word of the transcript, `build.mjs` writes
the plate, the pop layer and a HyperFrames composition, and `check_plan.mjs` enforces the format. Run commands
from this folder and quote every path that contains a space.

## When to use / when not

- **Use** for the user's own 9:16 take, locked-off camera, head and shoulders or tighter (a head top near 20 %
  of the frame works: the split scales and places the presenter), naming things that can be shown.
- **Do not use** before the take exists (this skill never writes what the user says), for a landscape take, a
  moving camera, two people in frame, a take that names nothing showable (use a captions format), or to replay
  another creator's reel.

## Requirements and side effects (complete list)

- **Tools:** Node 22+ (the CLI's startup guard), `ffmpeg` and `ffprobe` with `libvpx-vp9` on PATH. No npm
  dependencies. The test fixture alone needs Python 3.10+ with `Pillow==12.3.0`:
  `python3 -m venv <venv> && <venv>/bin/python3 -m pip install -r scripts/requirements.txt`.
- **HyperFrames CLI:** only through `bash scripts/hf.sh <command>`, which runs `hyperframes`
  with `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1` and forces
  `snapshot --describe false`.
- **Network, by destination:**
  - `storage.googleapis.com`: the CLI downloads its headless Chrome on first use.
  - `cdn.jsdelivr.net`: the composition loads GSAP 3.14.2 whenever it opens (check, snapshot, render).
  - `github.com`: `prep_matte.sh` runs the CLI's `remove-background`, which downloads its person model
    (about 170 MB, to `~/.cache/hyperframes/`) on first use. Matting runs on the machine.
  - Switched off by `hf.sh`: CLI telemetry (`us.i.posthog.com`), its update check (`registry.npmjs.org`)
    and its skills check (`github.com`). `snapshot` sends frames to Google's Gemini API when
    `GEMINI_API_KEY` is set unless `--describe false`, which `hf.sh` always passes.
  - Page capture, only for a URL the user approved: `capture_page.sh` opens it in headless Chrome
    (`CHROME`, else the installed Chrome or Chromium) with a throwaway profile, so the page's host and
    everything it loads are contacted.
  - Licensed images, only after the user agrees: the agent downloads them from Wikimedia Commons or
    Openverse ([references/visuals.md](references/visuals.md)).
- **Credentials and cost:** none on the default path. Cloud render (`bash scripts/hf.sh cloud render`) needs
  a HeyGen login and spends HeyGen credits: use it when the video needs it, without asking.
- **Fonts:** shipped OFL files in `assets/fonts/` with their licences (Inter, Instrument Serif Italic,
  JetBrains Mono). No system fonts. See [NOTICE.md](NOTICE.md).
- **Files:** the scripts write only inside the project: `index.html`, `hyperframes.json` and `meta.json`
  (when missing), `assets/reel/` (`plate.mp4`, `pop.webm`, `voice.wav`, masks, cache keys, `build.json`,
  `fonts/`), the matte (`prep_matte.sh`), captures and `qc/sources.json` (`capture_page.sh --project`).
  Renders go to `<project>/renders/`. Temporary folders (the raw voice, Chrome's profile) are deleted when
  each script ends. `build.mjs` refuses to overwrite an `index.html` it did not write. The CLI keeps caches
  in `~/.cache/hyperframes/`.
- **Plan content is data:** no plan field is inserted as raw HTML. Text is escaped, colours must be
  `#rrggbb`, numbers are type-checked and every path must stay inside the project, also through links.

## Inputs

- **A-roll:** the user's own 9:16 take with audio, at least 720 x 1280, the picture filling the frame.
- **Transcript:** `[{"text": "word", "start": 0.15, "end": 0.31}, ...]` from any word-level transcriber the
  user runs ([references/inputs.md](references/inputs.md)).
- **Matte, always:** `bash scripts/prep_matte.sh <take> <project>/assets/aroll-matte.webm`, or a matte the
  user supplies.
- **Visuals:** one per beat that names something showable, from the ladder below.

## Every graphic shows the real thing

For each beat that names something showable, list the candidate sources and pick the one that shows it
best. Prefer the real thing (the user's file or a capture) over a recreation, and a recreation over a
licensed photo. The full rules, the ask, capture failures and the credit files:
[references/visuals.md](references/visuals.md).

| Source     | Use it for                                                                                                    | How                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`     | anything the user has: screenshots, recordings, photos, exports                                               | ask once, listing every beat that wants a visual                                                                                                   |
| `capture`  | a named product, site, repo, doc page, article, app store page, public post                                   | name the URL, get a yes, `bash scripts/capture_page.sh <url> <out.png> --project <project>`                                                        |
| `screen`   | a UI state no public page shows: a prompt typed, a chat, a terminal with its real output, a file in an editor | a recreated screen from plan data with real content, its look taken from the product's own screenshot (`ref`: a logged capture or the user's file) |
| `output`   | the user's own result: a render, a before and after                                                           | the user's file, or a frame or clip of it                                                                                                          |
| `licensed` | physical things, places, ideas with no page or UI                                                             | public domain, CC0, CC BY or CC BY-SA, credited in `CREDITS.md`                                                                                    |

A word, a chip, a pill list, a box-and-arrow diagram or a terminal with made-up commands is not a visual.
Title cards and the text kinds (`diagram`, `list`, `promise`) count as text and only annotate a beat that
also shows the real thing. When nothing on the ladder shows a beat, it gets no graphic and the speaker
carries it.

## Read the take into beats

`node scripts/read_take.mjs <project>` prints the take as timed lines with word indexes, pauses and cue tags
(`[n=3]` a number, `[ordinal]` "the first", "then there's", `[show]` a showable word), then a list of every
showable word: the basis of the one ask. Method and a worked reading:
[references/reading-beats.md](references/reading-beats.md).

| Beat         | Find it in what was said                                                                                   | On screen                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Hook         | everything before the first thing the take names                                                           | 2 to 4 shots, opening on split                                                                                                            |
| Section 1..N | each thing the speaker names and talks about for a while: a product, an idea, an example, a result, a step | its visual first; a title card only when the take introduces it by name or ordinal ("The first one is", "Then there's X", "so I built X") |
| Close        | everything after the last section                                                                          | full presenter, a two-line lockup of words said in it                                                                                     |

A beat the take lacks is skipped, never written. Words on screen are words said in their shot (gate `said`).

## Layouts and the pop-out

- **Presenter:** the take scaled `presenter.full.scale`, cropped at `anchor_y`.
- **Split:** the visual on the stage (x 80, y 110, 920 x 720), the caption rail at baseline 940, the
  presenter in the room panel (x 20 to 1060, top 1200, radius 200) with the head breaking out above its top
  edge. The head is its own layer (`pop.webm`, cut from the matte) drawn over the graphic.
- **Graphic:** the visual on the full stage (x 80, y 230, 920 x 940), the caption at baseline 1390.
- **Gate `pop`:** on every split shot, measured from the matte at the shot's middle frame, the head top sits
  at least 90 px above the panel edge (the measured split: about 190) and at least 16 px below the caption
  box, and the eye line stays inside the panel or at most 40 px above it. On a fail it prints the
  `presenter.split.y` range, or the `split.scale` (up to 3, for a small head), that passes. The take's
  background inside the panel's top edge and the canvas differ by a contrast ratio of 1.25 or more, or the
  panel edge vanishes: a light wall needs a darker `style.canvas`. `presenter.split.matte_top` drops objects
  the matte keeps above the head.
- **Gate `focus`:** each visual names `focus: [x, y, w, h]` (fractions of the image); on split shots at least
  90 % of it stays clear of the popped-out head. A push zooms into the focus and a scroll ends on it.

Geometry, type roles and the fit rules: [references/layout-and-type.md](references/layout-and-type.md).

## Cut law

- Every boundary is a hard cut, on the onset of a word (`from`). `"max_pause": 0.4` shortens long silences at
  cuts ([plan-schema.md](references/plan-schema.md#pauses)).
- Shots run 0.6 to 4.5 s, median 1.6 to 2.8 s. A full presenter shot outside the close stays under 3.0 s.
- Never two presenter or two split shots in a row; two full graphics in a row only with different content.
- Layout shares: presenter 20 to 42 %, split 18 to 42 %, graphic 30 to 47 % (a fail from 40 s, a warning below).
- The graphic enters large and faint, sharp 0.2 s after the cut, then settles 3 % smaller. Captions swap
  whole, one or two words at a time.

## Graphic kinds and in-shot motion

Real visuals: `screenshot`, `examples`, `video` (a muted clip), `browser` (a capture under its real URL),
`screen` (`terminal`, `chat`, `prompt`, `editor`, recreated from plan data). Format text: `title`, `diagram`,
`list`, `promise`. Motion follows the content: scroll to the part being named, push into the focus, a highlight
drawn on as its word is said, typing, an example swap, a count of a figure the user says. A visual never sits
still longer than 1.5 s, entrance and settle aside. Fields and defaults: [plan-schema.md](references/plan-schema.md);
kinds: [graphics.md](references/graphics.md).

## Gate

`node scripts/check_plan.mjs <project>` prints `FAIL <rule>` and `WARN <rule>` lines, then `GATE PASS` or
`GATE FAIL`, and exits 1 on any FAIL or input error. FAILs: `aroll`, `framing`, `cut`, `unit-length`,
`presenter-length`, `median`, `mix` (from 40 s), `adjacent`, `spine`, `hook`, `section`, `close`, `motion`,
`dead`, `caption`, `said`, `fit`, `text`, `count`, and the visual rules: `pop`, `focus`, `visual-source`
(every real visual names its `source` and an existing file, a `screen` its `ref` and `ref_source`),
`visual-share` (85 % of graphic screen time shows a real visual; title cards and text kinds count against
it), `visual-fill` (an image fills half its slot), `visual-motion`, `credits` (licensed credits in
`CREDITS.md`, capture URLs in `qc/sources.json`). WARNs cover what the take decides: beat lengths, a missing
hook or close, the hook's number. Numbers: `scripts/lib/format.mjs`; provenance:
[references/measurements.md](references/measurements.md).

## Build recipe

1. Put the take and transcript in a project folder; make the matte with `prep_matte.sh` and look at one frame.
2. `node scripts/read_take.mjs <project>`; mark the beats; send the user one message listing every showable
   beat (its cue word and what would show it) and the URLs you propose to capture.
3. Gather the visuals from their answers: their files, approved captures, recreated screens, licensed images.
4. Write `plan.json` ([plan-schema.md](references/plan-schema.md); worked example in
   [worked-example.md](references/worked-example.md)).
5. `node scripts/check_plan.mjs <project>` until `GATE PASS`. Pass the WARNs on to the user.
6. `node scripts/build.mjs <project>`, then `bash scripts/verify.sh <project>`.
7. Look at every shot: `node scripts/check_plan.mjs <project> --shots`, then
   `bash scripts/hf.sh snapshot <project> --at <list> --no-end`.
8. Render only when the user asks: `bash scripts/hf.sh render <project> --quality draft -o <project>/renders/draft.mp4`,
   then `bash scripts/check_render.sh <project>/renders/draft.mp4 <project>`.

## Verify

`bash scripts/verify.sh <project>` exits 0 only when the gate passes and the build matches the plan and
transcript, `pop.webm` is VP9 with alpha and has the plate's frame count, `lint` and `check` report 0 errors,
the voice measures -15 to -13 LUFS with a true peak at most -1 dBTP, and one mid-motion frame captured three
times, plus once after a backward seek, is byte-identical. Expected warnings:
[references/worked-example.md](references/worked-example.md#expected-warnings).

Reviewer run on the synthetic fixture (no real person, no downloads beyond the app bundled CLI, its Chrome and GSAP);
every failure input is in [references/worked-example.md](references/worked-example.md#failure-inputs):

```bash
<venv>/bin/python3 scripts/make_fixture.py "/tmp/pos fixture"
cp references/example/plan.json "/tmp/pos fixture/plan.json"
node scripts/build.mjs "/tmp/pos fixture"
bash scripts/verify.sh "/tmp/pos fixture"
node scripts/check_plan.mjs "/tmp/pos fixture" --plan references/example/fail/no-pop.plan.json      # exit 1, pop
node scripts/check_plan.mjs "/tmp/pos fixture" --plan references/example/fail/text-only.plan.json   # exit 1, visual-share
node scripts/check_plan.mjs "/tmp/pos fixture" --plan references/example/fail/focus.plan.json       # exit 1, focus
```

## Limits

- One framing per layout per film; the plate assumes a locked-off camera.
- The eye line is estimated from the matte's silhouette; hair over the shoulders falls back to the head width.
- Matte edges on fine hair can flicker over the graphic. An even wall is keyed out of the matte's edge; a busy
  background is not, so its colours can ring the head.
- The gate checks provenance fields and files, not whether a capture or a recreated screen is truthful;
  the agent names each source to the user.
