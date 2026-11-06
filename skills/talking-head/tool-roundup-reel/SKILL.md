---
name: tool-roundup-reel
description: >
  Use when an agent turns the user's own recorded 9:16 talking-head take, with its word-level transcript,
  into a reel that recommends a finite list of tools ("N plugins that fix X"). The agent reads what was
  said into beats (the hook: an audience qualifier or shared frustration plus the promise; one section per
  tool: its name, job, mechanism and result; the close) and never writes or changes the words. The edit
  hard-cuts between full presenter, presenter under a graphic, and full-screen graphic, with a median shot
  of about 2 s, and every graphic keeps moving inside its shot (scroll, highlight, count, example swap).
  Measured from two public short-form reels of one creator. Trigger on: "tool roundup reel", "N tools that
  fix", "plugins I recommend video", "talking head listicle with screenshots". Ships a plan.json engine, a
  numeric gate, a synthetic test fixture and verify.sh.
---

# Tool roundup reel

The user has already recorded a take that names a few tools. This skill finds the format's beats in what was
said and edits the take: `plan.json` maps each shot to a word of the transcript, `build.mjs` writes the plate
and a HyperFrames composition, `check_plan.mjs` enforces the measured format. Run commands from this folder.

## When to use / when not

- **Use** when the user has a take recommending a short list of real tools, apps, plugins or services:
  locked-off 9:16, head and shoulders, any background. The measured reels run 45 to 60 s; the gate warns
  outside that band and never asks for a new take.
- **Do not use** before the take exists (this skill does not write or draft what the user says), for a
  single-product demo or launch film, a landscape video, a moving or handheld camera, a take with no screen
  evidence to show, plain subtitles, or anything that replays another creator's reel.

## Requirements and side effects (complete list)

- **Tools:** Node 22+ (the CLI's startup guard), `ffmpeg` and `ffprobe` on PATH. The engine has no npm
  dependencies. Only the test fixture needs Python 3.10+ with `Pillow==12.3.0`:
  `python3 -m venv <venv> && <venv>/bin/python3 -m pip install -r scripts/requirements.txt`.
- **HyperFrames CLI:** call it only through `bash scripts/hf.sh <command>`, which runs
  `hyperframes <command>` with `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1
HYPERFRAMES_SKIP_SKILLS=1` set and forces `snapshot --describe false`. `verify.sh` uses it too.
- **Network, by destination:**
  - `storage.googleapis.com`: the CLI downloads its headless Chrome on first use.
  - `cdn.jsdelivr.net`: the composition loads GSAP 3.14.2 whenever it is opened (check, snapshot, render).
  - Switched off by `hf.sh`: CLI telemetry (`us.i.posthog.com`), its daily update check
    (`registry.npmjs.org`) and its skills update check (`github.com`). Set the three variables yourself if you
    ever call `hyperframes` directly. `snapshot` sends frames to Google's Gemini API when `GEMINI_API_KEY` is set and
    `--describe` is not `false`; `hf.sh` always passes `false`.
  - Optional, local tools that fetch a model on first use: `remove-background` (from `github.com`) and
    `transcribe` (from `huggingface.co`). See [references/inputs.md](references/inputs.md).
  - Optional page capture (ask first): `bash scripts/capture_page.sh <url> <out.png>` opens the URL in headless
    Chrome (`CHROME`, else the installed Chrome or Chromium), which fetches the page and everything it loads.
    Run it only for a URL the user approved. Throwaway profile, no cookies, light theme.
- **Credentials and cost:** none on the default path. Cloud render (`bash scripts/hf.sh cloud render`) needs a
  HeyGen login and spends HeyGen credits: use it when the video needs it, without asking.
- **Fonts:** shipped OFL files in `assets/fonts/` with their licences (Inter, Instrument Serif Italic,
  JetBrains Mono), from google/fonts at a pinned commit. No system fonts. See [NOTICE.md](NOTICE.md).
- **Files:** the engine writes only inside the project: `index.html`, `hyperframes.json` and `meta.json`
  (when missing), and `assets/reel/` (`plate.mp4`, `voice.wav`, `panel-mask.pgm`, `matte-keep.pgm` with
  `split.matte_top`, `plate.key`, `build.json`, `fonts/`). The raw voice is staged in a temporary folder
  that is deleted when the build ends. It refuses to overwrite an `index.html` it did not write. Renders go
  to `<project>/renders/`. The CLI keeps caches in `~/.cache/puppeteer` and `~/.hyperframes/`.
- **Plan content is data:** no plan field is inserted as raw HTML. Text is escaped, colours must be
  `#rrggbb`, numbers are type-checked and every path must stay inside the project.

## Inputs

- **A-roll:** the user's own 9:16 take with audio, at least 720 x 1280, the picture filling the frame
  (a picture padded to 9:16 with flat bars fails the gate). Never another person's footage.
- **Transcript:** `[{"text": "word", "start": 0.15, "end": 0.31}, ...]` in seconds, sorted, from any
  word-level transcriber the user runs. Format, validation and the onset check:
  [references/inputs.md](references/inputs.md).
- **Evidence images:** PNG or JPEG screenshots and icons for each tool, supplied by the user (see B-roll).
- **Optional matte:** a transparent `.webm`/`.mov` or a grayscale `.mp4` of the person, same framing.

## Read the take into beats

`node scripts/read_take.mjs <project>` prints the take as timed lines with word indexes, pauses and cue tags
(`[n=3]` a number, `[ordinal]` "the first", "the second"). Find each beat in those words; the number of
tools is the number of tool sections the take has. Method, cues and a worked reading:
[references/reading-beats.md](references/reading-beats.md).

| Beat      | Find it in what was said                                                                                                                                            | On screen                                                                                                                                                             | Measured (reel 1 / reel 2)                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Hook      | everything before tool 1: the audience qualifier ("If you make talking head videos") or the shared frustration, then the promise ("these three free skills fix it") | 2 to 4 shots, opening on split; a promise graphic counts the tools                                                                                                    | 3 shots each, 4.4 / 6.5 s                   |
| Tool 1..N | an ordinal or the tool's name opens it ("The first one is X"); then its job, the mechanism (what goes in, what comes out) and the result                            | a title (ordinal and name), then evidence: the tool's page under the job, a diagram, terminal or examples under the mechanism, a count or the output under the result | 3 to 7 shots; 6.7 to 13.1 s / 6.5 to 14.2 s |
| Close     | what follows the last tool: where to get them, the ask                                                                                                              | full presenter with a two-line lockup of words said in it, holding                                                                                                    | 3.7 / 4.2 s                                 |

A beat the take lacks is skipped, never written: no hook opens the reel on tool 1, no close ends it on the
last tool, and an unsaid job or result gives that section fewer shots. Beat durations are the user's; the
gate warns outside the measured ranges. The rest of the missing-beat rules are in reading-beats.md.

Words on screen: captions are the transcript; overlays and title cards show words said in their own shot,
plus a tool's name and number on its title (gate `said`); graphic labels and counts reproduce the tool's own
page or output, or the user's words. Every text fits the action-safe area (x 54 to 1026, y 96 to 1824) at
rest, the frame while entering, and its chip, pill or window (gate `fit`). No trailing periods on screen.

## Cut law

- Every boundary is a hard cut. No crossfade, slide or zoom between shots.
- A shot starts on the onset of its first word (the plan's `from` anchor).
- A real take pauses between sentences, and that silence counts toward the hook and every shot.
  `"max_pause": 0.4` keeps 0.4 s of any longer pause at a cut and drops the rest; the jump hides
  under the cut ([plan-schema.md](references/plan-schema.md#pauses)).
- Shots run 0.6 to 4.5 s, median 1.6 to 2.8 s (measured 0.77 to 4.2 s, median 1.97 / 2.20 s).
- Full presenter outside the close stays under 3.0 s (measured longest 2.6 s).
- Alternate layouts: never two presenter or two split shots in a row; two full graphics in a row only with
  different content.
- Cut first, then the graphic enters: large and faint, sharp 0.2 s after the cut, then settles 3 % smaller.
- Layout share is a per-film choice: presenter 20 to 42 %, split 18 to 42 %, full graphic (title cards
  included) 30 to 47 % (measured 25.4 / 35.5, 37.4 / 23.3 and 37.2 / 41.1 %).

Geometry of each layout and the type roles: [references/layout-and-type.md](references/layout-and-type.md).
Captions swap whole, one to two words at a time (measured 1 to 3 words, max 14 characters, median 0.33 s on
screen), never across a cut. A title, overlay or count takes the caption's place while it shows.

## Graphic kinds and in-unit motion

Kinds: `screenshot` (one image in a rounded panel; `scroll`, `push`, `highlight`, `border`, `strike`),
`examples` (2+ images in one panel; `swap`), `diagram` (1 to 5 chips into one output; `build`, `draw`),
`list` (2 to 8 pills or steps; `build`), `terminal` (typed commands and output; `type`, `scroll`), `promise`
(N numerals aimed at a mark; `build`, `progress`) and `title` (the chapter card, revealed on the cut and the
spoken name). `count` works on every kind but promise and title. Measured timings: entrance 0.2 s, push +11 %
over 1.5 s, border trace 0.7 s, count 0.4 s, examples about 0.5 s apart, list items 2 to 3 frames apart. A
graphic or split shot needs at least one motion and never holds still longer than 1.5 s; the entrance and
settle do not count. Fields and anchors: [plan-schema.md](references/plan-schema.md); kinds in detail:
[graphics.md](references/graphics.md).

## B-roll doctrine

- Graphics are evidence: the tool's real page, its output, or a diagram of its mechanism. No stock footage.
- Evidence first, annotation after: the highlight, border or strike lands on content already on screen.
- Screenshots are user-supplied by default. If the agent captures one, name the URL, get a yes, then run
  `capture_page.sh`. Images from elsewhere: public domain, CC0, CC BY or CC BY-SA only, listed in `CREDITS.md`.
- Cards never ship empty: a title card carries the tool's icon and a promise graphic its mark (user-supplied,
  or a capture the user approved), and an image fills at least half the stage. Otherwise the gate warns,
  naming the beat.
- Phone viewers read the caption: enlarge what must be read with `highlight` or `push`. Strike only a
  real rejected example.

## Framing and sound

- `offset_x` on `presenter.full` and `presenter.split` slides the picture sideways (px, positive to the
  right) to centre a person who sits off centre. The gate fails any framing that shows an edge of the take
  (`framing`) and prints the range that keeps it covered; `build.mjs` stops on it
  ([inputs.md](references/inputs.md#fitting-the-framing)).
- The voice is the only sound. `build.mjs` levels it to -14 LUFS under a -1.5 dBTP ceiling with one gain
  (two-pass ffmpeg `loudnorm`, linear mode only, so it never pumps); `verify.sh` and `check_render.sh` print
  the measured loudness and fail outside -15 to -13 LUFS or above -1 dBTP ([inputs.md](references/inputs.md#sound)).

## Build recipe

1. Put the take, transcript and images in a project folder ([references/inputs.md](references/inputs.md)).
2. `node scripts/read_take.mjs <project>`; mark the beats in what was said.
3. Write `plan.json`: one unit per shot, each starting on a word of the take
   ([references/plan-schema.md](references/plan-schema.md); worked example in
   [references/worked-example.md](references/worked-example.md)).
4. `node scripts/check_plan.mjs <project>` until it prints `GATE PASS`. Pass the WARNs on to the user.
5. `node scripts/build.mjs <project>`: plate, levelled voice track, `index.html` (about 5 s for the 29 s
   fixture). `read_take.mjs <project>` now also prints the beat map: confirm each section's words.
6. `bash scripts/verify.sh <project>`.
7. Look at every shot: `node scripts/check_plan.mjs <project> --shots` prints each shot's window and an `--at`
   list; pass it to `bash scripts/hf.sh snapshot <project> --at <list> --no-end`. Fit the framing.
8. Render only when the user asks: `bash scripts/hf.sh render <project> --quality draft -o <project>/renders/draft.mp4`,
   then `bash scripts/check_render.sh <project>/renders/draft.mp4 <project>`.

Edit `plan.json` and repeat from step 4; the plate re-encodes only when cuts, framing or media change. Quote
every path that contains a space.

## Gate

`check_plan.mjs` prints `FAIL <rule>` and `WARN <rule>` lines, then `GATE PASS` or `GATE FAIL` with the
layout shares, and exits 1 on any FAIL or input error. FAILs are what the edit controls: `aroll` (padded
picture), `framing`, `cut`, `unit-length`, `presenter-length`, `median`, `mix` (from 40 s), `adjacent`,
`spine`, `hook` and `section` (shot counts when the beat is long enough; each section opens on a title naming
the tool), `close` (ends on the presenter), `motion`, `dead` (still over 1.5 s), `caption`, `said`, `fit`,
`text`, `count` and the asset checks. WARNs cover what the take decides (the first tool after 7.5 s, a close
under 2.5 s, a length outside 45 to 60 s, a missing hook or close, the hook's number against the sections),
empty cards, text shrunk below 70 %, and what both reels did but a film may skip. Numbers live in
`scripts/lib/format.mjs`; provenance in [references/measurements.md](references/measurements.md).

## Verify

`bash scripts/verify.sh <project>` exits 0 only when: the gate passes and the build matches the current plan
and transcript; `lint` and `check` report 0 errors; the voice track measures -15 to -13 LUFS with a true peak
at most -1 dBTP; and one mid-motion frame captured three times, plus once after a backward seek in a second
session, is byte-identical. Otherwise it exits 1 and lists the causes.

Expected warnings (by design): lint `nested_structure_needs_subcomposition`, `timeline_track_too_dense` and
`duplicate_media_discovery_risk`, check's contrast warning for white type on a light wall, and a
`clipped_text` info while a terminal line types. Why: [references/worked-example.md](references/worked-example.md).

Reviewer run on the synthetic fixture (a test stand-in for a user's take: no real person, no downloads beyond
the pinned CLI, its Chrome and GSAP):

```bash
<venv>/bin/python3 scripts/make_fixture.py "/tmp/trr fixture"
cp references/example/plan.json "/tmp/trr fixture/plan.json"
node scripts/build.mjs "/tmp/trr fixture"
bash scripts/verify.sh "/tmp/trr fixture"
node scripts/check_plan.mjs "/tmp/trr fixture" --plan references/example/fail/long-presenter.plan.json   # exit 1
node scripts/check_plan.mjs "/tmp/trr fixture" --plan references/example/fail/off-frame.plan.json        # exit 1
node scripts/check_plan.mjs "/tmp/trr fixture" --plan references/example/fail/text.plan.json             # exit 1
```

`make_fixture.py` is a test tool; `--script <file.txt>` makes its synthetic take say another text, with neutral
placeholder labels. Every failure input: [references/worked-example.md](references/worked-example.md).

## Limits

- One framing per layout per film: the plate assumes a locked-off camera, and `offset_x` cannot follow a
  person who moves during the take.
- Without a matte the head stays inside the split panel. Matte edges on fine hair can flicker.
- Words are never dropped or reordered: pauses are trimmed only at cuts; a long pause inside a shot stays.
- Captions are grouped automatically; there is no per-word override.
