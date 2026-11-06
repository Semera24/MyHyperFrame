# ③ Generate and gather the media the remix needs

Keep exact text, captions, data and graphic motion in native code. Anything the reference films moving (a hand, a
body, a product being handled, a camera travelling through a real scene) is generated or recorded **video** driven by
the reference's own span, never a still moved by transforms. The
app's media tools ([SKILL.md](../SKILL.md#tools)) carry the HeyGen key, job recovery and Video 1's rules. Choose a route
for the required result, not for the price. Call `video.generate` directly: it goes out at once, with no cost question to
the person (the one exception is the 1080p question in [SKILL.md](../SKILL.md)'s budget step). Tell the person what it will make: generations, seconds, resolution and how long it
will take (H3 Max makes about 1.6 s of video a minute, Video 1 about 17 s: a 12 s H3 Max take is about 8 minutes).

**Submit every generation at once, then build while they render.** After G1.5, send every independent take
(a single `video.generate` clip, Video 1 or a third-party model) in the same message, so they render at the same
time. A call answers with the saved take, or with status rendering once HeyGen has taken it, already paid for: Desktop
then saves it into the project's assets and says so in the chat once it is ready. Build the edit, the captions and the
graphics on placeholders meanwhile and swap each take in as it lands; never send a take again. Chained takes stay in
order: a take whose first frame is cut from the previous take goes out once that take is in. Waiting on one
independent take before starting the next turns minutes into an hour.

`video.downloadFromLink` needs a signed-in person; ask the person to bring the file instead.

## Voice

Speech is HeyGen Voice 1, HeyGen's newest speech model. Whose voice speaks is the person's answer to the intake's
whose-voice question ([intake.md](intake.md#whose-voice)); each answer is one route below, with its own controls.
Speed is at most 1.05 on every route. HeyGen has no voice-conversion (speech-to-speech) route, so the creator's exact
intonation in the person's voice is not offered: a route matches the creator's pace and pauses, and a professional
clone also the pitch movement.

- **1. Their own recording of the script:** use it as is and never rewrite their words. The edit follows its timing:
  `voice.transcribeAudio` it for word times, cut only on word boundaries, cut breaths and pauses at the pause density
  measured in the reference (`vc voice tighten`), and
  speed the whole at most 1.05. The presenter's mouth follows this audio through
  Video 1 alone: `vc voice split rec.wav rec.json --max 11.5` cuts it at sentence ends, and each piece goes as a segment's
  `audio` with the presenter's picture in `references`, then drop the take's own sound and lay their recording under
  it. Accept a take by `hf-media evidence av-sync --mouth-roi …` against the recording.
- **2. Their voice, reading a new script in the creator's rhythm:** clone their 30 s to 3 min upload with
  `voice.cloneVoice` (instant; professional when they give enough audio), wait for `ACTIVE`, and reuse a clone of
  theirs from `media.find` kind voice's `your_clones` before making another. A `[voice: your HeyGen voice <name> (<id>)]` in
  the message is that clone, picked or made in the setup: pass that id as `voice`, and ask for no recording. Write the
  script the way the creator talks (`voice.md`), then pace it toward the creator:
  a professional clone takes `speed` (0.75–1.05 here), `expressiveness` (its pitch movement, -1 to 1, 0 its own) and
  `<break time="0.5s"/>` at the creator's pause places and lengths; an instant clone takes only `expressiveness` (0–1, never flatter)
  and drops break tags,
  so pace it with punctuation and sentence length.
  Compare each stretch with `node scripts/prosody.mjs REF_PASSAGE --compare TAKE` against the creator's same kind of
  passage and redo what falls outside the targets. A clone keeps the register of its sample, so ask for a sample in
  the creator's energy (a rapid tool verdict, not a slow motivational read).
- **3. The avatar's own voice:** its catalog voice through `voice.generateVoiceover` (on HeyGen Voice 1 when it has it) takes
  `speed` per call and `<break time="0.5s"/>` in the text: match the creator's words per minute and their pause
  places and lengths. Its intonation and energy stay the voice's own. A `[voice: HeyGen voice <name> (<id>)]` in the
  message is the person's pick from `media.find` kind voice's `stock_voices`: pass that id as `voice`, a HeyGen Voice 1
  voice paced as route 2 paces a clone of its `mode`, and measure nothing. With no avatar and no pick, choose the catalog voice by
  measurement: download each candidate's `preview_audio_url` and run
  `node scripts/prosody.mjs REF_VOCALS --compare preview.mp3`; keep candidates within 2 semitones of the reference's
  median pitch and the closest pitch range, then the closest words per minute. Never choose by a style word ("Bright &
  Energetic") or by speed alone; record the numbers; avoid legacy voices (old presets with no engines).
- **One take per stretch:** synthesize each stretch of the script (a section, up to 5,000 characters) in one
  `voice.generateVoiceover` call, then cut it into the pieces the edit needs at sentence ends with `vc voice split`. A call per line restarts the delivery every line and sounds read.
- **Delivery is measured, not imagined:** `voice.md` holds the reference speaker's prosody per kind of passage (pitch
  range, pitch movement, rising phrase ends, pauses per minute and their length). Run `prosody.mjs` on the take
  against the same kind of passage; for a clone, raise `expressiveness` when the range or movement comes out
  under about 0.8 of the reference's, and rewrite punctuation and sentence length when pauses are off. A flat take is
  a failed take, not an approximation.
- **Audition:** you cannot hear a take. Transcribe it and check words, pace and pauses against `voice.md`, run
  `prosody.mjs`, and list the voice, its numbers and its reason in `RESULT.md` for the person to hear.
- **Pace with the script, not the audio:** speed at most 1.05, and never collapse pauses inside the audio; a sped-up,
  gap-trimmed take sounds rushed and robotic. When the reference's edit removes pauses (jump cuts), remove them with
  cuts (`vc voice tighten`), at the pause density measured in the reference. A clone can speak up to about 20% slower than its original; fit the
  runtime by writing fewer words. One call takes up to 5,000 characters; split longer scripts at sentence ends.
- **Timing:** `voice.generateVoiceover` returns each word's start and end. When it returns none, `voice.transcribeAudio` the file
  before binding captions.

## Speaking footage

**Every person shot is made to the reference's kind of shot; a named avatar only decides who appears.** A
reference frame of that kind of shot fixes the place, framing, light and pose, `editing.md`'s person-shot rules and
its span fix the action and the camera, and the avatar's
picture from `media.find` with kind avatar fixes the face. Make the shot's first frame with `nano-banana-2` from the avatar's picture
and the reference frame's camera, framing and light in words ([plates](#stable-people-places-and-props)), then
generate from it. A shot that speaks goes to Video 1 segments carrying the new lines as `audio`, with its
actions written into each segment's prompt, however much it moves; a silent shot goes to H3 Max with the span's
motion in words. A silent shot never goes to Video 1 without segment audio, which invents speech and lip motion.
Crop the avatar's picture to face and hair before it goes into `references`: a whole picture carries its own room,
and Video 1 drifted back to it in 2 of 5 takes. Write actions as what the body does ("she traces a circle in the air
with one finger"), never as something on screen: "draws a circle" came back as drawn white circles. Take each shot's
actions from the beats in its span in `templates/<slug>/reference/gemini-perform.json` (hands, body, head and face,
object, camera, with the words they land on), each beat checked on frames first ([watch.md](watch.md#the-loop)
step 5): write them into each Video 1 segment's prompt at the words they land on, and into the H3 Max motion
description. A named avatar's shots are always made this way, never from its own HeyGen avatar clip, unless the setup
picked an avatar engine (below). A presenter who never speaks in the reference stays silent unless the
person asks for speech in so many words.

**The setup's model answer names the model for each of the person's shots.**
`[model: <pick>; speaking shots by <route>; silent and moving shots by <route>]` replaces the model in the rows below:
a shot that speaks goes by its speaking route, a silent or moving one by the other, and each row's first frame,
actions in words and acceptance still hold. `video.generate model heygen-video-1` for a speaking shot is the Video 1
segments row; `video.generate model minimax-h3-max` for a speaking shot carries our speech in `references` (the H3 Max
row); `video.generate model seedance-2.5` takes the same images as `references` and the motion in words, with no exact
frames and no audio (4–30 s), and always `generate_audio: false`: Seedance makes its own soundtrack unless told
not to, and none of it belongs under our voice or the reference's sound. A speaking shot whose route is `video.generate model seedance-2.5 then video.lipsync` is made silent that way, with the shot's lines spoken by `voice.generateVoiceover` first; then `video.lipsync` with the take as `video` and that voice as `audio` (speed mode) puts the words on its lips. The voice must be within 15% of the take's length, so retime the voice or ask Seedance for the span's length. A lipsync refusal fails that shot: say HeyGen's reason in the reply and never send the shot to another model unasked. With no model answer, the rows decide.

**An avatar engine answer makes the avatar's speaking shots in its own HeyGen look.** When the answer's speaking route
is `avatar.generateVideo engine avatar_v` or `avatar.generateVideo engine avatar_iv`, each shot where the avatar
speaks goes to `avatar.generateVideo` with that `engine`, the shot's new lines as `script`, the voice answer's
`voice_id` and the format's `aspect_ratio`: one take per speaking shot, so every cut lands where the reference's does,
and every shot's lines in one call with `script` a list, since separate calls are made one after another.
The take shows the avatar in its own HeyGen look and room; the reference's place, framing and gestures do not carry
into these shots, which the person chose with the engine. Accept it by its words and retime it onto its span
([retime](#retime-a-take-onto-the-reference)). The avatar's silent and moving shots go by the answer's other route:
the first frame, then H3 Max.

| Need                                                                                                                           | Route                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A presenter or creator in a scene speaking our lines                                                                           | `voice.generateVoiceover` per stretch, cut into pieces of at most 11.5 s (`vc voice split`), then `video.generate` with `segments`, each carrying its piece as `audio` and the person's photo in `references`.                                                                                                                                                                                                                                                                    |
| A shot of a named HeyGen avatar that **speaks**, when the setup picked an avatar engine                                        | `avatar.generateVideo` with that `engine`, the shot's lines as `script`, the voice answer's `voice_id` and the format's `aspect_ratio`, one take per shot, all shots in one call (above). Accept by its words; its silent shots go by the silent row                                                                                                                                                                                                                              |
| A shot of a named avatar that **speaks**, moving or not, in any place, framing or camera                                       | the first frame made from the avatar's picture (above), then Video 1 `segments` with each new line as `audio` and the reference shot's actions written into that segment's prompt. Accept by its words and by `motion-energy.mjs` against the reference span (peak and mean ratios 0.7–1.4). When the motion still fails after one retry: H3 Max with our speech in `references` and the motion described in words; a gesture a piece hangs on goes by the gesture row below      |
| A shot of a named avatar that is **silent**, still or moving                                                                   | the same first frame, then H3 Max with the span's motion described in words and no audio, and the first frame file also in `references` (H3 Max needs one; `first_frame` does not count); the take's own sound is dropped. Accept by `motion-energy.mjs` against the span (r ≥ 0.8) and by its mouth: the same script on a box around the mouth reads no more than about 1.4× the reference's, and a transcription of the take finds no words beyond a one-word filler on silence |
| A body that moves a lot, a take that must open on an exact frame, a footage reel (try-on, a hand on a mouse, a toss and catch) | `video.generate` with `model: "minimax-h3-max"`: `first_frame` is the exact first frame, the span's motion described in the prompt, the identity and, when it speaks, our speech in `references`, `last_frame` when the next piece is fixed; 0.92–15 s                                                                                                                                                                                                                            |
| A gesture a piece hangs on (a hand to the lens, a grab and a toss, a pinch, a wipe)                                            | `video.generate` with `model: "minimax-h3-max"`: `first_frame` our first frame, the reference's span cut silent (below) and the identity in `references`, the gesture also in words; no audio in `references` (refused beside a guide). A line spoken over the gesture comes from a Video 1 take opening on the guided take's last frame. Accept by the gesture's frames ([checks.md](checks.md) targeted actions) before any piece goes over it                                  |
| H3 Max refused                                                                                                                 | A refusal is almost always the request: check it against [the H3 Max request](#the-h3-max-request) and send it again to H3 Max. Only after a 403, an outage or three identical refusals of a checked request, a take that starts on a hard cut goes to `seedance-2.5` with the **same** images and motion words (4–30 s, no exact frames, `generate_audio: false`); a still moved by transforms never replaces it                                                                 |
| Two or more people in conversation (a podcast clip, an interview)                                                              | each speaker's lines from their own voice with `voice.generateVoiceover`; each person's shots with `video.generate` segments carrying their own lines; cut to whoever speaks, and give the listener a silent reaction take                                                                                                                                                                                                                                                        |
| Put the person into a performance of their own video                                                                           | Never the reference (the app refuses it): `video.generate` with `reference_video` (and `reference_start`), three or four photos as `references` and `person`; follow its plan and `reperform_job` flow                                                                                                                                                                                                                                                                            |

**Video 1 speaks our voice only through segment audio.** Without it, Video 1 invents its own voice, garbles words and
times mouth and gestures to that. With `segments[].audio` it re-speaks our line in that voice with matching lips.
Because it re-speaks the line, a take can still insert, repeat or trail words, so accept every take by its words
([below](#accept-a-take)). There is no separate lip-sync pass.

- One line per segment, 5–13 s (the last up to 15), sized at about 3 words a second plus 1 s; quote the line in the
  segment's prompt; segment audio at most 11.5 s. Each spoken segment after the first opens on a cut to a new angle, so
  pack consecutive lines into one segment's audio for fewer cuts.
- Request the length of the span the take covers (9 s for a 9.0 s span, not 10); a longer request stretches lines and
  actions late.
- Frame a cast person chest-up or closer, the face at least a quarter of the frame height; a smaller face drifts at
  every join. Framing words alone do not set the size: naming shoes, legs or floor-level props shrinks a chest-up face
  to 6–9%. Describe only what the framing shows.
- Write each shot's prompt from that shot's reference frame; never prefix one shared scene description to every shot,
  because the model adds whatever the text names. Never name a prop the shot should not contain.
- Give each reference its job in the prompt: "<Picture 1> controls identity and outfit; ignore its background.
  <Picture 2> controls the place and light. One scene, no collage, no captions."
- One place and one continuous camera per long clip; `camera` (Video 1 only) takes only the measured moves (dolly-in,
  pull-back, orbit, crane-up, static, crash-zoom).
- Pass `prompt_enhancement: "disabled"` (Video 1 only) for any take you may keep; a single clip otherwise defaults to
  the rewriter.
  Every result reports its seed. `finish_2k` replays a pick sharper, for takes the edit shows large; a 2k replay drops
  about two leading frames, so re-check the in point.

### The H3 Max request

H3 Max is the route whenever the reference films motion the remix must match: a hand typing or pointing, a body
turning, a product handled, a catch, a run. It follows the motion the prompt describes and opens on your exact frame. The app
refuses a malformed request before paying, naming the field and what it takes; check these before sending:

- **At least one reference** in `references` (a picture, a video or audio); `first_frame` and `last_frame` do not
  count. Always pass the identity or product still in `references`. When `first_frame` is a plate made from the
  person's photo, that plate is their identity still: pass it alone, not the photo or a crop of it, since a crop still
  carries the photo's background. On 2026-10-29, of 8 talking takes with a crop beside the plate, 2 grew a second
  person behind the presenter and 1 drifted to another room, all three 12 s or longer; 0 of 2 with the plate alone.
- **None of the other models' options:** no `camera`, `prompt_enhancement`, `segments`, `continue_from` or `finish_2k`
  (Video 1), no `generate_audio` (Seedance).
- **A guide clip or our audio, not both:** HeyGen refuses a request that carries a guide video and audio in
  `references` together with "Could not read the duration of reference_videos[0]" (tested 2026-10-13: either one
  alone passes, any file). A guide clip is the person's own footage or a span of the reference, always silent (the
  app sends a guide's picture alone): the take follows its motion, and `references` set who is in it. For a take
  that must speak our line with matching lips, send our audio in `references` and describe the motion, or make the speaking take with Video 1 segments.
  Seedance takes no `first_frame`, `last_frame` or audio references at all.
- **Under 7.7 MB in total,** since every file is sent inside the request: frames and stills as JPG (not PNG), the
  guide clip trimmed to the span (at most 15 s), 720p and silent (`ffmpeg -ss S -t D -i take.mp4 -an -vf
scale=-2:720 -c:v libx264 -crf 26 guide.mp4`).
- `duration` 0.92–15 s. Leave `resolution` out (768p); send 1080p only when the person asks for it or picks it at the
  budget step.

```json
{
  "model": "minimax-h3-max",
  "prompt": "Top-down table. <Picture 1> controls the hands and sleeves only. The hands type on the table surface in two quick bursts, 0-3 s and 4-7 s, the right hand reaching for the trackpad at 3.2 s; a sheet slides in from the top edge at 2.1 s. No floating graphics, no text, no keyboard drawn on the table.",
  "first_frame": "assets/plates/plate-first.jpg",
  "last_frame": "assets/plates/plate-last.jpg",
  "references": ["assets/identity/hands.jpg"],
  "duration": 8,
  "aspect_ratio": "9:16"
}
```

- Write the motion from the span's beats: what moves, which way, how far and at which second
  (`gemini-perform.json`, checked on frames), then accept the take by `motion-energy.mjs` against the span, measured
  here. Say in the prompt that floating graphics are not part of the scene.
- Takes often run about 1.3× slow, drift 0.5–1.5 s late and can shift the audio by about a second; a stricter prompt
  does not fix it. Measure, then retime ([below](#retime-a-take-onto-the-reference)).
- Generated people move a third to a half as much as the reference: ask for bigger action in the prompt.
- The last ~0.8 s of a take can twitch: generate a little longer and cut before it. A job left `pending` much longer
  than its siblings can be retried with the reference trimmed to 3 s or less.

## Accept a take

A finished generation is not yet a usable shot. Check the range the edit will use:

1. **Contents:** `node scripts/vc.mjs compare REF TAKE --map refT=takeT,…` at about 2 FPS: one sheet of the take
   beside the shot's reference frames. Any object, person, place or framing the still lacks fails the take, and so does
   a prop that changes shape, color or label. When only its end fails, keep the clean span and make just the rest: a
   new take that opens on the last clean frame (`first_frame`) at a pause between words, not the whole take again.
   Only H3 Max and Video 1 take `first_frame`, so pick a pause early enough that the rest is at least the model's
   shortest take (H3 Max 0.92 s, Video 1 5 s). Seedance takes no exact frame: there, remake the whole shot on Seedance,
   and move it to another model only when the person agrees.
2. **Continuity:** the `checks` in the generation's answer (continuity jumps and flicker); a reframe or internal cut
   plays as a jump cut.
3. **Words:** `voice.transcribeAudio` the take and compare it with the line (`hf-media evidence word-drift` for timing).
   Set the in and out points from the take's own word times, about 0.1 s clear of the nearest unwanted word, so no
   inserted or skipped word falls inside the used range. When the line must stay whole, regenerate that segment once
   with its audio; when it fails again, shorten the line.
4. **Actions and timing:** each listed action at its time; drift over 0.2 s is retimed or regenerated.
5. **Lip-sync:** `hf-media evidence av-sync take.mp4 --mouth-roi x,y,w,h` on the talking range. A picture more than
   45 ms late or 125 ms early is a defect. (The answer's `av_offset` only reports how much later the picture stream
   starts.) Watch and listen when the host can play media; otherwise record lip-sync as measured only.
6. **Face size:** `hf-media evidence face-size take.mp4 --cast`. A cast face under 15% of the frame height carries a
   weak likeness, under 6% none. Below 15% at a join, make the next piece from the original identity references, not
   from the previous frame.
7. **Sound:** a take always carries its own sound. Mute it wherever another track owns the speech, so no generated
   dialogue or music leaks into the mix; never alternate a take's re-spoken audio with the TTS track in one film. When sound is the content (ASMR, foley-led reels), the take's own synced sound
   may be the source: check it lands on every action.

Record which takes passed, and what still differs, in `frame.md`.

## Retime a take onto the reference

HyperFrames has no playback-rate attribute, so the edit plays a derived file:

```sh
node scripts/retime.mjs take.mp4 media/runner.mp4 --map "0.66:5.83=0.20:4.60,5.83:9.25=4.60:7.34" --total 11.55
```

Each piece maps a take span onto a reference span at constant speed. Land the reference's beats first (the press, the
catch, the swap). For a speaking take, `node scripts/vc.mjs align VOICE.wav TAKE.mp4 --words voice.json take.json`
prints the map from the take's words and the command; without words it gives the lag. Without speech, rates up to about 1.5 work while the motion does not read as fast-forward; keep
speaking ranges within 0.85–1.15. The output is silent: lay the speech from its own track. Record every piece's rate in
`frame.md`. Fill a missing pause with the take's own idle frames before resorting to a freeze, and redo any cut-out
made from the take after retiming.

## Stable people, places and props

- **Identity:** the original identity image is the authority. Make every view with `image.generate` from it plus the
  scene reference, never from the previous generated shot alone. A compact sheet (front full body, three-quarter, face
  close-up) helps when several shots need the same face and wardrobe. On drift, return to the originals.
- **A new person in a filmed world:** first make one in-world portrait per lighting world (edit the identity photo with
  that world's light written in words), then use that portrait as the identity reference. Check each still for
  a pasted look (light direction, color temperature, grain, head size against neighbours) before generating a take; a
  take copies whatever the still gets wrong.
- **Plates are made to the reference frame, never from it.** Make each shot's first frame with `image.generate`,
  `model: "nano-banana-2"`, `references` [the identity, the product], and the frame's camera height, lens, framing,
  light and the hero object's size and position written in numbers ("camera at chest height, 35 mm, subject's head
  at the top third, product a fifth of the frame width, lower right"). Name the remix's own products, dishes and
  props, since a lookalike of the reference's is a copy. Lay the plate over the reference frame (50% opacity) on this
  computer before generating any video: the horizon, the hero object's box and the subject's height within about
  10%; a plate that misses is made again with the numbers corrected.
- **A generated person changes the place too:** the person, the surfaces, props, wall and brand change; the camera geometry,
  lens, framing and the hero object's scale stay the reference's, because they are the format. A new person in the
  reference's exact street or room is still a copy.
- **Products and garments:** make the product still first and pass it to every shot. Printed words smear when the
  object tumbles: keep printed text short, or composite the mark natively.
- **A screen held in the shot** (phone, laptop) belongs to the footage: put the target UI into the take's first frame
  and generate from it. A flat layer pinned to a held device slides against the hand.
- **Cut-outs:** `media.cutOut`; check every matte on a contact sheet.

## Boundaries in trick reels

List every place where one generated piece meets another, and every change in a still room, with its reference frame
and kind. Build each kind one way:

| Reference boundary                                                            | Build                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hard cut to a new shot                                                        | Independent shots                                                                                                                                                                                                           |
| A later take of one continuous shot, or a body that moves a lot               | H3 Max with `first_frame` set to the exact frame the edit cuts on. Measure the join with `hf-media evidence join-timing REF DRAFT --at T`; beyond about 3 source frames the jump is visible                                 |
| Locked camera, same place                                                     | One plate (generated or the person's own) supplies every still pixel; generated **video** supplies the moving subject, cut out with `media.cutOut` and laid over it. A still cut-out slid along a path is not a moving hand |
| A change hidden behind an occluder (a blade, a passer-by, a door, a whip pan) | A hard cut on the frame where the occluder covers both subjects. Never a wipe that follows the occluder's edge: it shows both at once                                                                                       |

Align each generated subject to the reference subject's position, scale and axis for its whole span, as a native
transform; joins and occlusions line up only when the bodies do.

**The same rules hold for every locked shot, not only trick reels:** a webcam or picture-in-picture presenter, a
locked desk shot, a continuous take. Make each locked shot from one long take (Video 1 segments chained in one call,
or H3 Max pieces opening on the exact frame the last ended on), never from many independent takes started from the same
still: those jump in framing and head size at every join. Accept such a take on its **worst** sampled frame (face
size, framing, what is in shot), not its median.

**Camera moves are part of the look.** Rebuild every camera move `watch.md` measured inside a shot (a slow push from
1.00 to 1.12 over 4 s, a drift, an orbit) with the same zoom, duration and easing: as a native transform on the shot
when the move is a zoom or pan of a flat picture, or in the take (`camera` on Video 1, the move in words on H3 Max) when
the view must change. A hard cut where the reference pushes in, or a still where it drifts, fails G2.

## Footage

Footage does the job the footage log records. When the reference's B-roll shows what the speech names, a generic scene
under a line about a specific event is a stand-in; when its B-roll sets a mood, match the mood and the kind.

1. **Shot list first.** One line per B-roll shot: what it plays under, the exact subject (event, person, place,
   document, year), the kind and era the template's footage rules call for, and the treatment.
2. **Search the most specific sources first**, several queries per shot (the subject's name in its own language and in
   English, the year, the venue):
   - News, press conferences and documentaries on video sites and broadcaster or institution channels; download only
     the span you need: `yt-dlp --download-sections "*START-END" -f "bv*[height<=1080]+ba/b" URL` (when the installed `yt-dlp` fails,
     `uvx --python 3.12 yt-dlp`).
   - Archives: Internet Archive (newsreels, documentaries, public-domain film), Wikimedia Commons categories and
     videos, government and institutional media libraries.
   - Photos: news and archive photos, Wikimedia Commons, and the HeyGen image library
     (`npx hyperframes media-use resolve --type image --intent "…" --project .`).
   - Stock video sites for generic scenes (a skyline, hands at work, a crowd).
   - Generate with `video.generate` only a generic scene no source has. Never generate a real person or a real event:
     find their real footage.
   - **Generated shots come from the reference's look, not from imagination:** give each generated shot the reference
     shot it stands for (a JPG frame) or the template's world still as an image reference, and describe its light,
     lens, palette and texture from `editing.md`. Keep one world across the film where the reference keeps one (the
     same dark space, the same studio); ten text-only prompts make ten unrelated worlds.
   - **Hero CG that moves in the reference moves in ours:** design the hero still with `image.generate`, then make it
     move with `video.generate` from that still (orbit, push, the object turning). A still with a 7% zoom stands in for
     a turning 3D object only when nothing else works, and is then a recorded stand-in.
3. **Choose on a contact sheet:** frames of the candidates beside the reference's footage-log rows for that segment
   (kind, era, look). Take the candidate that does that footage's job best.
4. **No filler repeats:** one clip at most twice in a film, never the same span twice.
5. **Record each file's source page** in `frame.md`; the reference's own footage never ships.

**Sourcing never holds up the build.** A subagent or batch fetching footage or photos runs beside the main work, never
in front of it: put a placeholder in each slot, a labelled solid at its box and never a frame of the reference (the
reference's own footage never ships, and a placeholder can outlive the draft), go on with G0.5, the script and paid
generation, and swap each file in as it lands. Take about three candidates per slot, only for slots the cut uses; a
slot still empty when the draft renders keeps its labelled solid and is a stand-in in `RESULT.md`.

**HyperFrames Studio may be rebuilt instead of recorded.** The app locks its Studio pane while you work, so a
recording is not required: rebuild Studio's screens as native layers from its real layout. Measure the panels, type
and colors from a real Studio screenshot (the app window, or the product shots on hyperframes.dev), fill them with
this film's own scenes, layers and timeline, and draw the cursor and hovers at the reference's UI event rate. A
recording the person brings, or one of `hyperframes preview` on a scratch project, is used when there is one.

For other software, record real use: run the product (for the HyperFrames CLI, `hyperframes preview` on a scratch
project) and record it with a headless-browser screencast or a terminal session, a live edit included. Script the recording to the
reference's UI event rate (the footage log's clicks, hovers, menus and page changes per minute) with the cursor drawn
and hover states visible; a headless recording with no cursor and four scrolls a minute is not a walkthrough. Where the reference shows
product use, a website screenshot is not product footage. A third-party product behind a sign-in: its vendor's public demo videos, or ask the person to record
it. Real data for charts comes from its publisher (a statistics office, an international body, a company report), cited on screen
the way the reference cites. Real colleagues in the person's own films appear only when the person's answers say so.

## Look and treatment

Give every shot the treatment the template records for its kind of footage, so the film reads as one channel: only the
treatments the reference uses (grade, black and white, blur and darkening behind graphics, grain, vignette, texture),
with `npx hyperframes media-treatment` for grades, LUTs and grain, or CSS filters. Measure each kind of segment with
`node scripts/look-stats.mjs --compare ref.mp4 REF_START export.mp4 START SECONDS`, and a person separately with
`--roi` on the person in both. The numbers guide the grade; they never override what you see: **never desaturate,
darken or brighten a person beyond the reference person's own region**, and never add grain, blur or texture the
reference does not have. A grade that leaves skin grey is a defect even when the whole-frame numbers match.

## Hero scenes

Rebuild each hero scene the template lists as a layered native scene around the remix's own subject, never as one
generated picture with text baked in:

- **Real people and places:** real photos or frames, cut out with `media.cutOut`.
- **Illustrated elements** (a board game, a cartoon, a parody card, a prop): `image.generate` in the template's
  recorded art style, about the new subject, on a plain background for cutting out; no text in the image.
- **Type, rings, badges, glow and texture:** native layers (CSS, SVG `textPath` for rings, gradients and shadows for
  bevel and stone), so every word stays editable.
- **Rendered 3D** (a drill down a shaft, a cutaway block, a globe, objects with depth of field): a Three.js layer
  by the `three` adapter (`hyperframes-animation`, `adapters/three.md`), its camera path, lens and lighting matched to
  the reference span (`hf-media evidence flow-track` for the camera's moves), materials, particles and depth of field
  read from full-size frames. A subject the scene cannot carry convincingly (water, ice close up, creatures, anything
  photoreal and organic) is generated video with the span's motion in words instead. Labels stay DOM over the canvas.
- **Motion:** the template entry's path; the scene's entry and exit get a motion window like any recurring type.

## Motion-graphics films: rebuild, then remix

A film whose content is its motion (a product launch, a UI promo, an animated explainer) is rebuilt 1:1 before any
content changes. Swapping in new words and UI while rebuilding drifts off the reference's beats: on one launch film
the direct remix left an empty frame at a click and cut to black early, while rebuild-then-remix kept every beat.

### How much to rebuild

A rebuild is what makes the remix look like the reference, and it costs time in proportion to what it covers (one
141 s film took 78 minutes by sections). Choose its scope; nobody is asked:

- **The whole film** when it is short (about 90 s or less) or its structure is its content (a launch, a UI promo):
  every scene carries over with new content, so every scene is rebuilt. Past about 90 s, by sections
  ([below](#build-a-long-film-by-section)).
- **A stretch, its hero scenes and its pieces** when it runs long and its scenes are drawn for its own topic (an
  animated explainer of several minutes): rebuild on the reference's clock one representative stretch of about
  20–30 s that shows how its elements compose, hand off and transition (the cold open and hook, plus a body passage
  when the body works differently), every hero scene ([hero scenes](#hero-scenes)), and every recurring type as a
  piece ([template.md](template.md#components-rebuilt-and-scored-one-at-a-time)). The rest of the remix is built from
  these by the template's rules, never from scenes nobody rebuilt.
- **The pieces alone** over a presenter ([below](#talking-heads-and-creator-videos-pieces-first-then-the-new-film)).

Between these, weigh the length, how much carries over and where the likeness lives (one hero scene a film is
remembered for is rebuilt whatever the scope). Write the scope and why in `RESULT.md`.

0. **The skeleton, right after the answers.** Before measuring or any paid generation, write the project's
   `index.html` as the film's skeleton: the remix's canvas and length, one slot per scene on the reference's clock
   from intake's slots, each a placeholder card in the brand kit's color (the app's neutral grey with no kit) showing
   the scene's number and length and a quiet label, "Scene 3 is being made". Never a reference frame, not even as a
   placeholder: a stopped run must not leave the person someone else's film. The preview plays the film's structure
   within minutes of the answers, where it stayed empty for about 20. Each placeholder goes when its scene lands, and
   G2 fails while one is left.
1. **The reference's soundtrack is the clock.** Put its voiceover and music under the rebuild and time every scene to
   them; length and sound then line up by construction. The remix replaces them by the voice and music rules above.
2. **One scene at a time: rebuild, score, remix, mount**, in film order, at the reference's canvas and frame rate.
   Plan only the scene in hand: one plan for the whole film before its first file kept the preview empty while it was
   thought through (315 s on a 12 s film). For each scene:
   - rebuild it in `templates/<slug>/`. Every move takes its ease, duration and overshoot from `motion-curve.mjs` on
     its window ([watch.md](watch.md#dynamic-graphics-inspect-the-path)); a spring eyeballed as `power2.out` is the
     commonest miss. Morphs keep the reference's handoffs: the element that becomes the next one is one element, not
     a cut between two;
   - score it on its window against the reference with `hyperframes snapshot --against`, in rounds
     ([checks.md](checks.md#rounds-not-edits));
   - copy it into the project's `compositions/` with the person's content from the remix's data file (step 6) and
     mount it in its slot in place of the placeholder; then the next scene.

   Start the paid generations once the scenes that need them are known, and build the scenes that need none while
   they are made.

3. **Stills** follow the Stills answer. A: cut each photo, product shot, map, icon and cover from the reference's
   largest clean frame and place it as is, any text or UI on it rebuilt as native layers, never by an image edit; a
   cover that flashes for half a second is cut too, never left as a dark placeholder. Generate only what the reference
   never shows clean (footage with burned-in captions).
4. **Fonts** ([watch.md](watch.md#the-loop) step 8): for a brand, take its fonts and colors with
   app.capture when it is offered, otherwise `npx hyperframes capture URL`; otherwise match by
   `ink-scan.mjs` and record the stand-in.
5. **G2 on one clock once every scene is mounted**: the rebuild against the reference, the core plus SSIM over what
   was rebuilt, the whole film or the stretch, and the mounted film with no placeholder left
   ([checks.md](checks.md#g2-the-draft-before-the-final-render)). One fix round, then stop and report what is left.
6. **The remix** is the project itself, filled scene by scene in step 2: each scene a copy of its rebuild in
   `templates/<slug>/` with the remix's own data file
   ([template.md](template.md#motion-graphics-films-the-rebuild-is-the-template)): new copy, UI, data, the brand
   kit's logo and colors, checked in rounds ([checks.md](checks.md#rounds-not-edits)). Every move keeps the ease,
   duration, overshoot and offset from its trigger that the rebuild scored; what moves is the trigger:
   - **Music-led** (little or no speech; cuts and moves on the music): the reference's clock stays. New copy fits its
     slots, and `hf-media review` against the rebuild on one clock shows every beat on the same frame.
   - **Speech-led:** the new voiceover is the clock. Each beat re-anchors on the new word that does its job (the
     number as it is said, the product as it is named) from the voiceover's word times; scenes lengthen or shorten
     in their holds, never by changing a move's speed. Check each move at its new time with
     `motion-curve.mjs REF T S ROI --compare DRAFT T2`.

   Decide which a film is before the first scene is mounted, or decide per section when it changes partway.

## Talking heads and creator videos: pieces first, then the new film

A creator video remixed with another person or new words is not rebuilt as a whole film: its people and words are
replaced anyway. Its avatar-independent pieces are rebuilt and scored one at a time, then the new film is built
from them.

1. **Pieces first** ([template.md](template.md#components-rebuilt-and-scored-one-at-a-time)): every graphic,
   background and transition built as a block (captions are not pieces: they follow the caption rule and G2 checks
   them), placed 1:1 over the reference's own footage on its clock and
   scored in its box (G0.5). No script, voice or paid generation starts before every piece is scored with no problem left, or scored again as v1 after its one fix round with every build difference it keeps named, and no piece still where the reference moves. In the new film a
   piece keeps the motion it scored: content that moves in the reference (footage in a card, an animation, a scroll)
   is moving content of the person's (a clip, a recording, a layered animation), never a still.
2. **New words and voice:** the script from `voice.md`, speech per the voice rules above, and its word times.
3. **Place the pieces on the words** by `editing.md`'s triggers. This also yields the person-shot list: for each
   stretch, the framing and place from `editing.md`'s person-shot rules and every action a piece needs on its word
   (points at the card, holds up the product).
4. **Make the person shots to that list** ([speaking footage](#speaking-footage)): the avatar's picture for the face,
   the framing, place and light of that kind of shot in words, the actions written into each segment.
5. **Assemble, never a builder of your own:** `.viral-clone/work/timeline.json` holds the takes (each with its
   `face_boxes` box from `hf-media evidence face-size`), the pieces at their words and the audio; `node scripts/vc.mjs
assemble` it. It places every piece by its vocabulary `anchor:`; a piece is on the face only as its `face:` line
   records. A change is an edit to the timeline and one more run.
6. **G2 against the template's numbers** (cuts, motion rhythm, MG density per segment, each piece's score), not a
   frame-by-frame comparison with the reference film.

## Build a long film by section

For a reference over about 90 s or with more than about 8 sections, build section by section; you decide, the person
is not asked, and you decide too whether the sections run in parallel subagents, which pays off when sections are
many and independent, since each subagent starts from what it is handed. One 141 s product film rebuilt in 11
parallel sections took 78 minutes.

1. Write `frame.md` first: tokens, fonts, the shared components (cards, orbs, buttons) and the section list with each
   section's start and end on the reference's clock, at its own section boundaries.
2. Measure before splitting, in the main session: every section's moves (`motion-curve.mjs`), boxes, sampled colors
   and type sizes (`vc box`) go into `templates/<slug>/reference/sections/sNN.json` beside its `dense.md` rows;
   section agents that measure for themselves repeat the work.
3. In parallel, start one subagent per section. Each gets its window, `frame.md`, the shared components, the full soundtrack as the
   clock, its `sections/sNN.json`, and its rows of `dense.md` and motion windows. It builds from those numbers and
   measures only what they lack, with the `vc` tools and this skill's scripts, never a measuring tool of its own. It writes only its own
   `compositions/sNN-<name>.html` and `assets/sNN/`, checks its window against the reference in **at most three
   snapshot rounds** ([checks.md](checks.md#rounds-not-edits); `hyperframes snapshot --against`, then its fixes), and then hands back with what still differs.
   It never polishes past the third: in one run three of five section agents were still polishing at 25 minutes and
   the video never reached assembly. GSAP is the CDN script in `index.html` (`gsap@<version>` on jsdelivr) and no copy is
   installed, so never search the disk for it: read that version's files at its jsdelivr URL.
4. Assemble the sections, then run G2 once on the whole video, judging what each section handed back, with
   `hf-media evidence join-timing` and continuity at every section boundary. Fix seams in the main session; one fix
   round per section, then report.

## Music and sound

- **Every format with music:** `media.find` with `kind: "music"` saves three tracks a call, so build a pool of 15 or
  more with many queries (mood, genre, tempo, instrument, the reference's section words) and rank them with
  `node scripts/music-scan.mjs --ref music-only-stem.wav track…` (drop time and size, tempo, onsets per second,
  energy every 2 s). Pick by the reference's tempo and density per section, never by the description alone.
- **Music-driven formats** (and any reference whose cuts land on the beat above chance): pin the cuts and graphics to
  the chosen track's beat grid at the reference's share (`music-scan.mjs --cuts T1,T2,…` reports both). Check for a
  vocal hook with `voice.transcribeAudio`, choose by the reference's own structure (a drop, a build, a steady bed, its tempo,
  how it ends) and pin cuts and graphics to the measured hits. Use `sound.generateMusic` only when nothing fits or the person
  asks (30, 60, 120 or 180 s; trim to length).
- **Music map:** change tracks, cut the music out for emphasis and add stings where the reference does; duck the bed
  under speech by the measured dB with volume keyframes.
- **Effects:** follow the template's trigger → effect rules with the reference's palette: about as many distinct
  sounds as it has, and no sound used more often than its most repeated sound (`editing.md` records both). One file
  played on every event is the cheapest-sounding mistake there is; when there are fewer good matches than the
  palette needs, leave more events silent rather than repeat one. Onsets that sit on the music's beat grid belong to
  the music, not the effects list. For each entry, choose:
  - **The reference's own sound:** `node scripts/sfx-extract.mjs STEM --at T1,T2,… --out assets/sfx/<name>.wav`
    aligns the group's instances to the sample and averages them, so the music under them drops by about
    10·log10(N) dB. Use it when the group has 3 or more instances and `alike` is 0.6 or more; it suits signature
    sounds (a logo sting, a recurring transition). A rarer sound takes the library route below.
  - **The closest library sound:** search `media.find` with `kind: "sfx"` and several queries for the kind, download the
    candidates, and rank them against the reference instances:
    `node scripts/sfx-match.mjs rank STEM --at T1,T2,… candidate.wav …`. 0.8 or more is the same kind of sound, 0.9
    or more very likely the same file; place it from its `starts_at`.

  Place each sound by its anchor, at the measured offset and level, on the same share of anchors:
  - **picture event:** on the event's frame;
  - **speech event:** on the start of the word or phrase, from the remix's own word timing (`voice.generateVoiceover` or
    `voice.transcribeAudio`), on the kind of phrase the rule names;
  - **run:** the whole run as one sound, with the cuts it marks placed on its hits;
  - **none:** ambience and foley under the scene it belongs to.

  Leave silent what the reference leaves silent. You cannot hear the result: list every chosen sound in `RESULT.md`
  for the person to audition.

- **References with sound effects and no music:** rebuild with `media.find` sound effects on the same hits, not a music bed.
- **Loudness:** measure the reference per section and the export the same way (`hf-media evidence loudness … --windows`). A section more than about 1 LU off is a defect or a
  recorded approximation.
  - **Set the balance before any render.** Mix the stems with ffmpeg at the planned levels (`amix` with `normalize=0`
    and each stem's `volume`), measure that mix per section against the reference, and fix the balance there: the
    voice over the music, the music's ducking, each effect by its **peak**. One effect peaking near 0 dBFS caps the
    whole film's level, however loud the voice is set.
  - **The render sums the tracks at unity.** Each track plays at its `data-volume`, a linear gain on that track
    alone (at most 3.98), and nothing limits the sum: a loud effect or a raised voice clips instead of getting
    louder. Keep the true peak near −1 dBFS or put a limiter on the master bus. Never chase the level by
    raising volumes and rendering again: keep the balance from the pre-mix and apply one gain pass to the export
    to reach the reference's LUFS.

## Building notes

- Frame-exact cuts: write `data-start` as `frame/fps − 0.002`; a value that is not an exact frame cuts one frame late.
- A GSAP timeline is thenable: return `{ timeline }` from async setup, not the timeline itself.
- Give every parallel render an absolute `-o` path. CSS paint order (stacking context, z-index, DOM order) decides
  what covers what, not track order.
