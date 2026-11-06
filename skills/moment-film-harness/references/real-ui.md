# Real UI

Everything on screen that claims to be the product is the product's real UI. Anyone who has used it recognises the real
interface, and one invented button loses all of them. No access is a blocker, never a reason to mock.

## 1. Where it comes from, best first

1. **The person's recording or screenshots.** When the proof needs a screen you cannot capture, ask for them (SKILL.md
   §3, the angle card): name the screens per beat, recordings at 1080p or more with the cursor visible, a few seconds
   per action. Without them, use a labelled placeholder.
2. **Figma frames.** Treat them as states of one app, not as pictures: rebuild them in code and make the change between
   two frames a real interaction (the click, the typing, the panel opening). Never export each frame as a PNG and
   animate on top. A marketing page's "step 1–5" is already a storyboard.
3. **Walking the flow yourself**, when a browser tool can reach it without a sign-in: click through the feature and
   screenshot every verb's state once the window is at rest.
4. **A capture** of the site and of the feature's own page (app.capture when it is offered, otherwise `hyperframes capture`): real fonts, colours, logo, screenshots and copy.
   The homepage is for the brand; the feature page is the film's material.
5. **The product's code, PR or docs**, to confirm today's labels, names and behaviour. A renamed button in the film is a
   bug. When the person points at a PR, read it before building.

Missing a screen: ask, or build a clearly labelled placeholder ("Screenshot: Settings → Motion") and say so in the
reply. Never stand in an invented screen.

A feature with nothing visible (speed, reliability, an API): show it, in this order of preference, as the real UI that
exposes it, a real analogue the viewer knows, the real terminal output, or a checklist of real facts. Never a made-up
dashboard.

## 2. Brand assets

- **Inventory first**: before designing, list everything the capture and the person gave you: logo and wordmark,
  illustrations, mascots, badges, partner logos, photos, fonts, product shots. Build from what the brand already owns
  before generating or drawing anything.
- **Logo**: the real SVG from the capture or the site; else `media-use` (`resolve --type logo`). Never redraw it from
  memory.
- **App icons** on macOS:
  `sips -s format png /System/Applications/<App>.app/Contents/Resources/<icon>.icns --out assets/ui/<app>.png` (or the
  app bundle the person names). A coloured square standing in for an icon fails review.
- **Fonts**: the site's own font files from the capture, copied into `assets/brand/`. Typography is the easiest quality
  difference there is; never fall back to a system font when the brand's is available.
- **Colours**: read them from the capture or the code's tokens (`:root` variables, Tailwind config). Never guess, and
  never default to dark: the ground is the brand's own. Only a film from an idea alone picks its own palette (SKILL.md
  §2).
- **Cursor**: one the viewer recognises from the product (a multiplayer arrow with a name tag, a crosshair) when the
  product has one; its tag and arrow move as one rigid piece. Otherwise the plain oversized arrow (`craft.md` §9).
- **The person's assets** (fonts, music, background video, a starter project) are used as given, never replaced by
  something similar.

## 3. Rebuild only what the story uses

- Rebuild the piece the beat needs in HTML and show it big: the camera frames the panel at about 1.6–2× its real size,
  so it fills most of the frame and its text reads on a phone. Never a small window floating in the middle of an empty
  canvas. On a ground of its own it floats with a soft shadow, not inside a card or a frame of corner brackets. Not the
  whole window with its chrome: the panel, the prompt box, the row that changes.
- Code what changes state; freeze what does not (a screenshot crop is fine for a static sidebar).
- Text on screen stays at least **26 px** at 1080p after the camera pushes in. Screenshots are never pushed past their
  native pixels.
- A still taken from a recording comes only from a moment where the window is fully at rest; a still pulled from a
  moving frame is a defect.
- One focal point at a time: when the UI takes over from the line, it takes the centre of the frame on its own.
- Text never reflows during a morph: when the prompt box becomes a bubble, the words keep their line breaks; a font swap
  happens mid-word at the camera distance where both glyphs are the same size on screen.

## 4. UI behaves like the product

List every action in the beat's `ui` as cause → effect, the way the real product does it, then animate exactly that:

- A clicked button opens what it opens, from where the button is.
- Typing happens in the focused field, at the caret, at a believable speed (fast, not instant).
- A sent message leaves the composer and lands in the thread above it; the composer stays and clears.
- Controls keep their own grammar: a dropdown opens, highlights its option and closes; a toggle flips on one click; a
  segmented control's highlight slides to the new segment.
- Generating and loading states move (progress, streaming output, a shimmer): a static loading frame is a defect.
- The product's own transitions (a panel opening, a page change): if you have a recording, measure their duration and
  ease and copy them; never guess.
- Many similar things (messages, notifications, results) move as one ordered rig: a feed, a stack, a thread. Check the
  registry (`notification-stack`, `thread-message-stack`, `scroll-feed`, `carousel-*`).
- The cursor aims at the target's live box (`getBoundingClientRect`), never at hard-coded coordinates.

The camera may push into the UI or travel across it; the UI keeps its real layout while it does. Never cut away
mid-action to a rebuilt screen, and never invent UI to sell a beat.

## 5. Outputs, inputs and what may be generated

- **The product's output is made by the product.** If the feature generates something (a video, a translation, an image,
  a result list), produce it with the product itself and show that. For HeyGen's own features, that means the HeyGen
  tools. The one real piece of data the film follows (`story.md` §1) is what you feed it.
- **Inputs and the world around the product may be generated** with HeyGen, paid and named in the storyline card:
  stills, footage of places, objects and weather, a presenter or founder saying a line. Footage is HeyGen Video 1, and
  footage that fills the frame is delivered at the frame's resolution or sharper (2K): a soft plate under sharp type
  reads as cheap. Each tool's own description says how. Plan generated shots in `film.json` `assets` under
  `generate`, with their seconds, so the cost is visible before anything is made. Organic things (clouds, smoke,
  hair, realistic objects) come from footage, never hand-drawn in CSS.

- **Never**: the launched product's UI, its logo, its icons, real customers' names or numbers.
- People in generated images and footage: change the light, wardrobe and angle so they do not read as stock.
