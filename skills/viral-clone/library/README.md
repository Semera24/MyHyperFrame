# Library

Helpers for pieces creator edits keep using. Copy the folder into the project (`cp -R <skill>/library lib`) and load
a helper after GSAP: `<script src="lib/paper.js"></script>`. Each call is seeded, so a render repeats exactly.

| Call                                                                            | Builds                                                                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `vcPaper.ransom(el, text, {font, perScrap: [1, 2], tilt: 3, seed})`             | Ransom-note type: overlapping torn paper scraps of 1–2 letters, tilted, shadowed, letters varied in size. Returns the scraps. |
| `vcPaper.boil(tl, els, {from, to, every: 7.5, poses: 3, rotate: 1, move: 1.2})` | The hand-made boil: each element jumps between a few poses, a new one every `every` frames.                                   |
| `vcPaper.typeOn(tl, el, {at, perFrame: 1, caretOff})`                           | Type-on with a caret, a character a frame.                                                                                    |

Set every option from the reference's zoom and strip (scraps per letter, tilt, pose period), never from the
defaults. The scraps' surface is the reference's paper, not the default gradient: pass the texture as `paper`
(`paper: "url(assets/paper.png) center/cover"`), a blank patch cut from the reference frame or edited from it. Cindy's hook title, rebuilt in one call: `ransom(line, "$5k scroll animations", {font: "Fraunces Black"})`
and `boil(tl, scraps, {from: 0, to: 5.37})`, a new pose every 7–8 frames as hers.
