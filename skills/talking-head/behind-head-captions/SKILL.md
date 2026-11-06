---
name: behind-head-captions
description: >
  Use when an agent captions the user's own talking-head take (one speaker, a locked shot, 9:16 or
  croppable to it) in two tiers: in each caption block one emphasis word is set huge in a stretched red
  serif behind the speaker's head, so the head covers its middle letters, and the other words sit small
  and white in front, under the chin. The words are the transcript's, verbatim. The emphasis word is
  picked automatically (a number, a proper noun, then the longest content word) and placed from the
  speaker's head, measured on a local matte. Trigger on: "big word behind my head", "text behind the
  speaker captions", "behind-the-head captions", "red serif word behind me", "background removal
  captions". A plan.json of word-indexed blocks drives the build; a gate checks the words, timing,
  framing and how much of each big word the speaker covers, and verify.sh checks the result.
---

# Behind-head captions

Each caption block shows from its first word to the next block's first word. Its emphasis word fades in
huge behind the speaker's head; the other words appear one by one in white under the chin. Type, sizes,
colours and timing were measured from snapshots of an earlier HyperFrames build of this style
([references/look.md](references/look.md)). The words, the emphasis choice and the placement come from the
user's take.

## When to use / when not

- **Use** on the user's own talking-head take: one speaker, a locked camera, 9:16 or croppable to it, the
  head at least 15 % of the frame width with its centre 25-60 % down the frame, plus a word-level
  transcript.
- **Do not use** for a moving or handheld camera, cuts between takes, two or more people in frame,
  landscape output, a speaker the person-matting model cannot separate, or writing a script (this skill
  captions a take that exists). A take outside the framing limits fails step 1, and the message says what
  to change.

## Requirements and side effects (complete list)

- **Node 22+** and Desktop's bundled `hyperframes` on PATH. Snapshots and renders use its headless
  Chrome, which it may download from `storage.googleapis.com` into `~/.cache/hyperframes/chrome`.
- **ffmpeg and ffprobe** on PATH, with the `libvpx-vp9` decoder (it reads the matte's alpha).
- **Python 3.12+** (`numpy==2.5.3` needs it) with `scripts/requirements.txt` (`numpy==2.5.3`,
  `Pillow==12.3.0`, from pypi.org). Make the venv in any folder outside this skill and the project:
  `python3.12 -m venv <venv> && <venv>/bin/pip install -r scripts/requirements.txt`. Below, `python3`
  means `<venv>/bin/python3`; the bash scripts take it as `PYTHON=<venv>/bin/python3`.
- **Matte:** `remove-background --quality best` runs locally. Its first run downloads the
  person-segmentation model `u2net_human_seg.onnx` (about 170 MB, from github.com/danielgatis/rembg
  releases) to `~/.cache/hyperframes/background-removal/`. The framing check runs it on three frames
  first.
- **Render time:** the composition loads GSAP 3.14.2 from `cdn.jsdelivr.net` in preview, snapshot and
  render.
- **Fonts:** Instrument Serif and Playfair Display Italic ship in `assets/fonts/` with their OFL licences
  ([NOTICE.md](NOTICE.md)); the build copies them into the project. No system fonts.
- **CLI calls home, switched off:** the HyperFrames CLI sends telemetry to `us.i.posthog.com`, checks
  `registry.npmjs.org` for a newer version once a day, and checks `github.com` for skill updates in an
  interactive terminal. `prep_take.sh`, `verify.sh` and `media_checks.py` set
  `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1`, and every CLI
  command below carries the same three. `snapshot` sends frames to a hosted vision model (Gemini) when
  `GEMINI_API_KEY` is set, so every snapshot passes `--describe false`.
- **Credentials, paid calls, uploads:** none. HyperFrames cloud render (`hyperframes cloud render`)
  spends credits on the user's account: use it when the video needs it, without asking.
- **Files written:** only inside the project (`aroll/`, `plan.json`, `fonts/`, `index.html`,
  `hyperframes.json`, `qc/`, `renders/`), plus the venv you make. The framing check writes three frames
  to a system temp folder and deletes them. Each step overwrites its own outputs; `make_blocks.mjs`
  refuses to replace `plan.json` without `--force`, and `build.mjs` refuses to overwrite an `index.html`
  it did not write. `make_fixture.py` refuses a non-empty folder without `--force`.

## Inputs

- **Take:** the user's own talking-head video with its audio (the voice track). A take letterboxed into
  9:16 fails with the crop to apply.
- **Transcript:** word level, from any transcriber the user runs, as
  `[{"text": str, "start": sec, "end": sec}, ...]` in spoken order. Words appear on their start times,
  so spot-check five onsets against the waveform; if every start runs late by about the same amount,
  shift them before prep. Captions show each `text` as written, casing included: fix a misheard word in
  the transcript, never in the plan.

## Workflow

Run from the skill directory; `<project>` is any path (spaces are fine).

1. **Prep:** `bash scripts/prep_take.sh <take> <transcript.json> <project>` checks the take and its
   framing, conforms it to 1080x1920 at 30 fps by crop only, levels the voice to -14 LUFS with one
   linear gain, mattes the speaker locally and measures the head into `aroll/head.json`.
   `--matte <video with alpha>` conforms the user's own matte instead of making one. On `FAIL framing`,
   stop and give the user the message: it says what to change in the shot.
2. **Blocks:** `node scripts/make_blocks.mjs <project>` writes `plan.json` and prints every block with
   its emphasis word.
3. **Review:** read the blocks. Move an emphasis, merge or split blocks if a line reads badly
   ([references/plan.md](references/plan.md)); never change a word.
4. **Gate:** `node scripts/check_plan.mjs <project>`. Fix every `FAIL` line and run it again. Each
   occlusion failure prints the `shift` that fixes it.
5. **Build:** `node scripts/build.mjs <project>` writes `index.html`, `hyperframes.json`, `fonts/` and
   `qc/build.json`, and prints review times, one per emphasis word.
6. **Verify:** `bash scripts/verify.sh <project>` (below). Then snapshot the review times and look at
   each frame:
   ```bash
   HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 \
     hyperframes snapshot <project> --at <review times> --no-end --describe false -o <project>/qc/review
   ```
7. **Render** only when the user asks (drop `--quality draft` for the final), then verify the file:
   ```bash
   HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 \
     hyperframes render <project> --quality draft -o <project>/renders/draft.mp4
   bash scripts/verify.sh <project> <project>/renders/draft.mp4
   ```

**Test only:** `python3 scripts/make_fixture.py <project>` writes a synthetic take (a drawn figure in a
plain room, one tone per word of `examples/fixture-script.txt`), its exact transcript and its exact matte
into `<project>/input/`. Prep it with `--matte <project>/input/matte.webm`. `--script <file.txt>` voices
other words. Never use it for a user's film.

## Blocks and timing

- A block ends after end punctuation, before a pause over 0.25 s, or at 4 words. One block holds at most
  one emphasis word and at most 3 small words.
- **Emphasis**, in priority order: a number, a proper noun not at the start of a sentence, then the
  longest content word of 4+ letters; never a stopword or a single character, never the same word
  twice within 10 s, and only a word that stays up 10 frames or more. `make_blocks.mjs` gives 45 % of the blocks one (35-60 %) and fills any stretch over
  4 s that holds a candidate.
- A block shows from its first word to the next block's first word, the last one to the end of the take.
  Its emphasis word fades in over 0.1 s (power2.out) on its own start; the small words appear on their
  starts with no tween; the next block hard-cuts in.
- Each word shows as written minus a trailing period, comma, colon, semicolon or ellipsis, so no line ends
  in a period.

## Placement from the head

- The emphasis word keeps the measured type at any length: 200 px, scaled to 1000 px wide but at most
  4.5x its own width (a short word sits narrower, centred), and 2.8x tall about its bottom centre.
- The speaker's crown sits 48 % of the way down the word: the head covers the lower middle letters and
  the word's top stays clear above the hair. The word centres on the head's x as far as the frame allows
  (20 px from each edge). Head moves under 12 px (crown) or 40 px (centre) from the take's median do not
  move it.
- A block's `shift` (px, + down) moves its word. `make_blocks.mjs` sets one when the head-derived place
  leaves the word outside 17-58 % covered: the same shift on every emphasis word when one value suits
  them all, so they stay at one height.
- The speaker cutout shows only while an emphasis word is up, masked to that word's box plus a 30 px
  feather, and cut 16 px above the highest crown of the word's window: anything the matte keeps above
  the head (a bowl on a shelf, a lamp) stays behind the word, and the gate does not count it as cover.
  Everywhere else the face and clothes come from the plate.
- The small words' line box sits at y 1150, or 40 px under the lowest chin when that is lower, and must
  end above y 1500.

## The gate

`check_plan.mjs` exits 1 and prints every cause:

- **Verbatim:** every transcript word in exactly one block, in order, as written (`text` must equal the
  transcript's words).
- At most one emphasis word per block. Warnings: a share outside 35-60 %, a stretch over 4 s without one,
  a hand-picked stopword, an emphasis word up under 10 frames, a word squeezed under half its width.
- Every block on screen at least 5 frames; small words at most 3 per block, fitting 980 px (shrunk to
  75 % at most).
- **occlusion:** at the emphasis word's middle frame the matte covers 15-60 % of its box (ascender line to
  baseline, 1000 px wide). Under 15 % the word is behind no one; over 60 % it cannot be read.
- **ends:** the first and last 12 % of the word's width stay at least 80 % clear.
- **Layout:** when small words show under it, the emphasis word's ink stays 6 px above theirs.
- **Framing:** head width at least 15 % of the frame, head centre 25-60 % down, small words above y 1500.
- **Plan values are data:** colours `#rrggbb`, fonts from the shipped list, paths inside the project,
  text escaped; it fails on a script tag, an inline handler or a remote load in the generated page.

## Verify

`bash scripts/verify.sh <project> [<render.mp4>]` exits 0 only when all of these pass, and prints every
cause otherwise:

1. The gate, then 2. the build (each stops verify on failure).
2. `hyperframes lint` and 4. `check` with 0 errors.
3. Determinism: the review frames snapshotted 3 times are byte-identical.
4. The matte lines up with the plate (size, rate, frame count) and holds a speaker.
5. Look calibration: on a page on black, in the project's look, the emphasis word's stretched height and
   baseline land within 4 px of the geometry computed from the font file (and its edges within 6 px for
   Instrument Serif), in its colour, and the small words' baseline lands at y 1257 +-3, where the
   reference build put it.
6. Layering: in each review frame with an emphasis word, at most 2 % of the solid speaker shows word ink
   and at least 5 % of the word's box around the head does.
7. The voice track at -15 to -13 LUFS integrated and at most -1 dBTP.
8. With a render: it decodes with the build's frame count, 1080x1920, 30/1 and audio, and meets step 9.

Expected noise, not failures: lint warns `timeline_track_too_dense` and
`nested_structure_needs_subcomposition` (one composition file by design); `check` may warn on contrast
where a word crosses a light wall.

## Looks

The red look is the default and the only preset. `style.color`, `style.stroke` and `style.shadow`
(`#rrggbb`) and `style.font` (`"Instrument Serif"`, or `"Playfair Display"` at 800 italic) are validated
overrides for the emphasis word ([references/plan.md](references/plan.md)).

## Limits

- The reference build set its word higher, above a wide shot's head: the matte covered 2 % of it. This
  skill keeps that type and moves the word down until the head covers its middle
  ([references/look.md](references/look.md)).
- The matte comes from a person-segmentation model: fine hair flickers at the word's edge. An object it
  takes for the speaker above the head is cut away; one beside the head (a plant, a chair back) covers
  the word too. Look at the review frames.
- The small words are white with a soft dark shadow, as measured. Over light clothing (a cream knit)
  they stay readable but low in contrast; look at the review frames.
- The chin is read from a silhouette: on two takes it landed within 30 px of the visible chin; under a
  high crew neck it read the collar line, about 90 px low. A low estimate only matters when it passes
  y 1110, where it starts pushing the small words down.
- One speaker, one framing, a locked camera. A head that reaches past x 140 or x 940 covers an end of the
  centred word: prep warns, and `make_blocks.mjs` keeps fewer emphasis words, at uneven heights.
