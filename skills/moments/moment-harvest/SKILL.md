---
name: moment-harvest
description:
  "Cut a finished HyperFrames project into Moments: windows of the film, each a copy of the film's own code retimed
  to that window, with clip.mp4, still.jpg, dense.md, REMIX.md and a role (hook, setup, proof, turn, payoff, cta),
  saved under the project's moments/. Use when the person has a finished video in a project (their own, a Viral Clone,
  one made for them) and says 'turn this into Moments', 'harvest Moments', 'split this into reusable clips', 'save the
  scenes'. Not for making a film from Moments (→ moment-film) or for a video file with no project. The harvest gate
  must pass before you reply. [moments, harvest, split, scenes, clips, reuse, remix, library]"
---

# Moment Harvest

A Moment is a short window of a finished film that someone can drop into a new film and edit. Harvesting does not
judge or rewrite the film: every Moment is the film's own code retimed to its window, so it plays the film's frames
there, and every word, colour and image in it stays editable. The work is choosing the windows (a script
does) and saying what each one is (you do).

Order: read → cut → name → pack → gate → reply.

## 1. Read

- The project is the folder with `index.html` whose root has `data-composition-id`, `data-duration`, `data-width`
  and `data-height`. No such root, or only a video file: say this skill needs a HyperFrames project and stop.
- Moments go in `<project>/moments/`. A second harvest replaces them; say so in one line before you cut.
- What the person asks maps to the cut: "short ones" → `--target 2.5 --max 4`; "about N Moments" → `--target`
  the film's length / N. Otherwise keep the defaults (windows of 1.5–8 s, about 4 s).

## 2. Cut

```sh
node <SKILL_DIR>/scripts/harvest.mjs cut --project <project>
```

It renders the film once (about 3 s of work per second of film), finds hard cuts, the timeline's own boundaries and
the ends of holds (the frames where motion starts again after a rest), and writes one folder per window:
`moments/M01/` with `clip.mp4`, `still.jpg`, `code/` (the film's `index.html` retimed to the window, with
`assets/` and `compositions/`; media wholly outside the window is left out), a `dense.md` and `moment.json` to fill,
and six frames of the window in `moments/.work/M01-sheet.jpg`. A render of this same project that is newer than its `index.html` can
stand in for the render: `--video <file.mp4>`.

This skill renders, unlike the build skills (STANDARDS.md §9): a Moment is a clip as much as code.

## 3. Name each Moment

Open each `moments/.work/<id>-sheet.jpg` (and `still.jpg` when a frame is unclear), then replace every `TODO`:

- `moment.json`: `name` (what happens, with the real nouns on screen, under 100 characters: "Search palette types
  'vide' and picks AI videos starring you"), `role` from the table below, `why` (one sentence: why a viewer keeps
  watching), `mechanic` (2-4 short tags: `cursor`, `kinetic-type`, `morph`, `chart`, `counter`, `ui-demo`, …).
- `dense.md`: Storyline (what happens, in order), Look (ground, palette, type), Motion rules (how things move).
- `moment.json` `media`: one row per footage, image or audio file the window plays. `origin` and `source` come from
  the project's own records (a Viral Clone's `work/plan.json`, media-use's `.media/manifest.jsonl`); leave them. Fill
  `what` (what is on screen, one line) and `prompt`, the prompt that would generate a stand-in for it: subject and
  action, framing and lens, camera move, light, look, aspect and length ("Low-angle 16:9 shot of a footballer lifting
  a trophy on a podium under stadium lights, confetti falling, slow push-in, 2.4 s"); for audio, the music or sound
  it is. A generated file keeps the prompt it was made with. `footage` is real video someone else shot: say so in
  the reply, since sharing the Moment shares those pixels.
- `code/REMIX.md`: the name, the Signature sentence, the words on screen with the element in `code/index.html`
  that holds each (search it for the word), and a role for each listed colour.

| role   | the window…                                               |
| ------ | --------------------------------------------------------- |
| hook   | opens the film or grabs attention before anything is said |
| setup  | frames the problem or the context                         |
| proof  | shows the product working, a number, a feature in use     |
| turn   | changes direction: a reveal, a switch, before → after     |
| payoff | lands the result or the emotional peak                    |
| cta    | ends on the logo, an end card or an ask                   |

The cut script guesses hook for the first window, cta for the last and proof between; change any guess the frames
contradict. Say what is there, not whether it is good. Do not move windows or edit `code/`: a different cut is a new
`harvest cut`.

## 4. Pack

```sh
node <SKILL_DIR>/scripts/harvest.mjs pack --project <project>
```

It refuses while a `TODO` is left, writes REMIX.md's Media table from `moment.json` (element, file, time, origin,
what, what to swap in, prompt), then writes each `bundle.tar.gz` (`code/` + `dense.md`) and its sha256 into
`moment.json`.

## 5. Gate

```sh
node <SKILL_DIR>/scripts/harvest-gate.mjs --project <project> --frames
```

It must print `RESULT: PASS`. `--frames` renders every Moment's `code/` and compares it with its clip frame by frame;
it takes about as long as the cut's render, and it is the check that catches a Moment whose code does not play its
window (a caption from outside it, cuts a frame late). It checks that the windows tile the film with no gap or overlap, each clip lasts its
window, each `code/index.html` is the film retimed to its window, nothing is left `TODO`, every role is
one of the six, and every bundle is the one pack wrote. On a FAIL, fix what it names and run it again.

## 6. Reply

One line per Moment: id, window (`3.77–8.80 s`), role, name. Then where they are (`moments/`) and how to use them:
attach Moments to a chat to build a new film from them (moment-film), or open a Moment's `code/` and edit its words.
Never claim more than the gate and the sheets showed.

## Notes

- "Make M02 a turn" or "rename M03": edit that `moment.json` (and its REMIX.md and dense.md if the name is there),
  then pack and gate again.
- "Longer" or "fewer" Moments: cut again with a larger `--target`, then name, pack and gate again.

## References

| file                       | what it does                                                                     |
| -------------------------- | -------------------------------------------------------------------------------- |
| `scripts/harvest.mjs`      | `cut` renders and splits the film into `moments/M01…`; `pack` writes the bundles |
| `scripts/harvest-gate.mjs` | the gate: one `FAIL <rule>: …` line per problem, then `RESULT: PASS` or `FAIL`   |
