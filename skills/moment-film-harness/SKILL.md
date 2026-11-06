---
name: moment-film
description: "Make a launch video for a real product: a feature launch, product promo, demo, changelog or announcement, from a website, a repo or PR, screenshots, Figma frames or an idea. Also handles every message that carries Moments (picked in Get inspired, with @, or in the first-video cut): it works out whether the person wants one Moment remixed, each Moment playing its part in a new film, or inspiration (each Moment studied through, the film's structure its own). Works like a senior motion designer: understand what the person wants, study the Moments that serve it by eye and by their code, pitch three storylines, then build by porting the Moments' real code into the product's story. It always stops once for the person to pick a storyline; with the #Storyboard ability on it also stops at a still storyboard. Its gate is node <SKILL_DIR>/scripts/film-gate.mjs, a script in this skill (not a CLI command), which must exit 0 before you reply. [launch, launch video, product video, feature video, promo, demo, announcement, moments, remix, storyboard, storyline, real ui, voiceover]"
---

# Moment Film

The bar is a launch film a senior After Effects designer would sign. Every official HyperFrames launch film and every
Moment in the library was made to that bar. They share five things: a clear story, popular effects, the brand used
well, the product's real UI, and clean motion. Faster but worse is not a win.

You get there the way a designer does, not by filling a template:

1. **Understand** what the person wants and what the film must make a viewer feel (§2).
2. **Study** the films that serve that, by eye and by their code (§3). This is where the quality comes from.
3. **Pitch three storylines** that are genuinely different films, and let the person pick (§4, a stop).
4. **Build by porting**: the Moments' real code, with the product's content in it (§5–§8).
5. **Look** at what you made beside what you studied, and fix the gap (§9).

`references/craft.md` is how official HyperFrames launch films are made, measured frame by frame. Read it before you
pitch. What a Moment or a reference film does wins over it for that film.

## The tells of a one-shot AI film

Each of these makes a film look generated:

- it opens by typing into a prompt box, because nothing else came to mind;
- titles keep sliding or shrinking after they land; in the official films a landed title is dead still;
- the logo docks small in a corner and stays there;
- one dark canvas for the whole film, small UI floating in its middle, captions small in a corner;
- every scene enters the same way, or the same move plays beat after beat;
- side-by-side panels, floating cards, three cards in a row, four corner brackets, click rings;
- a title laid over a dimmed screenshot of the product;
- a Moment ported without what makes it work: its footage, its rhythm;
- breathing, floating or pulsing loops standing in for motion;
- snappy slide-up-and-scale entrances that read as glitches.

None of them is banned when a Moment or the person's reference does it on purpose; they are banned as defaults.

## 0. Storyboard mode

The #Storyboard ability turns it on. Its chip stays on the person's messages until they remove it, and each message then
carries `[ability "Storyboard": …]`. The person can also ask in words ("show me a storyboard first", "just make it").
Otherwise the mode is off. Record it in `film.json` as `"storyboard"`.

- **Off** (the default): stop once, at the storyline (§4). Once one is picked, plan, pose and check the stills yourself
  (§6 steps 1–2) and go straight through to the gated film, with no `boards/storyboard.html`. The reply gives the plan
  in words: the storyline in a sentence and a short `# | On screen | Motion` table. A screen still missing after the
  storyline card becomes a labelled placeholder; say so, with your assumptions, in one line.
- **On**: stop twice, at the storyline (§4) and at the still storyboard (§6). The storyboard is the contract: no
  animation, voice or paid generation until the person approves it ("go", "looks good"). Record the approval as
  `"approved": "<ISO time, UTC, with Z>"`. A new session that finds it set and no motion yet copies `boards/.posed.html`
  over `index.html` and goes straight to §7. A new
  storyline or a changed beat list clears the approval; show the sheet again.
- **Plan only** ("plan a launch video for…"): write no files. Answer with three storylines and, once one is picked, the
  shot table in text, with the voice-over if narrated. Build when told to go.

## 1. Moments in the message

A message with Moments ends with the app's note, "Selected Moment references": one line per Moment, with its folder in
the project. A Moment is a passage of a launch film that worked, rebuilt in code: a **viewer job** (hook, proof, turn or
cta), **mechanics** fixed by numbers, and **swap slots** for another product. Moments are golden samples: port their
motion fully and exactly (timing, eases, rhythm, layout), never as a loose impression. Never port their **subject**: the
object, footage, glyphs or UI a Moment acts on belong to its brand. Figma's butterfly, Suno's V and 6, another app's
prompt bar stay behind, even when `code/REMIX.md` lists no slot for them; the same move plays on the product's own
mark, real UI, footage or nouns. Each beat's `subject` in `film.json` names what replaces it.

**Read the intent** from the person's words, the number of Moments and where they came from. Record it in `film.json`
as `"intent"` and name it in one line of the reply.

- **remix**: one Moment and few words beyond the product ("make it ours", "for acme.com"). Its sequence becomes the
  film. Start from its code and keep its structure, timing, layout and motion; fill its slots with the product's copy
  and real UI; let the brand replace its fonts and colours; lengthen it only at its stretch points (`code/REMIX.md`).
  Split it into beats at its own cuts.
- **transplant**: several Moments, the first-video cut ("Create a launch video with … cohesive storyline"), or "like
  these", "in this style". A new film where each Moment plays the beat of its job, ported from its code with the
  product's content in its slots and the product's own subject in place of the Moment's. A beat no Moment covers gets
  one from the study (§3).
- **inspiration**: "inspired by", "ideas from", or a full brief with the Moments alongside. Study every Moment through,
  as deeply as a transplant (§3). The storyline sets the film's structure; its beats port whatever the Moments do best,
  as much from each as the film needs.

When the intent is unclear, the three intents are the three storylines (§4), each described by how the film will look.
A clear remix offers no storylines, since the Moment's own sequence is the film; it still stops once for its plan and
paid items. Never show a Moment's original as the plan: the stills show it already in the product's brand.

## 2. Understand before anything else

Read everything first, then write `boards/brief.md` (a few lines, for you and the next session):

- **What the person asked for**, in their words, and what they did not say but clearly want (the conversation, earlier
  films in the project, the Moments they picked and why those, a reference they pasted). Anything they gave (fonts,
  music, footage, a starter project, a reference film) is copied into the project and used as it is.
- **The facts**: what shipped ("You can now …"), the one thing a viewer must remember, who it is for, where it will be
  posted, the call to action. A whole-app release is not one thing: take its headline feature (`references/story.md`).
- **The product**: a website gets the app's capture tool (app.capture) when it is offered, otherwise
  `hyperframes capture <url> -o "$(mktemp -d)/site" --json --skip-vision`, on the home page and the feature's page, and `node <SKILL_DIR>/scripts/features.mjs <capture-dir>` lists its features, newest first.
  Inventory what the brand owns (logo, wordmark, fonts, colours, illustrations, mascots, photos) and copy what you use
  into `assets/brand/` and `assets/ui/`. Walk the feature when a browser can reach it without a sign-in, and screenshot
  each step at rest. Read the product's code, PR or docs for today's labels (`references/real-ui.md`).
- **What the film must make the viewer feel**, in one line. This line steers the study.
- An idea with no product: its real nouns are the material; never invent a logo or a product UI.

## 3. Study: look, then read the code

Skip only for a remix (its one Moment is the study) or a reskin of an @-referenced project. Its downloads land in
`.hyperframes/refs/`; `node <SKILL_DIR>/scripts/refs.mjs` with no arguments lists its commands. The full method is
`references/study.md`. In short:

1. **Search the library.** `browse_library` with no arguments lists its groups, by the job a Moment does in a
   launch film. For each beat, pick the group that does its job and search it with `query`; the best fits come back
   fetched with a sheet of their frames. Look at every frame. Keep 4–8 Moments whose look and move would make _this_
   film better: different from each other, from at least two source films, and chosen for what you see, not for a word.
   The Moments in the message come first; the library fills the beats they leave open. Search by each beat's job, never
   by the move you already had in mind: a search for "typewriter" only finds typewriters.
2. **Watch each pick.** `browse_library` with its `id` brings its clip, `dense.md` and its code; `refs strip` on the
   clip from 0 makes a strip of every frame of it at 10 fps (`.hyperframes/refs/frames/<id>-0s.jpg`). Read the strip frame by frame: what moves first, what carries over each cut,
   where the type sits, how the logo lands.
3. **Read its code** with the `moment` tool (`moment: "<id>"`): its timeline label by label with the code that starts
   each, its text by selector, its theme variables, its assets, and its frames at its labels in one picture. Use it
   instead of opening `code/index.html`; open the file only for a line the answer leaves out. `code/REMIX.md` has its
   slot limits and stretch points.
4. **Name what makes it work, and point to it.** In `compositions/film.json`, each beat built on a Moment names it in
   `moment`, the timeline labels of its code it ports in `port` (`["M<id>:s01-scan"]`, from `code/REMIX.md`'s Timeline),
   and in `use` one line on what that part becomes in this film. Keep what makes it work: its footage, its rhythm, its
   type, its 3D, its colour. A Moment whose look is footage keeps footage: generate shots of the same kind and quality
   for this product (`references/real-ui.md` §5), named in the storyline card as paid items. Its cuts and holds keep
   their source length.
5. **Read `references/craft.md`**, the house craft. Where a Moment you picked does something else, the Moment wins for
   its beat.

A reference film the person gave is studied first and the same way (`refs sheet`, `refs strip`, `refs cuts`); its
grammar wins over everything else (`references/borrow.md`).

## 4. Three storylines (a stop, whatever the storyboard mode)

Every film stops here once. This is also where the person approves anything paid: nothing paid (voice, generated images
or video) is made unless this card named it and they picked it, or they asked for it in words. A person who asked for
no questions ("just make it, don't ask") gets no stop: take the storyline you would recommend, make nothing paid they
did not ask for, and say in the reply what a voice or a generated shot would add.

1. Write three storylines (`references/story.md` §2). They are three different films, not three titles on one film:
   each has its own **world** (where it happens and what it looks like), its own **device** (a moment in a real person's
   day, a character who does the work, a metaphor world, the product's UI journey with the camera, type that carries
   the argument, a number that lands, life before and after) and its own **form** (one continuous take, a chain of
   transitions through objects, an endless zoom, a flight through one world, cuts on the beat, match cuts). Sketch five
   or more ideas first, each a line pairing a device with a form; drop those this product cannot carry well, and of the
   rest keep the three that differ most. Each one says:
   - its name, its device and form in a few words, and in two sentences what the viewer sees and feels;
   - the first two seconds, exactly;
   - its beats in one line (`hook → … → lockup`);
   - which Moments it ports, for which beats, the one move from each that makes it, and the product's own thing the
     move plays on, e.g. "M<id>: the grid of repeating type that splits into colour fields, on Acme's own pricing
     tiers, for the pain". A storyline that names another brand's object (its mascot, its logo, its product) is a
     reskin: replace that object before you send the card.

   Make one of the three the bold one you would not have picked first. Put your recommendation first: the one with the
   strongest visual impact, the film that would stop a scroll, with what makes it stop one in a clause. A narrated film
   adds a draft voice-over under each. Tell the person they can mix ("A's opening with C's middle"), and ask once for a
   film whose feel they want; a pasted link or file is studied before the plan.

2. Send one AskUserQuestion card: the three storylines by name, plus at most two blockers only the person can answer:
   - **Real UI you lack**, when the proof needs a screen you cannot capture. Ask for exactly what each beat needs
     (screens, or recordings at 1080p or more with the cursor visible), with "use a labelled placeholder for now".
     Never mock the product being launched.
   - **Voice**, only when it is unclear: narrated (HeyGen Voice 1) or music only.
3. Decide everything else and state it in one assumption line, e.g. "16:9 for X, 20–25 s, music only, ends on Try Acme
   Motion." Name every paid item in it ("narrated in HeyGen Voice 1", "two generated product shots"), with "none: make it
   free" as an option. Give the length as a range, never an exact number. Never ask about easing, transitions or fonts
   unless the person raised them.
4. Without AskUserQuestion (some agents, comment runs), end the turn after the storylines and questions.

The answer arrives in the same turn; continue to §5. A mix is one storyline: record its parts in `angle`. Two picked
means two films: build the first, then offer `hf:projects` with `copy: true` for the second.

## 5. The plan: `compositions/film.json`

Write it before any HTML and keep it. It is the plan, the storyboard's source, the gate's input, and the memory a new
session reads instead of the chat history. Start from `<SKILL_DIR>/assets/film.json`.

- **Beats** follow the storyline (`references/story.md` §3). Each has one `line` (at most 6 words, no trailing period,
  shown whole) and a `picture` (what the viewer sees that proves it). Read the lines alone, then the pictures alone:
  each must tell the story.
- **`moment`**, **`port`** and **`use`**: the Moment a beat is built from, the timeline labels of its code you will
  port (`["M<id>:s01-tiles"]`; a reference film the person gave is `"<file>@<start>–<end>"`), and one line on what that
  part becomes here. The gate fails a `port` label its Moment's code does not hold. **`subject`**: for a beat with a
  `moment`, the product's own thing its move plays on, in place of the Moment's (`"the Acme pricing card, not M<id>'s
photo tiles"`); the gate fails a ported beat without one.
- **`keep`**: where a part the beat ports is something the gate refuses by default, the check it keeps off for this
  beat and that part: `[{"check": "no jitter" | "lines on screen" | "hard cuts", "port": "<one of the beat's port>"}]`.
  Write it for a stepped cycle, a scene the reference keeps wordless (its `line` is then `""`) or a hard cut the
  reference takes. It counts only once the person approves the plan and only for a part the beat's `port` lists; the
  gate names every check it kept off.
- **`shots`**: the `# | On screen | Motion` table, one row per camera idea, with `at` where it reads best, written in
  camera words: push in, pull back, pan, whip, hard cut, match cut, morph, cursor in, click.
- **`ui`**: every product action as cause → effect, the way the real product does it (`references/real-ui.md`).
- **`assets`**: what each beat needs, in buckets: `capture`, `build`, `generate` (paid) and `shared` (cursor, lockup,
  outro, made once). Anything with `have: false` shows on the sheet.
- **`seam`**: how the beat hands over (`references/craft.md` §4), with `exit` and `entry` directions. A planned hard cut
  (a punch-in, a cut to a new world) is `"hard-cut"`; every other seam cuts while both sides move.
- **`ground`**: the colour `html`, `body` and `#root` are painted with. Worlds may change their own background on top of
  it (`references/craft.md` §6). **`brandReveal`**: the beat where the mark lands. Beat times run contiguously from 0
  to `duration`.
- **`intent`** when the message carried Moments; **`notes`**: every note from the person and what you changed for it.

## 6. Stills, then the storyboard (stop 2, storyboard on)

1. **Pose every shot.** Build `index.html` and one composition per beat (`compositions/<beat-id>.html`, mounted with
   `data-composition-id="<beat-id>"`, times matching `film.json`). A beat that ports a Moment starts as `moment` with `port`
   (§8), with the product's content in its slots. Each beat's layout is complete at its local 0, inside
   one named wrapper, with named, grouped layers the person can edit in Studio. In each beat's timeline, `tl.set` every
   element to its pose at each shot's `at`, with real fonts, colours, copy and UI. No tweens yet. With the storyboard
   on, nothing is paid for before approval, and a frame that needs generated output shows a labelled stand-in until
   then. With it off, generate only the paid items the person picked, once the stills hold.
2. **Snapshot them** with
   `hyperframes snapshot --at <every shot's at> --no-end --describe false -o boards/stills`. Check
   every still yourself against the tells above and against the Moment frames it ports: one focal point, real UI big
   enough to read on a phone, nothing cropped by accident. Fix and snapshot again until they hold. With the storyboard
   off, continue to §7.
3. **Write `boards/storyboard.html`** by the storyboard recipe
   (`hyperframes/references/storyboard.md`, or `hyperframes-creative/references/storyboard-recipe.md` on the older skill set), filled from `<SKILL_DIR>/assets/storyboard.html`: one
   `.act` bar per beat (id, line, times, the Moment it ports, voice-over) and one `.frame` per shot (still, number, On screen, Motion, time), with the
   seam into the next beat and any missing asset. The app shows it in the Storyboard tab.
4. **Stop.** Put the film back first (the recipe's step 4), so the Preview never plays the stills. Reply in two
   sentences: what the film tells the viewer, then "The storyboard is in the Storyboard tab: say go to animate, or tell
   me which frame to change." On the go, copy `boards/.posed.html` over `index.html`, then §7.
5. **Notes on stills** change only those frames, as the recipe's step 5 says, and stop again. For "try harder
   on frame N", pose 10 or more genuinely different versions into `boards/contact-sheet.html` (the Contact sheet tab)
   and let the person pick or mix.

## 7. Sound first: the clock (`references/sound.md`)

Once the stills hold, and are approved when the storyboard is on, set the clock before any tween.

- **Narrated**: HeyGen Voice 1 only. Choose a voice with `media.find` with kind voice, then call `voice.generateVoiceover` and
  check that the answer's `engine` is `orca`. The `words[]` it returns are the clock: move the beats to the
  words, keep the voice's own pauses, and never speed the read past 1.05.
- **Music only**: the person's own track first, else the music order in `references/sound.md` (Lyria first, else the best
  of 3 library tracks, else a bed in code), entered at its strongest bar. Land the lockup, the
  payoff and the key clicks on its beats.
- Effects, captions and levels come once the motion is final. With no HeyGen key, make the film music-only (a library
  track, or the bed in code when the library gives none) and say so in one line.

## 8. Build: port, then direct

1. **Port before you write.** For every beat with a `moment`, if §6 already ported it, keep working in that file; otherwise call `moment` with `moment: "<id>"`, `port: "<beat id>"`
   and the beat's `start`. It writes `compositions/<beat id>.html`, the whole Moment as a scene whose root,
   `data-composition-id` and timeline key are all the beat id, copies its assets to `assets/moments/<id>/`, and answers
   with the host line to paste inside `index.html`'s root. Then, in that file: set its theme variables to the brand,
   replace its text with the product's copy, its images with the product's UI and the object the Moment acts on with the
   beat's `subject`, delete the parts of it the beat does not use, and trim its timeline only at its labels, keeping the
   ones the beat's `port` names. Keep its numbers (durations, eases, offsets, staggers, `keys` tables): a move re-typed
   from notes drifts and goes flat. The runtime scopes each scene's CSS, ids and selectors to that scene, so never
   prefix or rename its ids and classes, and never copy its code by hand. A Moment built at another size scales as one
   group. Its footage slots take the shots you generated for them, full frame, at its own cut rhythm.
2. **Direct the rest with `references/craft.md`**: transitions, type, the camera over the UI, the logo, the ground,
   blur, the cursor. Before animating a beat, reopen its frames in `.hyperframes/refs/frames/`: the frames are the brief.
3. Cause comes before effect: a click fires the next thing on the same frame. Something brings every element in. A
   landed title holds still until it leaves. Unsure a move will read? Prove it in a few-second test composition,
   snapshot its middle frames, then wire it in.
4. Before hand-writing a known look, check the registry: `hyperframes catalog --query <look>`, then
   `hyperframes add <block>`.
5. Footage, people and products in real places are generated with HeyGen (`references/real-ui.md` §5), after approval
   when the storyboard is on.

## 9. Finish, gate, look

1. **Finish**: sound effects on the final motion, captions if narrated, levels (`references/sound.md` §4–6).
2. **Gate**: the film gate with `node <SKILL_DIR>/scripts/film-gate.mjs --project .`. Then check the video with
   `npm run check`.
   Both must pass before you reply; fix the cause and run them again. On a later turn that changes some beats
   (a comment, a drawing, a follow-up), run the gate once, after every edit, with `--beats <ids you changed>`: it checks
   those beats and their seams in a fraction of the time. Gate the whole film only when the change moves other beats'
   timing in film.json or touches most of them. `film-gate` checks the floor
   (`references/floor.md`), including that at most a third of the seams are planned hard cuts, and that every `port`
   label is in its Moment's code.

3. **Look**, as the designer would:
   - Snapshot every beat's midpoint and every seam ±0.2 s (on a later turn, only the beats you changed) with
     `hyperframes snapshot --at <those times> --describe false`. For each ported beat, one `frames` call with `file`
     its Moment's clip, `compare_with: "film"` and `offset` the beat's start minus the ported part's start puts each Moment
     frame beside yours. Someone who knows the Moment recognises it in its beat, made for this product. Where yours is
     flatter, fix it from the code.
   - Read the film against the tells above. One of them on screen is a fix, not a note for the reply.
   - Watch as a stranger on a phone: one story, real UI you can read, every line readable, nothing cut off.
   - Unless you are snapshotting and fixing one spot, take every snapshot and `frames` call at once, then fix
     everything in one round of parallel edits or one script. At most two rounds.

   Verify with frames and numbers, not assumptions. Never render or start servers: the app previews and exports.

## 10. Reply, then take notes

- Reply in plain words: the feature, the one thing, the length, the intent you read from any Moments, which Moments each
  beat ports, the plan in words when the storyboard was off, and that the person can comment or draw on the preview.
  Never claim anything the gate or your snapshots did not show.
- On a later turn, read the person's own edits first: re-read the files, or run
  `hyperframes history --since mine --who <your name>`. Positions and values they set by hand are the source of truth.
- Turn feelings into measured changes and change only what was named (`references/craft.md` §10): "too fast" → slow
  every zoom and pan to 0.7×; "make it pop" → offer an `hf:motion` card. Log each note in `film.json` `notes`.
- A note about a quality rather than a value ("not premium", "the ending is flat"): write `boards/fixes.md` from
  `<SKILL_DIR>/assets/fixes.md` (symptom, root cause in your code, how a Moment or an official film does it, the
  change), study again for that gap only (`references/study.md` §7), and fix from the top.
- Other ratios or cut-downs: lay each one out again, never crop; offer `hf:projects` with `copy: true`.

## 11. Leave a template behind

The project is the template: `film.json`, the compositions, the stills and the storyboard. Keep shared pieces (cursor,
logo lockup, outro) in single files, and write a short `README.md` for the next agent saying which layers are locked
(timing, eases, seams) and which are swappable (brand, copy, screens).

## References

- `references/craft.md`: how the official HyperFrames launch films are made, measured: story shapes, the camera over
  the UI, transitions, type, the logo, grounds and worlds, light, the cursor, timing, sound, notes into numbers.
- `references/study.md`: look at the library, read a Moment's code, point to it, port, compare.
- `references/story.md`: the one thing, storylines, beats, time, copy, voice.
- `references/real-ui.md`: where real UI comes from, rebuilding it, product outputs, generated footage, brand assets.
- `references/borrow.md`: reference films, earlier projects, Moments, popular effects and registry blocks.
- `references/sound.md`: voice, music, sound effects, captions and levels.
- `references/floor.md`: what every film keeps, and what the gate checks.
- `assets/film.json`, `assets/storyboard.html`, `assets/fixes.md`: templates.
- `scripts/film-gate.mjs`, `scripts/features.mjs`, `scripts/refs.mjs`: the gate, the feature lister, and the study tools.
