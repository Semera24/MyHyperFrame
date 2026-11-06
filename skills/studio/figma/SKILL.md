---
name: figma
description: Bring Figma into a HyperFrames video - layers and logos as local files, design tokens as variables, frames as editable HTML, storyboard sections animated, Figma motion rebuilt as a GSAP timeline and checked against its export. Use when the person shares a figma.com link.
---

# Figma → HyperFrames

Every import happens at build time and is frozen to a local file with its source recorded in `.media/`, so renders never call Figma and re-running a command re-imports only what changed.

## Access

The commands read `FIGMA_TOKEN` from the environment or the project `.env`: a read-only personal access token with File content and File metadata scopes, plus Library content for `tokens` on non-Enterprise plans. If there is no token, don't wait for one: build from whatever else you have (exports, screenshots, `capture` of their site) and say in your final message how to create the token (figma.com → Settings → Security → Personal access tokens).

## Commands

- A layer, logo or image as a local file: `hyperframes figma asset '<url or fileKey:nodeId>' [more refs] --format svg|png --scale 2 --description "<what it is>"`. Several nodes of one file in one call render in one request.
- Brand colors and type as composition variables: `hyperframes figma tokens <fileKey>`. Run it before `component` and paste the printed entries into `data-composition-variables`. Figma variables need an Enterprise plan; on other plans it falls back to published styles by itself, which is expected, not an error.
- A frame as editable HTML at exact geometry: `hyperframes figma component '<url or fileKey:nodeId>'`. Fills bound to an imported token come out as `var(--slug, #literal)`, so changing one variable re-brands every imported component. A fill bound to a token you haven't imported stays a literal marked `data-figma-unresolved`: import that library's tokens, then re-import the component.

## What you can't infer

- **Storyboard frames are keyframes, not slides.** In a section of scene frames, an element that appears in consecutive frames is one element changing state: animate it between the states. Order scenes by x position. Text notes under the strip describe the motion; they are not on-screen copy. Playing the frames back to back as stills is the failure mode.
- **Figma motion is states plus timing.** Read the frames and their transition settings, write the GSAP timeline yourself, then check it against Figma's own export: `hyperframes snapshot --at <t,…> --against <figma export.mp4>` puts your frame and Figma's side by side at each time.
- **Shaders don't survive Figma's export path**: they flatten to the base color. Use a native export of that frame as a `<video class="clip">` instead.
- **Check hero components against Figma's pixels**: `figma asset <same node> --format png` is the ground truth. Text drift is the usual cause; report drift you can't fix instead of hand-tweaking the import.
- Never leave a Figma URL in the composition.
