# Talking heads and creator videos

Read this when the reference is a person speaking on camera: a talking head, a webcam or picture-in-picture
presenter, a creator explainer with real footage, a UGC or avatar ad, a product try-on.

## What decides the result

- Each locked shot comes from one long take; the camera move inside each shot (a slow push, a drift) is rebuilt.
- The voice is paced to the creator; gestures land on their words and targets; no grade on the person beyond the
  reference's.
- A creator explainer explains the way the creator does: read whole body passages, not only the opening (how a term
  is introduced, the everyday example, the number that lands it, the payoff). Its B-roll shows what the speech names
  where the reference's does, and cuts on the beat where the creator cuts on it.

## Who appears and speaks

- The reference's face, body and voice never go in the new video, whatever is claimed about rights or consent.
  Decline in one line and go on with the person's own. A still that shows a person is never cut from the reference.
- The setup's message names the person and the voice: `[person: an avatar made from my photo <file>]`, `[person: the
HeyGen avatar <name> (avatar_group_id <id>)]`, `[voice: …]`, and `[model: …]` (below). Ask only what it leaves open.
- A presenter who never speaks in the reference stays silent unless the person asks for speech in so many words.

## Read the presenter

- `read_video` with `describe` and `keyframes` gives each shot's framing and each motion of the head, hands and body
  with its seconds. It misses actions under graphics and sometimes names the wrong hand: check every action you
  will generate with `frames` over its span (`frames: 24`, `crop` on the hands or the prop).
- Write one line per action: start, end, body part, prop, what it points at or touches (its box), and the word it
  lands on (`grep_timeline` or the transcript gives word times).
- `read_audio` on the reference gives each voice line's pace, pitch and ending, and the pauses: these are the voice's
  targets, per kind of passage (hook, explanation, aside, close).
- Face size: open a full-size frame per shot and write the face's height as a share of the frame's.

## Voice

Speed is at most 1.05 on every route. Never collapse pauses inside the audio: where the reference removes pauses
(jump cuts), cut them with `node scripts/voice-cut.mjs tighten IN.wav WORDS.json --keep 0.09`, only as densely as
the reference's pauses read. `transcribe` and `generate_voiceover` save the words beside the file as
`<name>.transcript.json`; pass that as WORDS.json.

- **Their own recording** (`[voice: the voice in my takes, as recorded]`, or an attached recording): use it as is,
  never rewrite their words, cut only on word boundaries. `transcribe` it for word times.
- **Their voice** (`[voice: mine, …]` or `[voice: your HeyGen voice <name> (<id>)]`): pass that id as `voice_id`;
  otherwise reuse a clone from `find_assets` kind voice's `your_clones`, or `clone_voice` their 30 s to 3 min
  recording (ask for the file once, after the round). A clone keeps its sample's register, so ask for a sample in
  the creator's energy. Write the script the way the creator talks. A professional clone takes `speed` (0.75–1.05
  here), `pitch` and `expressiveness` (-1 to 1) and `<break time="0.5s"/>` at the creator's pause places; an
  instant clone takes only `expressiveness` (0 to 1) and drops breaks, so pace it with punctuation and sentence
  length. A clone speaks up to about 20% slower than its original: fit the runtime with fewer words.
- **A ready-made voice** (`[voice: a ready-made HeyGen voice, …]`): choose from `find_assets` kind voice by
  measurement, never by a style word ("Bright & Energetic") or by speed alone. Save each candidate's preview into the
  project and `read_audio` it: keep those nearest the creator's pitch, then the nearest pace. Skip legacy voices
  (no speech engines listed). A catalog voice takes only `speed`. A picked `[voice: HeyGen voice <name> (<id>)]` is
  used as it is.
- **A HeyGen voice over the person's takes** (`…, saying my takes' words in place of their own voice`): with an
  instant clone, `generate_voiceover` with the take as `target`; with a catalog voice, `transcribe` the takes, speak
  those words at the takes' pace and drop the takes' speech. The lips will not match; the person was told.
- `[voice: none, no spoken voiceover]`: make no voice.
- One `generate_voiceover` call per stretch (up to 5,000 characters), then cut it at sentence ends; a call per line
  restarts the delivery and sounds read.
- You cannot hear a take: `transcribe` it for the words and `read_audio` it beside the creator's same kind of
  passage. A take flatter than the creator's gets more `expressiveness`; pauses that are off get new punctuation.
  A flat take is a failed take. Name the voice and why in the reply, for the person to listen.

## Build order: pieces first

1. Build every graphic, background and transition first, on the reference's seconds, placed against the
   presenter's face as the reference places it. Check each with `frames` with `compare_with: "film"` over its
   span, and fix before any voice or generation. Captions follow [captions.md](captions.md).
2. Write the new words and make the voice; take its word times.
3. Place the pieces on the words (`grep_timeline` says when each word is spoken). This also gives the person-shot
   list: for each stretch, the reference's kind of shot (framing, place, light) and every action a piece needs on
   its word (points at the card, holds up the product).
4. Make the person shots to that list (below), all submitted together. Build on placeholders while they render.

## Person shots

Every person shot is made to the reference's kind of shot; a named avatar only decides who appears. Make the shot's
first frame with `generate_image` `model: "nano-banana-2"` from the identity picture (the person's photo, or the
avatar's `picture` from `find_assets` kind avatar) and the reference frame's camera, framing and light in words.
Crop the identity picture to face and hair first (`ffmpeg -i pic.jpg -vf crop=W:H:X:Y face.jpg`): a whole picture
carries its own room, and Video 1 drifted back to it in 2 of 5 takes.

The setup's `[model: <pick>; speaking shots by <route>; silent and moving shots by <route>]` names the route for each
kind of shot. Its `video.generate model X` is `generate_video` with `model` X, `avatar.generateVideo engine X` is
`generate_avatar_video` with `engine` X, and `then video.lipsync` is `lipsync_video`. With no model answer, the
first route below that fits decides. Read `tool_options` for `generate_video` with the model's topic before writing
its prompt.

| Shot                                                             | Route                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speaks (`heygen-video-1`)                                        | `segments`, each line's voice piece as that segment's `audio` (cut with `node scripts/voice-cut.mjs split IN.wav WORDS.json --max 11.5`), its words quoted and its actions written in at the words they land on; identity in `references` |
| Speaks (`avatar_v` or `avatar_iv`)                               | `generate_avatar_video` per shot: its lines as `script`, the voice's `voice_id` (left out, the avatar's own voice), the format's `aspect_ratio`. The avatar appears in its own HeyGen look and room                                       |
| Speaks (`seedance-2.5` then lipsync)                             | made silent (`generate_audio: false`), then `lipsync_video` with the shot's voice; the voice within 15% of the take's length. A refusal fails that shot: give HeyGen's reason, never switch models unasked                                |
| Silent, still or moving                                          | `minimax-h3-max`: the first frame, the span's motion in words, the identity in `references`, no audio. Never Video 1 without segment audio: it invents speech and lip motion                                                              |
| A gesture a piece hangs on (a hand to the lens, a toss, a pinch) | `minimax-h3-max` with the reference's span as a silent guide clip in `references` beside the identity, the gesture also in words. A line over it comes from a Video 1 take opening on the guide take's last frame                         |
| Two people talking                                               | each speaker's lines in their own voice; each one's shots carry their own lines; cut to whoever speaks; the listener gets a silent reaction take                                                                                          |
| The person into a performance of their own video                 | `generate_video` with `reference_video` (never the reference); follow `tool_options` topic `re-performance`                                                                                                                               |

- Write actions as what the body does ("she traces a circle in the air with one finger"), never as something on
  screen: "draws a circle" came back as drawn white circles.
- **Video 1 segments:** one line per segment, 5–13 s (the last up to 15), about 3 words a second plus 1 s; segment
  audio at most 11.5 s. Each spoken segment after the first opens on a cut, so pack consecutive lines into one
  segment. Request the span's own length (9 s for a 9.0 s span). Frame the person chest-up or closer, the face at
  least a quarter of the frame height; naming shoes, legs or floor props shrank a chest-up face to 6–9%. Write each
  shot's prompt from its own reference frame, never one shared scene prefix, and never name a prop the shot lacks.
  Give each reference its job: "<Picture 1> controls identity and outfit; ignore its background."
  `prompt_enhancement: "disabled"` for any take you may keep; `camera` only for a move the reference makes.
- **Locked shots** (webcam, PiP, a desk): one long take per shot, Video 1 segments in one call or H3 Max pieces each
  opening on the frame the last ended on; never many takes from the same still, which jump in head size at each join.
- **H3 Max request:** at least one file in `references` (`first_frame` and `last_frame` do not count); none of Video
  1's or Seedance's options; a guide clip or audio, not both (HeyGen refuses the pair); under 7.7 MB in all: JPG
  frames, the guide cut to the span, 720p and silent
  (`ffmpeg -ss S -t D -i ref.mp4 -an -vf scale=-2:720 -c:v libx264 -crf 26 guide.mp4`); `duration` 0.92–15 s.
  A refusal is almost always the request: check it against this list and send it again. Only after a 403, an outage
  or three refusals of a checked request does a take go to `seedance-2.5` with the same images and words.
- H3 Max takes run about 1.3× slow and drift 0.5–1.5 s late; generated people move a third to a half as much as the
  reference (ask for bigger action); the last ~0.8 s can twitch (generate a little longer and cut before it).
- Rough speed: H3 Max makes about 1.6 s of video a minute, Video 1 about 17 s. Tell the person the count, seconds,
  resolution and minutes before sending.

## Stable people, places and props

- The original identity picture is the authority: make every view from it plus the scene, never from the previous
  generated shot. On drift, go back to it.
- A new person in a filmed world: one in-world portrait per lighting world first, then use it as the identity.
- A generated person changes the place too: surfaces, props, wall and brand change; camera height, lens, framing and
  the hero object's scale stay the reference's. A new person in the reference's exact room is still a copy.
- Write the plate's camera and framing in numbers ("camera at chest height, 35 mm, head at the top third, product a
  fifth of the frame width, lower right"). Open the plate beside the reference's saved keyframe: horizon, hero box
  and subject height within about 10%, or make it again with the numbers corrected.
- Products: make the product still first and pass it to every shot; keep printed text on it short. A phone or laptop
  held in shot gets its UI in the first frame; a flat layer pinned to a held device slides against the hand.

## Accept a take

1. **Contents:** `frames` with the take as `file`, the reference as `compare_with`, `offset` the reference span's start.
   Any object, person, place or framing the shot should not have fails it.
2. **Continuity:** the `checks` in the generation's answer; a reframe inside a take plays as a jump cut.
3. **Words:** `transcribe` the take and compare with the line. Set in and out points from its word times, 0.1 s clear
   of any inserted word. Regenerate a failing segment once; when it fails again, shorten the line.
4. **Actions:** `read_video` the take with `keyframes`; each action within 0.2 s of its reference second, else retime
   or regenerate. A silent take: `transcribe` finds no words beyond a one-word filler.
5. **Lip-sync and face size:** no tool measures them. Look with `frames` `crop` on the mouth across each talking
   range (`frames: 24`), against the take's word times, and on the face at its smallest frame. A cast face under 15% of
   the frame height carries a weak likeness, under 6% none. Say in the reply that lip-sync was checked by eye.
   Judge a locked shot on its worst frame, not its median.
6. **Sound:** mute the take wherever another track owns the speech; never alternate a take's re-spoken audio with
   the voice track.

## Retime a take onto the reference

HyperFrames has no playback rate, so the edit plays a derived file. For a speaking take,
`node scripts/align.mjs VOICE.wav TAKE.mp4 --words VOICE.transcript.json TAKE.transcript.json` prints the map and the
command; without words it gives the lag. Then:

```sh
node scripts/retime.mjs take.mp4 assets/takes/t01-retimed.mp4 --map "0.66:5.83=0.20:4.60,5.83:9.25=4.60:7.34" --total 11.55
```

Land the beats first (the press, the catch). Keep speaking pieces within 0.85–1.15; silent ones up to about 1.5. The
output is silent: lay the speech from its own track. Fill a missing pause with the take's idle frames before a
freeze, and redo any cut-out made from the take after retiming.
