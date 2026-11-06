# Study: look at the library, read the code, port the move

The quality of a launch film is decided here. The craft in `craft.md` gets a film to clean; what makes it memorable is
a move a real designer made, studied until you can rebuild it, and put to work for this product. Every step leaves a
file in `boards/`. `node <SKILL_DIR>/scripts/refs.mjs` does the mechanical parts; run it with no arguments for its commands.

## 1. When

- **Before the storylines** (SKILL.md §3), with the brief in hand (`boards/brief.md`): what the person wants and what the
  film must make the viewer feel. You study _for_ that, not in general.
- **After a storyline is picked**, for any beat no pick covers yet: look at the wall again with that beat's job in mind.
- **After a note on a draft** that names a quality ("not premium", "the ending is flat"): study again for that gap only
  (§7).

Skip only for a remix (its one Moment is the study) or a reskin of an @-referenced project.

## 2. Look at the whole library first

`refs wall` puts every Moment's still on labelled sheets (`.hyperframes/refs/frames/wall-1.jpg` …, 40 a sheet) and prints their ids
in order. Open every sheet and look at every still, the way a designer flips through a reference book:

- Which of these would make _this_ film better? Look for worlds, type, colour, depth and devices this film could use:
  giant type that becomes a pattern, a colour field that floods the frame, a 3D object, a live-action shot, a mascot, a
  photo collage, a UI shown full-bleed and tilted, a number that fills the frame.
- Pick 4–8: different from each other, from at least two source films, each for a reason you can say in one line.
- The Moments in the message come first. The wall fills the beats they leave open, and gives each storyline its own
  references: three storylines built on the same Moments are one storyline.
- Never pick by searching for the move you already have in mind. `refs moments <words>` is for reading a pick's job and
  source film (`refs moments <id>`), or for a job you cannot see in a still (`refs moments a-roll`); a word search for
  "typewriter" or "logo" finds only what you already know.

## 3. Watch, then read the code

For each pick, `refs get <id>` brings:

- the clip, and `.hyperframes/refs/frames/<id>-0s.jpg`: every frame of it at 10 fps;
- `dense.md`: a shot-by-shot description, `[M]` for measured facts and `[H]` for judgements;
- `code/index.html`: the composition itself, and `code/REMIX.md`: its slots, their limits and its stretch points.

Read them in this order, each one through:

1. **The strip**, frame by frame (1 frame = 0.1 s). What moves first, on which axis, how many frames it takes to cover
   most of its distance, what carries over each cut, where the blur is, where the type sits and how big, how the logo
   lands, what holds still.
2. **`code/index.html`, top to bottom.** The layout and the timeline are written down: selectors, durations, eases,
   offsets, staggers, masks, filters. Find the lines that make what you saw on the strip. The move you will port is
   usually far below the first screen; a `head` or a grep of a few lines is not a reading.
3. **`code/REMIX.md`** for what you may swap and how far it stretches, and `dense.md` for anything the code does not
   make obvious.

An attached Moment is already in the project (its folder is in the app's note); `refs get` it anyway for the strip.

A reference film the person gave, or one you found: `refs sheet <video>` (a frame every 1.5 s), `refs strip <video>
<start> <seconds>` (10 frames a second through one passage), `refs cuts <video>` (measured hard cuts). A model saying
"one continuous shot" is a claim to check on the frames.

## 4. Name what makes it work

Before any finding, write one line per pick: what makes it work. Usually it is one of these, and it is what you keep:

- **footage**: full-frame live action, nature, a city, a 3D render. a Moment's name cards can work because of the agate,
  the Earth and the rocket behind them; the same cards on a dimmed screenshot are the Moment without its reason to
  exist. Generate footage of the same kind and quality for this product (`real-ui.md` §5);
- **rhythm**: its cuts and holds (a card every 0.5 s, nine cuts in 2.8 s). Keep their source lengths; a longer beat
  gets more events, never slower ones;
- **type**: its grid, scale contrast and colour fields, which port whole from the code;
- **a 3D object or a material**: rebuild it, generate it, or pick another Moment, never a flat stand-in.

## 5. Write `boards/refs.md`

Copy `<SKILL_DIR>/assets/refs.md`. One row per finding, never per film:

| id@time         | what it does                                                                                     | how it is built                                                                                     | for this film                  |
| --------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------ |
| M<id>@1.21–1.67 | four giant numerals fill the frame; columns 0 and 2 rise while 1 and 3 sink, so the frame splits | `` `keys('#col-0, #col-2', 'y', '29:16 30:-134` ``: 150 px in the first frame, then 6–20 px a frame | steps: our 4 steps as numerals |

- **Evidence** is `<id>@<seconds>`, so anyone can open the frame on the strip.
- **For this film** names the beat that uses it by its id (`steps: …`); `refs check` holds a beat to the findings read
  for it.
- **How it is built** quotes the line of its code in backticks, exactly as it is written there, plus any number you
  measured. `refs check` looks for the quote in the Moment's `code/index.html`: a finding that quotes nothing, or quotes
  what the code does not hold, does not count. "Smooth", "premium" and "dynamic" are not findings.
- **For this film** names the beat and what changes in it; a finding with no use here is not written down.
- **Three findings or more** for every Moment a beat builds on: its entrance, what carries it, how it lands.
- End with **what we will not take**: the Moments' copy, colours, logos, bookends and subjects (the objects, footage,
  glyphs and UI they show).

## 6. Use

- **Storylines** (SKILL.md §4) name the Moments they port and the one move from each that makes them.
- **The plan** names, per beat, its `moment`, the part of its code to `port`, the product's own `subject` the move
  plays on, and the findings it `borrow`s.
- **Building** (SKILL.md §8) starts by copying that part of the code into the beat: its markup, CSS and timeline,
  including its `keys(...)` tables, which are the source film's motion traced frame by frame. Keep them as they are and
  fill the slots with the product: its copy, its UI, and for a footage Moment the shots generated for it. Retyping a move from your notes loses most of it.
- **A finding that disagrees with `craft.md`** wins for its beat. Say which house defaults you broke in the reply.

## 7. Compare, and study again after notes

- After animating, snapshot each ported beat at the times its Moment's strip shows its key frames, and put the two side
  by side. Where yours is flatter (less scale contrast, a slower carry, a missing layer), fix it from the code.
- After a quality note, write `boards/fixes.md` from `<SKILL_DIR>/assets/fixes.md`: one row per symptom, its root cause
  in your code (`file:line`), how a Moment or an official film does it (`id@time`), the change. Look at the wall again
  for that gap only, read the pick's code, and fix the top rows first.
