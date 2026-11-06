---
name: viral-clone
description: Clone a reference video's edit and style onto new content as an editable HyperFrames project. From a video the person brings or a gallery pick, learn how it speaks, how it is cut, its motion-graphic vocabulary, its footage language and its form; save that as a reusable template; then remix it with the person's topic, product, brand or people. Covers creator explainers, talking heads with B-roll and graphics, UGC and avatar ads, product try-ons, music montages, tier lists, short brand reels built on a visual trick, and product launch and UI promo films in pure motion graphics (rebuilt 1:1, then rebranded). Use for "make a video like this one", "recreate this video", "copy this style for my product", "remix this template", or revising a saved viral-clone template.
---

# Viral Clone

This skill clones a reference video's **edit**, not its footage: format, cut rhythm, A/B-roll logic, motion graphics,
captions, transitions, how the script is told, and the visual trick a short reel is built on. Footage is generated or
comes from the person. The result is a native HyperFrames project whose text, graphics, data and timing stay editable.
A generated video with baked-in text is a failure, however good it looks.

```
⓪ The ask → preview → ① Watch → G0 → ② Template → G0.5 → G1 · G1.5 → ③ Remix → G2 → final
  intake.md   sheets      vc watch        template.md  vc pieces             media.md   vc film · vc review · vc verify
```

`node scripts/vc.mjs next` says where a project stands and the one command to run next. Each `vc` command does a
stage's mechanics at once (what to run, in parallel, where it lands) and ends in one file to read: `watch.md` for the
reference, `report.md` for the pieces, `review.md` for the film. What they cannot do is yours: reading the frames (`video.read`),
deciding what the reference does and how it is built, writing the pieces, fixing what the reports name. Measuring,
the template's structure and the film's assembly are `vc` tools ([Tools](#tools)): never write a script of your own
for them. Read each step's reference file before doing it. The result is decided by what was measured, not by effort: a remix built from 1 FPS
sheets and descriptions comes out generic however long the run.

**A first preview by minute 5.** Right after the answers, before G0's measurements and G0.5, write the project's
`index.html` as a rough storyboard laid out from the overview sheets: the remix's canvas and length, one card per
section on the reference's clock, each showing what the person's version puts there (their words, screens and logo
from `assets/` and the brand kit), never a reference frame ([media.md](references/media.md#motion-graphics-films-rebuild-then-remix)
step 0). Then refine it in place as each stage lands.

G0.5 (talking heads, creator and UGC videos): every graphic and transition rebuilt 1:1 over the reference's
own footage on its clock and scored in its box, before any script or paid generation; one scoring round by default,
started once the preview is up, and `--changed` re-scores only what had a problem. Captions are not pieces: `vc assemble`
builds them from the caption rule, and G2 checks them. The film renders once as v0; after it, every change
re-renders only its own seconds through `vc verify`.

## Choose the work

Every path starts with ⓪ the ask ([intake.md](references/intake.md)): one round (the person, voice and words questions the
reference needs, plus at most two more), none the message, the brand kit or the template already answers. A `Brand: <site>` line with no kit for that site comes first:
make its kit with a `brand_kit_ops` create (site), then set it with a `use` op in the next call and say so in one line, before you watch
or ask anything (the person watches the kit fill in from the sidebar).

| Situation                                                                                           | Path                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The person brings a video and wants one like it (a kind no row below covers)                        | ① → ② → ③ at single depth                                                                                                                                                                                                                                                                                                                              |
| A creator or format template others will reuse, from several of its videos                          | ① → ② at creator depth                                                                                                                                                                                                                                                                                                                                 |
| A style template (`templates/<slug>/` with `CHANNEL.md` and `series/<series>/REMIX.md`) and a topic | the style-sampling skill (`/hyperframes-style-sampling:style-sampling`), not this one: its REMIX.md is the process; this row wins over every other                                                                                                                                                                                                     |
| A saved template and new content                                                                    | read the template's `TEMPLATE.md`, then ③; re-watch only what the new content changes. Its scored `components/` stand in for ① and G0.5, so this row wins over the talking-head one below                                                                                                                                                              |
| Revise a delivered remix                                                                            | read its `frame.md` code map; change only the coupled parts ([template.md](references/template.md#change-only-the-coupled-parts))                                                                                                                                                                                                                      |
| A motion-graphics film (product launch, UI promo, animated explainer) to rebuild or rebrand         | ① → the skeleton in the project → one scene at a time: rebuilt 1:1 on the reference's clock, scored, remixed with the person's content and mounted, as much of the film as [its length and kind call for](references/media.md#how-much-to-rebuild) → G2 on the mounted film ([media.md](references/media.md#motion-graphics-films-rebuild-then-remix)) |
| A talking-head, creator or UGC video remixed with the person, an avatar or a new person             | ① → G0.5: every graphic and transition rebuilt 1:1 over the reference's own footage on its clock and scored in its box → new words and voice → person shots made to the pieces' plan → G2 ([media.md](references/media.md#talking-heads-and-creator-videos-pieces-first-then-the-new-film))                                                            |

**Rebuild before remixing, as much as the reference needs.** Every path that keeps a reference's motion rebuilds it
1:1 on the reference's clock before any content changes: the whole film, a representative stretch with its hero
scenes and recurring pieces, or the pieces alone over a presenter. You choose how much by the reference's length,
how much of it carries over to new content and where its likeness lives
([media.md](references/media.md#how-much-to-rebuild)); write the choice and why in `RESULT.md`. What is not a
choice: nothing enters the remix that was not rebuilt and scored against the reference first. A motion-graphics film keeps this per
scene: a scene is mounted in the person's project only once it was rebuilt and scored on its window.

**Depth:** with one video, every number is that video's. With several videos of one creator or format, every target
becomes a median and range, and a choice seen once becomes a variant with its condition
([watch.md](references/watch.md#depth-one-video-or-a-creator)).

**Topic fit:** the topic must be able to carry the reference's footage language. A footage-heavy format needs a topic
with real footage (a real event, place, institution or product); when it has none, say so and use the nearest real
material.

**Long films:** over about 90 s or about 8 sections, build section by section, in parallel subagents when that is
faster ([media.md](references/media.md#build-a-long-film-by-section)). Decide this yourself; do not ask.

**Runtime cap:** when the answers allow less time than the reference runs, keep the reference's pace and depth and
cover fewer points (the cold open, the hook and the first sections), never the whole form squeezed into a summary.

## What decides the result, by format

| Format                                                  | What makes or breaks it                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand reels built on a visual trick                     | The trick inventory ([watch.md](references/watch.md#the-loop) step 6); plates made to the reference frame with `nano-banana-2`; the moving subject made by H3 Max with the span's motion in words ([media.md](references/media.md#the-h3-max-request)); the trick gate in G2                                                                        |
| Motion-graphics explainers (faceless or with a host)    | A close-up window per graphic type for entry and exit; motion rhythm (frames in motion, holds, on ones or twos); boxes and sampled colors; hero scenes rebuilt as moving layers; the sound palette's size and repeats                                                                                                                               |
| Creator explainers with real footage                    | The script explains the way the creator does (read body passages, not openings); footage that shows what the speech names; music tempo per section and cuts on the beat where the creator cuts on it                                                                                                                                                |
| Talking heads, webcam and picture-in-picture presenters | Each locked shot from one long take; the measured camera per shot (slow push, drift) rebuilt; voice from an on-format clone with measured prosody; gestures landing on their targets; no grade on the person beyond the reference's; a named avatar's shots made to the reference's kinds of shot, around pieces rebuilt 1:1 on the reference first |
| Screen walkthroughs                                     | Real use recorded at the reference's UI event rate with the cursor and hovers visible; HyperFrames Studio may be rebuilt from its real layout instead                                                                                                                                                                                               |
| Product and UI films in pure motion graphics            | A 1:1 rebuild on the reference's clock before any content changes (a direct remix drifts off the beats); every move's ease, duration and overshoot from `motion-curve.mjs`; stills cut from the reference's frames; blur, typing and the cursor matched by measurement                                                                              |
| Music-driven edits                                      | A ranked pool of 15+ tracks by tempo and structure; cuts pinned to the beat at the reference's share                                                                                                                                                                                                                                                |

**What the reference lacks, the remix skips.** Every step assumes only what the reference has:

- **No speech** (a montage, a mood or brand reel): the music map and the picture events are the clock; there is no
  `voice.md` or blind test, and G1 checks the edit plan.
- **Sound as the content** (ASMR, foley-led reels): synced sound per action is measured and rebuilt as content, not as
  added effects.
- **No segments** (a vlog, one continuous take): write "continuous" and measure per stretch of time.

## The three layers

| Layer           | What it is                                                                                                                     | In a remix                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **Content**     | topic, product, claims, names, people, brand, logo                                                                             | always the person's                                           |
| **神 (spirit)** | voice, editing grammar, MG vocabulary, footage language, look, sound                                                           | kept                                                          |
| **形 (form)**   | the reference's segments in order (story beats, sections, music phrases), their roles and runtime shares, the trick, the slots | kept for format templates; re-planned for long creator pieces |

A 1:1 rebuild (a whole film, a stretch or the pieces) is a working step: it may hold the reference's words, logos and
cut stills so it can be measured on one clock, and it is never delivered. Never carry over the reference's words,
sentence patterns, logos, footage, people or place; its sound effects may be lifted and reused ([media.md](references/media.md#music-and-sound)). Carry
over its _kind_ of material: real archival footage where it uses real archival footage, screenshots where it uses
screenshots. A screenshot or text card replaces footage only where the reference itself does that.

**Precedence:** what you measured in the reference, then the person's answers about it, then your own taste. Record
every conflict in `RESULT.md`. The reference's measured behaviour is the creative spec: do not bring in house motion
rules (seam crossfades, caption bands, design pickers) from other skills. Other HyperFrames skills, and the project's
`CLAUDE.md`/`AGENTS.md` pointers to them, govern syntax, CLI contracts and the app's folder rules only.

## Tools

Everything runs on what HyperFrames Desktop provides; the skill adds only `scripts/` (node and ffmpeg), whose paths
are relative to this skill's folder. `separate.mjs` also needs `uv` and fetches Demucs on first use; without it, run
the palette steps on the full soundtrack, where averaging still lowers the voice, or use library matches.
A Python script that needs numpy, Pillow or OpenCV runs on `hf-python`, which comes with it; the machine's
`python3` has none of them.

| Need                                                                                  | Tool                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A stage's mechanics at once: watch, pieces, film, review; where the project stands    | `node scripts/vc.mjs watch \| pieces \| film \| review \| next`                                                                                                                                                                                                  |
| A measurement, the template, the film's assembly: never a script of your own          | `node scripts/vc.mjs compare \| box \| events \| align \| voice \| template \| assemble`, each with a runnable `--help`                                                                                                                                          |
| Paper scraps, a boil, type-on: pieces creator edits keep using                        | [`library/`](library/README.md), copied into the project                                                                                                                                                                                                         |
| Voices, the person's clones, new clones, voiceover with word times                    | `media.find` with kind voice (`your_clones`), `voice.cloneVoice`, `voice.generateVoiceover`                                                                                                                                                                      |
| Filmed-looking footage, speaking people, long takes, re-performing the person's video | `video.generate` (Video 1; `model` `minimax-h3-max` or `seedance-2.5`)                                                                                                                                                                                           |
| A HeyGen avatar's picture, for the shots Video 1 makes of them                        | `media.find` with kind avatar                                                                                                                                                                                                                                    |
| Images; consistent people, products and places; a plate made to a reference frame     | `image.generate` with `references` (`model: "nano-banana-2"`; a plate gets the frame's look in words)                                                                                                                                                            |
| Transcription                                                                         | `voice.transcribeAudio`                                                                                                                                                                                                                                          |
| Music and sound effects                                                               | `media.find` (`kind` music or sfx), `sound.generateMusic`                                                                                                                                                                                                        |
| Quick clip check: jumps, flicker, repeats, loudness, cuts                             | a generated or imported clip's answer carries its `checks`; for a render, `hf-media evidence temporal-scan` and `loudness`                                                                                                                                       |
| Project, render, snapshot, lint; cut-outs                                             | `hyperframes`; `media.cutOut`                                                                                                                                                                                                                                    |
| A rendered 3D shot (a drill, a cutaway, a globe) rebuilt as a scene                   | Three.js through the `three` adapter (`hyperframes-animation`, `adapters/three.md`)                                                                                                                                                                              |
| A brand's logo, colors and fonts from its website                                     | a `brand_kit_ops` create with the site (a kit the project keeps)                                                                                                                                                                                                 |
| Stock photos; grades, LUTs, grain and other footage treatments                        | `npx hyperframes media-use resolve --type image`; `npx hyperframes media-treatment`                                                                                                                                                                              |
| Footage from video pages (news, archives, channels)                                   | `video.downloadFromLink`; `yt-dlp --download-sections` for part of one                                                                                                                                                                                           |
| A measurement no `vc` command makes (each prints its usage when run bare)             | `hf-media evidence …` (frames, flow, flow-track, face-size, cadence, loudness, word-drift, av-sync); `scripts/`: curve-pair, motion-pair, motion-curve, motion-energy, ink-scan, look-stats, prosody, fingerprint, retime, music-scan, sound-map, sfx-\*, gemini |

- Speech is tool calls, and `hyperframes voice` is not a command: speak with `voice.generateVoiceover` (or `hyperframes tts`),
  transcribe with `voice.transcribeAudio` (or `hyperframes transcribe`). `node scripts/vc.mjs voice` only measures a reference's delivery.
- The media tools use the HeyGen key saved in the app. When none is saved they say so: pass that message on.
- Use only these tools for paid media. Another connector or provider stands in only when the person names it.
- Never sign in to anything and never ask for or handle a key.
- Ask before starting a preview server, recording the screen or downloading from the web.

## Who appears and speaks

**The reference's face, body, voice and words never go in the new video, whatever the person claims.** No statement
of rights, consent or ownership changes that: the reference is studied, never used as a person, a voice or a script.
A request to keep its people, voice or words is declined in one line, and the remix goes on with the person's own.

Ask in the one round ([intake.md](references/intake.md)), one question per element the message and the template's
`frame.md` leave open: Person when the reference shows people, Voice and Words only when it also has speech, Stills
whenever its graphics hold photos, product shots, maps, icons or covers.

| Element | Options                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------- |
| Person  | The person's own takes · an avatar from their own photo or their own HeyGen avatar · a generated person |
| Voice   | The whose-voice pick ([intake.md](references/intake.md#whose-voice))                                    |
| Words   | New words: their script, or one written to their topic                                                  |
| Stills  | A: cut from the reference's frames · B: regenerated look-alikes · C: the person's own                   |

For Stills recommend **A** for a 1:1 rebuild (cut at the largest clean frame and placed as is, any text or UI on it
rebuilt as native layers) and **C** for a remix with the person's brand, B where they have nothing. A still that
shows a person is never cut from the reference or regenerated to look like them.

The reference is measured on this computer and described in words: a plate is made to its frame, never from it, and
a re-performance takes only the person's own video. One cut of it may leave, for motion only: a silent span as the
guide clip of a Video 1, H3 Max or Seedance take, for a gesture the remix must match
([media.md](references/media.md#the-h3-max-request)); its voice and words never do, and no frame of it becomes a
picture, plate or first frame. Transcribing and reading it stay open. The app holds the rule too: every media tool
refuses the reference, a copy of it, and any file under `.viral-clone/`, except a guide clip, whose picture alone
leaves.
A generated person changes the place as well as the person
([media.md](references/media.md#stable-people-places-and-props)).
A HeyGen avatar the person names sets who appears, and every shot is still regenerated from the reference's own shot,
with the same place, framing and action ([media.md](references/media.md#speaking-footage)).

## Hard rules

1. **Speech follows the whose-voice answer** ([intake.md](references/intake.md#whose-voice)): the person's own
   recording used as is, their HeyGen Voice 1 clone reading a script written the creator's way, the avatar's catalog
   voice on engine `orca`, or the stock voice they picked; never the reference speaker's voice. Each synthesized
   stretch is one call, paced toward the creator and checked with `prosody.mjs`; never a legacy voice. Speed at most
   1.05 on every route; remove pauses only with cuts, and only as densely as the reference does
   ([media.md](references/media.md#voice)).
2. **Generated people speak our audio:** every spoken line goes into `video.generate` as segment `audio`, and each
   take is accepted by its words ([media.md](references/media.md#speaking-footage)).
3. **Real material of the reference's kind:** footage of the kinds and specificity its footage log records, from any
   source. When its B-roll shows what the speech names, the remix's does too; product use is recorded for real (HyperFrames Studio may be rebuilt from its real layout instead, [media.md](references/media.md#footage)); charts
   use real data with the source on screen ([media.md](references/media.md#footage)). The reference's own footage
   never ships.
4. **The reference's look:** every shot gets the treatment the template records for its kind of footage, and the
   reference's hero scenes are rebuilt as layered scenes, not left out ([media.md](references/media.md#hero-scenes)).
   Generated shots are made to the reference's frames: plates line up with the reference frame, and what the reference
   films moving is generated video with that motion in words, never a still moved by transforms.
5. **Motion is measured and gated:** the reference's motion rhythm, camera per shot and every graphic's entry, hold and
   exit are measured before building (G0) and checked on the draft (G2's core). A failing core check is fixed or
   regenerated; it is never noted and shipped.
6. **Editable:** text, captions, chart data, UI and logos are DOM layers; generated video carries no text. Captions
   are an overlay, never a reserved band.
7. **Gates:** G0 evidence before the template, G0.5 the pieces rebuilt on the reference before the script (talking-head,
   creator and UGC remixes), G1 script or edit plan before paying, G1.5 media list before
   building, G2 v0 before the patched final ([checks.md](references/checks.md)).
8. **Sound:** the reference's music map and its sound events on the same anchors, from its own lifted sounds, the
   music and sound-effect catalogs and real foley; no synthesized dings, chimes or jingles ([media.md](references/media.md#music-and-sound)).
9. **Budget:** before the first paid generation, list each planned generation (model, seconds, resolution; 2k counts
   as 3× 768p; its expected minutes) with a planned and an at-most count, then submit them together
   ([media.md](references/media.md)): plan several generations per kept clip, then use your own
   acceptance rate once you know it. Leave resolution at the model's default (768p, Seedance 720p); 1080p only when
   the person asks for it. When they ask for the best possible look without naming a resolution, ask once before the
   first paid generation, with the total at the default and at 1080p, and use what they pick. The tools return no price: estimate from that list and say it is an estimate. With a model answer, price the person's speaking shots on its speaking route over their real seconds and the rest on
   its silent route; the setup showed only a range. Stop and report at the person's limit.

## Finish

Make `renders/final.mp4` yourself: `vc film`, then `vc verify` after the fixes; the person can export again from the
app. Every turn that changes the picture, a later message's too, ends with `node scripts/vc.mjs verify <the seconds it
changed>` (`--sound` when it touched the voice, music, effects or mix), and you read its strips and
`.viral-clone/work/verify.md` and fix what they name before replying: stills alone are not a check, and "I can't hear
it" is not an answer. Every later message's asks join `.viral-clone/asks.json` ([intake.md](references/intake.md#4-after-the-answers)),
and the final waits until `node scripts/vc.mjs asks` exits 0.

**The reply** opens with what was delivered against what was asked: the length against the length asked, animated or
a storyboard, voice and music in or not, and every stand-in by name (a placeholder name or figure, a font, a logo,
generated stills in place of their screens). Before using any stand-in, look for the real one in the brand kit and
`assets/`.

Deliver the export, the editable project, the template and `RESULT.md`, written for the person in their language.
It opens with what still differs from the reference, each with a still pair: every problem G0.5 went on with and
why, every failed G2 core check, every stand-in (fonts, assets, approximated motion)
([checks.md](references/checks.md#resultmd)). Then what was made, the G2 core numbers, a verdict per check, the
`.viral-clone/no-pieces` reason when G0.5 was skipped, and anything left unchecked. A difference or stand-in the person
is not told about is a defect.
