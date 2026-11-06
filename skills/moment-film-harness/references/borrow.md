# Borrowing: reference films, earlier projects, Moments, popular effects, registry blocks

Steal the grammar, not the pixels.

## 1. A reference film

When the person gives one (a file, a link, an @-referenced project), ask yourself what they like about it; if the
message does not say, it is usually the motion. Finding, watching and measuring references is `study.md`; this section
is what to take from one.

1. Get the best source: the highest-resolution copy at its native frame rate. Check it with `ffprobe` (frame rate,
   bitrate) and look for duplicated frames; a re-encode padded to 30 fps (common on LinkedIn) has invented frames and
   cannot be measured.
2. Look at it, not its description: the `frames` tool with `file` the reference and `compare_with: "film"` puts its
   frames beside yours, with `offset` when the two timelines do not start together.
3. A launch film reference whose motion is the point: rebuild its key passage 1:1 first and measure its numbers
   (durations, eases, distances), then swap in the person's brand and story. Describing frames alone loses most of the
   motion.
4. Otherwise write one sentence per mechanic: what moves, on which axis, in which direction, over how long, what it
   reveals, and what in it never stops moving. That continuous motion is usually why it holds attention.
5. Its transition grammar overrides the house craft in `craft.md` (match cuts instead of zoom-throughs, its scale-ins,
   its cut rhythm). Where what you borrow is something the gate refuses by default (a cycle that steps back and forth,
   a scene with no words, a hard cut), write `keep` on that beat (SKILL.md §4), or the gate fails it.
6. Leave behind its copy, its brand, its colours, its background, its logo opener and end plate. The film is the
   person's brand from the first frame.
7. Frame tables you trace from a video yourself (arrays of positions) are read for timing only: the start value, the
   end value, and how many frames cover 90% of the distance. Write one tween; your own tracing noise plays back as a
   wobble. A Moment's `keys(...)` tables are different: they were traced and cleaned by the people who built it, and
   are ported as they are (`study.md` §6).

| 90% of the distance covered in | Ease         |
| ------------------------------ | ------------ |
| the first 15% of the move      | `expo.out`   |
| the first 25%                  | `power4.out` |
| the first 35%                  | `power3.out` |
| the first 50%                  | `power2.out` |
| an S-curve, slow at both ends  | `expo.inOut` |

- "Make it Apple-like" with no reference: find a concrete one (a named film, a component library's cards) before
  guessing a style.
- The reference is the brand's own earlier films: take two or more, so you can tell the brand's choices from one film's
  choices.
- An illustrated or print-style world: its elements step at 12 fps while the camera stays smooth.
- A borrowed shader or canvas effect: keep its geometry, replace its clock with the timeline's time (never
  `requestAnimationFrame`), so every frame renders the same.

## 2. Earlier projects

An @-referenced project is the best source there is: its motion and style are already approved. Reuse what is asked for
("the outro from @keyframes-launch") as it is, and change only the brand layer: logo, colours, fonts, copy. Keep timing,
easing and seams. Do not replay an earlier film's signature shots unasked; agents have favourites, and every film starts
looking like the same film.

## 3. Moments: golden samples

A Moment is a passage of a launch film that worked, reversed, measured and rebuilt in code. It has a **viewer job**
(what it buys from the viewer: attention, orientation, proof, trust, the close), **mechanics** fixed by numbers (layout,
motion laws, timing, cut behaviour, how each element enters and leaves) and **swap slots** with their limits. A Moment
is defined by its job, not by its position in the film. How a message's Moments are read, and which intent they carry,
is SKILL.md §1.

| Take          | From                                             | How                                                                                                                                                                                 |
| ------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| its job       | `refs moments <id>` (role and why)               | decides the beat it plays                                                                                                                                                           |
| its mechanics | `code/index.html`, then `dense.md`'s `[M]` facts | port its timeline as written, `keys(...)` and `kf([...])` tables included: the same eases, durations, distances, staggers and cut frames; never rebuild a move from its description |
| its layout    | `dense.md`'s objects (positions and sizes)       | keep the frame's composition                                                                                                                                                        |
| its slots     | `code/REMIX.md`'s slot table                     | fill each with the product's real UI (walk the feature and capture it), copy or data, within the slot's limits                                                                      |

Leave behind:

- its copy, brand, colours and fonts: the brand layer replaces them, colour for colour (its accent becomes the
  brand's accent, its ground the brand's ground);
- its subject: the object, footage, glyphs or UI it acts on, listed as a slot in `code/REMIX.md` or not; the move
  plays on the product's own mark, screens, footage or nouns (the beat's `subject` in `film.json`);
- its bookends: logo openers, end plates, one-frame UI flashes, hard-cut tails;
- its holds stretched: a Moment's own hold keeps its source length, and a longer slot gets more events from the product.

Rules:

- **Transplant, not reskin**: the result is centred on the person's product, with a clear a→b correspondence to the
  Moment: the same job and mechanics, new content. Swapping only fonts and colours on someone else's product is the
  failure.
- No timeline is cloned whole, except the remix of one Moment the person asked for. A film built from several takes them
  from different source films; eight films on one demo's skeleton feel like versions of the same film.
- Several Moments bring competing motion languages. The brand layer, declared first (the fonts, the palette, the
  accent, one ease family), is what makes them one film; each world may keep its own background.
- Show them to the person only as stills already wearing the product, in the storyboard when it is on: people never read
  the text and take a reference for their finished film. Off, name the Moments and what each plays in the reply.

## 4. Popular effects

Popular effects are one of the five marks of a good launch film. Use what people are responding to now, where it fits
the brand, built from the registry rather than by hand:

- soft blur-in text, and text that changes by match cut (`text-match-cut`);
- gradient and shader backgrounds, colour wipes (`colorama-wipe`);
- ASCII and other type-as-texture treatments;
- product output arriving as a live, moving grid or feed.

Not every trend fits every brand. When unsure, ask which recent launch films the person likes.

## 5. Registry blocks

About 400 prebuilt blocks install with one command. Before hand-writing a known look, search:
`hyperframes catalog --query "<look>"`, then `hyperframes add <block>` and use it as its snippet says. Proven for launch
films: `text-match-cut`, `colorama-wipe`, `motion-blur`,
`notification-stack`, `thread-message-stack`, `scroll-feed`, `carousel-*`. Install blocks before building beats, never
mid-way.
