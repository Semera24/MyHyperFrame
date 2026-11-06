---
name: camera-3d-captions
description: >
  Captions living in 3D space around a talking head: a camera flies between the speaker and the words (whip-in,
  parallax truck, push), caption groups sit at different depths so camera moves pull them apart, hero words hide
  BEHIND the speaker through an alpha matte, a ring of words wraps round the speaker and turns in front of them, focus
  racks between depths, and text steps at 15 fps with ghost motion blur. Works in any type style (editorial serif,
  bold sans) or hand-drawn (p5.brush write-on). Trigger on: "3D text", "3D camera captions", "text around / behind the
  speaker", "camera moves through the text", "depth captions on my avatar video". Covers prep (portion, padded plate,
  matte, word clock, font metrics), the shot grammar, depth rules, QC, and limits.
---

# 3D camera captions

The After Effects move (3D camera, depth of field, text on a path, Posterize Time 15, motion blur) rebuilt as a
deterministic per-frame painter for HyperFrames. One clock paints plate, matte and every glyph. Nothing is a CSS
animation.

## When to use / when not

- **Use** on a static-camera talking-head take (avatar or real), landscape, medium shot or wider, 5–20 s per piece.
  The words must perform in depth around the speaker.
- **Do not use** for plain subtitles, a moving or handheld camera (the matte and the plate transform assume a locked
  shot), extreme close-ups (no room behind or around the head), or a subject a person-matting model can't separate.

## Requirements and side effects (complete list)

- **Tools:**
  - Node 22+ and Desktop's bundled `hyperframes` on PATH. Use that CLI for every command below.
  - `ffmpeg` on PATH.
  - Python 3 with `fonttools`, `brotli`, `numpy`, `pillow`.
- **Matte:** `hyperframes remove-background` runs locally. On first run it downloads its person-segmentation
  model (~170 MB) to `~/.cache/hyperframes/`.
- **Render time:** compositions load GSAP 3.14.2 from `cdn.jsdelivr.net` at preview/render time.
- **Word clock:** existing word timings or Desktop’s `voice.transcribeAudio`. Onset accuracy matters; plain Whisper
  starts run late.
- **Fonts:** bundled OFL faces and Apache-2.0 Permanent Marker in `assets/looks/fonts/`, with licence texts and `NOTICE.md`. Confirm embedding rights for any user-supplied face.
- **Hand-drawn style (optional):** needs the `p5-paint-animation` skill installed and set up (its setup downloads
  pinned puppeteer, Chrome for Testing, p5 and p5.brush). `build-sprites.py` runs it headlessly; frames are written
  to that skill's `out/` and removed afterwards.
- **Nothing else:** no credentials, no paid calls, nothing uploaded. Files are written only into the project
  (`assets/`, `renders/`).

## Prep (once per take)

1. **Portion and plate.** `bash scripts/prep-take.sh <take.mp4> <start_s> <dur_s> <project>/assets` produces:
   - `portion.mp4`: the audio source.
   - `plate-tall.mp4`: reflect-padded 240 px each side, 480 px top, 240 px bottom, so whips, trucks and pull-backs
     never show an edge.
   - `person.webm`: the alpha matte, same frames.
   - The script then checks the plate and matte against the portion (size, frame rate, frame count) and fails on
     any mismatch.
2. **Word clock.** Word timings for the portion, in seconds from its start.
3. **Fonts.** Pick 2–3 roles (caption / hero / ring), then
   `python3 scripts/font-metrics.py assets/metrics.js key=font.woff2[@wght=…,opsz=…] …`.
   - A variable font must get its axes passed here AND pinned in CSS (`font-variation-settings`,
     `font-optical-sizing: none`). Otherwise the browser's opsz follows the size and words overlap.
4. **Silhouette.** Read the head box and shoulder line off the `person.webm` alpha before placing anything.

## Build

- Copy `assets/kit/` into the project's `assets/kit/` and `metrics.js` into `assets/`.
- Copy `assets/looks/` into the project's `looks/`, and keep `NOTICE.md` and the licence texts with copied fonts.
- `references/worked-film.html` is the complete reference film. It has two shots, a body wipe, both ring types, a
  fly-through, a finale and the grade; its media is not included.
- `references/recipes.md` holds the depth-first groups, the wrapped ring, the staircase and hand-drawn words.
- `C3.init(metrics, {W, H})`:
  - The lens keeps the tutorial's vertical field of view (F = 1326.1·H/1080), so `tables.js` applies unscaled at any
    width.
  - On a frame wider than 1440, add `(W − 1440) / 2` to `wipe.x`.

## Shot grammar

Pick 4–6 beats. Split each spoken clause into its own group.

| Beat             | Build                                                                                 | Rule                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Whip-in punch-in | `camA` table (19 f from 502 px low) then a `linear` creep                             | plate `S0` 1.1–1.3; the frame never lands                                                               |
| Depth groups     | 2–3 caption groups per clause at D 1250 / 1500 / 2200                                 | near = bigger with a bigger shadow; the creep and truck reveal the parallax                             |
| Hero behind      | hero word in the behind layer at the plate depth, masthead-style across the head      | the head hides the middle letters; ≥ 60 % stays legible; the ascender is inside the frame               |
| Parallax truck   | `swing` segment, `tx` 420                                                             | the old layout fades over 3 steps; the next layout arrives by parallax                                  |
| Body wipe        | the speaker's own matte, `brightness(0) blur()`, leading edge from `wipe.x`           | shot A clips left of the band, shot B right; pull-out on both sides                                     |
| Wrapped ring     | horizontal circle IN FRONT of the speaker (centre Z 2000), 11–16° from above, turning | words enter small at the side as spoken, swing round the front, settle; lower arc flips to read upright |
| Fly-through      | phrases at D 1500 / 2000 / 2500, camera swings between them                           | focus follows the phrase                                                                                |
| Staircase finale | push segment; caption words each deeper and smaller down a diagonal                   | the push drives the near words apart                                                                    |

## Rules

- **Motion:**
  - Text is posterized to 15 fps (its own animation and the camera it sees). Plate and matte move every frame.
  - Motion blur is 7 ghosts over half a 15-fps step. Use `shutter: 0.5` on turning rings.
  - Captions lead the voice by 0.2 s, snapped to the 15-fps grid: `fr(t) = 2·round((t − 0.2)·15)`.
  - Entries rise by `ENTRY`: captions 30 px, heroes 110–260 px. Ring words ease their last 30–44 px along the path.
    Use `RING_ENTRY`'s overshoot only when no neighbour is seated yet.
- **Depth:**
  - Every group gets its own D. Plate 3000, captions 1250–2400, wrapped ring ≈ 1100–2700.
  - Depth shadow `[6, 16, 0.5, 1500]` scales as 1500/(D − cz).
  - DOF σ = 6.7·|D − focus|/D px at 1080 tall. Flat captions cap at 1.2 px; ring glyphs take the full blur.
- **Sizes:** `size` / `rise` are on-screen px at the landing camera (`tland`). Sprites are rendered at their
  on-screen size.
- **Spacing:**
  - Ring text always goes through `ringLine` (on-screen advance; type: track 1.10, gap 26–30; hand-drawn: track 1.0,
    gap 28).
  - A turning ring is re-laid every pose.
- **Occlusion:**
  - Rings draw in front of the speaker.
  - Split a word into behind/front instances (`side`, `zSplit`) only when it is MEANT to pass behind the head.
- **Legibility:**
  - Captions go over the dark side of the frame.
  - Text crossing skin or light clothing gets a dark halo.
  - No trailing periods on screen.
- **Grade (optional):** `finish.js` supplies curves, saturation 1.12 for skin, and grain re-rolled per frame. Put
  the opaque scene (plate + behind text + matte) in a filtered wrapper. Give front text the same grade with grain
  composited atop, so a word split behind/front stays one colour (see `references/worked-film.html`).

## Styles

- **Editorial:** a condensed display serif, italic for heroes; a text serif for captions; cream plus one accent.
- **Bold:** heavy grotesk heroes, light captions, one saturated accent (the worked film).
- **Hand-drawn:** p5.brush write-on sprites from `scripts/hand/build-sprites.py`:
  - Each word writes itself on from its onset.
  - Rings place words whole, rotated to the tangent and scaled by depth, on a bigger, flatter ring.
  - Recipe in `references/recipes.md`.

## Verify

1. `hyperframes check . --no-contrast`. The ghost layers trip the WCAG contrast check; the whip and wipe seams
   are overlapping by design.
2. In the preview page, paste `scripts/frame-bounds.js` and run `__frameBounds(0, dur)`.
   - It must return `[]`: no group outside the frame for 5+ steps while visible.
3. Paste `scripts/glyph-gaps.js` and run `__glyphGaps(t)` at rest.
   - No cross-word touches.
   - Flat words measure as one box (descenders flag false positives). An italic f's overhang reads negative. Words on
     opposite sides of the wipe band both show.
4. Word gaps: the rendered gap between words ≈ one space advance.
5. Snapshot every beat, render with `hyperframes render . --crf 12`, and check full-resolution frames per
   beat.

## Limits

- Matte edges flicker on fine hair. The mirrored pad shows briefly during a whip.
- A speaker who fills the frame leaves little room behind: go masthead-high, or tuck behind a shoulder.
- `snapshot --at` shares one page, so grain does not re-roll between captures. Judge grain on a render.
- Rendering with the grade and many ghost layers costs about 2× a plain render.

## Desktop look selection

A style request carries `[look: <id>]`, or `[look: custom; type "<family>"; accent #RRGGBB]`.
Use the supplied `assets/looks/looks.js`, `looks.css` and fonts; `references/look-composition.html`
is the measured example, not a take to reuse. Copy its look application and composition-variable declarations
into the new take, replacing every word and media path with the person's take and transcript.
Presets: editorial, bold, poster, marker, soft, tech, neon, clean. Keep the `look` variable with these
options so the app can change it after the build. For custom type, reuse the family's supplied font
from `assets/looks/fonts` first. Otherwise install it through the app font path.
Add its role faces and metrics to the look table, and set accent.
For a website request, use the captured fonts and palette included in the request. Never guess a site's brand.
For vertical takes, start from `references/portrait-film.html`, which uses the same camera/ghost painter with portrait-specific landings and an explicit measured head box. Replace its sample words, head bounds and media
with the actual take. Author a 1080 by 1920 composition and fit camera landings, word widths and
head occlusion to that canvas. Do not stretch the landscape take or use its coordinates unchanged.
The Desktop run provides `hyperframes` on PATH, at the app's pinned version. Do not download a second CLI.
