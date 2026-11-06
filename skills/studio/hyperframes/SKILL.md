---
name: hyperframes
description: HyperFrames render contract, Studio editing, and references for format, runtimes, motion, look and captions. Open for every video edit.
---

# HyperFrames

HyperFrames renders HTML to video by seeking a paused timeline frame by frame: identical renders, the same files editable in Studio.

`index.html` is the root: it declares variables and mounts one scene per sub-composition from `compositions/`. Media and fonts live in `assets/`. A website subject: app.capture when offered, else `hyperframes capture <url> -o "$(mktemp -d)/site" --json`; read what it wrote.

Build what was asked: no voiceover or captions and no new aspect ratio unless the message or the source calls for them; a film over ~15 s that tells something gets music and sound on its visible actions unless the person asked for silence (`media-use`). A new video is 1920×1080 at 30 fps. Before hand-writing a named effect, transition, caption style, chart or card, search the registry (`hyperframes-registry`).

## Contract

`hyperframes check --json` reports most violations with a `Fix:` line.

1. Every timed element has `class="clip"`, `data-start` and `data-duration` in seconds, and shows over `[start, start + duration)`: land an end state just before its end. `data-track-index` is only a Studio lane; paint order is `z-index`.
2. The video's length is the root's `data-duration`: overrun is cut, an early end holds the last frame.
3. Each composition builds one paused timeline and registers it after its tweens: `window.__timelines["<data-composition-id>"] = tl`.
4. No `Date.now()`, unseeded `Math.random()`, network fetches, timers or `repeat: -1`. Everything visible is a function of timeline time.
5. Never tween `display`, `visibility` or `autoAlpha` on a `.clip`; animate a child.
6. No CSS `transform` on an element GSAP transforms; animate transforms, not `left`/`top`/`width`/`height`.
7. Never `play()`, `pause()` or seek media. A `<video>` with sound keeps it (`data-has-audio="true"`); silent footage is `muted`. A separate `<audio>` is for music, voiceover, replacement sound or a J/L cut.
8. Every `<audio>` has an `id` or it is left out of the mix. No `crossorigin` on media.
9. Time a `<video>` or its wrapper, never both.
10. Only the bundled fonts (`references/format.md`) resolve by name; any other family needs `@font-face` to a file in `assets/fonts/`.
11. Asset paths are root-relative (`assets/...`), in sub-compositions too.
12. Grades, grain, blur and vignettes on footage go through `hyperframes media-treatment` (`media-use`), never CSS filters.
13. The root is a normal document. A scene file puts its styles, markup and scripts inside `<template>` and styles its root as `#root`.
14. Intended overflow or overlap: `data-layout-allow-overflow` or `data-layout-allow-overlap`.

## Keep it editable

Studio edits the tags you write.

- One scene per sub-composition, short readable ids; the root holds only scene hosts, media and audio.
- Timed elements are written in the HTML, not made by script, each with a stable `id`.
- Copy, brand colors and swappable media are variables (`data-var-text`, `data-var-src`, `var(--id)`).
- One kind per track: `data-track-kind="graphics"` on scene and overlay hosts, `captions` on the one host that holds every caption group.
- Keep content inside the 90% action-safe box, captions and key text inside 80% title-safe. Studio draws the guides; never add them as elements.

## References

| Read                     | When                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `references/format.md`   | Scenes, nesting, `data-*` attributes, variables, adding media, linked clips, layout opt-outs, lint errors                             |
| `references/runtimes.md` | GSAP facts that bite, or CSS, WAAPI, Lottie, anime.js, Three.js, canvas                                                               |
| `references/motion.md`   | Writing any motion: timings, eases, blur, cuts, title entrances; punch-ins, speed changes, holds; motion that stutters; seeing motion |
| `references/look.md`     | Colors, type and style: a brand, a project `frame.md`, or one of 13 presets                                                           |
| `references/captions.md` | Captions: transcripts, word groups, fitting, placement                                                                                |
