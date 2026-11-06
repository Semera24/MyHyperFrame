# Screen walkthroughs and app demos

Read this when the reference is mostly a screen being used: an app or website demo, a tutorial on screen, a product
walkthrough, with or without a presenter in a corner.

## What decides the result

Real use, recorded at the reference's UI event rate, with the cursor and hover states visible. A recording with no
cursor and four scrolls a minute is not a walkthrough, and where the reference shows the product in use, a
screenshot is not product footage. A presenter in the picture follows [talking-head.md](talking-head.md).

## Read the screen

- `read_video` with `describe` and `keyframes` marks each shot that is a screen recording, gives its on-screen text
  exactly, and lists each UI change, cursor move, zoom and pan with its second and ease.
- From that, write the event list: every click, hover, menu, page change and typed field at its second, and the UI
  event rate (events per minute) of each shot. Note whether the cursor shows, its size and style, any click effect
  (a ring, a pulse), and whether the view zooms or pans to follow it.
- Cursor paths: `frames` over each move with `frames: 24` and a `crop` around it; write the path's points at their
  seconds. Never key a cursor path from a 9-frame sheet.
- Typing: `frames` with a `crop` on the field across the span: characters per second, bursts, pauses after
  punctuation, backspaces, the caret.
- Sound: `read_audio` gives each click and key sound's second.

## Get the recording

Ask in the intake round for what you cannot record yourself, with the steps and their seconds so the person can
match the rate.

- **The person's product behind a sign-in:** the person records it, or its vendor's public demo video
  (`import_from_link`). Never sign in to anything.
- **A public website:** `capture_website` gives its screenshots, copy, colors, fonts and logos for the layers
  around the recording. Its use is recorded by the person; without a recording, rebuild its pages as native layers
  from those screenshots, with the cursor, hovers and clicks drawn on the event list's seconds.
- **HyperFrames Studio:** rebuild it as native layers instead of recording it, and start no preview or Studio
  server. `inspect_app_window` gives every control by name and where it sits; measure panels, type and colors from
  a real screenshot (the app window, or the product shots on hyperframes.dev through `capture_website`); fill it
  with this film's own scenes, layers and timeline. A recording the person brings wins.
- **The HyperFrames CLI:** run the commands for real and type their real output into a native terminal layer at the
  reference's typing rate.

## Build

- Land the recording on the reference's clock: map each recorded event onto the reference's event second with
  `node scripts/retime.mjs rec.mp4 assets/screen/rec-retimed.mp4 --map "TAKE_IN:TAKE_OUT=REF_IN:REF_OUT,…"`. Up to
  about 1.5× while the UI does not read as fast-forward; a cut where the reference cuts beats a faster rate.
- Zooms and pans on the recording are native transforms with the ease and span `read_video` gives. Callouts,
  highlights, labels and captions are native layers on their event seconds, never burnt into the recording.
- Where the recording lacks a cursor or a click effect the reference shows, draw it as a native layer on the
  recorded click points.
- Click and key sounds on their event seconds, from the effects catalog (`find_assets` kind sfx) at the reference's
  density.

## Check

- `frames` with the reference as `file`, `compare_with: "film"`, over each span with events: the same
  screen, cursor position, hover state and zoom at each second.
- Each click, hover and page change within about 0.2 s of the reference's; typing leads or lags by about 4 frames
  at most; the UI event rate per shot near the reference's.
