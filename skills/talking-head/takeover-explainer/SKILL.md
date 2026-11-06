---
name: takeover-explainer
description: >
  Use when an agent edits the user's own 9:16 talking-head take (about 30 to 50 s) into an
  explainer reel where a graphic takes over the frame each time the speaker names something. The
  agent reads the video's word transcript into beats (the hook sentence for word-by-word uppercase
  pills, the named nouns that trigger takeovers, the turn, the ender) and never writes or changes
  words. Cards (browser page, icon tiles, post, clip, diagram, grid, photo fan) fill with the
  user's screenshots, icons and footage, enter through measured glitch or blur-whip transitions
  and leave on a hard cut; 1 to 3 word caption pills run verbatim. Trigger on "talking head with
  b-roll takeovers", "pill captions with card takeovers", "tech explainer reel". Covers tightening,
  beats, card media, the plan, the build, a numeric gate, loudness and verification. Measured from
  6 public short-form reels of one creator.
---

# Takeover explainer

The user's take is one continuous plate. Every noun the speaker names gets a graphic
**takeover** filled with the real thing (page, post, icon, footage) that arrives empty and builds
as the words land. Captions are 1 to 3 words in a pill, verbatim. Cuts follow the sentence, not
the clock, and the words are the take's own. Every number below is measured
([references/measurements.md](references/measurements.md)).

## When to use / when not

- **Use** for a solo, locked-off talking-head take (the user's own, or an avatar render they
  own), 9:16, where the speaker names tools, sites, posts, numbers or steps.
- **Do not use** for interviews, two-person or split-screen formats, a handheld or moving camera
  (the punch-in assumes a locked frame), landscape delivery, plain subtitles with no graphics, a
  take that names nothing to show, or writing a script (this skill edits a take that exists).

## Requirements and side effects (complete list)

- **Inputs from the user:**
  - A-roll: 9:16 video filling the frame (no letterbox bars; the gate fails them) with the voice
    on its audio track, 24, 25 or 30 fps constant frame rate.
  - Word transcript of that file: `[{"text": str, "start": sec, "end": sec}, ...]` from any
    word-level transcriber (segment-level times run late). Check onsets: `ffmpeg -ss <start - 0.2>
-t 0.8 -i <aroll> -vn <project>/onset.wav` should start 0.2 s before the word.
  - Card media they have the right to use: a screenshot of each page and post the speaker
    names, each product's icon, clips, photos ([references/beats-and-media.md](references/beats-and-media.md)).
  - Video needs a keyframe at least every 2 s (the gate warns); `tighten.py` re-encodes the
    plate, re-encode clips with `ffmpeg -i <in> -c:v libx264 -g <fps> <out>`.
- **Tools:** Node 22+ (the CLI's startup guard), the app's HyperFrames CLI, `hyperframes`, on PATH
  (first run may download chrome-headless-shell to `~/.cache/puppeteer`), `ffmpeg` and `ffprobe`,
  Python 3.11+ (tested on 3.12) with Pillow 12.3.0 in a venv outside the skill directory:
  `python3 -m venv ~/.venvs/takeover && ~/.venvs/takeover/bin/python3 -m pip install -r scripts/requirements.txt`;
  run the scripts with it (or `PYTHON=<venv>/bin/python3 bash scripts/verify.sh`). Optional: Chrome
  or Chromium for `capture.py` (`CHROME=<path>` overrides).
- **Network:** GSAP 3.14.2 from cdn.jsdelivr.net at preview and
  render. The CLI also calls us.i.posthog.com (telemetry), registry.npmjs.org (daily update check)
  and github.com (skills check) unless `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1
HYPERFRAMES_SKIP_SKILLS=1` is set: every CLI command below sets all three, `verify.sh` exports
  them. `snapshot` uploads frames to Gemini when `GEMINI_API_KEY` is set: always pass
  `--describe false`. `capture.py` loads one URL and what that page requests, with Chrome's own
  background traffic off: name the URL to the user and wait for approval.
- **Fonts:** Poppins Bold and Inter ship in `assets/fonts/` (SIL OFL 1.1); `build.py` copies them
  and their licences into the project. No system fonts.
- **No credentials, no paid calls.** Everything renders locally; cloud rendering spends credits,
  so use it when the video needs it; you decide, with no question to the person.
- **Files:** the scripts write only inside the project (see Outputs), plus a temp directory
  `tighten.py` and `verify.sh` delete. Without `--force`, `make_fixture.py` keeps an existing
  transcript, plan or A-roll, `build.py` an `index.html` it did not write, `loudnorm.py` any
  existing file; `capture.py` replaces the one `.png` it is given.
- **Plan values:** every string in `plan.json` reaches the page as escaped text (no field takes
  HTML); colours must be `#RRGGBB`; every path must stay inside the project, with no URL scheme.

## Workflow

Put `assets/plate/aroll.mp4`, `transcript.json` and card media under `assets/` in a project
directory outside the skill. Run every command from the skill directory with `<project>` as an
absolute path; [references/worked-example.md](references/worked-example.md) runs them on a fixture.

1. **Tighten the plate:** `python3 scripts/tighten.py <project>`. Every sentence gap over 0.30 s
   is cut to 0.10 s, frame-exact, with a 4 ms audio fade at each seam; writes `aroll-tight.mp4`
   in `assets/plate/`, `transcript-tight.json`, `tighten-edl.json`. Skip it on a tight take.
2. **Read the take into beats:** `python3 scripts/read_beats.py <project>` prints the sentences
   with times and word indices and flags the hook spans, names, numbers, things to show, turn
   words and the call to action. Pick the beats (table below).
3. **Ask for the card media** in one message, one row per card: beat, what the file shows, shape
   ([references/beats-and-media.md](references/beats-and-media.md)). Capture a public page with
   `python3 scripts/capture.py <url> <project>/assets/cards/<name>.png` only once the user approves it.
4. **Write `plan.json`** ([references/plan-schema.md](references/plan-schema.md)), starting from
   [examples/meal-prep/plan.json](examples/meal-prep/plan.json).
5. **Gate the plan:** `python3 scripts/check_plan.py <project> --no-build-check`. Fix every FAIL.
   Each card without media is a WARN that names its beat: ask again, or accept it knowingly.
6. **Build:** `python3 scripts/build.py <project>` writes `index.html` and prints the cut list and
   seam punches. Change `plan.json`, never `index.html`: the next build replaces it.
7. **Verify:** `bash scripts/verify.sh <project>` (gate, lint, check, determinism).
8. **Look:** `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 hyperframes snapshot <project> --at <t1>,<t2> --describe false`
   at every cut + 0.3 s; read each frame in `<project>/snapshots/`.
9. **Render only when the user asks:**
   `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 hyperframes render <project> --quality draft -o <project>/renders/draft.mp4`,
   then `python3 scripts/loudnorm.py <project>/renders/draft.mp4` (writes `draft-final.mp4`) and
   `bash scripts/verify.sh <project> <project>/renders/draft-final.mp4`; no `--quality draft` for the final.

When the transcript or plan changes, repeat from step 5; `verify.sh` fails a stale `index.html`.

## Read the take into beats

| beat        | find it in what was said                                                  | becomes                                                                                   | when it is missing                                                                       |
| ----------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| hook        | the first sentence or two, up to the promise                              | UPPERCASE pills word by word, at most 2 stacked; the promise line is the blue payoff pill | the opening runs past 8 s: end the hook on its last clause before 7.6 s                  |
| named nouns | each product, site, doc, post, price, number or step the viewer could see | a takeover on the first word of the clause; the named element lands on the noun           | no media after asking: a rebuilt card (gate WARN) or stay on talk; never invent a screen |
| turn        | a sentence opening on But, However, So, Instead, Then, Just               | hard cut back to the talking head on that word                                            | return on the next sentence boundary                                                     |
| ender       | a call to action in the last 5 s ("Follow me ...")                        | the Follow pill on that word, labelled with it                                            | leave the ender out; never add one                                                       |

On-screen text is what was said, plus the labels the format allows (URL, spoken price, step
labels, chyron, cover title from the hook's words). The gate warns about label words the take
never says and fails trailing periods.

## Spine (measured)

| time          | beat                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| frame 0       | cover: title pills over a still; the file's first frame is the thumbnail                 |
| 0 to 0.6 s    | hook zoom-out: face crop 2.4x to the talk scale in 15 frames on a measured S-curve       |
| 0 to 8 s      | hook (the measured body starts by 7.6 s)                                                 |
| body          | TALK holds up to 8 s alternating with takeovers, a card swap at least every 6 s          |
| last 3 to 5 s | ender: Follow pill, cursor from the bottom-right, red trace, red fill; captions continue |
| whole film    | 31 to 51 s measured; a take outside it is a warning, never a rewrite                     |

## Cut law

1. **Enter a takeover on the first word of the clause that names the thing.** The card arrives
   empty and builds one element every 2 to 3 frames; the named element lands on the spoken noun.
2. **Return to the talking head with a hard cut on a sentence boundary**, usually on a turn word
   (But, However, So, Then, You). Mid-thought returns use the flicker (type C).
3. **Never jump-cut talk to talk.** The plate runs continuous; framing changes across a takeover.
   A tightening seam left on a visible plate (talk, or under a stacked card) gets a punch-in change
   on its own frame by default: 1.15x about the head, back at the next seam, reset at the next
   cut (`plate.seam_punch`; deliberate, the measured plates show no seams). A cut on it is better.
4. **Transitions only from talk into a takeover.** Card to card and takeover to talk are 1-frame
   hard cuts on clause boundaries (or the flicker return). Two graphics never dissolve.
5. **Cut in the breath:** from 0.26 s before the clause's first word to 0.10 s after its onset
   (transitions start 0.14 s early, or as the previous word ends after a shorter breath, so the
   veil hides the plate seam; hard cuts 0.05 s). Never inside a word (more than 0.06 s from
   both edges), except list beats where each item word swaps its own card (`"list": true`).
6. **Cadence:** no talk hold over 8 s, no card over 6 s without a swap, mean segment length
   at most 4.5 s. A longer hold is a missing graphic.

## Transitions, layouts, type ([references/format.md](references/format.md))

Talk enters a takeover by `glitch` (5 frames through a near-white veil), `whip` (6 frames of
vertical blur, to stacked) or `hard`; swaps and returns are 1-frame `hard` cuts, or the `flicker`
return. Layouts: talk, stacked (card y 111 to 846 over the plate from y 1080), full, clip. Hook
pills: Poppins 700 UPPERCASE 68 px; captions: Inter 700 64 px. **A pill stack holds at most 2
lines** (deliberate; the measured hooks stack 2 to 3): a third line clears the stack by hard cut
on its first word and starts a new one; the cover holds 2. Every variable-length text is measured
against its box and the 40 px margins, pop overshoot included.

## B-roll doctrine: illustrate the noun with the real thing

| the voice names           | card      | fill it with                                                           | motion                                                                                 |
| ------------------------- | --------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| a site, doc, course, app  | `browser` | the page screenshot (`shot`) under traffic lights and the URL          | page builds top-down in 4 strips; cursor + blue selection box on the phrase being said |
| a tool, brand, price      | `tiles`   | each product's icon; one tile can carry its screen or output as `shot` | each tile pops on its noun; red strike L to R on "stop" or "skip"                      |
| a quote or post           | `post`    | the post screenshot (`shot`)                                           | card pops; yellow marker sweeps each quoted line's box in sync                         |
| a news event or demo      | `clip`    | 16:9 footage                                                           | hard cut in and out                                                                    |
| an abstract idea or steps | `diagram` | labels naming the spoken steps                                         | one box per clause                                                                     |
| a quantity or habit       | `grid`    | an icon per cell                                                       | one cell per beat                                                                      |
| a product's output        | `image`   | the photos                                                             | pop, or a fan of up to 3                                                               |

Icon tiles render at the measured sizes: 200 px over the talking head, 220 px in a takeover row,
280 px for one brand tile above its media band. A page, post or tile card with no media (text
tiles, a rebuilt page, fewer than 3 icons and no `shot`) is a gate WARN naming its beat.

## B-roll rights

Cards use files the user provides or confirms they may use, and pages they approve for capture.
Never invent UI for a real product. If the user asks the agent to find other assets: public
domain, CC0, CC BY or CC BY-SA only, with source URL, author and licence in
`<project>/CREDITS.md`. Never download other people's videos or music.

## Audio

The only sound is the plate's voice (clips play muted), so one gain sets the mix. `loudnorm.py`
brings a render to -14 LUFS integrated under a -1 dBTP ceiling (two-pass ffmpeg `loudnorm`, the
video copied); `verify.sh` fails a render outside -15 to -13 LUFS or above -1 dBTP.

## Outputs

`index.html`, `hyperframes.json` (if missing), `takeover-schedule.json` (cut list, seam
punches), `assets/takeover/fonts/`, the tight plate, transcript and EDL, the `-final.mp4`, and
`<project>/snapshots/`; renders go where `-o` points, normally `<project>/renders/`.

## Verify

`bash scripts/verify.sh <project> [render.mp4]` exits 0 only when all of these hold, listing
every cause otherwise:

1. `check_plan.py`: A-roll fills the frame, cut law, hook, 2-line pill stacks, captions, card
   builds, text widths, trailing periods, ender and poses against the measured limits (table in
   [references/measurements.md](references/measurements.md)), `index.html` current. Card media,
   seams, film length and unsaid labels are warnings.
2. HyperFrames `lint` and `check` (the app's CLI, opt-outs set) report 0 errors.
3. One settled frame captured 3 times by `snapshot` is byte-identical.
4. With a render: 1080x1920 at the plate fps, the scheduled frame count, audio, a clean full
   decode, -15 to -13 LUFS and a true peak at most -1 dBTP.

Test input only: `python3 scripts/make_fixture.py <dir> [--script <file>] [--fps 24|25|30]`
writes a synthetic take (silhouette, one tone per word, exact transcript, placeholder media) that
speaks the worked example, or the words in `--script` with neutral placeholders.

## Limits

- The tables are per frame at 25 fps. At 24 and 30 fps every table and frame count is scaled by
  time and rounded to whole frames (the glitch runs 6 frames at 30 fps).
- A plate with a moving camera breaks the fixed punch-in; re-shoot locked off.
- Rebuilt browser elements use Inter, not the product's typeface.
- `snapshot --at` can show the previous frame at a frame boundary (the render does not): to see
  frame f, pass `--at` (f + 0.5) / fps or later.
- On light sets `check` warns about caption contrast (the measured 85% pill is about 2.8:1, and a
  veil frame lower): expected; `"captions": {"opacity": 0.94}` clears the first. Warnings do not
  fail `verify.sh`.
