# Named colour grades

A grade is applied in post, to the whole clip, with HyperFrames grading. It never changes what is in the picture, so it is the right tool for "make it teal and orange" or "black and white" on a clip you already have. Do not write a grade into a `video.generate` prompt: Video 1 rewrites the scene to fit it and, for black and white, leaves colour in.

Each grade has a restrained form, grading JSON you can edit, and where it applies a full form, a LUT written on demand:

```bash
node <SKILL_DIR>/scripts/grade-lut.mjs hyper-neon -o assets/luts/hyper-neon.cube
hyperframes media-treatment --selector '#clip' --grading '{"lut":{"src":"assets/luts/hyper-neon.cube","intensity":0.8}}' --apply --json
```

The LUT's `intensity` (0 to 1) blends it with the source. Use the JSON for a tint and the LUT when the whole frame should take the colour. Pick one per clip, compare it with the source on one frame (`hyperframes grade-compare --for frame.png --grades grades.json`), and keep the source if it is not clearly better.

| Grade            | Reads as                                      | Use         |
| ---------------- | --------------------------------------------- | ----------- |
| `bleached-warm`  | amber light, brown shadows, creamy highlights | JSON or LUT |
| `teal-orange`    | teal shadows against warm skin and highlights | JSON or LUT |
| `cold-steel`     | a steel-blue cast, no warmth                  | JSON or LUT |
| `nostalgic-blue` | faded blue, lifted blacks                     | JSON or LUT |
| `bleach-bypass`  | desaturated, hard contrast, silvery           | JSON        |
| `classic-bw`     | true monochrome, nothing keeps its colour     | JSON        |
| `hyper-neon`     | magenta highlights, acid green shadows        | LUT         |
| `sodium-decay`   | emerald shadows, sodium-yellow highlights     | LUT         |
| `candy-pink`     | pink takes the whole frame                    | LUT         |
| `lime-jam`       | lime green takes the whole frame              | LUT         |

**When one red has to survive** (a coat, a car, a sign), do not cool or warm with `temperature`, and avoid `cold-steel`, `bleach-bypass` and `sodium-decay` as they stand: all three dragged a red coat to black. Tint the shadows and highlights with the wheels instead, leave `temperature` at 0, lift `blacks` a little, and add a small warm `midtones` amount to hold the red, for example `{"adjust":{"contrast":0.05,"saturation":0.12,"blacks":0.08},"wheels":{"shadows":{"hue":210,"amount":0.25,"level":0},"midtones":{"hue":8,"amount":0.1,"level":0},"highlights":{"hue":195,"amount":0.2,"level":0}}}`. Compare on a frame where the red is large before applying.

## Grading JSON

`bleached-warm`

```json
{
  "adjust": {
    "temperature": 0.28,
    "saturation": -0.12,
    "contrast": 0.05,
    "highlights": 0.12,
    "blacks": 0.06
  },
  "wheels": {
    "shadows": { "hue": 28, "amount": 0.3, "level": 0 },
    "midtones": { "hue": 38, "amount": 0.12, "level": 0 },
    "highlights": { "hue": 48, "amount": 0.22, "level": 0.05 }
  }
}
```

`teal-orange`

```json
{
  "adjust": { "contrast": 0.12, "saturation": 0.1 },
  "wheels": {
    "shadows": { "hue": 188, "amount": 0.5, "level": 0 },
    "midtones": { "hue": 28, "amount": 0.1, "level": 0 },
    "highlights": { "hue": 30, "amount": 0.4, "level": 0 }
  }
}
```

`cold-steel`

```json
{
  "adjust": { "temperature": -0.45, "saturation": -0.15, "contrast": 0.08 },
  "wheels": {
    "shadows": { "hue": 215, "amount": 0.35, "level": 0 },
    "midtones": { "hue": 210, "amount": 0.22, "level": 0 },
    "highlights": { "hue": 205, "amount": 0.2, "level": 0 }
  }
}
```

`nostalgic-blue`

```json
{
  "adjust": { "saturation": -0.12, "blacks": 0.18, "contrast": -0.06 },
  "wheels": {
    "shadows": { "hue": 222, "amount": 0.35, "level": 0 },
    "midtones": { "hue": 210, "amount": 0.25, "level": 0 },
    "highlights": { "hue": 200, "amount": 0.1, "level": 0 }
  }
}
```

`bleach-bypass`

```json
{ "adjust": { "saturation": -0.55, "contrast": 0.32 }, "details": { "grain": 0.14 } }
```

`classic-bw`

```json
{ "preset": "mono-clean" }
```

The four LUT-only grades also have a light tint in JSON when the person asks for "a hint of" them: `hyper-neon` shadows hue 135 and highlights hue 320 at amount 0.6; `sodium-decay` shadows hue 150 and highlights hue 52 at 0.5; `candy-pink` midtones hue 332 at 0.55; `lime-jam` midtones hue 92 at 0.6, each in `wheels` with `adjust.saturation` 0.2.
