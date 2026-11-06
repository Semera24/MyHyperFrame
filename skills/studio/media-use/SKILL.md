---
name: media-use
description: Which of the app's tools makes or fixes each kind of media - footage, voice, avatars, images, music, sound effects, transcripts - remaking what is in the picture, and local grading, cutouts and mixing.
---

# Media in HyperFrames

Make media with the app's tools, never with another connected service or a local model unless the person names one. Each tool saves into `assets/` and returns the path; renders never fetch. Each tool's description holds its parameters and limits; read it.

## Which tool

| You need                                                                                                        | Tool                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A filmed-looking shot (a scene, a product, a person who is not an avatar)                                       | `video.generate` (HeyGen Video 1)                                                                                                                                                                                                                             |
| A directed shot: a named camera move, or a lighting, era or emotion look, or a model picked for what it renders | `shot.make`, after `references/shots.md`                                                                                                                                                                                                                      |
| A voiceover, with every word's timing                                                                           | `media.find` with kind voice, then `voice.generateVoiceover`                                                                                                                                                                                                  |
| The person's own voice                                                                                          | `voice.cloneVoice` from a recording of them, then `voice.generateVoiceover`; for a shot where they speak, make the line first and pass it to `video.generate`                                                                                                 |
| A recording re-spoken in their clone                                                                            | `voice.transcribeAudio` for its speakers, then `voice.generateVoiceover` with the recording or its clip as `target`                                                                                                                                           |
| A presenter speaking a script                                                                                   | `media.find` with kind avatar, then `avatar.generateVideo`                                                                                                                                                                                                    |
| An image                                                                                                        | `image.generate`; name a project image as reference to keep a product, person or place                                                                                                                                                                        |
| Music                                                                                                           | `media.find` with `kind: "music"`; `sound.generateMusic` only when asked for an original or nothing fits                                                                                                                                                      |
| A sound effect                                                                                                  | `media.find` with `kind: "sfx"`; land its hit on the moment, measured rather than guessed                                                                                                                                                                     |
| Words and timings from audio                                                                                    | `voice.transcribeAudio`                                                                                                                                                                                                                                       |
| A YouTube video or Short                                                                                        | `video.downloadFromLink`                                                                                                                                                                                                                                      |
| Something the person used before                                                                                | `media.library`, then `media.libraryImport`                                                                                                                                                                                                                   |
| Glitches in a clip you joined or cut (a generated, imported or background-removed one comes checked)            | `video.checkForGlitches` (free)                                                                                                                                                                                                                               |
| A cutout, a background removed, or an object erased from a picture                                              | `media.cutOut` (a picture or a video; no region keeps the people), `image.erase`; each answer shows the selection to check; correct a picture result using the same target and its returned correction reference as `corrects` (omit for an independent edit) |

Changing what is in an existing picture or clip (subjects, action, camera, lighting) means making it again: `references/regenerate.md`.

## Transcription

Use existing transcript or voiceover word timings first. When recognition is needed, call `voice.transcribeAudio` through Desktop on the audio or video file itself. Desktop uses HeyGen Scribe v2 with speaker labels. Keep `hf-media` transcription jobs on the app's supplied gateway. Do not read the key, replace the gateway URL or install a transcription model. An offline failure needs an internet connection; there is no local fallback.

## When there is no key or no credit

HeyGen media is paid with the key in Settings > HeyGen API key. When a tool answers that no key is saved, the key is not accepted or credits ran out:

- If the person asked for that media, the chat already shows it as a card. Say in one line what you couldn't make and what they can pick instead: their own HeyGen sign-in (voiceover or avatar only), their own HeyGen API key, or another service they name. Then stop and wait.
- If you chose to add it, finish without it and say in one line that a key would add it.
- If the answer says they already saw it in this chat, finish without it and say what was left out.
- Never say the key was rejected unless the answer says so.

## In the HTML

- Music carries `data-timeline-role="music"`.
- Trim and crop in the composition before making a new file: `data-media-start` picks where a clip starts in its source, `clip-path` crops. HEVC needs no conversion.

## On this machine

Grading, looks, cutouts, loudness, beats and transcript imports run as `hyperframes` commands: `references/local.md`. Levels, fades, envelopes, effect chains and group buses are attributes: `references/audio.md`.
