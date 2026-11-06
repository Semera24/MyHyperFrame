# Study: look at the library, read the code, port the move

The quality of a launch film is decided here. The craft in `craft.md` gets a film to clean; what makes it memorable is
a move a real designer made, studied until you can rebuild it, and put to work for this product. Every step leaves a
file in `boards/`. `node <SKILL_DIR>/scripts/refs.mjs` does the mechanical parts; run it with no arguments for its commands.

## 1. When

- **Before the storylines** (SKILL.md §3), with the brief in hand (`boards/brief.md`): what the person wants and what the
  film must make the viewer feel. You study _for_ that, not in general.
- **After a storyline is picked**, for any beat no pick covers yet: search the library again by that beat's job.
- **After a note on a draft** that names a quality ("not premium", "the ending is flat"): study again for that gap only
  (§7).

Skip only for a remix (its one Moment is the study) or a reskin of an @-referenced project.

## 2. Search the library by each beat's job

`browse_library` with no arguments lists the library's groups, by the job a Moment does in a launch film. For each beat,
pick the group that does its job and search it with `query`; the 4 that fit best come back fetched, each with a sheet of
its clip's frames. Look at every frame on each sheet:

- Which of these would make _this_ film better? Look for worlds, type, colour, depth and devices this film could use:
  giant type that becomes a pattern, a colour field that floods the frame, a 3D object, a live-action shot, a mascot, a
  photo collage, a UI shown full-bleed and tilted, a number that fills the frame.
- Pick 4–8: different from each other, from at least two source films, each for a reason you can say in one line.
- The Moments in the message come first. The library fills the beats they leave open, and gives each storyline its own
  references: three storylines built on the same Moments are one storyline.
- Search with `query` by each beat's job, never by the move you already have in mind: a word search for "typewriter"
  or "logo" finds only what you already know. Pass `id` for the Moments a message names.

## 3. Watch, then read the code

For each pick, `browse_library` with its `id` brings:

- the clip, `.hyperframes/refs/<id>.mp4`; `refs strip` on it from 0 makes `.hyperframes/refs/frames/<id>-0s.jpg`:
  every frame of it at 10 fps;
- `dense.md`: a shot-by-shot description, `[M]` for measured facts and `[H]` for judgements;
- `code/index.html`: the composition itself, and `code/REMIX.md`: its slots, their limits and its stretch points.

Read them in this order, each one through:

1. **The strip**, frame by frame (1 frame = 0.1 s). What moves first, on which axis, how many frames it takes to cover
   most of its distance, what carries over each cut, where the blur is, where the type sits and how big, how the logo
   lands, what holds still.
2. **Its code, with the `moment` tool** (`moment: "<id>"`): the timeline label by label with the code that starts each
   (selectors, durations, eases, offsets, staggers, `keys` tables), its text by selector, its theme variables and its
   frames at its labels. Find the lines that make what you saw on the strip. Open `code/index.html` only for a line the
   answer leaves out.
3. **`code/REMIX.md`** for what you may swap and how far it stretches, and `dense.md` for anything the code does not
   make obvious.

An attached Moment is already in the project (its folder is in the app's note); fetch it with `browse_library` anyway for the strip.

A reference film the person gave, or one you found: `refs sheet <video>` (a frame every 1.5 s), `refs strip <video>
<start> <seconds>` (10 frames a second through one passage), `refs cuts <video>` (measured hard cuts). A model saying
"one continuous shot" is a claim to check on the frames.

## 4. Name what makes it work

Write one line per pick: what makes it work. Usually it is one of these, and it is what you keep:

- **footage**: full-frame live action, nature, a city, a 3D render. a Moment's name cards can work because of the agate,
  the Earth and the rocket behind them; the same cards on a dimmed screenshot are the Moment without its reason to
  exist. Generate footage of the same kind and quality for this product (`real-ui.md` §5);
- **rhythm**: its cuts and holds (a card every 0.5 s, nine cuts in 2.8 s). Keep their source lengths; a longer beat
  gets more events, never slower ones;
- **type**: its grid, scale contrast and colour fields, which port whole from the code;
- **a 3D object or a material**: rebuild it, generate it, or pick another Moment, never a flat stand-in.

## 5. Point to the code

For each beat a Moment serves, write in `film.json` the timeline labels of the part you port (`port`) and one line on
what it becomes in this film (`use`). The labels are the ones `code/REMIX.md`'s Timeline lists; open the code at each
one before you write it. Leave behind the Moments' copy, colours, logos, bookends and subjects (the objects, footage,
glyphs and UI they show).

## 6. Use

- **Storylines** (SKILL.md §4) name the Moments they port and the one move from each that makes them.
- **The plan** names, per beat, its `moment`, the timeline labels of its code to `port`, the product's own `subject` the
  move plays on, and `use`, what that part becomes here.
- **Building** (SKILL.md §8) starts with `moment` and `port`, which puts the whole Moment in the beat as a scene,
  including its `keys(...)` tables, the source film's motion traced frame by frame. Keep them as they are and fill the
  slots with the product: its copy, its UI, and for a footage Moment the shots generated for it. Retyping a move from
  your notes loses most of it.
- **A Moment that disagrees with `craft.md`** wins for its beat. Say which house defaults you broke in the reply.

## 7. Compare, and study again after notes

- After animating, show each ported beat beside its Moment with one `frames` call: `file` the Moment's clip, `at` its
  key frames, `compare_with: "film"`, `offset` the beat's start minus the ported part's start. Where yours is flatter (less scale contrast, a slower carry, a missing layer), fix it from the code.
- After a quality note, write `boards/fixes.md` from `<SKILL_DIR>/assets/fixes.md`: one row per symptom, its root cause
  in your code (`file:line`), how a Moment or an official film does it (`id@time`), the change. Search the library again
  for that gap only, read the pick's code, and fix the top rows first.
