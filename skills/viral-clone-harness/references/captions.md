# Captions

Read this when the reference shows captions, or any text layer that follows the speech, the beats or picture events.

## Recover the rule, not the look of frames

A caption is a function of a clock: usually the words, sometimes the music's beats or the picture's events. Rebuild
that function. The remix carries captions only when the reference does; when it shows none, add none. A box that marks
who is speaking in one street interview belongs to that video, not to the format. Auto-caption mistakes are not design.

1. **Find the clock** each text layer follows, and time it first:
   - Words: `transcribe` the reference. It saves `<name>.transcript.json` beside the file; `read_audio` then gives
     each voice line with its words, and `grep_timeline` with `transcript: { fromFile, return: ["wordTimestamps"] }`
     gives each word's start and end. Without a transcript, `read_audio`'s voice lines carry no words.
   - Beats: `grep_audio` with `file` the reference and `return: ["beatTimestamps", "downbeatTimestamps"]`.
   - Picture events: `read_video`'s cuts and keyframes.
2. **Look at the states.** Call `frames` on the reference with `at` set just before and just after the word starts of
   two groups, one group change and one pause, and `crop` around the caption (`width` 960 for small type).
3. **Name the clock of each property** (size, color, box, opacity, position): never changes (a static keyword
   style); one word at a time (active-word karaoke, a moving box, a pop); accumulating (each word stays as the next
   appears); at group boundaries only; or with a person (tracked; record where it sits against the face).
4. **Anchor and maximum width.** Compare one-, two- and three-line groups with `ink-scan.mjs` (below): a group that
   grows upward is bottom-anchored, one that grows both ways is centred.
5. **Cue timing.** On four cues spread across the film, scan at the frame rate (`--fps 30`) and compare
   `first_visible` and `last_visible` with the heard word's start and end. When the four lags agree within about two
   frames, use their median as the rule's lead or lag.
6. **Test the rule.** Predict a group you did not look at, its state at two word starts, then check those seconds
   with `frames`. Fix the rule until the prediction holds.

Write down the rule: the clock, each property's state change, words per group and how groups break (by count, by
pause, by phrase), which words get emphasis and why, the hold after the last word, the anchor, the maximum width, the
font, size, weight, case and colors.

## ink-scan.mjs

`node scripts/ink-scan.mjs VIDEO START SECONDS X,Y,W,H [--fps 10] [--ink light|dark|R,G,B] [--tol 60] [--min 12]`

- It finds the text's ink inside the region `X,Y,W,H` (frame pixels; take it from the `frames` crop) from `START`
  for `SECONDS`, and prints JSON: `first_visible`, `last_visible`, `median_box_h`, `max_box_w`, and one row per
  sample with the ink box in frame pixels (`null` when no ink).
- `--ink`: `light` for white text, `dark` for black, or the text's color as `R,G,B`; `--tol` is how far a pixel may
  be from it. Pick the region and ink so the background never counts: a bright sky under white text fills the box.
- `SECONDS 0` reads one still, such as a PNG from `hyperframes snapshot --at T`. Use it for font size: snapshot your
  caption at a known size, scan both, and `size = your size × reference median_box_h / your median_box_h`.

## Word timing in the remix

The remix's own recording owns the words and their timing; the script is intent. `generate_voiceover` returns each
word's start and end and saves `<name>.transcript.json`; for any other recording, `transcribe` it. Fix a misheard word
with `transcript_correct_words`, never by editing caption text.

- Bind each displayed word to its spoken span, merges included ("TRY HEYGEN TODAY" ↔ "Try / Hey Jen / today").
- Keep the rule (grouping, emphasis, hold, lead or lag), never the reference's letters or its keyword list.
- Source, take and film time differ. For a clip at constant speed,
  `filmTime = placement + (takeTime − trimStart) / rate`. A missing anchor never defaults to zero.
- When the speech is assembled from several voiceovers (one per section, or a script split at 5,000 characters),
  place each word by its own fragment's placement, never by another take's times.
- Captions, speech-driven graphics and sound effects use the same word times; find them with `grep_timeline`
  transcript `search`.

## Build

Try these in order and take the first that expresses the rule:

1. **`captions_apply`**, when one of the app's caption styles has the reference's rule and look. Give `style` (the
   style's name, such as `caption-neon-pink`) and `src` (the recording on the main timeline the film hears). It sets
   lines, timing and fonts itself; it takes no position, grouping, hold or color, so never edit what it writes.
   Check it with `frames` against the film (below). When its rule differs, remove its layers
   (`compositions/captions/` and their host in the root composition) and go on.
2. **A caption-style component.** `hyperframes catalog --tag caption-style --json` lists them with their
   descriptions; `hyperframes add <name>` installs one into `compositions/components/<name>.html`. Restyle it to the
   reference (font, size from `ink-scan.mjs`, colors, box, anchor, maximum width) and bind it to the remix's words.
3. **Your own caption layer**, when neither has the rule: each word an element carrying its spoken start and end; a
   paused timeline sets each state at its word start with seek-safe `set` calls; CSS owns every state's look and the
   wrapping. Karaoke, moving boxes and pops then differ only in CSS. Set frame zero's state explicitly.

Captions are an overlay on the picture, never a reserved band.

## Check

1. `hyperframes check` passes.
2. Timing: `grep_timeline` with `track: { kind: "captions" }` and the remix's `transcript`. Each word's state change
   lands within about two frames of its word start plus the reference's lead or lag; nothing shows early.
3. Look: `frames` with `file` the reference, `compare_with: "film"`, `at` two word starts per stretch, one group change and
   frame zero, `crop` on the caption. The states match, and so do position, font, weight, color and case.
4. Size: `hyperframes snapshot --at T` on a caption, then `ink-scan.mjs` with `SECONDS 0` on the PNG and on the
   reference frame. The line-height ratio is 0.95–1.05; outside it, the size is wrong or a fallback font is showing.
