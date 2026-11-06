# ② Write the template, and leave a project another session can remix

Two things are saved, at two levels:

- **The template** (`templates/<slug>/`) describes a _format or creator_, so many films can be made from it.
- **The remix project** (the HyperFrames project itself) describes _one film_: its `frame.md` holds the current story,
  shots and code map, so another session can revise it without this conversation.

The files are the same at every depth; a single-video template is a thinner fill, never a different format.

## Template files

**`template.json` is the template.** `vc watch` drafts `templates/<slug>/template.draft.json` from what it measured:
one draft type per Gemini kind (box in pixels, times, motion windows, face relation and anchor, Gemini's words), the
form, captions, person beats, motion rhythm, sound and prosody. What it cannot do is yours:
consolidate the kinds into reusable types (Cindy's 16 kinds became 13 types with shared presets; another film's 13
became 8), map every kind to a type or to `kinds_not_taken`, and correct each field
against frames and the tools (`vc box`, `vc events`, `motion-curve.mjs`). Save the result as `template.json`, run
`node scripts/vc.mjs template check` until it passes (G0.5 waits on it), then `node scripts/vc.mjs template render`,
which writes the md files below. Every field, the
md file it renders into and what it holds: `scripts/template-schema.mjs`.

| File          | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEMPLATE.md` | The entry, rendered: name, depth, sources, canvas, runtime, slots; what the format is; kept versus swapped; the file map; known limits.                                                                                                                                                                                                                                                                                                  |
| `frame.md`    | Rendered: design tokens (colors, recovered fonts with their files, grid, caption skin); the `Rights:` line; the **form**: the reference's own segments in order, in its own terms (story beats, sections, music phrases, or "continuous" for one take), each with its role, runtime share, layout, footage kind, MG density, slots and script recipe; for trick reels, the trick's timing and mechanism.                                 |
| `voice.md`    | Rendered, only with speech (check the audio): the fingerprint from `fingerprint.mjs` (G1's targets); delivery per kind of passage from `prosody.mjs`; moves by segment, **including how a term gets explained** (the everyday example, the comparison, the number that lands it), from body passages, each move's function plus one to three paraphrased examples, never sentence shapes; the script recipe.                             |
| `editing.md`  | Rendered: trigger → treatment rules with numbers and evidence; MG density per segment; the **MG vocabulary**; **footage rules**; the caption rule; transitions and camera; sound; what we will not take.                                                                                                                                                                                                                                 |
| `components/` | The avatar-independent pieces as code, one HyperFrames block each: every caption skin, card, overlay, sticker, lower third, picture-in-picture frame, background and transition its MG vocabulary, caption rule and footage treatments name, words and colors as `data-composition-variables`. Each type's `component` points at one and its `score` carries how it scored ([Components](#components-rebuilt-and-scored-one-at-a-time)). |
| `reference/`  | Text records only: `dense.md` (what the original shows, source observations only), the footage log, `motion-windows.json`, measurement JSON, the sound map and palette JSON, loudness and drop numbers. The frames, sheets and strips behind them stay in the project's hidden `.viral-clone/<slug>/`.                                                                                                                                   |

Slots are what the person brings; the editor renders them as form fields.

### What the fields must say

**Rules, never a timeline:** each a trigger, its treatment, what was measured and the evidence (a new term → a
keyword pill beside the host, 1.8–3.2 s on screen, ref@62.4). Cover, with numbers: layouts
and A-roll share; what triggers B-roll; cuts per minute (hard and all) and what a cut lands on (the beat share beside
chance); graphic types, triggers, boxes, entries and exits; captions; transitions and camera (punch-ins: crop or real
move); sound and loudness per section.

**Motion rhythm** per kind of segment: moving share, longest and median hold, update rate, and the camera per kind
of shot (push in from 1.00 to 1.12 over 4 s on every A-roll shot; static on B-roll). These are G2 targets.

**Sound:** the music map by segment (mood, tempo, track changes, drop-outs and hits, how many dB it ducks under
speech), then one rule per kind of sound event, in the reference's own terms, with how often its anchor gets it
(a card's entry gets whoosh-1 on 6 of 10 entries, about 18 dB under the voice; anchor `none` for foley).
Write "no added effects" when that is what the reference does, with `not_effects`: each of the map's hits on a picture
event, at its second, with why it is not an effect (on the music's beat, room tone, handling), read from its frame and
clip; `template check` refuses a silent template that leaves one out. Keep `event_lift`, `phrase_lift` and the share of
picture events and phrases with sound (`share_of_events_with_sound`: 1 is every event, not one event) from
`reference/sound/sound-map.json` as the targets, and the palette as
`reference/sound/palette.json` plus its lifted files, with its size (distinct sounds), effects per minute and the most
any one sound repeats per minute.

**MG density per segment, not per minute.** A per-minute rate gets rebuilt as many short cards where the creator keeps
one long card that keeps changing. For each kind of segment, state how many MG events it has and whether one card
evolves or several replace each other.

**MG vocabulary**, one type each:

```json
{
  "name": "line chart draw-on",
  "kinds": ["line-chart", "chart-reveal"],
  "trigger": "a number changes over time",
  "frequency": "1–2 per explain segment (median 1)",
  "box": { "x": 560, "y": 345, "w": 455, "h": 1150 },
  "anchor": { "to": "face", "dx": 1.9, "dy": 0.6, "scale_with_face": false },
  "face": { "relation": "clear", "share": "on the face box in 0 of 12 sampled frames" },
  "look": "tokens chart-ink, chart-band (sampled #1F6FEB, #FFD54A)",
  "build": [
    "one card, not split",
    "the line is one stroke 6 px wide with round caps",
    "all text sharp"
  ],
  "entry": "card rises 40 px + fades in 0.45 s ease-out; line draws left→right 1.2 s linear",
  "hold": "card drifts 6 px and rotates 1° over its hold",
  "exit": "card drops 60 px with motion smear, 0.3 s ease-in, on the sentence end",
  "update": "on twos",
  "evidence": { "times": [312.4], "windows": ["linechart-in", "linechart-out"] },
  "component": "components/line-chart.html",
  "score": "curve-pair in 0.86, out 0.83; box within 6%"
}
```

A type with no close-up window behind its path, or no `build` list, has `"status": "unmeasured"` and is not built
until it is measured: a graphic invented where nothing was measured is the commonest way a remix stops looking like
its reference. `build` holds what no number in the type can check (what the piece is made of, how many units, their
shape, edge, texture and sharpness), each item one a rebuild does or does not do
([watch.md](watch.md#the-loop) step 4).

`face` is how the piece sits against the presenter's face in the reference, read from the face box over its window
beside the piece's box: `clear` (never on the face), `crosses` (only while it enters, leaves or transitions) or
`covers` (it holds over the face: a full-frame cutaway, a card laid over the host, a sticker on the face as a joke),
with the share of sampled frames. A remix piece is on the new person's face exactly as its `face` says: a
`clear` piece that a different framing puts on the face is a layout defect, and a `covers` piece moved aside to keep
the face in view loses the creator's cutaway or joke. With no presenter in the window, `none`.

**Hero scenes**, one each in `hero_scenes` in the vocabulary's shape, plus its art style and the segments that call
for it. The remix rebuilds the scene's construction around its own subject.

**Person shots:** per kind of segment, the framing (face height and subject box as shares of the frame), camera,
place and light, and each action tied to a word or a graphic (points at the card as it lands, holds up the product,
reaches for the laptop), so a different person can be shot to fit the graphics.

**Footage rules:** per kind of segment, which kind and era of footage it uses and what that footage does (proves what
the speech names, sets a mood, shows the product), how specific it is, how long a shot holds, its treatment (whichever
the reference uses: push-in, grade, black and white, blur, grain, vignette, crop, host picture-in-picture corner), the
measured look targets from `look-stats.mjs`, and the runtime share.

**What we will not take:** brand marks, including their layout redrawn around a new name, the reference's own
footage and photos, and its people: their face, body, voice and words.

## Motion-graphics films: the rebuild is the template

For a video whose content is its motion, the reusable template is the rebuilt project itself, not a description of it.
One data file (for example `src/story.js`) owns every text, number, list item, color, step timing and cursor key;
the motion code reads it and holds no copy of its own. Each step's time is its trigger and offset (a word of the
voiceover or a beat of the music, plus the measured seconds), not an absolute time, so a new voiceover moves the
beats without touching the motion code. Top-level strings and colors are also declared in `data-composition-variables` and
read with `window.__hyperframes.getVariables()`, so `hyperframes render --variables '{…}'` changes them without code. Before delivering, render one variant with changed content
(a longer title, one more list item, another color) and confirm it re-fits and keeps every beat: a template that only
renders its own first content is a recreation, not a template. The rebuild lives in `templates/<slug>/` from its first
frame, with the reference's own words, logos and cut stills; the remix is the project itself, a copy of it with its own
data file. The project's `index.html` is what the app plays and the person keeps, so it never holds the rebuild, not
even mid-run. It holds the film's skeleton from right after the answers and each scene, remixed, as it lands
([media.md](media.md#motion-graphics-films-rebuild-then-remix)). `TEMPLATE.md` and `editing.md` still describe the format and point at the data file for timing.

## Components: rebuilt and scored one at a time

For a talking-head, creator or UGC video the reusable part is not the film but its pieces: who appears and what they
say change every time, while captions, graphics, backgrounds and transitions carry over. Rebuild each piece as code
instead of the whole film, and score it with the instruments the watch already used on it:

1. **The pieces are the MG vocabulary's types and the transitions** already in `editing.md`, each with its window in
   `reference/motion-windows.json`. Captions are not pieces: they follow the caption rule
   ([below](#captions-and-event-time)) and G2 checks them.
2. **Build each as a HyperFrames block** in `components/<name>.html`, its size from the measured ink and boxes, and
   place it 1:1 on the reference: `.viral-clone/pieces/index.html` plays `ref.mp4` as its base and lays every piece over
   it at the reference's own times, with the reference's words and its own cut clips and stills (a working step, never
   delivered). A piece whose box moves in the reference while it holds (a title that boils, a card playing footage or
   an animation, a scrolling page) moves in the rebuild too: cut that span of the reference as a clip, or rebuild the
   animation in layers; never a still with a push. Read each move from the reference rather than from frames by eye:
   `hf-media evidence flow-track ref.mp4 --roi … --start --end` gives every move between holds as a tween (start,
   duration, x, y, scale, rotation, the closest GSAP ease, overshoot; a one-frame `jump` is a cut, not a tween);
   over a moving presenter, where flow is noisy, `node scripts/vc.mjs box ref.mp4 --start --end --roi … --color …
--track` follows the piece by its color instead, and `motion-curve.mjs` gives fades and reveals. **Materials before code:** settle each piece's materials from its zoom
   before writing it. Each typeface is matched as [watch.md](watch.md#the-loop) step 8 says, candidates rendered beside
   the zoom; a stand-in only when no candidate comes close, named in `frame.md`. Anything the reference shows as a
   photographed surface (torn paper, a sticker, tape, a cut-out, a photo) is an image: a blank patch cut from the
   reference's largest clean frame, or an `image.generate` edit of that frame (`nano-banana-2`, the frame first),
   never gradients and clip paths standing in for it; Cindy's drawn scraps read as cheap beside her paper. Start
   paper scraps, a boil and type-on from the skill's
   [library](../library/README.md) rather than writing them again. Subagents may build pieces in parallel when that
   is faster, each from the same measurements. Declare
   its variables in HyperFrames' own schema, each with its `role`: `content` for what changes every video (words,
   images), `style` for brand tokens, `layout` for anchors and boxes, `timing` for measured offsets. A piece whose look
   holds while its entry changes between videos is one block with each measured entry as a preset, not two pieces.
3. **Score them all on their windows, entry, hold and exit** (G0.5): `node scripts/vc.mjs pieces` renders the pieces
   on green (the page with its reference video removed), scores every window and writes `report.md`; open each
   window's zoom and strip it names, fix everything, then `node scripts/vc.mjs pieces --changed <the windows you
changed>`; one fix round: v0, fix, v1; a piece that still does not move where the reference does is fixed
   again, never let through by the round
   ([G0.5](checks.md#g05-the-pieces-before-the-script-talking-head-creator-and-ugc-remixes)). Write `matches` or what
   differs in each type's `score`, with its numbers. Then render it once with changed content (a longer
   title, another image), as a motion-graphics template is checked, and confirm it re-fits.

The remix is assembled, never written as a builder script: `node scripts/vc.mjs assemble timeline.json` copies the
pieces into `compositions/`, fills their variables, places each at its word by its type's `anchor` on that take's
face box, keeping its `face` relation, and writes `index.html` .

## The remix project's frame.md

`frame.md` is the project's reading entry. Keep native design tokens in its frontmatter. Its body covers the current
film, in prose or compact tables, at every meaningful moment and change of speaker, action or view:

| Information        | Minimum handoff                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Intent and story   | What is exact, similar or changed; what each segment does (for a story: setup, claim, proof, payoff; for a montage: build, peak, release)     |
| Cast and world     | Names and roles, each person's identity image and voice source, location, wardrobe, eyelines, prop state                                      |
| Speech             | Script owner, selected soundtrack and its alignment, the speech engine and transcription route used, meaningful pauses                        |
| Performance        | Ordered gestures, gaze and expressions tied to words or actions; the listener's reaction                                                      |
| View and edit      | Framing, and camera move versus crop; what triggers each cut; what each B-roll shot proves                                                    |
| Graphics and sound | Layer handoffs; caption versus scene text; the event driving each effect                                                                      |
| Code map           | Selector, content field or data file for each editable thing; selected media and its tool result; the render command; stand-ins and open gaps |

Keep **observed source behaviour**, **intended direction** and **verified delivered behaviour** distinguishable. A
prompt asking for a smile does not prove the take has one; note the gap beside its moment.

Keep one owner per fact: numbers and timing live in code and data, not in a second prose timeline; source
observations live in `reference/dense.md`, never rewritten as if the remix appeared in the original.

## Keep media connected to its use

For each selected file keep the request (prompt, settings, model and engine requested and reported), its ordered
references with their roles, the tool result as it came back (path, video_id, seed), the selected output and its hash,
retime pieces and rates, and what still differs. Keep identity images and scene anchors separate from generated views,
so a later session never mistakes the last generated scene for the identity source. Keep private recovery files out of
anything shared.

## Captions and event time

The selected recording owns the performed words and their timing; the script is intent. Bind each displayed word to its
spoken span, merges included ("TRY HEYGEN TODAY" ↔ "Try / Hey Jen / today"). Captions, speech-driven graphics and sound
effects share word and phrase events, with their offsets, in one editable owner.

Source time, take time and composition time differ. For a forward constant-speed piece,
`compositionTime = placement + (takeTime − trimStart) / rate`. Apply the same mapping the edit uses; a missing anchor
never defaults to zero. When speech is assembled from phrases (one `voice.generateVoiceover` call per segment, or a long script
split at 5,000 characters), place words by those exact fragment placements, never by another take's transcript times.

`vc assemble` builds captions from `template.json`'s caption rule: each word carries its spoken span, the paused
timeline sets its state with seek-safe `set` calls, and CSS owns every state's look and the wrapping; karaoke, moving
boxes and pops then differ only in CSS, and frame zero is set explicitly. A rule it cannot express is a caption
component of the template's, started from HyperFrames' caption work rather than from scratch ([watch.md](watch.md#captions-recover-the-rule-against-its-clock)). A caption keeps the reference's rule
and style (`ink-scan.mjs` on both, cue onsets against the words within about two frames, the same box and style),
never the reference's letters.

## Change only the coupled parts

| Request                       | Reconsider                                           | Reuse after checking                |
| ----------------------------- | ---------------------------------------------------- | ----------------------------------- |
| Caption color or grouping     | style, fit, render                                   | audio, alignment, performance       |
| New person                    | identity views, performance, mattes                  | audio, world, shot grammar          |
| New script, language or voice | speech, performance, alignment, speech-driven events | unrelated media and graphics        |
| New product or claim          | claims, script, props and screens, proof, payoff     | camera, world, motion relationships |
| New MG content                | text and data meaning, layout, crop, reading time    | motion code                         |
| Borrow only the style         | new story, objects and edit                          | the template's 神                   |

Replacing the brand name while showing the old product's proof does not complete a remix. Update the affected segment
notes, code pointers, media selections and alignment together, and keep the parent revision intact.

## Deliver

Deliver the export plus the editable project with its local assets and fonts. A fresh session reads `frame.md`, then
the affected segment, then its code and media record, and can render and revise without this conversation. List every
stand-in in `frame.md` and in the reply.
