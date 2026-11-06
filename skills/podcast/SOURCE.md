# Source

The podcast-clips skill picks a made podcast episode's clips for socials and writes each clip's title and
description for the post. Its rubric (§2: hook, stands alone, one idea with a payoff, guest over host, no
housekeeping, diversity, and the 0 to 100 score bands) is Tejas Makwana's moment rubric from Clipper
(packages/clipper/skill/clipper/references/moment-rubric.md on branch tejas/clipper-skill, PR #4566,
2026-10-18), kept nearly word for word. Clipper's file steps (its moments file, its edge-snapping script, contact sheets, B-roll)
became the app's podcast tools, and the length moved to 20 to 60 s because the episode's pauses are already cut.

`main/appGuides.mjs` unpacks it as its own plugin, `hyperframes-podcast-clips`, and a run loads it only while
`desktop-podcast-clips` is on: the flag the clips themselves sit behind. It cuts with `podcast.cutVerticalClip` and
writes copy with `podcast.adjustClipRange`, both in `main/mcpPodcastTools.mjs`.

## sha256

```
03d0b19a67f8c85d95169dcd064bbfd3773d56150f9a3b0816193f7971ede5b5  ./podcast-clips/SKILL.md
```
