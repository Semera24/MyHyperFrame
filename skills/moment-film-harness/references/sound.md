# Sound

Every tool here is in the app's own tool list. `media.find` music and `media.find` with kind voice are HeyGen's, free with the
person's sign-in; `media.find` sound effects are Openverse's (CC0 and CC BY), free with no sign-in; `voice.generateVoiceover`, `sound.generateMusic` and `voice.transcribeAudio` are paid and need the HeyGen key.
With the storyboard on, nothing paid is made before approval. With no key, make the film silent over `media.find` music and
say so in one line. How audio clips are written into `index.html` (`data-start`, `data-volume`, volume lanes) is in the
core guide.

Order: the clock (§1–3) once the plan holds and before any tween; effects, captions and levels (§4–6) once the motion is
final.

## 1. Which clock

- **Narrated**: the voice is the clock. Generate it from the voice-over in the plan (approved on the storyboard when it
  is on), then time the beats to its words.
- **Silent**: the music is the clock. Measure its beat grid (`grep_audio` lists beats, downbeats and bpm, or
  `hyperframes beats` on the film's music track), then hang the film on it:
  - each cut from one beat (scene) to the next on a beat, a downbeat or bar line when one is within reach; clicks and
    landings on beats, fast repeated presses on half-beats; the payoff and the lockup on a downbeat or the track's
    strongest hit.
  - **Inside a ported Moment, its own timing wins.** Its inner cuts, holds and presses keep their source spacing; the
    passage snaps as a whole, by its start and, when its stretch points (`code/REMIX.md`) allow, its landing. An inner
    cut already within a frame of a beat or half-beat may move onto it; no other inner cut moves.
  - **No reliable grid** (a free-time track, a bpm the tools disagree on, beats a frame or more uneven): cuts follow
    the motion, the lockup lands on the strongest hit, and the reply says so in one line.
  - Before you reply, list each cut, click and landing outside a ported Moment with its nearest beat; one more than a
    frame (33 ms) off moves.
- Optional, and strong when it fits: let the sound act out the value. The `before` sits near silence; the moment the
  product appears, the music opens up.
- Re-generating the voice or swapping the track reopens every seam it moves: re-run the gate.

## 2. Voice

1. **HeyGen Voice 1 only**, HeyGen's newest voice model, through `voice.generateVoiceover`; never media-use, `hyperframes tts`,
   Starfish or ElevenLabs. Search `media.find` with kind voice with a style word and a language ("warm confident narrator", "English")
   and pick by name. When the voice matters to the person, offer two by name in the angle card; otherwise pick one and
   name it in the reply. The person's own voice is an ACTIVE one of `media.find` kind voice's `your_clones`, or a new
   `voice.cloneVoice` from a recording in the project.
2. Write two layers. The **spoken** layer is what the voice reads; the **display** layer is what captions show.
   - Spoken: respell what the voice gets wrong ("HeyGen" → "hey-jen", "JSON" → "jay-sawn"), space out acronyms ("C L
     I"), say "dot" in URLs, spell out version numbers or leave them unsaid. Pause with commas, dashes or
     `<break time="0.4s"/>`, never ellipses. A feature with a one-line command says the command.
   - Display: the real spelling, always.
3. `voice.generateVoiceover` (a catalog voice speaks on HeyGen Voice 1, orca, when it has it; a clone always does)
   returns the file, `words[]` and the `engine` that ran. Check that it says `orca`; a clone's answer names none. A voice that cannot
   speak through it is the wrong voice: pick another, never another engine. Its times are the truth: each beat's start
   sits on the start of its anchor word, and text lands on the word that says it.
4. Keep the voice's own pauses and pace: never trim the gaps between words, never speed the read past 1.05. Too long for
   its slot? Cut words from the script and generate it again.
5. If `words[]` comes back empty, run `voice.transcribeAudio` on the file for the word times. A recording the person gave
   with speech in it gets `voice.transcribeAudio` too.
6. Audio that plays inside the film (a voice sample in the product, a generated clip) is never cut mid-word: the scene
   waits for it to finish.

## 3. Music

- The person's own track first, kept as given. The music that wins on social is a known song's instrumental.
- Then `sound.generateMusic` (paid, `duration` 30 or 60, `bpm`, `intensity`; no `lyrics` is instrumental), cut to length. In a blind
  test of six launch films (2026-10-14) Lyria rated above library tracks.
- Else `media.find` with `kind: "music"` and the film's feel, not its subject ("tense minimal pulse building to a bright
  drop, 120 bpm"), `count: 3`. Read each description and length and use the one that fits best; try another query
  before settling.
- Enter at the track's strongest bar, not its quiet intro; end on a bar line with a short fade under the ender.
- If neither gives a track, compose a simple instrumental bed in code, save it as a WAV in assets, and say in one line
  that it is a basic stand-in. The film is never silent for want of a track.

## 4. Sound effects

Few and exact: every effect has a cause on screen, and too many read as a template.

| Sound           | Only on                                              |
| --------------- | ---------------------------------------------------- |
| click           | a real cursor click on screen                        |
| whoosh          | a scene cut, or a card wider than 600 px moving fast |
| soft key tick   | text arriving line by line                           |
| impact or riser | the lockup or the climax, once                       |

- `media.find` with `kind: "sfx"` and a concrete query ("soft mouse click", "fast air whoosh"). Land its hit on the
  frame; measure where it lands rather than guessing.
- Vary them: the same whoosh on every cut is the most common tell. Search two or three and rotate.
- Sometimes no effects at all is right: a typing-heavy film over strong music can drop the clicks and keys.
- **The ender lands on the music**: the mark's landing sits on a downbeat or the track's last hit. Never synthesise a
  tone, chime or ding: the score and real foley only. When the library has nothing that fits, use no effect.

## 5. Captions

Only on a narrated film, from the display layer with the spoken layer's times. One clean rail, bottom centre, its
baseline 5–8% of the height above the bottom (on a 1080 square: top at 990 px, 32 px type), the film's body font, white
with a soft shadow. Each word fades in over 0.12 s on its spoken time; a phrase change is a cut, not an animation;
phrases stay under about 40 characters and two lines. No bounce, pop or colour flashing; a key word may be highlighted
inline. Drop fillers (um, uh, restarts). Captions are an overlay, not a reserved band: compose the frame on its true
centre and keep only critical small text (URL, legal line) out of the bottom 80 px. At most one word a beat is promoted
to a large on-screen word, never two in a row, at most one apex in the film.

## 6. Levels

Music under a voice sits around 0.14. Nothing redlines: AI audio often clips, voices included. Check each audio file
before you place it, and keep its true peak at −1 dBTP or lower:

```bash
ffmpeg -hide_banner -i assets/audio/voice.mp3 -af loudnorm=print_format=summary -f null - 2>&1 | grep -E "Input (Integrated|True Peak)"
```

Aim the mix at −19 to −15 LUFS integrated. Set every track's level in one edit from these measurements and one
`check_audio` report, then check once more; never change one volume per step.

## 7. When the person hears it out of sync

- "Not aligned" can mean the effects against the motion or the cuts against the music's beats (§1): measure both
  before you answer.
- Measure every sound against its moment. Its audible onset is `grep_audio`'s `keyMoments` onset for the placed clip:
  the first point at 20% of its peak energy, in film seconds, past any silence at the head of the file. A clip's
  `data-start` is not its onset. Its moment is the frame at that time (`hyperframes snapshot
--at <t>`). Fix what is more than a frame off, and say what moved.
- Measured onsets and seeked frames cannot show live playback, so never answer "it's the preview" or "the picture lags
  the audio" from a guess. When everything measures in sync, say what you measured, and ask which second sounds off and
  whether they heard it in the preview or in an exported file.
