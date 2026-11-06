# ① Watch the reference

Every number comes from measurement, never from a description: a reference said to "cut on the beat" often cuts no
more on the beat than chance. Watch the frames yourself; the authoring agent owns the understanding.

## Get a usable copy

- Copy each reference into `.viral-clone/<slug>/` first. Tools write their output next to their input, and the app's
  media list hides dot folders, so the hundreds of frames a read produces never bury the person's media.
- Check resolution with `hf-media evidence probe`. Study typography and dense frames at 720p or more; when only a
  low-resolution copy exists, get a 720p clip of the passages you study.
- Measure the reference and the remix at the same resolution with the same instrument: cut counts change with
  resolution.
- Reference media is study material. It never ships, and its people, logos and footage never enter the output.
- Keep every piece of evidence in the project, never in a scratch folder (the app clears scratch files, and every
  number in the template needs its evidence): frames, sheets, strips, crops, audio slices, stems and scans under
  `.viral-clone/<slug>/`; the text records the template cites (`dense.md`, logs, measurement JSON,
  `motion-windows.json`, the sound map and palette JSON) under `templates/<slug>/reference/`. Drafts and checks go
  under `.viral-clone/work/`.
- `hf-media evidence frames --start/--end` take **native frame indices** (seconds × the video's fps), not seconds;
  `--times '[…]'` takes seconds. A dense read written in seconds lands in the first second of the film.

## The loop

**Start with `node scripts/vc.mjs watch ref.mp4 --slug <slug>`.** It runs what needs no reading at once (the 1 FPS
overview sheets, `temporal-scan`, `motion-rhythm.mjs`, the stems for the sound map, Gemini's read and, when someone
talks on camera, Gemini's beat-by-beat read of the presenter in `templates/<slug>/reference/gemini-perform.json`) and writes
`.viral-clone/<slug>/watch.md`: what ran, every graphic kind Gemini saw with its instances and a zoomed crop of its
box, and draft motion windows in `templates/<slug>/reference/motion-windows.draft.json`. Reuse its sheets, crops and
drafts rather than cutting them again, and give the reading about
10 minutes for a reference under a minute and 20 for a longer one; past that, build from what is measured. Then read:

**A reference over two minutes is watched in a stretch, not whole.** With no flags `vc watch` cuts the first two minutes
and measures that; `--from M:SS --to M:SS` names another stretch, and the times in everything it writes count from the
stretch's start (`templates/<slug>/reference/watched.json` has the offset and the whole length). Pick the stretch from the
person's words and from the whole file's pace: `node scripts/motion-rhythm.mjs ref.mp4` runs on the full file in
minutes, so read its cuts and holds first. Then say which stretch you watched, and offer to watch another; run each
other stretch on the original file, into its own `--slug`.

1. **Every overview sheet**, ending included. Sheets locate story, view and layout changes. They are navigation, not
   motion evidence: a motion-graphic style is invisible at this rate. For a film longer than about 3 minutes, split
   the sheets across parallel helper agents (one per 5 minutes of film, no skills loaded), each reading every sheet in
   its range and writing one row per second to `reference/overview-log/partN.tsv` (`t, layout, footage, graphic,
caption, note`); read the logs and open the moments they flag yourself.
2. **The scan's candidates and Gemini's kinds** in real frames: the scan flags cuts, flashes and fast graphics between
   samples, not story beats. Gemini's times are about ±1 s and it misses some events, so check its kinds against the
   sheets; it caught 4 of 6 reference boils and read Cindy's scrap-per-letter title as one strip from the whole film,
   so its words are a lead, never a measurement. One window per kind per distinct entry or exit style: the other
   instances reuse that piece (four "Step" badges with one look and one entry are one window). `node scripts/vc.mjs
events ref.mp4 --grid 6x10 --start S --end E` lists each appear, disappear, cut and hold.
3. **Layer inventory per scene** from at least one full-size frame: every layer (footage, host, cards, text, cursor,
   highlight, glow, shadow, thin outline), its focus and filter state (sharp, focus blur, backdrop blur, depth blur,
   motion smear, glow, opacity, color or black and white), **its box** (x, y, width, height as % of the frame, and how
   much of the frame it fills) and **whether it moves while it holds** (a background that boils, flickers or drifts; a
   card that floats). Downscaled sheets hide all of these. A crisp rebuild of a blurred layer is a defect, so is
   blurring a layer the reference keeps sharp, and so is a still layer where the reference's moves. Sample colors
   and boxes from full-size frames, never by eye: `node scripts/vc.mjs box ref.mp4 --at T --roi x,y,w,h --color auto`
   gives the box in pixels, its dominant colors, its text lines and cap height.
4. **Every graphic the remix builds**, from the kinds `vc watch` listed (one the remix leaves out needs no window):
   sort it into a recurring type or a hero scene, and inspect its path, its entry, **its hold and its exit**
   ([below](#two-kinds-of-motion-graphics)), each from a close-up window at native frame rate. Write what the hold does: still, a boil (how
   many poses, frames per pose), footage playing, or an animation (what moves); "N states" only when frames show each
   state holding still. A title over the host counts as a graphic. A type with no window
   is unmeasured, and an unmeasured type cannot be built (G0). Write each move's ease, duration and overshoot from
   `motion-curve.mjs` into its vocabulary entry (over a moving presenter, `vc box … --track`, which follows the piece
   by its color); in a motion-graphics film, every move. Over a presenter, the draft's
   `face:` and `anchor:` come from the face boxes `vc watch` saved in `reference/face-size.json`: check them on the
   window's frames. Then write **how it is built** as the entry's `build:` list, three to six items each a
   rebuild either does or does not do, read from the zoomed crop `vc watch` saved for its kind (or one you cut the
   same way at its entry: the box scaled to about 1600 px wide), never from a sheet: what it is made of and how many (one paper scrap per letter, five letters), how each unit sits and moves
   (each tilted up to 8°, a new pose every 7 frames), its shape (an irregular polygon along the real coastline, not a
   box), its edge and texture (outer glow about 12 px; mosaic blocks about 12 px), and how sharp it is (all four lines
   blurred past reading, the host behind blurred too). "Paper-cut letters" or "a glowing zone" is not a build item; a
   type whose `build:` list is missing is unmeasured.
5. **Every action and prop in spans you will generate:** read those spans at 6–8 FPS
   (`frames --start F0 --end F1 --step 3 --sheet-columns 8`, frame indices) and zoom into hands and anything picked up,
   held, pointed at or put down. List each action with its start and end, body part, prop, **what it points at or
   touches (the target's box)** and what it triggers. Small props motivate the next beat and vanish at 1 FPS.
   With a presenter, start from `gemini-perform.json`: each beat's start and end, words, hands (which hand, shape,
   where, motion), body, head and face (eye line), object and camera. It got finger counts, the mic hand and its
   switch at a cut, waves and typing mime right within about 0.5 s on Cindy and Ali Abdaal, but missed actions under
   graphic overlays and sometimes named the wrong hand, so check every beat you use on these frames and fix it there.
6. **Trick inventory** (a reel built on a visual trick): read the trick span at native frame rate from 0.5 s before to
   0.5 s after. List every manipulated event: an object changing scale, crossing a frame or screen edge, passing in
   front of or behind something, a hand-off, a swap. Track the hero object's box frame by frame
   (`hf-media evidence track`), count the cuts inside the span (often none: a "jump" may be one continuous take), and
   write the mechanism in one sentence ("a giant cup shrinks to hand size as the runner grabs it, in one take").
7. **Motion rhythm and camera:** `templates/<slug>/reference/motion-rhythm.json` from `vc watch`: the share of frames in
   motion, the still holds (longest, median), the animation's update rate (on ones at the film's fps, on twos at about 12) and every shot's camera (push in, pull out, pan or drift, handheld, static, with its zoom). Confirm each camera move on
   frames against two stable landmarks, and tell a camera move from a crop. A shot read as "moving, unexplained" changed in
   a way no zoom or pan explains (a swing, a tilt, a body crossing the frame): step through its frames and write down
   which it is; never record it as static. These are the remix's motion targets: a
   remix with the right graphics that holds still for three seconds where the reference never stops moving still
   looks cheap.
8. **Typography:** identify each typeface from full-size crops and compare candidates rendered with
   `hyperframes snapshot` beside the crop. Solve the size from ink rather than by eye: scan one line in the reference
   (`node scripts/ink-scan.mjs ref.mp4 T 0.2 ROI`) and the same text rendered at a known size
   (`node scripts/ink-scan.mjs still.png 0 0 ROI`); size = candidate size × reference box height / candidate box
   height. Use a cap-height or x-height line, not a mixed one. HyperFrames ships no Simplified Chinese font, and
   other non-Latin scripts (Japanese, Korean, Arabic, Devanagari) need checking too: bundle Noto Sans SC or the matched
   face in `assets/fonts/`. When the match stays uncertain (white text over a blurred
   photo), record a stand-in. Look for font files only in `~/Library/Fonts`, `/Library/Fonts` and the project; never
   search the whole disk (`find /` took one run 7 minutes). A brand's fonts come with app.capture when it is offered, otherwise `npx hyperframes capture URL`;
   other candidates download from Google Fonts (the `https://fonts.googleapis.com/css2?family=…` stylesheet lists
   each face's file).
9. **Captions and on-screen text:** recover each text layer's rule against its clock (below).
10. **Footage log:** for every shot, its kind (A-roll, news or press, archival film, archival photo, stock or scenic,
    portrait, map, document, screen recording, product in use, generated), its era, how specific it is (shows the exact
    event, person or place the line names, or a generic scene), the claim it proves, its treatment (grade, black and
    white, blur, grain, vignette), its runtime share, and for screen recordings the UI events per minute (clicks,
    hovers, menus, page changes) and whether the cursor shows.
11. **Look:** measure each kind of segment's footage with `node scripts/look-stats.mjs ref.mp4 START SECONDS` (luma,
    contrast, saturation, black-and-white share, warmth), and any person separately with `--roi`; these numbers are
    the remix's grade targets. Note texture (grain or clean) on three or more flat patches.
12. **Speech:** `voice.transcribeAudio` the soundtrack; it keeps punctuation, fillers and terms, with every word timed
    and its speaker named. Then:
    - **Fingerprint:** `node scripts/fingerprint.mjs` on the creator's transcripts gives the ranges G1 checks
      (numbers, questions, I / you / we, everyday examples, phrase length, rate).
    - **How the creator explains:** read whole explanation passages from the body of the films, not only the
      openings: how a new term is introduced, the everyday example or comparison that makes it concrete, the number
      that lands it, the aside, the payoff. These moves, with their counts, are what `voice.md` is for; a script built
      from openings alone names things without explaining them.
    - **Delivery:** `node scripts/prosody.mjs` on the vocals stem over each kind of passage (hook, explanation,
      aside, close): pitch range and movement, rising phrase ends, pauses per minute and their length. Listen-free
      targets for the voice.
13. **Sound:** what sounds, when, and what each sound is tied to ([below](#sound-what-sounds-and-what-it-is-tied-to)).

`vc watch` drafted `templates/<slug>/template.draft.json`; consolidate it into `template.json` while the
remaining questions resolve ([template.md](template.md#template-files)), and revise an inference when evidence
disproves it.

## Sound: what sounds, and what it is tied to

The question for any reference: at which moments does the edit make a sound, what is each sound tied to, what does it
do, and which sounds come back? "Almost no effects" is a common answer, and so is "the sound is the content" (ASMR,
foley-led reels). Measure the reference's own answer; never look for a list of expected effects.

**The model.** Every sound event has:

| Field    | Values                                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| anchor   | the timeline it lines up with: a **picture event** (a cut, a graphic entering, an action landing), a **speech event** (a word or phrase starting or ending), a **music event** (a beat, a drop; it then belongs to the music map, not the effects) or **none** (ambience, foley that builds the world) |
| function | punctuation (marks a moment), transition (carries across a cut), rhythm, world, identity (a recurring sting or logo sound)                                                                                                                                                                             |
| identity | which palette sound it is: creators reuse a few files                                                                                                                                                                                                                                                  |
| pattern  | a single hit, or a run of hits close together that acts as one gesture                                                                                                                                                                                                                                 |
| level    | against the voice, or against the music where nobody speaks                                                                                                                                                                                                                                            |

**Music map**, section by section: music bed, effects only, or silence; each track change; mood and genre; tempo, drop
and hits (`node scripts/music-scan.mjs --ref STEM` on the music-only stem from `separate.mjs`, per section, with
`--cuts` set to the section's cut times: it reports how many cuts sit on the beat beside chance); where the music drops out and where a sting marks a section; and
how far it ducks under speech, from loudness over speech windows against music-only gaps
(`hf-media evidence loudness ref.mp4 --windows '[[a,b],…]'`).

**Method:**

1. With speech, use the voice-free stem `vc watch` separated into `.viral-clone/<slug>/sep` (`node
scripts/separate.mjs` makes it by hand). Onsets found on it are reliable; on the full mix an onset inside speech is
   only a candidate.
2. `vc watch` maps the picture anchors into `templates/<slug>/reference/sound/`; once the speech is transcribed
   (step 12), build it again with the words so phrases count:
   `node scripts/sound-map.mjs --video ref.mp4 --stem STEM --scan .viral-clone/<slug>/scan/<scan>.json --words WORDS --out .viral-clone/<slug>/sound`,
   then copy its `sound-map.json` to `templates/<slug>/reference/sound/`.
   It lists every strong onset with a clip, the frame, the words around it, the nearest picture event, its run and its
   palette group, as `sound-map.json` and `sound-map.html`.
   With no speech, or when sound is the content, add `--full` to scan the band where taps, crinkles and foley sit.
3. Decide anchors on the whole film, not hit by hit: `event_lift` and `phrase_lift` say how much more often onsets fall
   on picture events and on phrase starts than chance (about 1 is chance). A group that repeats at a regular period
   and ignores picture events is the music.
4. Confirm a dozen onsets in their frames and words, then name each palette sound by what it is (impact, whoosh,
   click, chime, riser, foley) and its function.
5. Write the result as rules in the template ([template.md](template.md#editingmd)), and keep the palette: the sound
   files lifted with `sfx-extract.mjs` where a group has three or more alike instances, otherwise the instance times
   for library matching. A group of two, or a lone hit on a picture event, is still a palette sound, never dropped
   for being rare. Record the palette's size (distinct sounds) and how often its most repeated sound plays per
   minute: a creator who uses 13 sounds, none more than three times, is not rebuilt with two sounds played 36 times.

**Reading the numbers:**

- The parameters are measurement defaults, not targets: ±2 frames is about where sound and picture stop reading as
  in sync; a run is strong hits under 0.25 s apart, heard as one gesture; a strong hit rises 20 dB or more. Adjust
  them to the reference's pace and say so.
- Where speech is timed per character (Chinese, Japanese), some character sits near every hit; judge speech anchoring
  by phrases and by what is being said, not by the nearest character.
- The tools cannot judge how a sound sounds. When a group stays doubtful, the person settles it by listening to
  `sound-map.html`.

How anchors differ across formats, for orientation only: an explainer may mark the term being defined with a short
hit and carry cards in with a whoosh; a trick reel often has one impact on the frame the trick lands and music
otherwise; a UGC ad may have only room tone and handling sounds; in a hype edit the hits are the music's and the cuts
follow them.

## Two kinds of motion graphics

- **Recurring types** come back many times with the same construction: title cards, photo cards, charts, keyword
  pops, name labels. Each gets an MG vocabulary entry and a motion window.
- **Captions are not graphics.** A caption shows the running words as they are said, in one place and one style; it
  gets the caption rule (below), never a motion window. Text that does more (a keyword that pops in another style
  and holds, a title, a step badge) is a graphic, even when it repeats a spoken word.
- **Hero scenes** are one-off, full-frame designed compositions that carry a creator's identity, such as a collage of
  cut-out portraits, an illustrated metaphor, a 3D product hero shot or a map fly-through. They are rare per minute but
  they are what viewers remember; leaving them out flattens the remix even when every recurring type matches. For each one record its layers (cut-out
  photos, illustrated elements and their art style, type and its material, rings, glow, texture, background), how it
  moves, which segment calls for it and how many each section has, with full-size evidence frames.

## Dynamic graphics: inspect the path

Locate the same instance before, during and after the effect: onset, acceleration, peak, occlusion, settle, hold,
exit. Separate camera or world movement, the carrier (card) moving, content moving inside the carrier, and masks with
their own edges. Similar cards crossing can fool a nearest-match reading; track instances. When a graphic exits as the
presenter moves into its space, record that handoff and which layer moves.

| Effect               | Decisive evidence                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Reveal or wipe       | Boundary shape, direction and softness; reveal order; what keeps moving underneath                                              |
| Streak, blur, glow   | Sharp core against trail direction, onset and decay, rest state; a symmetric blur is not a one-sided trail                      |
| Perspective or 3D    | The same instance's four corners on several frames; a narrowing box can be rotation, crop or scale                              |
| Cursor or UI         | Tip path from `hf-media evidence track` (never keyed by hand from sheets), hover, press, release, glyph swap, the UI's response |
| Slide, scale, morph  | `node scripts/motion-curve.mjs ref.mp4 START SECONDS ROI` (over a presenter `vc box … --track`): ease, duration, overshoot      |
| Typing or stepped UI | Bursts, pauses after punctuation, backspaces, caret blinks: `hf-media evidence cadence ref.mp4 --roi … --start --end`           |
| Scene transition     | Position and velocity on both sides; which object carries across the seam                                                       |

Write each type's mechanism into the template's MG vocabulary and save a window for it in
`reference/motion-windows.json` (`[{name, start, seconds, roi, build}]`, `build` the entry's `build:` items as
strings), one per distinct entry or exit style. G0.5 holds paid work until every build item is answered on the
rebuild, and G2 compares the remix against these windows.

## Captions: recover the rule against its clock

A caption or on-screen text layer is a function of a timeline: usually the words, sometimes the music's beats or the
picture's events. Recover the rule, not the look of frames. A caption style belongs to the format only when the
format's own videos show it: at creator depth it must appear in at least two on-format videos, and when the format's
videos carry no captions, the remix carries none. A box that marks who is speaking in one street interview is that
video's, not the creator's.

1. Find the clock each text layer follows, and time it first (the speech, even when the remix replaces the script;
   the beats; the picture events).
2. Open native frames just before and after word starts for two groups, plus one group change and one pause.
3. For each property (size, color, box, opacity, position), find the clock it follows: never changes (a static
   keyword style); one word at a time (active-word karaoke, box or pop); accumulating (cumulative reveal); at group
   boundaries; or with a person (tracked, which needs placement evidence).
4. Compare one-, two- and three-line groups for the anchor (top, centre or bottom) and the maximum width
   (`node scripts/ink-scan.mjs ref.mp4 S SECONDS ROI --fps 30` gives the ink box per frame).
5. On four cues across the film, measure the first and last visible frame (the same scan's `first_visible` and
   `last_visible`) against the heard words; use the median lag when the cues agree within about two frames.
6. Predict a held-out group's states at two word starts, then check those frames.

A remix binds cues to its own word timing and keeps the rule (which words get emphasis, grouping, hold), not the
source's keyword list. Auto-caption defects are not design.

Record the rule in `template.json`'s `captions`; `vc assemble` builds captions from it, never as a G0.5 piece. A rule
it cannot express is a caption component restyled from `hyperframes catalog --tag caption-style --json`.

## Measurement definitions

| Metric            | Definition                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cut               | a hard cut; or a same-set jump (the subject's framing or position changes by more than 10% between adjacent frames); or one panel of a split layout changing source. Report hard cuts and all cuts.                                                           |
| MG event          | one graphic element entering (card, pill, number, chart, map, sticker). A card changing content in place counts once per change.                                                                                                                              |
| layout            | a starting set (A-roll full · A-roll with MG beside · B-roll full · B-roll with host picture-in-picture · screen or UI · MG full · split or stacked panels · multi-camera conversation · text on flat color · end card); add every layout the reference shows |
| footage share     | runtime showing footage other than A-roll, full-screen MG and the end card                                                                                                                                                                                    |
| fixed moments     | brand moments (sting, credit, end card), counted per film rather than per minute                                                                                                                                                                              |
| cut vs beat       | share of cuts within ±1 frame of a beat, beside the chance rate for that tempo; "on the beat" only when clearly above chance                                                                                                                                  |
| voice fingerprint | speech rate on timed speech only (excluding music, other-language clips and sponsor reads); phrase length by punctuation; questions per minute and where they fall; numbers per minute; the I/you/we ratio; recurring phrases                                 |
| trick timing      | for a reel built on one visual trick, the frame where it lands (press, flip, catch, swap, reveal) and the time of each action before it                                                                                                                       |
| motion rhythm     | from `motion-rhythm.mjs`: share of frames in motion, longest and median still hold, update rate, camera per shot (kind and zoom), cuts per minute                                                                                                             |
| graphic box       | each layer's box at its hold (`vc box`)                                                                                                                                                                                                                       |
| UI event rate     | clicks, hovers, menus and page changes per minute in a screen recording                                                                                                                                                                                       |

Write evidence as `<ref-id>@<seconds>`.

## Depth: one video or a creator

**Sort the videos by format first.** A creator's most-viewed list mixes formats (a silent tier reel, a monologue, a
street interview). Every layer of the template (voice, captions, layout, motion, sound) comes from videos of the
named format; other videos give it nothing, and the creator's face and voice never go in it. With fewer than two on-format videos,
find more of that format on the creator's channel (`yt-dlp "ytsearch10:<creator> <format words>"` or the channel's
shorts page) before mixing anything in, and say so in `TEMPLATE.md`.

With one video, every number is that video's. With several videos of the same creator or format (a corpus of
transcripts plus passages), every target becomes a **median and range**, and the creator's rules separate from one
video's choices: a rule that holds in most videos goes into the template; a choice seen once becomes a variant with its
condition ("a graphics-free hook, only when the hook is a personal story").

At creator depth, watch at least one full video end to end, plus two-minute passages of the others for the MG
vocabulary. Record `depth` and `sources` in `TEMPLATE.md`.
