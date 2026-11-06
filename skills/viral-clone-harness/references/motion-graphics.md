# Motion-graphics films

Read this when the reference is a product or UI film in pure motion graphics, a motion-graphics explainer (faceless
or with a host), or a brand reel built on a visual trick.

## Rebuild 1:1, then remix

A film whose content is its motion is rebuilt 1:1 before any content changes. Swapping in new words and UI while
rebuilding drifts off the reference's beats: on one launch film the direct remix left an empty frame at a click and
cut to black early, while rebuild-then-remix kept every beat.

1. **The skeleton first.** Before any generation, write `index.html` as the film's skeleton: the canvas and
   length, one slot per scene on the reference's cut seconds, each a placeholder card in the brand kit's color (a
   neutral grey with no kit) with the scene's number, length and a quiet label, "Scene 3 is being made". Never a
   reference frame, not even as a placeholder: a stopped run must not leave the person someone else's film. Each
   placeholder goes when its scene lands; none is left at the end.
2. **The reference's soundtrack is the clock.** Put its voiceover and music under the rebuild and time every scene to
   them; length and sound then line up by construction. They are a clock only: the delivered film carries the voice
   and music asked for, never the reference's own.
3. **One scene at a time, in film order:** rebuild it, check it with `frames`, put in the person's content, mount it
   in its slot. Plan only the scene in hand: one plan for the whole film kept the preview empty for 315 s on a 12 s
   film. Start the generations as soon as the scenes that need them are known, and build the others meanwhile.
4. **What moves in a remix.** Every move keeps its ease, length, overshoot and offset from its trigger; only the
   trigger moves. Decide before the first scene is mounted, or per section when it changes partway:
   - **Music-led** (little or no speech): the reference's clock stays; new copy fits its slots.
   - **Speech-led:** the new voiceover is the clock. Each beat re-anchors on the word that does its job (the number as
     it is said, the product as it is named), from the voiceover's word times. Scenes lengthen or shorten in their
     holds, never by changing a move's speed.

## How much to rebuild

A rebuild is what makes the remix look like the reference, and it takes time in proportion to what it covers. Choose
the scope yourself and write it, with why, in `RESULT.md`:

- **The whole film** when it is about 90 s or less, or its structure is its content (a launch, a UI promo).
- **A stretch, its hero scenes and its pieces** for a long explainer whose scenes are drawn for its own topic: one
  stretch of 20–30 s showing how its elements compose, hand off and transition (the opening and hook, plus a body
  passage when the body works differently), every hero scene, and every recurring type as a component
  (`references/template.md`). Build the rest from these by the template's rules, never from scenes nobody rebuilt.
- A hero scene the film is remembered for is rebuilt whatever the scope.

## Read every move

- **Recurring types** come back with the same construction (title cards, photo cards, charts, keyword pops, name
  labels): one MG vocabulary entry each. **Hero scenes** are one-off, full-frame compositions (a collage of cut-out
  portraits, an illustrated metaphor, a 3D product shot, a map fly-through); rare, but what viewers remember. Captions
  show the running words in one place and style; they are not graphics.
- Use `read_video` with show `keyframes` over each scene's range: each keyframe's second and each motion's what,
  from where to where, ease, speed and overshoot. Separate the camera, the card moving, content moving inside the
  card, and masks with their own edges. Similar cards crossing fool a quick read: follow each one.
- When a motion line leaves a detail open, look closer with `frames`: a `range` over the move with up to 24 frames,
  and a `crop` on its box.

| Effect               | What decides it                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Slide, scale, morph  | The motion line's ease and overshoot: ease-out `power3.out`, spring or overshoot `back.out`, constant `none`; a spring built as `power2.out` is the commonest miss |
| Reveal or wipe       | The edge's shape, direction and softness; the reveal order; what keeps moving underneath                                                                           |
| Streak, blur, glow   | A sharp core against the trail's direction, onset and decay, the rest state; a symmetric blur is not a one-sided trail                                             |
| Perspective or 3D    | The same card's four corners on several keyframes; a narrowing box can be rotation, crop or scale                                                                  |
| Cursor or UI         | The tip's position at every keyframe, hover, press, release, the UI's response; never keyed from a sheet by eye                                                    |
| Typing or stepped UI | `frames` across the span: characters per frame, pauses after punctuation, backspaces, the caret's blink                                                            |
| Scene transition     | Position and speed on both sides; which object carries across the seam                                                                                             |

A morph keeps the reference's handoff: the element that becomes the next one is one element, not a cut between two.

## Stills, type and look

- **Stills:** cut each photo, product shot, map, icon and cover from the reference's largest clean frame and place it
  as is, its text or UI rebuilt as native layers. A cover that flashes for half a second is cut too, never left as a
  dark placeholder. Generate only what the reference never shows clean (footage with burned-in captions).
- **Fonts:** a brand's from its kit (`read_brand_kit`) or site (`capture_website`). Otherwise match the face from
  crops, rendering candidates with `hyperframes snapshot` beside the crop, and solve the size from ink:
  `node scripts/ink-scan.mjs ref.mp4 T 0.2 x,y,w,h` on one cap-height line in the reference, the same on the candidate
  still (`node scripts/ink-scan.mjs still.png 0 0 x,y,w,h`); size = candidate size × reference box height ÷ candidate
  box height. HyperFrames ships no Simplified Chinese font: bundle Noto Sans SC or the matched face in `assets/fonts/`.
  Look for font files only in `~/Library/Fonts`, `/Library/Fonts` and the project; never search the whole disk.
- **Look:** only the treatments the reference uses (grade, black and white, blur behind graphics, grain, vignette).
  Never darken or desaturate a person beyond the reference's own, never add grain or blur it lacks.

## Hero scenes

Rebuild each as a layered native scene around the remix's own subject, never one generated picture with text in it:

- Real people and places: real photos or frames, cut out with `cut_out`.
- Illustrated elements (a board game, a cartoon, a prop): `generate_image` in the scene's art style, about the new
  subject, on a plain background for cutting out, with no text.
- Type, rings, badges, glow and texture: native layers (CSS, SVG `textPath` for rings), so every word stays editable.
- Rendered 3D (a drill down a shaft, a cutaway, a globe): a Three.js layer (`hyperframes-animation`,
  `adapters/three.md`), its camera path from the span's motion lines, lens, light and materials from full-size
  frames. A subject it cannot carry (water, creatures, anything photoreal and organic) is `generate_video` with the
  span's motion in words. Labels stay DOM over the canvas.

## Trick reels

- **The trick inventory:** read the span from 0.5 s before to 0.5 s after the trick with `read_video` keyframes and
  `frames`. List every manipulated event (a change of scale, crossing a frame or screen edge, passing in front of or
  behind something, a hand-off, a swap), count the cuts inside the span (often none: a "jump" can be one take), and
  write the mechanism in one sentence ("a giant cup shrinks to hand size as the runner grabs it, in one take").
- **Plates** with `generate_image`, the reference frame's look described in words; the moving subject with
  `generate_video` model `minimax-h3-max`, the span's motion in words. Read `tool_options` for generate_video, topic
  minimax-h3-max, before writing the prompt.
- **Each boundary** where two generated pieces meet, or something changes in a still room, is built one way:

| Reference boundary                                        | Build                                                                                                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hard cut to a new shot                                    | Independent shots                                                                                                                                                                  |
| A later take of one continuous shot                       | H3 Max with `first_frame` the exact frame of ours the edit cuts on; beyond about 3 frames the jump shows                                                                           |
| Locked camera, same place                                 | One plate supplies every still pixel; generated video supplies the moving subject, cut out with `cut_out` and laid over it. A still cut-out slid along a path is not a moving hand |
| A change behind an occluder (a blade, a door, a whip pan) | A hard cut on the frame where the occluder covers both; never a wipe following its edge                                                                                            |

- Align each generated subject to the reference's position, scale and axis for its whole span, as a native
  transform. Rebuild every camera move inside a shot (a push from 1.00 to 1.12 over 4 s, a drift) with the same zoom,
  length and ease.
- H3 Max takes run slow and land late, and generated people move less than the reference (the numbers are in
  [talking-head.md](talking-head.md)): ask for bigger action, find where the take's moments land with `frames` (the
  take as `file`, the reference as `compare_with`), and land them with
  `node scripts/retime.mjs TAKE OUT.mp4 --map "take_in:take_out=ref_in:ref_out,..."` (rate at most about 1.5 without
  speech). The last 0.8 s can twitch: generate a little longer and cut before it.

## Build a long film by section

Over about 90 s or 8 sections, build section by section; decide yourself whether sections run in parallel
subagents, which pays when they are many and independent (one 141 s film in 11 parallel sections took 78 minutes).

1. Write `frame.md` first: tokens, fonts, the shared components (cards, buttons) and the section list with each
   section's start and end on the reference's cut seconds.
2. Read the whole film with `read_video` (keyframes included) in the main session; a later read of any range comes
   from its cache.
3. Each subagent gets its range, `frame.md`, the shared components, the full soundtrack as the clock and its lines of
   `read_video`'s text. It writes only `compositions/sNN-<name>.html` and `assets/sNN/`, checks its range with
   `frames` with `compare_with: "film"` in at most three rounds, then hands back what still differs. In one
   run three of five section agents were still polishing at 25 minutes and the film never reached assembly. GSAP is
   the CDN script in `index.html`: never search the disk for it.
4. Assemble, then check every section boundary with `frames` (the reference as `file`, `compare_with: "film"`) across the seam. Fix seams in the
   main session, one round per section.
