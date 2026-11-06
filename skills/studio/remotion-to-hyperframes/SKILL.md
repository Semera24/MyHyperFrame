---
name: remotion-to-hyperframes
description: Bring existing video code or footage into HyperFrames and verify it frame by frame against the original - Remotion, Motion Canvas, Lottie, Three.js, p5.js, canvas or plain HTML/CSS animation, or renders from Manim, After Effects or Blender. Use to port, convert, migrate or reuse work made with another tool.
---

# Import into HyperFrames

HyperFrames is the container: its tracks, sub-compositions and variables are editable in Studio whatever runs inside a clip. Bring each part in at the highest level it supports and record which level you used.

| Level  | For                                                                                                             | How                                              | Editable in Studio afterwards                     |
| ------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| Native | code that can become HTML + GSAP: most Remotion, HTML/CSS/GSAP animation, simple Motion Canvas                  | translate it, then verify frame by frame         | every element; variables, catalog, FRAME.md apply |
| Hosted | code that can draw any requested frame in a browser: canvas, p5.js, Three.js, Lottie, WebGL, other JS animation | keep the code and drive it from HyperFrames time | timing, position, exposed parameters              |
| Media  | anything that outputs video or frames: Manim, After Effects, Blender, PIL, moviepy                              | render to a file and use it as a clip            | cut, place, layer; not the pixels inside          |

Code that depends on wall-clock time, live physics or the network can only come in as media.

## Native: translate, then verify

1. Translate to the contract in the `hyperframes` skill: one sub-composition per scene, times in seconds (`frame / fps`), asset paths root-relative.
2. Keep it editable while translating: the source's props or config become `data-composition-variables` bound with `data-var-text`, `data-var-src` or `var(--id)`; each sequence or scene becomes a timed clip or a sub-composition; a reusable component becomes one sub-composition file mounted several times with `data-variable-values`.
3. Compare frame by frame: `hyperframes snapshot --at <t,…> --against <original.mp4>` saves the original's frame at each time next to yours, with a pair sheet. Sample every scene and both sides of every cut, fix the worst differences and repeat until the pairs match; look for one late or recolored element, not only the overall picture.

React state or effects driving animation (`useState`, `useReducer`, `useEffect` with dependencies), async `calculateMetadata` and third-party React UI kits don't translate: host them or refactor them out; don't approximate.

## Hosted

Keep the code and let HyperFrames own the clock: it draws the frame for the time it is given. The seek protocol and the built-in adapters for Lottie, Three.js, anime.js, WAAPI and CSS animations are in the `hyperframes` skill's `references/runtimes.md`. No `requestAnimationFrame` loop or timer as the time source, seeded randomness only, and `data-duration` on the root when nothing else defines the length.

## Media

`<video class="clip" data-has-audio="true" src="assets/x.mp4" ...>`, or `muted` when it is silent. Nothing else is needed.

In the final message, list each imported part with its level, what a person can change in Studio, and how the frame-by-frame comparison came out.
