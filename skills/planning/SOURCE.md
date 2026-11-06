# Planning skills

## Visual planning

English translation of the user's reviewed Chinese principles, approved on 2026-10-28.
The planning discussion drew on [School of Motion's project guide](https://schoolofmotion.com/blog/guide-completing-motion-design-project)
and [Higgsfield's skills](https://github.com/higgsfield-ai/skills). No third-party code or assets are bundled.

This is a principles skill, not a production workflow: the approved scope deliberately excludes
output schemas, approval steps, storyboard handoffs and a completion gate. It therefore does not
use the production pipeline and gate structure in ../STANDARDS.md.

Desktop unpacks it as the separate hyperframes-planning plugin. Only Claude Mods and DSH runs
receive that plugin through appGuides.mjs, agent.mjs and dshHarness.mjs. The existing Mods/DSH
boundary is its rollout scope. hf-chat-rules/skills.md asks the agent to load it after initial
research, before visual planning. The motion bundle disables the legacy hf-visual-planning injection. Its progressive disclosure and spatial composition guidance is merged here with the user-reviewed changes: narration-led arrangements are conditional on a voice script; transitions use anchor elements; continuous motion can come from the camera or element scale and position. Fixed time-density requirements, mandatory visual consistency, the single-lead requirement and the product UI tilt restriction are not carried over.

## AI visual generation

The user's author-reviewed English creative guidance, introduced on 2026-10-28 in PR #6657.
It covers generation and correction decisions, with five on-demand references for character
references, image editing, motion and performance, shot continuity, and audio direction.

This is a principles skill alongside visual-planning, not a production workflow with a fixed
pipeline or completion gate. Desktop unpacks it into the same hyperframes-planning plugin;
the existing Mods/DSH boundary is its rollout scope. The hf-image and hf-video plugins load
it through deferred guidance. Image selection/correction behavior remains in hf-image, and
model-specific parameters, limits, and syntax remain in tool_options.

The reviewed replacement does not carry over the old video's blanket first/last-frame
approval step or the requirement to approve a look sheet before every video containing a
person. Character-reference confirmation remains in ai-visual-generation/references/character-reference.md
when establishing a reusable character; an already approved reference can be reused, and a
one-off image without continuity needs no additional sheet.

## SHA-256

```text
eb510bd78a2bbbd3996272f89eb3eb60cd3d168b1b1bfb6496154d999e4df7d2  ./ai-visual-generation/SKILL.md
d56857678294cde4250657f24813d6645f6fb5aff86da500d07f6e2a1b960620  ./ai-visual-generation/references/audio-direction.md
cdb89592853e11ca6c20a0c7e08ea9d127c744bc4e201c23ae2c2c8e356de6e1  ./ai-visual-generation/references/character-reference.md
1d9e2b6fe4fa5c92ea6fc070bdcdf31661325995390ce4720af485d34de27ef1  ./ai-visual-generation/references/image-generation-and-editing.md
f9fa522e9a351044ab3c25552d6c94915f7f0eff9c38094aa69c95499dc95c09  ./ai-visual-generation/references/shot-continuity.md
93f7ee13466c7791144798902d1293fc059b4585767eb6d3646825c6ce1237e4  ./ai-visual-generation/references/video-motion-and-performance.md
8ddf8088c830a5c91221a6fa14eca0169197cb2c0f5bb4edc3b6db150be6eeea  ./visual-planning/SKILL.md
```
