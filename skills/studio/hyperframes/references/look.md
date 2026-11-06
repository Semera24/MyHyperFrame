# The look

Left alone, the same brief comes out with the same look run after run. Outside input breaks that: the project's design spec, a real brand, reference images the person gave you, or a preset chosen on purpose. Settle it before the first scene.

## The project's design spec

Read the first of `frame.md`, `design.md`, `DESIGN.md` at the project root that exists; ignore the rest.

- **Frontmatter is normative**: `colors`, `typography`, `spacing`, `components`. Quote hex values, families and weights exactly; never round or invent them.
- **A brand kit note outranks it on color**: when the message carries the project's brand kit, its `Colors:` are the kit as it is now. Where a color of the same name has a different hex in the spec or in files you already wrote, the person changed it in the kit: use the kit's hex, and update the spec and those files to match.
- **The prose is intent**: what the look is for, Do's and Don'ts. Follow it for judgment, not values.
- **Brand, not layout**: hex, fonts, weight relationships and Do's and Don'ts are strict; type sizes, spacing, border weight and decoration are yours to scale for video. A 1px border or a 6% shadow from a web page vanishes on screen.

## From a brand

- A website: the app's capture tool (app.capture) when it is offered, otherwise `hyperframes capture <url> -o "$(mktemp -d)/site" --json`. Either writes screenshots, the copy (`extracted/visible-text.txt`), images, logos, `extracted/tokens.json` (colors, fonts) and `extracted/design-styles.json` under its output folder. Look at the screenshots before choosing anything. A capture that exits non-zero, prints `ok: false` or writes `BLOCKED.md` failed: take no brand data from its partial files.
- Figma: `hyperframes figma tokens <fileKey>` (`figma` skill).
- Images the person attached: take palette and type from what you see.

Use the brand's own fonts when the capture shipped their files or they are bundled (`format.md`); otherwise download the family's `.woff2` into `assets/fonts/` with an `@font-face`, or pick the closest bundled family and say so.

## Presets

Each folder in `../assets/frame-presets/` holds a `FRAME.md` spec, a `caption-skin.html` and a `frame-showcase.html` contact sheet. To use one, copy its `FRAME.md` to the project root as `frame.md`, then read it as above; its fonts that aren't bundled need `@font-face` files. The two HTML files are reference code: read them for treatments, never mount them.

| Preset              | Look                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `biennale-yellow`   | Museum catalogue: parchment, deep indigo ink, solar-yellow blooms, Instrument Serif, hairlines |
| `blockframe`        | Loud neobrutalist: 4px black borders, hard shadows, candy pastels, Inter 900 caps              |
| `blue-professional` | Consulting restraint: cream canvas, one cobalt accent, Space Grotesk + Inter, tinted cards     |
| `bold-poster`       | Vintage editorial poster: Shrikhand tilted display, Baskerville, tomato red, double borders    |
| `broadside`         | Protest poster: ink-black and fire-orange planes, giant lowercase Barlow 900, mono chrome      |
| `capsule`           | Friendly editorial: every container a pill, cream, nine candy accents, Bodoni Moda             |
| `cartesian`         | Quiet catalogue: warm-stone palette, Playfair + Inter, taupe hairline grid, compass rings      |
| `cobalt-grid`       | Two-color risograph: cream paper, cobalt ink, graph-paper grid, Newsreader serif               |
| `code-editorial`    | Developer brand book: warm paper, scarce terracotta, EB Garamond, navy code surface            |
| `coral`             | Bold magazine: coral, ink and cream planes at hard edges, Bebas Neue, giant numerals           |
| `creative-mode`     | Sparse neobrutalist: cream, 4px ink borders, Archivo Black caps, rationed accents              |
| `daisy-days`        | Picture book: charcoal outlines, sunny pastels, Fredoka One, hand-drawn ornaments              |
| `editorial-forest`  | Literary: green, pink and cream, Source Serif display, mono chrome, flat paper                 |

## Without a brand or preset

Choose a direction from the subject itself (its era, materials, where it would be shown) and hold it in every scene: palette roles (ground, ink, one accent), a display face and a body face, one rule for the frame.

## Video facts

- Full-screen linear gradients on dark grounds band under H.264; use a radial gradient, a solid fill or a solid plus a local glow.
- An accent at 5% opacity disappears in compression: 15–25% for atmosphere, full saturation for the focal element.

## Make it re-brandable

Declare palette and fonts as variables on the root `<html>` and use them everywhere, so the person can re-brand from Studio's Variables panel:

```html
<html
  data-composition-variables='[
  {"id":"color-ground","type":"color","label":"Background","default":"#ffffff"},
  {"id":"color-ink","type":"color","label":"Text","default":"#101010"},
  {"id":"color-accent","type":"color","label":"Accent","default":"#0055ff"},
  {"id":"font-display","type":"string","label":"Display font","default":"Montserrat"}
]'
></html>
```

Reference them as `var(--color-accent)`; point a registry item's color and font variables at the same values.
