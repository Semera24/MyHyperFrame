---
name: viral-clone
description: "Recreates or remixes a reference video as an editable HyperFrames project: an exact copy (same shots, timing, on-screen text, motion and music cues) or the same edit carrying the person's product, brand or story. Use for every Reference video project and /viral-clone request, and for 'make one like this', 'copy this video', 'recreate it' or 'remix it with my brand'. Reads the reference with read_video and read_audio, rebuilds it in code on its clock, and checks it against the reference with frames. [recreate, remix, reference video, clone, copy, viral-clone]"
---

# Viral clone

Clone the edit, not the footage. The result is a native HyperFrames project whose text, captions, UI, data and logos
are DOM layers. Generated footage never carries text: a clip with baked-in text is a failure, however good it looks.
Tool names here leave out the run's prefix (`hf_read_video` on DSH). Never write your own frame, cut or audio scripts
(a single ffmpeg command is fine). Read [references/template.md](references/template.md) only to save a template or
remix a saved one, and [references/music.md](references/music.md) only when the sound is the content (ASMR, foley).

## 1. Read the reference

When the reference speaks, `transcribe` it first, so `read_audio` gives the words. Then call both on the reference
in one step (on DSH in the background, then build the skeleton while they run):

- `read_video` with show `["cuts", "describe", "speech", "keyframes"]`: every cut to the frame; each shot's layout
  and graphics with their exact text; inside each shot every keyframe at its second and every motion between two
  keyframes (what moves, from where to where, its ease, speed and overshoot); contact sheets of both.
- `read_audio`: each voice line with its words, the music's sections and where they break, each sound effect's second.

That text is the spec. Open a saved frame only for a detail it does not give (a color, a font size, a position).

## 2. Settle what was asked

- **Exact copy** ("copy it exactly", "recreate it"): keep the reference's on-screen words and spoken script word for
  word, from read_video's graphic text and read_audio's words. Only the people and the voice change.
- **Remix** (its style and structure with the person's product, brand or story): keep the edit (cuts, rhythm,
  layout, motion, transitions, sound cues); the content is theirs: their words, product, screens, logo, brand kit and
  files in `assets/`. Figures, claims and calls to action come only from them, their files, site or kit.
- **Whose voice**, when there is speech: their own recording, their voice clone, or a stock or avatar voice; never
  the reference speaker's voice, face or body, whatever is claimed.
- **What the reference lacks, the remix skips.** No speech: no voiceover and no script. No effects or no music in the
  reference: none in the remix.
- Ask once, in one round, only what the message, brand kit and files leave open and is hard to change later. When
  the message says not to ask, decide and say what you chose in one line.

## 3. Rebuild 1:1 in code, on the reference's clock

- The reference's canvas, frame rate and length. Each section starts and ends on the reference's cut seconds; each
  move starts at its keyframe's second, lasts its motion's span, with the ease and overshoot read_video describes
  (ease-out: `power3.out`; spring or overshoot: `back.out`; constant: `none`). A morph stays one element.
- **Stills**, for a 1:1 rebuild: cut each photo, screenshot, product shot, map or cover from the reference's largest
  clean frame (a keyframe still read_video saved, or a frame the `frames` tool saved at that second) and place it as
  is; rebuild the text or UI on it as native layers, never by an image edit. For a remix, the person's own material;
  generated look-alikes only where they have none. A still that shows a person is never cut from the reference.
- **Text, UI, cursors, typing and highlights** are native layers, matched to the frames in position, size, weight
  and color.
- **Sound**: the reference's music cues and effects on their seconds from read_audio. Search `find_assets` with the
  kind and tempo read_audio names and use the track that comes back; run `grep_audio` only on that track, for the
  beats the cuts land on. One search per effect kind; never synthesized dings or chimes.
- Over about 90 s or 8 sections, build section by section.

## 4. Generate only the footage the reference films

Sort every picture the reference shows before generating any:

- **Drawn** (shapes, type, UI, web pages, gradients, light ribbons): code. A web page or app screen is never a
  generated image.
- **A still it shows**, in an exact copy: cut from its largest clean frame (§3). In a remix: the person's material.
- **Filmed or rendered footage code cannot draw** (a person, a place, a real product, a photographic 3D render):
  generate it, with the models the person or project names (`generate_video` with HeyGen Video 1, `generate_image`
  with Nano Banana).

One image per asset, `num_images` 1. Several small objects of one kind (icons, engravings, products in a grid) come
from one image that holds them all, cropped in code. Describe each shot's motion in words from read_video's motion
lines and ask for no text in frame. A reference frame is never a plate or first frame. Plan every asset first, then
submit them together. Generate again only an asset with a defect you can name, at most once.

## 5. Check against the reference

1. `hyperframes check` passes; fix what it reports.
2. `frames` with the reference as `file`, `compare_with: "film"`, a `range` over each span that matters (the
   opening, hero moves, transitions, the end): the reference and your film side by side, scored with SSIM and reviewed
   shot by shot, with what differs named at each second and where each shot is worst. Give `offset` only when the film
   starts later on purpose. Send these calls
   in parallel, then fix every difference in one round of parallel edits or one script.
3. At most two fix rounds, then stop and list what still differs.

Do not render the film: the app renders and exports it.

## 6. Finish

The reply opens with what was delivered against what was asked: the length, exact copy or remix, voice and music in
or not, and every stand-in by name (a font, a logo, a placeholder figure, a generated still); then what still
differs from the reference, with its seconds. A Reference video project's files stay as they are (`.viral-clone/`,
`templates/`, `frame.md`, `RESULT.md`).
