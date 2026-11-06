# Music and sound

Read this when the reference has music or sound effects, when its cuts follow the music, or when sound is the content.

## What the reference lacks, the remix skips

Rebuild only what the reference has:

- **No speech** (a montage, a mood or brand reel): no voiceover and no script. The music map and the picture events
  are the clock; plan the edit (sections, shots, the music choice) instead of a script.
- **Sound as the content** (ASMR, foley-led reels): each action's sound is the content. Rebuild it synced to its
  action ([below](#sound-as-the-content)), not as effects added over a bed.
- **No added effects**: leave the remix silent there too. **No music**: no bed; effects alone on the same hits.

## Read the sound

1. When the reference speaks, `transcribe` it first: `read_audio` reads words only with the transcript beside the
   file.
2. `read_audio` on the reference separates voice, music and effects first and returns lines in time order:
   - **music**: each piece (its instruments and BPM), whether a section is its first appearance, resumes or returns,
     after a break or fading; and each break with its length.
   - **effect**: its second, kind, `×N` for a run of hits heard as one gesture, its sound group, band, attack, tail,
     peak, and how far it stands over the music (or over what played before). The header counts effects and distinct
     sounds and names the most repeated; drum hits on the beat are left out as music.
   - **voice**: each line's words, pace and pitch, and the voice against the music ("voice 14 dB over music"): that
     is how far the music ducks under speech.
   - **ambience**, and the **pauses** with what plays in them.

   It gives stem levels, not stem files, and it cannot judge how a sound sounds. Before trusting an effect's kind,
   look at its band and how far it stands over the music.

3. For the beat, `grep_audio` with `file` the reference and `return: ["bpm", "beatTimestamps",
"downbeatTimestamps", "sections", "description"]`; they come only when asked for by name. When it finds no steady
   beat, do not cut to a beat and do not invent a grid.

## The music map

Section by section: music bed, effects only, or silence; each track change; mood and genre; tempo; drop-outs and
returns; stings that mark a section; how far the bed ducks under speech.

Cuts on the beat: take the cuts from `read_video` and the beats from `grep_audio`, and count the share of cuts within
±1 frame of a beat. Chance is about 3 frames ÷ fps × beats per second (0.2 at 120 BPM and 30 fps). Call the edit
"on the beat" only when its share is clearly above chance.

## Choose the music

- The person's own track when they bring one.
- Otherwise name what the reference's music does first: its tempo per section, where its build and drop fall, how
  dense it is, how it ends. Search once or twice with those words (mood, genre, tempo, instrument), the queries in
  parallel: `find_assets` with `kind: "music"` saves 3 tracks a call, so 3 to 6 tracks.
- Measure them in parallel, one `grep_audio` per track
  (`file`, `return: ["bpm", "sections", "downbeatTimestamps", "energyShape"]`), and keep the one closest to the
  reference. Never pick by a track's description alone. Check a vocal hook with `read_audio` on that track.
- When none is close, search once more with other words; do not widen the pool past that.
- `generate_music` only when no track fits or the person asks: give `bpm`, `intensity` and the duration (made at 30,
  60, 120 or 180 s; trim it).

## Music-driven edits

Pin the cuts and graphics to the chosen track's beats and downbeats at the reference's on-beat share. Slide the track
(`grep_audio` with `file`, `placeAt` and `skipFileSeconds` gives its beats in film seconds) so its drop lands on the
reference's drop second, then put each cut on the nearest beat. Change tracks, cut the music out and add stings
where the reference does.

## Effects

- **The palette.** Match the reference's number of distinct sounds and never play one sound more often per minute
  than its most repeated one. A creator who uses 13 sounds, none more than three times, is not rebuilt with two
  sounds played 36 times. One file on every event is what makes a track sound canned; with fewer good matches
  than the palette needs, leave events silent rather than repeat one.
- **What each sound is tied to.** Its anchor is a picture event (a cut or keyframe from `read_video` within ±2
  frames), a speech event (the start of a word or phrase), the music (on its beat: it belongs to the music map), or
  none (ambience and foley that build the world). Its job: marking a moment, carrying a cut, rhythm, world, or
  identity (a recurring sting). Count how many picture events and phrases get a sound, and keep that share.
- **Find each sound.** `find_assets` with `kind: "sfx"` and the kind as the query (whoosh, click, paper crinkle), up
  to 3 a call, one query per sound of the palette, in parallel. Run `read_audio` on the candidates in parallel and
  keep the one whose kind, band, attack and tail are closest to the reference's line. When the catalog
  does not answer, ask once more, then try another word or leave the event silent. CC BY attributions go in
  `assets/sfx/CREDITS.md`.
- **A signature sound** (a logo sting, a recurring hit that is the reference's identity): when the catalog has
  nothing close and the sound plays alone or stands 10 dB or more over the music in `read_audio`, cut it from the
  reference with one ffmpeg command (`ffmpeg -ss S -t D -i ref.mp4 -vn assets/sfx/sting.wav`, a few frames before
  its onset to its tail's end). `read_audio` the cut: keep it only when nothing else plays under it; otherwise take the
  closest catalog sound.
- **Place each sound** at its reference level over the voice or music:
  - picture event: find the moment with `grep_timeline`, then `grep_audio` with `file`, `placeAt` near it and
    `alignTo` the animation; use the `data-start` it gives;
  - speech event: find the word with `grep_timeline` transcript `search`, `grep_audio` with `placeAt` there, and move
    `data-start` by the difference between its onset and the word;
  - a run: one sound with several hits, the cuts it marks on its `hitTimestamps`;
  - none: under the scene it belongs to.
- You cannot hear the result: list every chosen sound with its second for the person to audition.

## Sound as the content

Each action (a tap, a pour, a cut, a crinkle) has its own sound on its frame. Take the actions and their seconds from
`read_video`'s keyframes and the sounds from `read_audio`'s effect lines at those seconds.

- Generated footage can carry it: in the `generate_video` prompt, write each action's sound in `< >`, keep audio on,
  then check the take with `read_audio` against its frames at each action.
- Otherwise one foley sound per action from `find_assets`, varied as the reference varies, placed with `alignTo` on
  the action within ±2 frames. A bed goes under it only where the reference has one, at the same level against it.

## Loudness and mix

- `check_audio` reports problems (a clip that will distort, speech too close to the music, a level jump); it does not
  measure the overall loudness.
- Measure loudness on a mixdown. Mix the film's audio files with ffmpeg, each delayed to its `data-start` (`adelay`)
  at its `data-volume`, with `amix=normalize=0`; then `ffmpeg -i mix.wav -af ebur128=peak=true -f null -` gives
  integrated LUFS and true peak. Measure the reference per section the same way (`-ss A -to B`). A section more than
  about 1 LU off is a defect.
- Ducking: `read_audio` on the mixdown gives the same voice-over-music lines as on the reference; keep it within
  about 2 dB.
- The render sums the tracks at unity and nothing limits the sum: a loud effect or a raised voice clips instead of
  getting louder. `data-volume` is a linear gain on one track, at most 3.98. Set each effect by its peak (one effect
  near 0 dBFS caps the whole film), keep the true peak near −1 dBFS, and fix the balance in the mixdown; never chase
  the level by raising volumes.
- Set every track's level in one edit from one `check_audio` report and one mixdown, then run `check_audio` once
  more. Never change one volume per step.
