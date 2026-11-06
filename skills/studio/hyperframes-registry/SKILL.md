---
name: hyperframes-registry
description: About 450 ready-made blocks and components installed as editable source - transitions, overlays, titles, kinetic type, captions, charts, maps, 3D, social cards, motion primitives, camera moves. Search before hand-building a named effect, transition, caption style or scene.
---

# HyperFrames registry

Starting from an item is faster and usually better than writing the effect yourself, and an installed item is ordinary source in your project: change it, cut it down, restyle it.

## Find and install

```bash
hyperframes catalog --query "<what it does, in English>" --json      # matches with name, title, description, tags, duration
hyperframes add <name> --vars '{"title":"…"}' --json                 # install; prints the written files and the mount snippet
```

- Narrow with `--type block` or `--type component`, and `--tag <tag>` (for example `transition`, `motion-primitive`, `caption-style`, `camera`). A bare word works too: `hyperframes catalog crossfade --json`. Search matches names, titles, descriptions and tags, so write the query in English. `--on-device` searches by meaning after a model download; use it only when the person agrees to the download.
- To read how an item is built, install it and read its file; nothing is wired until you mount it.
- `add <tag>` installs every block with that tag. Registry dependencies install first. An item you've edited is kept on reinstall unless you pass `--force`.
- Nothing fits: build it yourself and report the gap once with `hyperframes feedback --search-miss "<query>" --wanted "<what you needed>"`.

## What's in it

447 items: 210 blocks and 237 components. An item can sit in more than one row.

| Blocks (a scene with its own timeline) | Count | Examples                                                            |
| -------------------------------------- | ----- | ------------------------------------------------------------------- |
| Transitions                            | 33    | `beat-freeze-cut`, `chromatic-radial-split`, `cinematic-zoom`       |
| Overlays and lower thirds              | 32    | `camcorder-hud`, `editorial-flash-overlay`, `freeze-frame-dressing` |
| Title cards and kinetic type           | 18    | `canopy-part-title`, `carousel-text-circle-1`, `code-slice-hero`    |
| Social, chat and UI cards              | 22    | `ai-answer-rank`, `ai-chat-reveal`, `chatgpt-exchange`              |
| Code and developer                     | 11    | `code-3d-extrude`, `code-diff`, `code-highlight`                    |
| Charts, data and maps                  | 16    | `bar-chart-race`, `data-chart`, `hw-pipeline`                       |
| 3D, shader and WebGL                   | 93    | `app-showcase`, `aurora`, `blob`                                    |
| Showcases, carousels and galleries     | 63    | `ai-chat-reveal`, `app-showcase`, `apple-money-count`               |
| Talking head, interview and podcast    | 10    | `lt-accent-underline`, `lt-bold-block`, `lt-clean-bar`              |
| Music and beat-synced                  | 2     | `beat-freeze-cut`, `waveform`                                       |
| Backgrounds and textures               | 30    | `aurora`, `blob`, `color-wheel`                                     |

| Components (a snippet merged into your scene) | Count | Examples                                                                   |
| --------------------------------------------- | ----- | -------------------------------------------------------------------------- |
| Motion primitives                             | 125   | `agent-cursor`, `ascii-render-pass`, `ascii-trail-reveal`                  |
| Text effects and typography                   | 55    | `blur-in`, `blur-out-up`, `bottom-up-letters`                              |
| Reveals and transitions                       | 63    | `ascii-trail-reveal`, `avatar-group-hover`, `badge-pop`                    |
| Caption styles                                | 16    | `caption-camera-follow`, `caption-clip-wipe`, `caption-editorial-emphasis` |
| Camera moves                                  | 14    | `camera-scan-gate`, `camera-shake`, `caption-camera-follow`                |
| Product demo and UI props                     | 50    | `agent-cursor`, `before-after-wipe`, `browser-device-stage`                |
| Video primitives                              | 28    | `arc-motion-path`, `avatar-group-hover`, `badge-pop`                       |
| Textures, particles and effects               | 35    | `ascii-render-pass`, `avatar-cloud`, `beat-accent`                         |

## Choosing the unit

- **Block**: a whole scene with its own timeline, mounted as a sub-composition. Installs to `compositions/<name>.html`.
- **Component**: a snippet (motion primitive, caption style, UI prop, texture) merged into one of your scenes. Installs to `compositions/components/<name>.html`; copy its markup, `<style>` and script into your scene, and follow its comment block if it hooks into your timeline.

Take the largest unit that fits, then edit it.

## What you can't infer

- A block's mount sets its place in your timeline: `data-composition-id` matching the block's own id, `data-start`, and `data-duration` for the length you need (see the snippet `add` prints).
- An item keeps its own variables; set them for one mount with `data-variable-values` on its host (`add --vars` writes that for you), and point its color and font variables at your brand's.
- Beat-synced blocks take hit times from `hyperframes beats --json`: the beat times minus the mount's `data-start`.
- Items load GSAP from the CDN; don't vendor it. Keep an installed item's ids prefixed as they are, so two items can't collide.
