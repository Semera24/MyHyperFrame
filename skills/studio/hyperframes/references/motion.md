# Motion

## Motion craft

Measured frame by frame from the official HyperFrames launch films. These are defaults: a reference the person gave, or a Moment that does otherwise on purpose, wins for its own beat.

- **Moves**: a fast move takes 0.3–0.6 s and carries motion blur on its own ease, peaking at its fastest frame: 6–12 px on text-sized elements, 15–20 px full-frame, horizontal-only on a horizontal move. One move is one tween.
- **Arrive slow, leave clean**: long-tailed ease-outs on arrivals; landing takes longer than leaving. An exit is one smooth motion, never slide, stop, then leave. Entrances that are too snappy read as glitches; slowing the whole video by about a second often fixes it.
- **Cuts**: cut at the fastest frame of a move, with matching direction and speed on both sides. A click into a new screen is a match cut on the click's rebound; the new screen comes in slightly large and settles.
- **Titles**: a landed title is dead still; the motion moves to the next element, the camera or the world behind. Enter by word, not by sliding: each word `blur(6px)` → 0 and opacity 0 → 1 in 0.13 s, 0.067 s apart, or the whole line 8 px → 0 in 0.13–0.2 s. Hold 1–2 s (0.4 s for a quick line), then exit with a blur-out and fade of 0.13–0.25 s.
- **Rhythm**: contrast speeds. Montages cut every 0.13–0.8 s; a demo holds one framing for 7–10 s while the UI acts; shots average 1.8–3 s with motion inside them. Hold 0.3–0.75 s before the payoff, which plays at normal speed.
- **Continuous motion that works**: the product's UI working, footage playing, a character acting, a 3D world turning, a slow orbit of a background stage (3–5° a second).
- **Defaults that look generated**: breathing, floating or pulsing loops standing in for motion; titles that keep sliding or scaling after they land; a slow creeping scale on a title or a slow push late in a scene; bounce; click rings; every scene entering the same way.

| The person says        | Change                                                                         |
| ---------------------- | ------------------------------------------------------------------------------ |
| "too fast"             | Slow every zoom and pan to 0.7× of its speed, nothing else                     |
| "speed this up"        | Speed the content and shorten the beat by the same amount; later beats move up |
| "the titles move"      | Land them, then hold them dead still until they leave                          |
| "it feels like slides" | Enter the next scene through an object on screen; cut a move mid-flight        |

## The right mechanism

| Request                                 | Mechanism                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Punch-in, zoom, pan, Ken Burns, reframe | Tween `scale` and `x`/`y` on a wrapper inside the clip, never on the timed media element; chain the states on one timeline |
| Crop or mask reveal                     | Tween `clip-path` or a mask on an inner wrapper; source time is untouched                                                  |
| Constant speed change                   | `data-playback-rate` on the media, 0.1–10 (picture and pitch-preserved sound)                                              |
| Speed ramp                              | A `rate` lane in `data-automation` on the media (`t` in clip seconds, `v` 0.1–10); it overrides the constant rate          |
| Hold or freeze                          | Hold a final frame or a finished scene; a freeze mid-source needs a still exported first and placed as its own clip        |

Ready-made moves: `hyperframes catalog --tag camera --json`, or `catalog --query "<the move>" --tag motion-primitive --json`.

## Seeing motion

- `hyperframes keyframes --json [--selector '#id'] [--runtime all]` lists keyframes and motion paths (GSAP, CSS, anime.js): property, time, value, ease.
- `hyperframes keyframes --shot motion.png --selector '#id'` draws the real element's samples over time with its path (9 samples; `--samples N`). `--layout strip` for motion in place, `--from`/`--to` for one stretch, `--angle iso|top|side|'yaw,pitch'` for 3D, `--ghost` for a `<canvas>`.
- `hyperframes snapshot --range 2,4 --frames 8` samples one stretch; `--composition <id>` samples one scene; `--at <t,…>` exact instants; `--zoom '#id'` a sharp crop; `--angle iso` depth and overlap.
- Against a reference video: `snapshot --at <t,…> --against ref.mp4` writes a side-by-side sheet.
- Assert intent instead of eyeballing it: a `<name>.motion.json` next to the composition makes `check` verify it on the seeked timeline, as errors (`motion_appears_late`, `motion_out_of_order`, `motion_off_frame`, `motion_frozen`):

```json
{
  "assertions": [
    { "kind": "appearsBy", "selector": "#headline", "bySec": 0.5 },
    { "kind": "before", "a": "#headline", "b": "#cta" },
    { "kind": "staysInFrame", "selector": ".card" },
    { "kind": "keepsMoving", "withinSelector": ".scene" }
  ]
}
```

## Common faults

| Symptom                          | Usual cause                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Blank or frozen scene            | Timeline registered before an async build finished, `visibility` tweened on a `.clip`, or a host id that differs from its scene's timeline key |
| Stutter or drift between renders | Layout measured in `onUpdate`, `requestAnimationFrame` or clock time; two timelines on one property                                            |
| Jump at a cut                    | Outgoing and incoming states differ at the seam: snapshot just before and after it                                                             |
| Ease looks off at a handoff      | Speeds don't match across the seam: mirror the ease (`power3.in` out, `power3.out` in)                                                         |

Studio's keyframe diamonds and motion-path handles rewrite the GSAP script in the composition file, so the person may have changed motion since you wrote it.
