---
name: cards-behind-you
description: >
  Use when an agent edits the user's own recorded talking-head take (9:16, locked camera, room around the
  head) so the real things the speaker names land as cards behind their head and shoulders, on the word:
  a page capture in a browser frame, their screenshots and screen recordings, a recreated terminal, chat or
  prompt filled with real content, a grid or a fanned stack of posts. A local matte keeps the speaker in
  front of the cards; verbatim captions ride a rail under the chin; every card moves with its content
  (scrolls to the part being named, pushes into it, a highlight drawn on as the word is said). The agent
  sources a real visual for each named thing from a ladder (the user's files, approved page captures,
  recreated screens, the user's own output, public-domain or CC photos) and never lets words on a card
  stand in for one. A numeric gate fails text-heavy plans, covered focus areas, cards nobody stands in
  front of, cards that sit still and visuals without a source. Trigger on: "cards behind me", "put my
  screenshots behind my head", "background removal template", "show what I'm talking about behind me".
---

# Cards behind you

The user has recorded the take. Each real thing they name lands behind their head the moment they say it,
and the cut-out speaker stays in front. The words and the visuals are theirs: this skill finds the beats in
the transcript, sources the visuals, and builds a HyperFrames composition from a `plan.json` anchored to
transcript words. Caption rail, card entrance, scroll and cut timing are measured from one public
short-form reel of one creator ([references/format.md](references/format.md)).

## When to use / when not

- **Use** for the user's own take on a locked camera, 9:16 or croppable to it, with wall around the head
  (head top at least 15 % down the frame, 240 px clear above it, head under 45 % of the width), when the
  speaker names things a viewer could be shown: apps, sites, posts, files, screens, results, numbers.
- **Do not use** for a moving or handheld camera, a take that cuts between shots, landscape output,
  captions only, a take that names nothing showable, or writing a script (this skill edits a take that
  exists). A take framed too tight fails step 1: offer a wider take, or the `pop-out-split` skill, which
  splits the frame and works with tight takes.

## Requirements and side effects (complete list)

- **Node 22+** and Desktop's bundled `hyperframes` on PATH. Rendering may download its headless
  Chrome into `~/.cache/hyperframes/chrome`. The engine has no npm dependencies.
- **ffmpeg 5.1+ and ffprobe** on PATH, with the `libvpx-vp9` decoder (reads the matte's alpha).
- **Python 3.12+** (`numpy==2.5.3` needs it) with `scripts/requirements.txt` (`numpy==2.5.3`,
  `Pillow==12.3.0`, from pypi.org), in a venv outside this skill and the project:
  `python3.12 -m venv <venv> && <venv>/bin/pip install -r scripts/requirements.txt`. Below, `python3`
  means `<venv>/bin/python3`; the bash scripts take it as `PYTHON=<venv>/bin/python3`.
- **Matte:** `remove-background` runs locally. Its first run downloads `u2net_human_seg.onnx` (about
  170 MB, from github.com/danielgatis/rembg releases) to `~/.cache/hyperframes/background-removal/`.
- **Render time:** the composition loads GSAP 3.14.2 from `cdn.jsdelivr.net` in preview, snapshot and render.
- **Page captures (optional, ask first):** `capture_page.sh` runs the installed Chrome or Chromium
  (`CHROME`, else the macOS app or `google-chrome`, `chromium` on PATH) with a throwaway profile, over a
  pipe (no DevTools port). Chrome fetches the approved URL and everything the page loads.
- **Fonts:** Inter Tight, DM Serif Display Italic and JetBrains Mono ship in `assets/fonts/` with their OFL
  licences ([NOTICE.md](NOTICE.md)); the build copies them into the project. No system fonts.
- **CLI calls home, switched off:** the CLI sends telemetry to `us.i.posthog.com`, checks
  `registry.npmjs.org` for updates daily and `github.com` for skill updates. Every script and command here
  sets `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1`. `snapshot`
  sends frames to Gemini when `GEMINI_API_KEY` is set: always pass `--describe false`.
- **Credentials, paid calls, uploads:** none. Cloud render (`hyperframes cloud render`) spends
  credits on the user's HeyGen account: use it when the video needs it, without asking.
- **Files written:** only inside the project (`aroll/`, `media/` captures, `qc/` with `qc/sources.json`,
  `captions.json`, `fonts/`, `index.html`, `hyperframes.json`, `renders/`), plus the venv. The framing check
  writes three frames to a system temp folder and deletes them; a capture's Chrome profile is deleted when
  it ends. `build.mjs` refuses to overwrite an `index.html` it did not write; `make_fixture.py` refuses a
  non-empty folder without `--force`.

## Inputs

- **Take:** the user's own talking-head video with its voice. A padded take (a landscape picture
  letterboxed into 9:16) fails the framing check, prep and the gate.
- **Transcript:** word level, from any transcriber the user runs: `[{"text": str, "start": sec, "end": sec}]`
  in spoken order. Visuals land on word onsets, so spot-check five onsets against the waveform and shift
  them if all run late. Fix casing in `text` (an ASR lowercases names); never change which words were said.
- **Visuals:** sourced per [references/visuals.md](references/visuals.md) in step 5.

## Workflow

Run from the skill directory; `<project>` is any path (spaces are fine).

1. **Framing first:** `python3 scripts/media_checks.py framing <take>` (`--matte <video with alpha>` if the
   user has one). On `FAIL framing`, stop and tell the user the cards live in the space around the head;
   offer a wider take or the `pop-out-split` skill. Never pad or shrink the take.
2. **Transcript:** `node scripts/check_plan.mjs --transcript <file>`.
3. **Prep:** `bash scripts/prep_aroll.sh <take> <transcript.json> <project> [--matte <video>]` conforms the
   take to 1080x1920 at 30 fps by crop only, levels the voice to -14 LUFS with one linear gain, copies the
   transcript, mattes the speaker, checks the matte, and writes `aroll/head.json` (the head box the card
   slots come from).
4. **Read the take:** `node scripts/read_beats.mjs <project>` prints the sentences, the showable words in
   each, and a media request skeleton. Map beats with [references/beats.md](references/beats.md).
5. **Source the visuals** ([references/visuals.md](references/visuals.md)): for every showable thing, weigh
   the ladder and pick what shows it best. Send the user one media request; capture only URLs they approve;
   use the user's own screenshots or recordings of a named product's UI, and recreate a screen only for
   content that has to animate (a real prompt typing, real CLI output), from real content and a reference
   screenshot; credit licensed images.
6. **Plan:** write `<project>/plan.json` ([references/plan.md](references/plan.md)); give each visual its
   `focus` (the part the viewer must read). The worked example:
   [references/worked-example.md](references/worked-example.md).
7. **Captions:** `python3 scripts/make_captions.py <project>/aroll/transcript.json <project>/captions.json`.
8. **Gate:** `node scripts/check_plan.mjs <project>`. Fix every `FAIL`, pass the `WARN`s on to the user.
9. **Build:** `node scripts/build.mjs <project>`.
10. **Verify:** `bash scripts/verify.sh <project>`, then snapshot the middle of every beat (`beatTimes` in
    `qc/build.json`) and look at each frame:
    ```bash
    HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 \
      hyperframes snapshot <project> --at <beatTimes> --no-end --describe false -o <project>/qc/beats
    ```
11. **Render** only when the user asks (drop `--quality draft` for the final), then check the file:
    ```bash
    HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 \
      hyperframes render <project> --quality draft -o <project>/renders/draft.mp4
    bash scripts/verify.sh <project> <project>/renders/draft.mp4
    ```

**Test only:** `python3 scripts/make_fixture.py <project>` writes a synthetic take, transcript, matte,
placeholder media and the worked example's plan (`--script <file.txt>`: other words, neutral media, no plan).

## Beats

| beat             | from the words                            | kinds                                                                                                        |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| hook             | the first sentence                        | its first visual, or a few big words (`mega`) above the head first                                           |
| each named thing | every showable word                       | a visual behind the head, landing 0.40 s before its word, held to the next visual or the end of its sentence |
| no showable word | a sentence that names nothing             | keep the current visual while it is still the subject, else the speaker alone (under 3 s of speech)          |
| call to action   | only if spoken ("Follow me", "Comment X") | `cta` in front, the speaker's words                                                                          |

Visual kinds, all behind the speaker: `card` (one image), `browser` (a capture with its real URL in the
bar), `stack` (2-4 posts or screenshots fanned, each landing on its word), `grid` (2-6 tiles around the
head), `video` (a clip, muted), `screen` (a recreated `terminal`, `chat`, `prompt` or `editor`), `typing`
(an input bar with the user's real prompt). Text kinds, in front: `mega`, `cta`.

## Placement, cut law and motion

- **Slots** come from `aroll/head.json`: `center` (centred on the head, top at headTop - 0.62 x height, so
  the head covers the card's lower middle), `left` / `right` (portrait, behind one shoulder, inner edge
  60-120 px out from the head's centre line), `wide` (x 40-1040). Cards keep their content's shape at the
  largest size the slot holds; `cover` crops around the focus, `scroll` fills the width. An image with flat
  uniform margins wider than 10 % is trimmed to its content first.
- **The cutout** shows only over the cards on screen (their union, feathered 24 px) and nowhere else, so
  the face and clothes stay the take's own pixels. Its alpha is choked slightly so the room behind the hair
  does not ring the head as a halo on a card.
- **Cut law:** a card enters on a measured pop (scale 0.80 to 1 in 8 frames, full alpha from frame one)
  and exits on a hard cut at the next beat. No fades, slides or idle drift. Motion steps on a 24 fps grid
  inside the 30 fps film.
- **In-card motion follows the content:** `scroll` in wheel bursts (up to 145 px a frame, with holds)
  landing the focus on the word that names it; `push` (scale 1.06-1.12 toward the focus over the hold,
  ease out); `highlight` (a marker sweep or a box, drawn on in 0.35 s on its word); typing in screens;
  swaps in stacks and grids.
- **Text:** captions are verbatim 1-3 word chunks on the rail (Inter Tight 800, 93 px, baseline 1240),
  0.25 s ahead of the voice, off during `mega` and `cta`. Big words stay above the head. Their ink is maroon
  for a warm light wall; on a dark or busy wall set `style.ink` to white with `style.inkShadow`. No line on
  screen ends in a period.
- **Plan values are data:** text is escaped, colours and numbers are checked, every path stays inside the
  project, and the gate fails a script tag, an inline handler or a remote load in the generated markup.

## Gate and verify

`check_plan.mjs` prints one line per beat (focus clear, behind, fill, longest still) and `FAIL <rule>` lines:
`visual-source`, `visual-share` (85 % of graphic time shows a real visual), `visual-fill` (50 %),
`visual-motion` (still at most 1.5 s), `credits`, `focus` (90 % clear of the speaker), `behind` (the
speaker covers at least 8 % of the card), `matte` (nothing the matte kept above the head inside a card),
`cadence` (a change every 3 s of speech), `layout`, `captions`,
`text`, `schema`, `anchor`, `asset`, `aroll`. It warns on a median gap over 1.5 s between visual events and
on any showable word with no visual and no `unshown` reason.

`bash scripts/verify.sh <project> [<render.mp4>]` exits 0 only when all pass: the gate, the build,
`lint` and `check` with 0 errors, three snapshots of the probe times byte-identical, matte alignment and
framing, the caption rail calibration (x-height 50 px, baseline 1240), the voice at -15 to -13 LUFS and
at most -1 dBTP, and with a render its frames, size, rate and loudness. Expected noise: lint warns
`nested_structure_needs_subcomposition` once per beat and `timeline_track_too_dense`.

## Limits

- The matte comes from a person-segmentation model: fine hair flickers, a light card shows a thin halo
  round the hair, and an object near the head can be taken for the person. Prep warns, and the gate's
  `matte` rule fails a card it would cover, until `aroll.matteTop` cuts the rows above the head
  ([references/plan.md](references/plan.md)). An object touching the head cannot be cut that way.
- Slots follow the head's median position; a speaker who moves a lot fails `focus` or `behind`, which name
  the frame.
- The gate measures the plan and the matte, not the rendered pixels: look at every beat's snapshot.
- A recreated screen takes its colours, title and labels from its ref, but its layout is one of four built-in
  arrangements (terminal, chat, prompt, editor): pick the closest and compare the snapshot with the ref. The
  gate checks that the ref exists, not that the copy matches.
