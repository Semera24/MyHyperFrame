---
name: ai-breakdown-reel
description: >
  Use when an agent needs to make a 9:16 AI-news breakdown reel in HyperFrames from the user's own talking-head
  video and its word-level transcript: one narrator explains one AI story, and every word that names something
  (a lab, a product, a person, a post, a page, a mechanism step) hard-cuts to a visual for it. The agent reads
  the take into beats (the hook, each named entity, the mechanism steps, the CTA word only if the narrator says
  one) and writes no narration. FULL and SPLIT narrator plates cut from one 16:9 take, a 2-line hook title, brand
  cards, a turning mechanism diagram, post cards, page screenshots, user-supplied clips, 1-3 word caption pills,
  a "Comment <word>" CTA, a music bed, soft clicks and a -14 LUFS mix. Includes the plan-driven build engine and a
  numeric gate measured from two public short-form reels of one creator. Trigger on "AI news reel from my video",
  "breakdown reel about <tool or launch>", "turn my take into a breakdown reel", "talking head with b-roll on
  every name".
---

# AI breakdown reel

The narration is the shot list. Every word that names something the viewer can be shown gets a hard cut on the
first frame of that word. The narrator plate runs continuously under every layout; layouts cut around it.
Output: 1080x1920, 30 fps, as long as the user's take (the measured reels run 40 to 50 s).

## When to use / when not

- **Use** when the user has a take: one narrator, one AI story (a launch, a release, a repo, a paper), a
  locked-off 16:9 camera, and narration that names products, people or companies, ideally with a how-it-works.
- **Do not use** before there is a take (this skill writes no narration), for a take that names nothing
  showable, for interviews or multi-speaker takes, handheld footage, or landscape delivery. Plain subtitles on
  a talking head are a different job. A take over 60 s builds, with a gate warning.

## Requirements and side effects (complete list)

- **Tools:** Node 22 or newer, `ffmpeg` and `ffprobe` on PATH, and the app's HyperFrames CLI,
  `hyperframes`, for every command (Desktop puts it on PATH; no separate download). Python 3
  for `plates.py` (standard library only). Python 3.12 or newer for `make_fixture.py`, which needs
  `scripts/requirements.txt` (numpy 2.5.3, Pillow 12.3.0) in a virtual environment outside the project:
  `python3 -m venv "<venv>" && "<venv>/bin/pip" install -r scripts/requirements.txt` (pip downloads both from
  pypi.org), then run it with `"<venv>/bin/python3"`. Chrome or Chromium only for `capture-page.mjs`.
- **Fonts:** Anton and Inter Tight ship in `assets/fonts/` under the SIL Open Font License; `build.mjs` copies
  them into the project, and `textfit.mjs` reads their widths for the text-width law. See [NOTICE.md](NOTICE.md).
- **Network:**
  - The composition loads GSAP 3.14.2 from cdn.jsdelivr.net whenever it is previewed, checked, snapshotted or
    rendered.
  - `capture-page.mjs` loads the one URL the user names, plus whatever that page loads. Ask before each capture.
  - The HyperFrames CLI sends anonymous usage telemetry (us.i.posthog.com), checks registry.npmjs.org for a
    newer version once a day, and in an interactive terminal checks github.com for skill updates, unless
    `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1` are set. `verify.sh`
    sets all three; every CLI command below carries them.
  - `snapshot` sends frames to Gemini when `GEMINI_API_KEY` is set. Always pass `--describe false`
    (`verify.sh` does).
  - For word timings, reuse an existing transcript or call Desktop’s `voice.transcribeAudio`.
    Transcription uses HeyGen Scribe v2 and requires an internet connection.
- **Credentials and cost:** none. A HyperFrames cloud render spends credits on the user's account; run one when
  the video needs it, without asking. The default render is local.
- **Files:** every tool in `scripts/` writes only inside the project folder the user chooses: `assets/aroll/` (plates,
  `vo.m4a`, `plates.json`), `assets/audio/`, `assets/fonts/`, `beats.md`, `index.html`, `ledger.json`,
  `hyperframes.json`, `renders/`, and `snapshots/` (step 8). `capture-page.mjs` writes (and overwrites) the one
  PNG it is given. `verify.sh` snapshots into a temporary folder it deletes. Nothing is uploaded. The HyperFrames
  CLI keeps its own state outside the project: `~/.hyperframes/`, a frame cache in the system
  temp folder, and on first render a headless Chrome it downloads to `~/.cache/puppeteer/` when it finds no Chrome.
- **Media rights:** b-roll is user-supplied. Never download other people's videos or music. See
  [references/broll.md](references/broll.md).

## Inputs

- **A-roll:** the user's own talking-head take, 16:9 (4K best), with audio, narrator centred and looking at the
  lens, camera locked off, the picture filling the frame (`plates.py` stops on a take padded with flat bars and
  prints the crop that removes them). Get the face box from one still:
  `ffmpeg -v error -ss 2 -i take.mp4 -frames:v 1 still.png`, then read the face centre x, y and its width
  (cheek to cheek) in source pixels.
- **Word clock:** `transcript.json` for the take, a JSON array `[{"text": "word", "start": 0.16, "end": 0.24}]`
  in seconds, one entry per spoken word, sorted, from any word-level transcriber. `build.mjs` and `check.mjs`
  reject anything else. Check onsets: cuts land on `start`, so a clock that runs late makes every cut late.
  `ffmpeg -i vo.m4a -af silencedetect=n=-35dB:d=0.2 -f null - 2>&1 | grep silence_end` prints where speech
  resumes after each pause; compare those times with the `start` of the first word after each pause. If the
  starts run late by a steady amount, set `"wordShift"` to minus the median gap (e.g. `-0.08`) in the plan.
- **B-roll:** files the user supplies or approves, listed in `assets/broll/credits.json`
  (`{"<path>": {"source": "...", "rights": "..."}}`).
- **Music (optional):** a file the user has the rights to.

## Workflow

Run commands from this skill's folder. `<project>` is the user's project folder; quote it.

1. **Plates.** `python3 scripts/plates.py "<take.mp4>" "<project>/assets/aroll" --face CX,CY,W` writes
   `plate-full.mp4`, `plate-split.mp4`, `plate-hook.mp4`, `plates.json`, and `vo.m4a` levelled to -14 LUFS,
   -2 dBTP by measured two-pass ffmpeg loudnorm in its linear mode: one gain for the whole take, so the voice
   keeps the take's loudness swing (a look-ahead limiter first shaves only the peaks that gain would push past
   -2 dBTP; timing unchanged). It stops rather than fall back to loudnorm's dynamic mode, and prints where the
   face lands in each plate and the narration loudness and loudness range before and after.
2. **Word clock.** Transcribe the take or `vo.m4a` into `<project>/transcript.json` (format above).
3. **Beats.** Read the take into beats with [references/beats.md](references/beats.md): the hook, each named
   entity and the visual it gets, the mechanism steps for the diagram, the CTA word only if the narrator says
   one. Write `<project>/beats.md`. Never add or change the narrator's words; a missing beat is skipped.
4. **B-roll.** Per name, the asset kind in [references/broll.md](references/broll.md): logo marks, post cards
   (`post.json` quoting the post word for word), page screenshots (`node scripts/capture-page.mjs <url>
<out.png>`, after the user agrees), user-supplied clips. Ask the user for every name still without one.
   Credit every file in `credits.json`.
5. **Plan.** Copy [examples/plan.json](examples/plan.json) to `<project>/plan.json` and rewrite it from
   `beats.md`: one shot per trigger word, `mustShow` = every name the narration says, diagram nodes = this
   story's products, a CTA shot only for the narrator's CTA. Fields: [references/plan.md](references/plan.md).
   Geometry, type, motion: [references/layouts.md](references/layouts.md).
6. **Build.** `node scripts/build.mjs "<project>/plan.json"` writes `index.html` and `ledger.json` and prints
   the shot table and the film length (`dur`, never past the end of `vo.m4a`). It sets the CTA word smaller than
   196 px only when it would not fit (printed). Missing b-roll renders as a magenta MISSING block and fails the
   gate; a missing plate, a bad word clock, an unknown trigger word, or a plan value that fails its type check
   (colours `#rrggbb`, numbers, plain CSS, paths inside the project; see references/plan.md) stops the build.
   It never overwrites an `index.html` or `ledger.json` it did not write.
7. **Audio.** `bash scripts/audio.sh click "<project>/assets/audio/click.wav"`, then
   `bash scripts/audio.sh bed "<music>" "<project>/assets/audio/bed.m4a" <start_s> <dur> --under "<project>/assets/aroll/vo.m4a"`
   (sets the bed 18 dB under the levelled narration, so the mix lands at about -14 LUFS).
8. **Verify.** `bash scripts/verify.sh "<project>"`. Then snapshot one time per shot into `<project>/snapshots/`
   (`HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 hyperframes snapshot "<project>" --at <t1,t2,...> --no-end --describe false`)
   and look at every frame. A name spoken over the narrator is a missing visual: restage it.
9. **Render** when the user asks:
   `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 hyperframes render "<project>" --quality draft -o "<project>/renders/draft.mp4"`
   (drop `--quality draft` for the final), then `node scripts/check.mjs "<project>" --render "<project>/renders/draft.mp4"`.

After a plan or word clock edit, rerun steps 6 and 8.

## Try it on the fixture

`make_fixture.py` is a test tool. It builds a synthetic stand-in for a user's take (a room plate with a
head-and-shoulders silhouette, one tone per word, an exact word clock, Pillow-drawn screens and marks, a
stand-in music pad) for the worked example in [examples/](examples/): [examples/beats.md](examples/beats.md) is
that take read into beats. No downloads, no real people. `<project>` must be a new or empty folder.

```bash
"<venv>/bin/python3" scripts/make_fixture.py "<project>"
python3 scripts/plates.py "<project>/assets/aroll/take.mp4" "<project>/assets/aroll" --face 960,380,300
cp examples/plan.json "<project>/plan.json"
node scripts/build.mjs "<project>/plan.json"                 # dur 24.246s
bash scripts/audio.sh click "<project>/assets/audio/click.wav"
bash scripts/audio.sh bed "<project>/assets/audio/music.wav" "<project>/assets/audio/bed.m4a" 0 24.246 --under "<project>/assets/aroll/vo.m4a"
bash scripts/verify.sh "<project>"
HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 \
  hyperframes render "<project>" --quality draft -o "<project>/renders/draft.mp4"
node scripts/check.mjs "<project>" --render "<project>/renders/draft.mp4"   # expects 727 frames (+-1)
```

Test only: `--script "<narration.txt>"` (plain text, kept outside `<project>`) makes the stand-in narrator speak
other words, to exercise the engine on a new beat table and plan. With `--script` the placeholders carry no
example names: three marks (`mark-triangle.png`, `mark-star.png`, `mark-leaf.png`), `chat.png`, `site.png`,
`stage.mp4` and a `post.json` to edit.

## Verify

`verify.sh` exits 0 only when all four steps pass, and prints every failing cause:

1. `check.mjs`, the numeric gate: cuts within 1 frame of their trigger onsets, median shot 0.8 to 1.6 s, no
   diagram shot over 9 s and no other shot over 4.5 s, layout mix, `mustShow` coverage, a CTA only where the
   narrator gives one, caption and headline rules, every text element inside the action-safe area (x 54 to 1026) at rest and inside the frame on its widest entrance frame, no line ending in a period, plate framing,
   no letterbox or pillarbox bars in a plate, bed level, the mix at -15 to -13 LUFS (target -14) and -1 dBTP or
   lower, zero missing or uncredited assets, inert `html` media. Each law and its measured basis:
   [references/gate.md](references/gate.md).
2. `hyperframes lint`: 0 errors.
3. `hyperframes check`: 0 errors.
4. Determinism: the busiest diagram frame, captured 3 times with a seek elsewhere between captures, is
   byte-identical (in the CLI's software renderer, `--no-browser-gpu`).

The gate prints WARN lines that never fail it; read each one to the user: a take outside the measured length or
pace (R1, R2), a card with no media (M6, the beat named), a small brand mark (M7), a spoken "comment" with no CTA
shot (L2), characters the fonts lack (T7). With `--render`, `check.mjs` also measures the render's own loudness
(D4). Other warnings that do not fail verify: `composition_file_too_large` (one generated file),
`duplicate_media_discovery_risk` when one screenshot is reused (page shot and CTA card), and, depending on the
story, `rotation_pivot_drift` on the turning ring and a contrast note on the hook title over light media.

## Vary per film

A hook title compressed from this take's hook, the products' own brand colours on their cards, diagram nodes
that are this story's products (2 to 6), a diagram only when the narrator describes a mechanism (otherwise
product-UI clips per verb), and the CTA word the narrator says, or no CTA. Never reuse the example's copy,
assets or CTA word.

## Limits

- The diagram ops (`query`, `answers`, `exchange`, `rank`, `crown`, ...) model 2 to 6 named products on a ring
  that receive, send, pass or rank something, with an optional hub. Other mechanisms need product-UI clips or a
  new op in `diagram-runtime.js`.
- `plates.py` crops one fixed face box; a narrator who moves a lot drifts out of the SPLIT and HOOK windows.
- The 9:16 FULL plate crops a 16:9 source by 1.8x at 1080p; a 4K take stays sharp.
- Text widths come from the fonts' advance widths without kerning (a little wide, the safe side); the post
  card's wrapped text is not width-checked.
