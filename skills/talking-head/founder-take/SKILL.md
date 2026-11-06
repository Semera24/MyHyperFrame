---
name: founder-take
description: >
  Use when an agent should edit the user's existing seated talking-head video (one contrarian lesson told to
  camera, 25-45 s) into the founder-take reel format with HyperFrames, from the video and its word-level
  transcript: a written hook title that restates the user's opening line over a punched-in pull-back, 1-2 word
  translucent caption pills, thesis and turn lines as a small lead plus a heavy italic punch with a dark halo, a mega
  word for a one-word answer, a cyan stat for a number the user says, stacked photo cards on the narrative nouns,
  and the key question as a quote on a push-in. Every on-screen word but the title is the user's own, on the frame
  it is said. Every curve, size and timing is measured from 6 public short-form reels of one creator. Trigger on:
  "founder take", "contrarian lesson reel", "founder talking-head reel", "make my A-roll look like a founder reel".
  Covers reading the take into beats, tightening it, plan.json, the numeric gate, build, overlay render, a
  loudness-normalised composite and verification. It does not write scripts or make footage.
---

# Founder take

One lesson, already told to camera. The edit makes the user's argument legible: title, thesis punch, evidence
cards, turn, proof number, the question, all read out of what they said. Every curve and size comes from
`references/presets.json`; never re-tune by eye. Vary b-roll per film.

## When to use / when not

- **Use** on the user's finished take (their own recording, or one they own the rights to): seated, locked-off,
  one speaker, one argument, 16:9 or 9:16 source, with a word-level transcript of it.
- **Do not use** to write, rewrite or approve a script, or to record or generate footage; for interviews,
  multi-speaker or handheld footage, plain subtitles, tutorials with screen recordings, or films over a minute. The
  format has no end card or call-to-action card.

## Requirements and side effects (complete list)

- **Tools:** Node 22+ and the app's HyperFrames CLI, `hyperframes` (Desktop puts it on PATH); `ffmpeg` and `ffprobe`
  on PATH; Python 3.12+ (numpy 2.5.3 needs it) in a venv outside the skill, then activated so `python3` is the venv's:
  `python3 -m venv ~/.venvs/founder-take && ~/.venvs/founder-take/bin/pip install -r scripts/requirements.txt`
  (numpy 2.5.3, Pillow 12.3.0), `source ~/.venvs/founder-take/bin/activate`.
- **Chrome** for font metrics (`scripts/metrics.py`, used by the gate and the build): `$CHROME` if set, else Google
  Chrome or Chromium in the usual macOS, Linux and Windows locations. It runs headless on its own temporary profile
  with background networking off and loads only a local page. The HyperFrames render browser works too:
  `CHROME="$(HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 hyperframes browser path)"`.
- **Fonts:** Instrument Sans 500 / 500 italic and Mona Sans 800 italic ship in `assets/fonts` (OFL, see
  `NOTICE.md`); no font is downloaded.
- **Network:** `registry.npmjs.org` (the CLI's daily update check, off with
  `HYPERFRAMES_NO_UPDATE_CHECK=1`); Google's storage (the CLI may download Chrome Headless Shell, about 100 MB, on
  first use); `cdn.jsdelivr.net` (GSAP 3.14.2 whenever the composition loads: preview, check, snapshot, render);
  `us.i.posthog.com` (CLI usage telemetry, off with `HYPERFRAMES_NO_TELEMETRY=1`); `github.com` (the CLI's skills
  check in an interactive terminal, off with `HYPERFRAMES_SKIP_SKILLS=1`); Google Gemini (`snapshot` sends frames
  when `GEMINI_API_KEY`, `GOOGLE_API_KEY` or Vertex settings are present, unless given `--describe false`).
  Every CLI command below and `verify.sh` set the three switches, and `verify.sh` passes `--describe false`.
  Nothing else leaves the machine.
- **Credentials and cost:** none. Rendering is local. A HyperFrames cloud render spends the user's credits: run one
  when the video needs it, without asking.
- **Files:** writes only inside the project: `assets/aroll/aroll-tight.mp4`, `transcript-tight.json`,
  `cuts.json`, `plan.json`, `index.html`, `zoom.json`, `font-metrics.json`, `assets/fonts/`, `assets/cards/gen/`
  (regenerated on each build), `renders/`; plus the venv you create. The build refuses to overwrite an `index.html`
  it did not write. Temporary files go to the system temp dir and are removed.

## Inputs

1. **A-roll:** the user's video, seated, mic in frame, headroom for a 1.31x punch-in, the picture filling the frame
   (letterbox or pillarbox bars in the crop window fail the gate: crop to the picture first). Any fps; it needs an
   audio stream (the voice).
2. **Word clock:** `[{"text": str, "start": sec, "end": sec}, ...]` from any word-level transcriber the user runs,
   sorted by start. Check it: `python3 scripts/check_clock.py --video take.mp4 --transcript words.json` (exit 1 when
   the onsets run late on median; plain Whisper often does). It reads a raw or a tightened take.
3. **B-roll:** user-supplied images for the cards (one per noun the user names), an optional logo (white on
   transparent), a screenshot of the source behind the stat (user-supplied, or a capture the user approved). If the
   user wants the agent to source images: ask first, use public domain, CC0, CC BY or CC BY-SA only, list each in
   `CREDITS.md` (title, author, licence, URL). Never redraw a copyrighted character or invent UI. A mostly empty card
   (an icon or a short label on a flat field) is a gate WARN.
4. **Music (optional):** a file the user supplies and has the rights to. Never download or rip a song.

## Read the take into beats

`python3 scripts/read_take.py <words.json> --words` prints the clock as numbered lines with frames. Find each beat
in what the user said; `references/reading-beats.md` has the cues and a worked reading.

| beat         | find it in what the user said                                     | treatment                                                                                            | when the take has none               |
| ------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------ |
| hook         | the first line: often a credential plus a contrarian claim        | hook title: a written frame of that line (question or curiosity frame), 110-145 f, no pills under it | never missing                        |
| thesis       | 1-2 short claim lines after the hook ("It doesn't X. It just Y.") | lead (the clause head) + punch (the payoff phrase) per line, hard cut between                        | no punch                             |
| before-state | the story of the old way and its concrete nouns                   | 1-2 word pills + one photo card per noun                                                             | pills only                           |
| turn         | the line that flips it ("But now ...")                            | punched-in cut that pulls out; lead + word-by-word punch, underline steps on                         | pills                                |
| list         | 2-3 parallel items                                                | pills + one card per item                                                                            | pills                                |
| answer       | a one-word answer said aloud, often to their own question         | spread words (what leads into it) + mega word, push-in ending on the cut                             | no mega                              |
| proof        | a name and a number the user says                                 | logo on the name; lead + cyan stat (the spoken number and unit); screenshot of the source            | no number: no stat; no name: no logo |
| question     | the key question ("you should ask: ...")                          | lead + `ask:` (when they say "ask"), then the quote word by word on a ~20% push-in                   | skip                                 |
| close        | the last line or two                                              | pills only (no logo outro, no call-to-action card)                                                   | never missing                        |

- **Verbatim:** every on-screen word but the hook title is the user's, in order, inside its beat. Allowed: caps on
  big type, digits for spoken numbers ("fifty thousand" -> `50,000`), dropped fillers and false starts,
  punctuation, quote marks. Never add, swap, paraphrase or reorder a word. The gate fails anything else.
- **Hook title:** the one written element. It restates the user's own hook in their words and never adds a claim,
  name or number (the gate warns on a word the hook line lacks and fails on a number the take never says).
- **Missing beats** are skipped, never written. The film needs only the title, pills and the close.
- **No trailing period** on any on-screen line (an ellipsis is fine).
- **Durations come from the take.** The gate compares them with the corpus (film 25-45 s, title 110-145 f, pill hold
  mean 15-22 f, a big-type beat every 4-11 s) and warns; it never asks for a re-take or new words.

## Laws

- **Cut:** A-roll jump cuts fall on sentence boundaries and always coincide with a graphics change; on a
  continuous take, emulate them with zoom cuts. Pills cut in on their chunk's first spoken word (median 0 f) and
  swap contiguously. Pills and big type never share a frame. A card stack is cleared by a hard cut before the next
  big-type beat. Exits are hard cuts; only the hook title (t² fade), logo, stat and its lead fade.
- **Zoom:** the footage carries punch-zooms. Spread words, turn punch words, mega, `ask:`, stat, quote and logo ride
  them about (360, 640); a lead or thesis punch rides only with `"ride_zoom": true` (set it on a lead beside a riding
  beat: the turn, stat and `ask:` leads). Nothing rides while it enters: it holds the scale it lands at, then follows
  the zoom. Pills, cards and screenshots never ride. Hook: open punched in at 1.12-1.31x and pull to rest, tau 37-54
  f. Thesis (default): **hold** - cut to 1.14-1.25x on the first thesis line (no thesis: on the cut where the title
  leaves) and keep that framing static through the pill-and-card stretch after it, until the turn's cut, which lands
  at least 5% from the held scale. A pull-out to rest under the thesis stays available. Other big-type beats: a cut
  to 1.14-1.25x that pulls out (tau 17-28 f, settles in 1.3-2.2 s), or a 1.12-1.25 push that lands ON the punch,
  mega word or quote and ends on the cut. No move over 3% inside a pill-and-card stretch.
- **Density:** one big-type beat every 4-11 s, pairs 0.5-2 s apart. **Type:** white text, the dark halo
  (`presets.halo`) behind all big type; on a light wardrobe or backdrop set `light_ground: true` (and `halo: true` on
  the logo). Instrument Sans for pills, leads, spread and quote; Mona Sans 800 italic for the rest.
- **Motion** (the engine applies it): hook `"enter": "smooth"` (default) is ONE move, a 0.7 s power3.out fade plus
  36 px rise, no scale, no zoom ride. Thesis punch: slow blur-rise (20 f from +88 px). Mega: fast rise (12 f) with
  vertical smear. Leads, turn words, stat tokens, `ask:` and quote words cut on. Cards rise, blur and fade over 8 f
  and stack with a linear-light blend. `tempo` (1.0-3.0) and the eases `inout` / `sine` slow a calmer take.

Geometry, the safe area and every field: `references/plan-schema.md`.

## Workflow

Run every command from the skill directory; `<proj>` is the user's project directory.

1. Put the take in `<proj>/assets/aroll/`, the word clock beside it, card images in `<proj>/assets/broll/`.
2. `python3 scripts/check_clock.py --video <take> --transcript <words.json>`
3. Tighten the pauses (it only removes silence): `python3 scripts/tighten_aroll.py --video <take> --transcript
<words.json> --out-dir <proj>/assets/aroll` (pads: `--gap-max 0.30 --pad-after 0.21 --pad-before 0.04 --lead-in
0.12`; cut points come from the audio). The 0.25 s of breath sits after each line so the join lands 0-2 f before
   the next word, where the overlay changes. Skip it for an already tight take and plan on the original files.
4. Read the take into beats: `python3 scripts/read_take.py <proj>/assets/aroll/transcript-tight.json --words`. Ask
   the user for the images the nouns name (cards, logo, screenshot) before planning them.
5. Write `<proj>/plan.json` (`references/plan-schema.md`): copy `examples/make_plan.py` to `<proj>/make_plan.py`,
   point its anchors and beats at this take's words, delete the beats it does not have, and run
   `python3 <proj>/make_plan.py <proj>` from the skill directory.
6. Gate: `python3 scripts/check_plan.py <proj>` must print `GATE PASS`. Read every WARN.
7. Build: `python3 scripts/build_format.py <proj> --no-plate` (exit 1 when ink does not fit). To preview with the
   footage in the page, build without `--no-plate` and run the preview below; rebuild with `--no-plate` before
   step 9 (the overlay render must be transparent).
   ```bash
   HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 \
     hyperframes preview <proj>
   ```
8. `bash scripts/verify.sh <proj>`
9. Overlay (PNG frames are lossless at any quality setting):
   ```bash
   HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 \
     hyperframes render <proj> --format png-sequence -o <proj>/renders/overlay --quality draft
   ```
10. Final: `python3 scripts/composite_format.py <proj> <proj>/renders/overlay <proj>/renders/<name>.mp4`
    (`--crf 12 --preset slow` by default; `--crf 20 --preset veryfast` for a quick look). It mixes the voice and the
    bed, then gives the whole mix one fixed gain to -14 LUFS integrated under a -1.5 dBTP ceiling (two-pass ffmpeg
    `loudnorm` in linear mode, 0.5 dB of margin for the AAC encode; a limiter takes down only the peaks that gain
    would push over), so the voice never pumps and the bed keeps its `gain_db` under it.
11. `bash scripts/verify.sh <proj> <proj>/renders/<name>.mp4`, then look at a full-resolution frame of every beat:
    nothing clips a frame edge, leads read, cards land on their nouns.

**Output:** `<proj>/renders/<name>.mp4`, 720x1280, 30 fps, H.264 + AAC at -14 LUFS: the zoomed, cropped A-roll under
the overlay, voice (and music) muxed.

## Verify

- `check_plan.py` (exit 1 on any FAIL; every check in `references/plan-schema.md`, Gate): verbatim words, the hook
  title, trailing periods, the hook, pill, card and zoom laws, letterbox bars, and every text element inside the
  safe area on every frame, entrances and zoom rides included. WARNs name the beat (an off-sync word, an empty-looking
  card, the take's durations against the corpus, a jump cut with no overlay change).
- `verify.sh <proj> [final.mp4]` (exit 1, every cause listed): the gate, a current build, `lint` and `check` with
  0 errors (sampled at every beat's rest frame), three snapshot runs of the same three times byte-identical, and
  with a final video: 720x1280, 30 fps, `plan.frames` frames, an audio stream, a clean full decode, -15 to -13 LUFS
  integrated and a true peak at or under -1 dBTP (both printed). `PYTHON` overrides `python3`.

## Test without personal media

```bash
T="<an empty directory outside the skill>"
python3 scripts/make_fixture.py "$T"
python3 scripts/tighten_aroll.py --video "$T/assets/aroll/fixture-aroll.mp4" \
  --transcript "$T/assets/aroll/fixture-transcript.json" --out-dir "$T/assets/aroll"
python3 examples/make_plan.py "$T"
python3 scripts/check_plan.py "$T"
python3 scripts/build_format.py "$T" --no-plate
bash scripts/verify.sh "$T"
HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 \
  hyperframes render "$T" --format png-sequence -o "$T/renders/overlay" --quality draft
python3 scripts/composite_format.py "$T" "$T/renders/overlay" "$T/renders/fixture.mp4" --crf 20 --preset veryfast
bash scripts/verify.sh "$T" "$T/renders/fixture.mp4"
```

The fixture stands in for the user's take: a drawn silhouette in a plain room, one tone burst per word of 11 lines
(30 s), an exact word clock, placeholder cards, logo, screenshot and pad. Test only: `--script lines.txt` synthesises
a take saying your sentences (one per line) to exercise a new plan; it never makes a film. To see the gate fail,
change a pill's text to a word the take does not say and rerun `check_plan.py`.

## Limits

- The final is 720x1280 (the measured canvas); `--resolution` cannot upscale it by 1.5.
- The fonts are stand-ins (best free match about 0.75 IoU to the originals) and cover Latin only.
- The composite reads the A-roll at 30 fps; a 25 fps source repeats frames.
- The verbatim check reads English number words; other spoken languages need digits in the transcript.

## References

- `references/reading-beats.md`: how to find each beat in the transcript, the verbatim rules, a worked reading.
- `references/plan-schema.md`: every plan.json field, beat type, zoom curve, tempo, music option and gate check.
- `references/presets.json`: every measured curve, table and geometry.
- `references/measurements.md`: the 6-reel corpus ledger (treatment, zoom and b-roll laws with counts).
- `examples/make_plan.py`: the worked plan for the fixture take.
