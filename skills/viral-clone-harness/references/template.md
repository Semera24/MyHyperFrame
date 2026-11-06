# Template, project handoff and RESULT.md

Read this once the 1:1 rebuild passes its `frames` check, to save the format so another session or a gallery pick can
remix it, and before revising a delivered film.

Two things are saved:

- **The template** (`templates/<slug>/`) describes a format, so many films can be made from it. One reference makes a
  single-depth template; several videos of one creator make a creator-depth one. Same files, thinner fill.
- **The project** describes one film. Its `frame.md` holds the current story, shots and code map, so another session
  can revise it without this conversation.

`.viral-clone/`, `templates/`, `frame.md` and `RESULT.md` are the project's own: never delete them.

## Template files

`templates/<slug>/template.json` is the template. Write it from three sources: what `read_video` said (its whole-video
text is saved under `.hyperframes/read-video/<name>.txt`), what `read_audio` said, and the rebuilt project. Every field,
the md file it renders into and what it holds are in `scripts/template-schema.mjs`; write `"version": 1`. Then:

```bash
node scripts/template.mjs check --slug <slug> --ref <reference.mp4>   # each missing field with its fix; exits 1 on errors
node scripts/template.mjs render --slug <slug>                         # writes the md files below from template.json
```

Run `check` until it passes, then `render`. Edit `template.json`, never the rendered md.

| File          | Holds                                                                                                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEMPLATE.md` | Name, depth, sources, canvas, runtime, slots (what the person brings; the editor shows them as form fields); what the format is; kept versus swapped; limits.                                                                    |
| `frame.md`    | Tokens (colors, fonts with their files, grid, caption skin); the `Rights:` line; the form: the reference's segments in order, each with role, share, layout, footage, MG density, slots and script recipe; a trick reel's trick. |
| `editing.md`  | Rules, MG density, motion rhythm, person shots, footage rules, captions, transitions and camera, sound, the MG vocabulary, hero scenes, what we will not take.                                                                   |
| `voice.md`    | Only with speech: delivery per kind of passage from `read_audio`'s voice lines; how the creator explains; the script recipe.                                                                                                     |
| `components/` | One HyperFrames block per recurring type, caption skin and transition, copied from the rebuild ([Components](#components)).                                                                                                      |
| `reference/`  | Text only: copies of `read_video`'s and `read_audio`'s text for the reference. Frames stay in `.hyperframes/read-video/`.                                                                                                        |

## What the fields must say

- **Rules, never a timeline:** each a trigger, its treatment, what was read and the evidence (a new term → a keyword
  pill beside the host, 1.8–3.2 s on screen, ref@62.4). Cover layouts and A-roll share, what triggers B-roll, cuts per
  minute and what a cut lands on (`grep_audio`'s beats), graphics, captions, transitions, camera and sound.
- **Motion rhythm** per kind of segment, from `read_video`'s keyframes: how much of it moves, the longest and median
  hold, and the camera per kind of shot (push in from 1.00 to 1.12 over 4 s on every A-roll shot; static on B-roll).
- **MG density per segment, not per minute.** A per-minute rate gets rebuilt as many short cards where the creator
  keeps one long card that keeps changing. Say how many MG events each kind of segment has and whether one card
  evolves or several replace each other.
- **Sound**, from `read_audio`: the music by segment (mood, tempo from `grep_audio`, where it breaks, how far it ducks
  under speech), then one rule per kind of effect with how often its anchor gets it (a card's entry gets a whoosh on
  6 of 10 entries). When the reference adds no effects, write that, and list each effect `read_audio` names on a
  picture event in `not_effects` with why it is not one (on the music's beat, room tone, handling).
- **MG vocabulary**, one reusable type each:

```json
{
  "name": "line chart draw-on",
  "kinds": ["line chart", "chart reveal"],
  "trigger": "a number changes over time",
  "frequency": "1–2 per explain segment (median 1)",
  "box": { "x": 560, "y": 345, "w": 455, "h": 1150 },
  "anchor": { "to": "face", "dx": 1.9, "dy": 0.6, "scale_with_face": false },
  "face": { "relation": "clear" },
  "look": "tokens chart-ink, chart-band (#1F6FEB, #FFD54A)",
  "build": [
    "one card, not split",
    "the line is one stroke 6 px wide with round caps",
    "all text sharp"
  ],
  "entry": "card rises 40 px and fades in over 0.45 s, ease-out; line draws left to right over 1.2 s, linear",
  "hold": "card drifts 6 px and rotates 1° over its hold",
  "exit": "card drops 60 px with motion blur, 0.3 s ease-in, on the sentence end",
  "evidence": { "times": [312.4], "frames": [".hyperframes/read-video/ref/frames/t0312.40s.jpg"] },
  "component": "components/line-chart.html",
  "score": "matches"
}
```

- `entry`, `hold` and `exit` come from `read_video`'s motion lines over the type's span: what moves, from where to
  where, its seconds, ease and overshoot. `build` holds what no number checks (what it is made of, how many units,
  their shape, edge, texture, sharpness), read from a close crop (`frames` with `crop`), each item one a rebuild does
  or does not do. "Paper-cut letters" is not a build item; "one paper scrap per letter, each tilted up to 8°" is.
- A type nobody read closely gets `"status": "unmeasured"` and is not built until it is: a graphic invented where
  nothing was read is the commonest way a remix stops looking like its reference.
- `face` is how the piece sits against the presenter's face in the reference: `clear` (never on it), `crosses` (only
  while it enters, leaves or transitions), `covers` (it holds over the face: a cutaway, a card over the host, a
  sticker as a joke), or `none` with no presenter. The remix keeps it: a `clear` piece that a new framing puts on the
  face is a layout defect; a `covers` piece moved aside loses the joke.
- **Hero scenes** in `hero_scenes`, in the vocabulary's shape plus their art style and the segments that call for one.
- **Person shots:** per kind of segment, framing (face height and subject box as shares of the frame), camera, place,
  light, and each action tied to a word or graphic (points at the card as it lands), so another person can be shot
  to fit the graphics.
- **Footage rules:** per kind of segment, the kind and era of footage, what it does (proves what the speech names,
  sets a mood, shows the product), how specific it is, how long a shot holds, its treatment and its share.
- **What we will not take:** brand marks, including their layout redrawn around a new name; the reference's own
  footage and photos; its people: their face, body, voice and words.

## Motion-graphics films: the rebuild is the template

For a film whose content is its motion, the template is the rebuilt project itself. One data file (for example
`src/story.js`) owns every text, number, list item, color, step timing and cursor key; the motion code reads it and
keeps no copy. Each step's time is a trigger plus an offset (a word of the voiceover or a beat of the music, plus the
seconds read), never an absolute time, so a new voiceover moves the beats without touching the motion code. Declare
top-level strings and colors in `data-composition-variables` too. Copy the rebuild, with the reference's words and
cut stills, into `templates/<slug>/` once it passes. Before calling it a template, change the data file (a longer
title, one more list item, another color), run `hyperframes check` and `hyperframes snapshot` at the beats, confirm
it re-fits and keeps every beat, then put the content back. A template that only fits its first content is a copy.

## Components

For a talking-head, creator or UGC video the reusable part is its pieces: who appears and what they say change every
time; captions, graphics, backgrounds and transitions carry over. Each recurring type and transition becomes
`components/<name>.html`, copied from the rebuild, its type's `component` pointing at it.

- Declare its variables in HyperFrames' schema, each with its `role`: `content` (words, images), `style` (brand
  tokens), `layout` (anchors, boxes), `timing` (offsets). A piece whose look holds while its entry changes is one
  block with each entry as a preset, not two pieces.
- A piece that moves while it holds in the reference (a boiling title, a card playing footage, a scrolling page)
  moves in the block too: never a still with a push.
- A photographed surface (torn paper, a sticker, tape, a photo) is an image: a blank patch cut from the reference's
  largest clean frame, or `generate_image` with `nano-banana-2` and that frame in `references`; never gradients and
  clip paths standing in for it.
- Check each piece on its span: `frames` with the reference as `file`, `compare_with: "film"` and a `crop` on its
  box. Write `matches` or what differs in its type's `score`.

## The project's frame.md

`frame.md` is the project's reading entry: design tokens in its frontmatter, then the current film at every change
of speaker, action or view, in prose or short tables:

| Information        | Minimum handoff                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Intent and story   | What is exact, similar or changed; what each segment does (setup, claim, proof, payoff; build, peak, release)          |
| Cast and world     | Names and roles, each person's identity image and voice source, place, wardrobe, eyelines, props                       |
| Speech             | Who owns the script, the chosen soundtrack and its alignment, the voice and transcription used, key pauses             |
| Performance        | Gestures, gaze and expressions in order, tied to words or actions                                                      |
| View and edit      | Framing, camera move versus crop, what triggers each cut, what each B-roll shot proves                                 |
| Graphics and sound | Layer handoffs; caption versus scene text; the event behind each effect                                                |
| Code map           | Selector, content field or data file for each editable thing; each chosen file and its tool result; stand-ins and gaps |

Keep what the reference shows, what was intended and what was delivered apart: a prompt asking for a smile does not
prove the take has one; note the gap at its moment. One owner per fact: timing lives in code and data, not in a
second prose timeline; what the reference shows lives in `templates/<slug>/reference/`.

## Keep media connected to its use

For each chosen file keep the request (prompt, settings, model asked for and reported), its references in order with
their roles, the tool result as it came back, the chosen output, `node scripts/retime.mjs` pieces and rates, and what
still differs. Keep identity images and scene anchors apart from generated views, so a later session never takes the
last generated scene for the identity source.

## Change only the coupled parts

| Request                       | Reconsider                                           | Reuse after checking          |
| ----------------------------- | ---------------------------------------------------- | ----------------------------- |
| Caption color or grouping     | style, fit                                           | audio, alignment, performance |
| New person                    | identity views, performance, cut-outs                | audio, world, shot grammar    |
| New script, language or voice | speech, performance, alignment, speech-driven events | unrelated media and graphics  |
| New product or claim          | claims, script, props and screens, proof, payoff     | camera, world, motion         |
| New MG content                | text and data meaning, layout, crop, reading time    | motion code                   |
| Borrow only the style         | new story, objects and edit                          | the template's feel           |

A new brand name over the old product's proof is not a remix. Update the segment notes, code map, media records and
alignment together.

## RESULT.md

Written for the person, in their language. It opens with what still differs from the reference, before anything
else: each difference with a `frames` picture of the reference beside the film at its worst second, and every
stand-in (a font, a logo, a placeholder figure, a generated still, an approximated move). Then:

- Editable: text, captions, graphics, data and UI are DOM layers, all of them.
- Form: the same beats, order and layouts, from `frames` with the reference as `file` and `compare_with: "film"`.
- Motion: each move's ease, length and overshoot against `read_video`'s motion lines; what the last review named.
- Sound: music and effects on `read_audio`'s seconds, ducking, and `check_audio`'s result.
- Voice: whose voice, and that it is never the reference speaker's.
- Rebuild scope (the whole film, a stretch with its hero scenes and pieces, or pieces) and why.
- What was not checked by a tool: lip sync and face size are checked by eye on `frames` crops; say so.

A difference or stand-in the person is not told about is a defect.

## Deliver

The editable project with its local assets and fonts, the template and `RESULT.md`; the app renders and exports. A
fresh session reads `frame.md`, then the segment it changes, then its code and media record, and can revise the film
without this conversation.
