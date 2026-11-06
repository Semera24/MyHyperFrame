# Directed shots with shot.make

`shot.make` adds a measured sentence for a camera move and a look to your prompt. About 3 takes in 4 show the move, so make two or three of a shot that matters.

## Before you call it

- **One subject first.** The move's sentence calls the main person or thing the subject. With two people, describe the subject first.
- **Say the framing.** With the rewriter off nothing composes the shot for you.
- **Say what the shot is.** No model has a negative-prompt field: at most one short exclusion, such as no cuts.
- **Put weather and other things that must show first in the prompt.** Fog and rain only rendered once the prompt opened with them. Make small story details big, and say them twice.
- **Colour and texture are not looks.** Grade the clip in post: references/grades.md.

## Keeping a person or a thing

- Pass a neutral character sheet (plain grey background, facing the camera) in references and open the prompt with: `<Picture 1> is the main character: use ONLY the person's face, hair and clothes; not the place, not the lighting.`
- A picture of a whole scene with a walking person makes the camera follow them, even on static. A character sheet or no picture keeps it still.
- A prop's sheet overrules the words. To change the prop in a shot, drop its sheet and describe it.
- For the exact scene, use a still as first_frame. As a reference it is a looser guide.
- A look changes the picture, most for noir and contre-jour. A character sheet or first_frame holds it best.

## Moves that need something

- `tracking-side`, `handheld-follow`, `snorricam`: a subject that walks or runs.
- `rack-focus`, `probe-macro`, `reveal`: something in the foreground.
- `zoom-out`, `pull-back`: a close start, not a wide picture.
- `whip-pan`, `crash-zoom`: `camera_target` names where the whip lands or what the zoom closes on. For a crash-zoom it must be in view in the opening wide shot, and a small one (a hand, a prop) often arrives as a cut.
- `orbit`, `roll`: these cost the subject's action, so keep it simple.
- A pan keeps the subject in frame and reads close to an orbit. Give it a still subject and something strong beside it.

## Long takes

A camera move runs inside one take of at most 15 s. Stated distances and angles hold at 5 s. A longer take keeps moving but travels farther than its words say, an orbit or a pan well past its angle, so keep those short.

## Models

- `heygen-video-1`: a look rewrites less with a character sheet. A seed repeats a take exactly with the rewriter off.
- `minimax-h3-max`: needs a reference and holds that scene. Moves are gentle and looks subtle.
- `seedance-2.5`: holds a reference scene, moves gently. With no reference its looks are strong but it replaces the scene and the person. No seed.
