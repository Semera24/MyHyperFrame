# Gates and checks

Five gates keep money and render time from going into a wrong draft. One set of checks then goes into `RESULT.md`.
A gate that fails is fixed (rewrite, regenerate, rebuild) before going on; three rounds at most, then stop and report
the failure as a failure. G2 counts renders rather than rounds: the whole film renders once, as v0; each fix after it re-renders only its own seconds (below). "Noted in RESULT.md and moved on" is not a pass.

## G0: the evidence, before writing the template

The template is only as good as the frames that were read. Before writing it, the evidence in `.viral-clone/<slug>/`
and its records in `templates/<slug>/reference/` hold:

- the 1 FPS overview of every reference film, every sheet read (or the helpers' per-second logs for long films);
- `dense.md` listing, per reference: the frames before and after every cut candidate it relies on; one close-up
  window at native frame rate per graphic type the remix builds, for its entry, its hold **and** its exit; a 6–8 FPS read of every action in a
  span you will generate, with its target; caption frames at two word starts; for a trick reel, the trick inventory;
- `motion-rhythm.mjs` output for every reference film;
- for speech, `fingerprint.mjs` over the creator's transcripts and `prosody.mjs` over each kind of passage;
- for music, the music map with tempo per section; for sound, the sound map and palette.

At creator depth, only on-format videos count ([watch.md](watch.md#depth-one-video-or-a-creator)). Anything missing is
`unmeasured` in the template and is not built from imagination. Last, `node scripts/vc.mjs template check` passes on `template.json`.

## G0.5: the pieces, before the script (talking-head, creator and UGC remixes)

Every graphic type, title and transition in `editing.md` is a block in `components/`, placed 1:1 over the
reference's own footage on its clock in `.viral-clone/pieces/index.html`, and scored over its whole window, entry,
hold and exit ([template.md](template.md#components-rebuilt-and-scored-one-at-a-time)). This is the only step where
the rebuild and the reference share one clock and one frame: a difference G0.5 lets through is never caught later.
Captions are not scored here: they follow the caption rule, and G2's caption check holds them.

| Field             | G0.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runs              | `node scripts/vc.mjs pieces`: renders `.viral-clone/pieces` on flat green with its reference video removed, scores every window of `reference/motion-windows.json` in parallel, has Gemini compare each window's box in both, and writes `scores.json` and `report.md`; the last round moves to `rounds/r<N>/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Holds paid work   | **never let go**: a window with no scored piece; a piece missing from its solo render for over half its window; a failed Gemini look. **Motion**: a covering piece held still where the reference's clearly moves (a dip to black excepted); a piece held still where the reference boils. **Build**: a major difference Gemini saw in the box (without a key: a `build` item not answered, or answered not done)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Advice            | the fix list, Gemini's minor differences and the SSIM of a covering piece                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Rounds and way on | one round by default: round 1 scores v0, and with no problem standing the pieces go on, the advice fixed without a re-score. Each problem is fixed once and `--changed` re-scores its windows as v1. A motion problem never goes on by round: it is fixed, within three rounds (no more), or the person lets it go by picking the option `Go on with it still` on a question about that piece alone, its text starting with the prefix `report.md` gives for it (`G0.5 <template>/<window> <id>:`, the id a digest of the window's time, box and build, so the answer lapses when either changes; the app reads what they picked; nothing the agent writes counts). A build difference left at v1 goes on only with the piece's `accepted` `{stand_in, why}` (a font not installed, a texture not found); the person's answer about motion never covers it. A failed Gemini look always waits |
| Reports           | every accepted problem, with its reason and the zoom that shows it, first in `RESULT.md`; each vocabulary `score:` line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Every measure reads a solo render: over the reference, its own graphic shows through every fade and stands in for a
missing piece. The person watches the project over the reference in the app; that view is never rendered.

**What `vc pieces` reads and writes**, so nothing needs reading in the scripts:

| File                                             | What it holds                                                                                                                                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `templates/<slug>/reference/motion-windows.json` | `[{name, start, seconds, roi: [x, y, w, h], build: ["…"]}]` in the reference's seconds and pixels. `vc watch` drafts it as `motion-windows.draft.json`; times and boxes come only from here                                                         |
| `.viral-clone/pieces/index.html`                 | A HyperFrames page whose first `<video src>` is the reference, from 0 s, with every piece at the reference's own times. Any size of the reference's aspect: boxes scale by the solo render's width over the reference's                             |
| `.viral-clone/pieces/pieces.json`                | Written on the first run. Per piece: `kind` (`opaque` or `overlay`), `ink` (`dark` for dark text), `solo` (its own render, starting at its window's start), `build` (`[{item, done, note}]` without a key), `accepted` (from v1: `{stand_in, why}`) |
| `scores.json`, `report.md`                       | Per window its numbers and verdict; `report.md` names each window's `sheets/<name>-zoom.png` and `sheets/<name>.png` strip                                                                                                                          |
| `rounds/r<N>/`                                   | The round before, kept whole                                                                                                                                                                                                                        |

`--changed a,b` re-renders the whole page but scores and looks again only at those windows.
`node scripts/pieces-gate.mjs .viral-clone/pieces/scores.json templates/<slug>/reference/motion-windows.json` prints the
verdict the app holds paid work on, and exits 1 while a problem stands. In G2, `vc film --patch` takes spans in the
film's own seconds (`9.5-15.3,22-24`).

**Round 1 (v0), started once the first preview is up; round 2 (v1) and round 3 only for what still has a problem, the last: `vc pieces` refuses a fourth.**

1. Build `.viral-clone/pieces/index.html` (its first `<video>` is the reference) and run `node scripts/vc.mjs pieces`.
   The first run writes `pieces.json` with every window; set each piece's `kind` (`opaque` when it covers its box) and
   `ink` (`dark` for dark text).
2. **Open `report.md`, and every zoom and strip it names.** The zoom is the box at mid-window, reference above, rebuild
   below, scaled up: it shows how a piece is built (separate scraps, gaps, tilt, edges, font, word spacing), which a
   builder's own "done" let through on Cindy's title. The strip is the whole window frame by frame at the
   reference's rate, reference row above: it shows motion, a boil, a fade or an ease. Gemini's major differences are
   problems; its word on motion is not evidence (it called a 7-8-frame boil static), the step gap and energy are.
3. Fix every problem, and the advice while you are in that code: each piece's differences in the units its code is edited in, from the same
   instruments on both sides (appears or leaves late, sits N px off, N% wider, `move 1 starts 3 frames late; eases
power2.out, the reference expo.out`, steps every 8 frames where the reference boils every 7). A line the strip
   contradicts is a measuring artefact, and the strip wins. When a problem stood, `node scripts/vc.mjs pieces --changed
   <windows>`: only those are scored and looked at again.
4. **At v1:** for each build difference you keep, write the piece's `accepted` as `{"stand_in", "why"}`. A piece
   still held where the reference moves or boils is never kept this way: change how it is built (cut that span of the
   reference as a clip, step the scraps' poses at the reference's gap, play the tween `flow-track` measured) and score
   it again. When round 3 leaves it still, ask the person once, if they can answer, with a question about that piece alone:
   its text starts with the prefix the piece's advice in `report.md` gives (the app records the answer under it and never
   shows it), then plain words about what they see: no window or template name, no id, never the reference creator's
   name. Its strip sits beside it, and one option is exactly `Go on with it still`
   (the others keep fixing). Only that pick lets the piece go on; any other answer, an answer about another piece,
   or words typed into the chat instead keep it waiting. With no one to answer, it goes at the top of `RESULT.md` as a
   failure, with its zoom and strip.

Without a Vertex key or a HeyGen key there is no look: answer each window's `build` items on its zoom and strip as
`{"item", "done", "note"}` in the piece's `build`, and the judge reads those. A title matches when its
style matches (position, size, weight, color, case, entry, cue timing), never letter for letter.

**The app holds paid work on the problems:** in a viral-clone project, `video.generate`,
`avatar.generateVideo` and `voice.generateVoiceover` (a re-voice too) refuse while one stands. A format with no
graphics over a host (a pure motion-graphics film, a trick reel) writes why in `.viral-clone/no-pieces` instead, and
`RESULT.md` quotes it.

## G1: the script, before any paid generation

With no speech and no on-screen copy, G1 is the edit plan instead: segments, shot list and music choice, checked
against the template before paying.

1. **Fingerprint:** `node scripts/fingerprint.mjs CREATOR_TRANSCRIPTS… --draft script.txt` and revise until every
   value sits inside the range (numbers per 100 above all: a script that names five things and explains one reads as
   abstract). Check the explanation moves too: every new term gets the creator's kind of everyday example or
   comparison, as often as `voice.md` records.
   **Under a runtime cap** shorter than the reference, cover fewer points at the creator's own pace and depth; never
   compress the whole form into a summary.
2. **Blind test:** a fresh subagent with **no file access** gets only two texts, your excerpt and a same-length excerpt
   from a _different_ real video of the same creator or format, and says which is real and how sure it is. Pass: the
   reader does no better than about 60%.
   - **Same form on both sides.** Run your generated speech through the same transcription as the real excerpt, or
     clean both; recognition typos alone give the real one away.
   - **Calibrate first** on a known pair (two real videos). When the control is caught too, the test cannot
     discriminate in this format: compare against the source itself, both as transcripts, and say so.
   - Do not pair against the source by default: the kept structure gives the source pair away.
   - Revise at most twice, then continue and record the verdict.
3. **Copy-only reels (about 15 words or fewer on screen):** no blind test, since it flips on surface cues such as a
   dash or a translation quirk. Check that nothing is copied and that the copy does the reference's job in the brand's
   voice.
4. **No copying:** no run of 8 or more words, or 10 or more 字, from the reference, and no mirrored sentence
   patterns; mirrored sentence shapes are what readers spot first. The next giveaway is a script that reads as a polished pitch:
   a too-neat problem-to-solution arc, no rough edges, written for the eye.

## G1.5: the media list, before building

- Every B-roll shot has footage of the kind, era and specificity the template calls for; no screenshot or text card
  stands in where the reference used footage, and no clip plays more than twice.
- Footage share is inside the template's range, and every file's source is logged.
- Every hero scene the template lists for these beats is planned with its layers.
- The voice is the whose-voice answer's route ([media.md](media.md#voice)) and was auditioned: the person's
  recording cut on word boundaries at the reference's pause density; a clone or catalog voice synthesized one call
  per stretch, its `prosody.mjs` pace and pauses within the creator's targets (a professional clone's range and
  movement at least 0.8 of the reference's too); speed at most 1.05 on every route.
- Every plate lines up with its reference frame within about 10%, measured on this computer
  ([media.md](media.md#stable-people-places-and-props)).
- Everything the reference films moving is generated video with that motion in words; no still is slid along a path
  in its place.
- Every graphic type and hero scene the remix builds has a measured window; nothing is built from an `unmeasured`
  entry.
- Every generated take is accepted on its worst frame ([media.md](media.md#accept-a-take)) and its retime pieces are
  recorded.

## Rounds, not edits

A build checks in rounds: the rebuild, the remix and each section. A round runs `hyperframes lint`, `hyperframes check`
or `hyperframes snapshot` once, reads the whole report, fixes every finding in it, and only then runs again. Each run
takes 20 to 30 s, so never one `hyperframes check` or snapshot per fix. A build gets at most three rounds, then goes
on and records what is left in `RESULT.md`. A 37 s remake that checked once per fix ran twelve of them and never
reached its render.

## G2: v0, then patches

Render v0 and measure it per segment with the instruments used on the reference.

**Before v0, check what needs no render.** Mix the audio stems with ffmpeg at the planned levels and
measure loudness per section against the reference ([media.md](media.md#music-and-sound)); check layout and text size
on `hyperframes snapshot` frames. v0 then only has to answer what only a render shows.

**The whole film renders once, as v0; a fix re-renders only its seconds.** `node scripts/vc.mjs film` renders v0 at
the default quality to `renders/v0.mp4`. `node scripts/vc.mjs review` then measures it against the reference in one
call and writes `.viral-clone/work/review.md`, a pass/fail table with the worst seconds of each failing row: holds
and moving share per segment, loudness per section, lip-sync per talking range, captions at word starts, each
piece against the face as its type's `face` says, motion rhythm, Gemini's structure review (kinds, instances, badges and cutaways v0 lacks or reorders, each
window's second mapped onto v0) and Gemini's look at each window's box at its matching second. Gemini gets the windows' times only, never a finding: told a finding, it agreed every time, a
false one too. Run the rows below that `review.md` does not cover, check each item on v0's frames, and write one fix
list in `.viral-clone/work/fixes.md` with the seconds each fix touches; it is a list, never a gate. Fix them all,
then check them on the render, never on stills alone: `node scripts/vc.mjs verify 9.5-15.3,25.9-30.8` (add `--sound`
when a fix touched the voice, music, effects or mix) re-renders only those seconds into `renders/final.mp4` through
`film --patch` (each span covers the changed clip's whole stretch on the timeline; a page whose compositions cannot
render a span alone is rendered whole), writes an 8 fps strip per span, has Gemini review them (with `--sound`, also
both films' voice, effect and music lines from `hyperframes audio --read`, to compare) and writes
`.viral-clone/work/verify.md`. Read the strips and `verify.md`, fix what they name and verify again, three rounds at
most. `vc next` stays short of Done until `verify.md` is newer than `final.mp4` and names no span to fix or not checked; after the
third round, a span still named is reported as a failure. Anything that moves the whole timeline (re-cutting the voice, retiming every graphic) is settled before v0;
a level that is off is fixed with one gain pass on the export. Run the rows that failed again on `final.mp4` at the
patched seconds. Record each check still failing in `RESULT.md` with its number, its worst seconds and what was
tried.

**The core, every run, blocking.** These decide whether the remix looks and sounds like its reference; put the
numbers in `RESULT.md`:

| What                             | Instrument                                                                                                       | Pass                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Motion rhythm                    | `vc review`, per segment                                                                                         | moving share 0.8–1.25×; longest hold at most 1.3× the reference's; same update class (ones or twos)               |
| Camera per shot                  | the same output's shots, beside the template's camera rules                                                      | same kind of move on the same kind of shot; zoom within ±30% of the reference's                                   |
| Every graphic type               | `curve-pair.mjs` / `motion-pair.mjs` on its entry **and** exit window                                            | ≥ 0.8 each; a type with no exit window fails                                                                      |
| Every held graphic               | `hf-media evidence flow REF DRAFT --roi … --start --end --candidate-roi … --candidate-start T` on its hold       | `energy_ratio` 0.8–1.25; an opaque piece never holds still where the reference's moves                            |
| Layout                           | `vc review`: each graphic and subject box against the template's boxes, by its `anchor:` on that shot's face box | size within ±20%, same position class; each piece on the face only as its `face:` line records                    |
| The trick (trick reels)          | cut count inside the trick span; `join-timing` at every generated join; the hero object's box                    | same cuts (often none); joins ≤ 3 frames; the hero's size curve follows the reference's                           |
| Targeted actions                 | a crop of each action's target at its action frame (the finger on the row, the hand on the switch)               | the action lands on its target in every instance                                                                  |
| Skeleton (motion-graphics films) | the project's `index.html` and `compositions/` against the scene list                                            | every slot holds its remixed scene; a placeholder left fails                                                      |
| Sound palette                    | `vc review`: the draft's sound map beside the reference's; advisory, RESULT.md's hit list decides                | distinct sounds within ±30% of the reference's; no sound repeats more per minute than its most repeated           |
| Voice                            | `prosody.mjs` on the draft's speech against the reference's same kind of passage                                 | pitch range and movement 0.8–1.25×; pauses per minute 0.75–1.33×; catalog voice within 2 semitones                |
| Every move (MG films)            | `node scripts/motion-curve.mjs REF T S ROI --compare DRAFT T` on each graphic's window                           | same ease family; duration within 2 frames or 10%; overshoot within 5 points; on one clock, start within 2 frames |
| Rebuilt film or stretch          | SSIM per frame on one clock over what was rebuilt (below)                                                        | mean ≥ 0.92 and ≥ 75% of frames ≥ 0.9; every worst second explained                                               |
| Soft layers (rebuilds)           | `hf-media evidence compare … --regions` on every layer the inventory marks soft, blurred or glowing              | `sharpness_ratio` 0.8–1.25; a crisp rebuild of a blurred layer fails                                              |

| What                                                     | Instrument                                                                                                                                                                                     | Pass                                                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cuts, MG events, layouts, footage share per segment      | The definitions in watch.md, at the reference's resolution; all cuts from `hf-media evidence temporal-scan` on both films, confirmed on frames (a clip's continuity check sees only hard cuts) | Inside the creator range, or ±30% at single depth                                                                                                         |
| Each graphic entry and exit style over footage or a host | `node scripts/curve-pair.mjs REF REF_T DRAFT DRAFT_T SECONDS REF_ROI DRAFT_ROI [in\|out\|pulse\|track]`, with the ROI inside the element and the window starting after the shot settles        | ≥ 0.8, aim for 0.9                                                                                                                                        |
| A graphic on a flat background                           | `node scripts/motion-pair.mjs … --out DIR`                                                                                                                                                     | ≥ 0.8                                                                                                                                                     |
| Flash, strobe, exposure pop                              | `curve-pair.mjs … pulse` on the full frame                                                                                                                                                     | ≥ 0.8                                                                                                                                                     |
| Body or camera motion                                    | `node scripts/motion-energy.mjs …` (on retimed footage read only the ratios)                                                                                                                   | Same action: r ≥ 0.8; any action: peak and mean ratios 0.7–1.4                                                                                            |
| A cursor, hand or body following a path                  | `hf-media evidence track` on both; compare the trajectories                                                                                                                                    | Same path shape; timing within about 0.2 s; a cursor keyed by hand from sheets fails                                                                      |
| Trick timing (press, catch, swap, reveal)                | The event's frame in both                                                                                                                                                                      | Within ±0.1 s, or the recorded retime                                                                                                                     |
| Joins between generated pieces                           | `hf-media evidence join-timing REF DRAFT --at T…`                                                                                                                                              | Jump of about 3 source frames or less                                                                                                                     |
| Soft, glowing or textured layers                         | `hf-media evidence compare REF DRAFT --pairs … --regions …` with tight regions; grain on three or more flat patches                                                                            | `sharpness_ratio` near 1                                                                                                                                  |
| Typing and stepped UI                                    | `hf-media evidence cadence REF --roi … --start --end --candidate DRAFT` (off-clock: cut both windows first)                                                                                    | Lead or lag of about 4 frames or less                                                                                                                     |
| Text size                                                | `node scripts/ink-scan.mjs` line height on both                                                                                                                                                | Ratio 0.95–1.05; outside it is a wrong size or a fallback font                                                                                            |
| Look per kind of segment (advisory)                      | `node scripts/look-stats.mjs --compare REF REF_START DRAFT START SECONDS` on footage of that kind; a person with `--roi` on both                                                               | luma and contrast ratios 0.85–1.15, saturation ratio 0.75–1.25, black-and-white share within 0.15; never at the cost of a person's skin: see the frames   |
| Hero scenes                                              | count per section against the template; each on a full-size pair sheet beside its reference                                                                                                    | same count and construction; judged, with frames                                                                                                          |
| The same person in every shot                            | one sheet of every person shot's face, a crop at its largest frame, beside the identity image                                                                                                  | the same face, hair and wardrobe throughout; a shot that drifts is made again from the identity image                                                     |
| Sound events                                             | `vc review` for picture events; `node scripts/sound-map.mjs` with the draft's words for phrases, beside `reference/sound/sound-map.json`                                                       | lifts and shares per anchor within ±0.15 of the reference; the same palette sounds on the same kinds of anchor; both maps offered to the person to listen |
| Music under speech                                       | loudness over speech windows against music-only gaps, in both films                                                                                                                            | ducking within 2 dB of the reference; track changes and drop-outs at the same beats                                                                       |
| Loudness per section                                     | `vc review` per section; `hf-media evidence loudness … --windows` over speech windows and music-only gaps                                                                                      | Within about 1 LU                                                                                                                                         |
| Captions                                                 | `vc review` at word starts; the rule at two word starts and frame zero beside the reference's; `ink-scan.mjs` line height on both                                                              | States match; nothing shows early; the same position, font, weight, color and case, and size within 0.95–1.05                                             |
| Speech                                                   | `voice.transcribeAudio` the draft, then `hf-media evidence word-drift` against the selected words                                                                                              | Median offset of about 1 frame or less; no missing or extra words                                                                                         |
| Lip-sync                                                 | `vc review` on every talking range                                                                                                                                                             | Picture at most 45 ms late or 125 ms early                                                                                                                |

SSIM for a rebuild on the reference's clock, over the whole film or the rebuilt stretch (trim both to it; scale both to the same square; last week's good rebuilds
scored 0.92–0.96, with the lowest seconds on regenerated footage):

```sh
ffmpeg -nostdin -v error -i ref.mp4 -i draft.mp4 -filter_complex "[0:v]scale=320:320,fps=10[a];[1:v]scale=320:320,fps=10[b];[a][b]ssim=stats_file=.viral-clone/work/ssim.txt" -f null -
```

Each line of `.viral-clone/work/ssim.txt` is one frame (`All:` is its SSIM); report the mean, the share at 0.9 or more and the five
worst seconds with what is on screen there.

Self-test every window first: a window against itself must score 1.0. Over scrolling or moving content under the
element, curve-pair is unreliable; report that window as unmeasured. `motion-pair` scores near 0 on anything over
footage, even the reference's own cards against each other.

`hf-media review . --source .viral-clone/<slug>/ref.mp4 [--spec review.json]` fits only a remix on the reference's
clock (a recreation, a trick reel retimed onto it): continuity `jump`, `flicker` and `structure` events, loudness,
duration and the spec's regions, the worst moments on one sheet.

- Fix every `fix` item at once between the draft and the final, verified on snapshots.
- `incomplete` is not a pass: fix the spec behind each `unmeasured` item, or report it as unchecked.
- Keep `motion` windows out of the spec; measure them with the scripts.

Fix what is out of range (the core first, then graphic density), then render once. Confirm the export decodes with the intended
duration and audio tracks, and build a side-by-side to watch (measure on the originals, not on this file):

```sh
H=960; ffmpeg -nostdin -i ref.mp4 -i export.mp4 -filter_complex "[0:v]fps=30,scale=-2:$H,setsar=1[a];[1:v]fps=30,scale=-2:$H,setsar=1[b];[a][b]hstack=inputs=2[v]" -map "[v]" -map '1:a?' -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac .viral-clone/work/side-by-side.mp4
```

## RESULT.md

Written for the person, in their language. **It opens with what still differs from the reference**, before anything
else: every problem G0.5 went on with (the judge's `accepted` lines, each with its reason), every G2 core check that
failed on the final, and every stand-in, each with a still pair (the reference and ours) at its worst second. The
person should learn where the remix falls short from this page, never by finding it.

| Check                                                                                             | Pass                                                 |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Editable: text, captions, graphics, data and UI are DOM layers                                    | 100%                                                 |
| Form: same beats, order and layouts (sheets side by side)                                         | Judged, with frames                                  |
| Edit metrics                                                                                      | Inside range                                         |
| G2 core: motion rhythm, camera, graphics in and out, layout, trick, targets, sound palette, voice | The numbers, each pass or fail                       |
| Graphic and body motion, per type                                                                 | The scores above                                     |
| Motion-graphics films: every move's ease, duration and overshoot; SSIM over what was rebuilt      | The numbers, each pass or fail                       |
| Rebuild scope: whole film, a stretch with hero scenes and pieces, or pieces; and why              | Stated                                               |
| Footage kind, era, specificity and share; sources                                                 | Inside range; all logged                             |
| Look per kind of segment; hero scenes                                                             | Inside the look targets; every hero scene rebuilt    |
| Sound: music map, sound events on the same anchors, ducking                                       | Inside range                                         |
| Voice: HeyGen Voice in every speech job; G1 verdict                                               | Yes; about 60% or less                               |
| No copying                                                                                        | 0 hits                                               |
| Cost and time                                                                                     | Logged per call, with the cost marked as an estimate |

Then: what was made, anything unchecked (what `verify.md` says it could not check, lip-sync measured but not
watched) and any friction with the skill. Every turn that touches the sound runs `vc verify … --sound` and fixes what
it reports; "I can't hear it" is not an answer. List each of the reference's hits on a picture event with its second
and what the remix plays there (or its `not_effects` reason), and link both `sound-map.html` files.
