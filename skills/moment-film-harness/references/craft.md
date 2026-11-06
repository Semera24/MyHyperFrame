# Craft: how the official HyperFrames launch films are made

Measured frame by frame from the official HyperFrames and HeyGen launch films (2026-05 to 2026-10, the most-viewed
over 1.6M views), and from Jake Moran's notes while directing them. Each rule names the films it was seen in. This is
the house craft; a Moment or a reference film the person gave wins for its own beat, and the reply says which house
rule it broke.

| id   | film                         | link                               |
| ---- | ---------------------------- | ---------------------------------- |
| STU  | HyperFrames Studio           | x.com/i/status/2107149824189698558 |
| WEB  | From Your Website            | x.com/i/status/2109689637216379019 |
| VOI  | HeyGen Voice Debut           | x.com/i/status/2108971020677988757 |
| CENT | One Cent Per Second          | x.com/i/status/2108644709946257524 |
| CLM  | Claude Motion to HyperFrames | x.com/i/status/2108274305570390403 |
| BGR  | Background Removal           | x.com/i/status/2107884342823485507 |
| C2V  | Code2Video Benchmark         | x.com/i/status/2102084939026247684 |
| SKL  | Skills Rebuilt               | x.com/i/status/2070557221340196913 |
| GRK  | HyperFrames on Grok          | x.com/i/status/2067265154505744833 |
| CMP  | Companion Mode               | x.com/i/status/2079979510783688953 |
| TRAE | HyperFrames on TRAE          | x.com/i/status/2084693763759468901 |
| ADS  | Simple Social Ads            | x.com/i/status/2095259928005099931 |
| FIG  | Direct From Figma            | x.com/i/status/2075627892852351128 |
| PR   | PR to Video                  | x.com/i/status/2069160747041763493 |
| CLD  | HyperFrames for Claude       | x.com/i/status/2064385555480326405 |
| INS  | HyperFrames Inspector        | x.com/i/status/2054265357096173761 |
| HIC  | HTML in Canvas               | x.com/i/status/2052072000747979162 |
| JUN  | HeyGen June Roundup          | x.com/i/status/2074905653462900750 |
| AUD  | Audio Is Everything          | x.com/i/status/2094839282712347009 |
| EYE  | Give Your Agent Eyes         | x.com/i/status/2097752755314286601 |
| BEAT | Better With a Beat           | x.com/i/status/2065113206377603325 |
| DDS  | Drag Drop Ship               | x.com/i/status/2057863946691133481 |
| KEY  | Keyframes in Code            | x.com/i/status/2072727079855247508 |
| TEX  | Textures and Shaders         | x.com/i/status/2052789902438490491 |
| SCL  | Scale Your Best Work         | x.com/i/status/2057516301757932020 |
| TALK | Launch Ready Talking Heads   | x.com/i/status/2070203745401815285 |
| VAG  | HyperFrames on Video Agent   | x.com/i/status/2080337241881387107 |

## 1. The film is a sequence of worlds

None of the official films is one canvas. A film visits 4–6 **worlds**, each with its own background, light and
scale: live action at night, a macOS desktop, the product on a brand gradient, a white void with a mascot, a 3D set, a
70s living room (STU, CENT, VOI, BGR). What makes them one film:

- **Every world is entered through an object already on screen.** The thing you click becomes the next shot: the
  notification, the dock icon, the send button, a dragged card, the Export button, a URL pill (STU, WEB, CLM). This is
  the single most repeated move in the official films.
- **A recurring home stage**: one world the film keeps returning to (CMP's glass stage, BGR's light-grey title cards,
  SKL's yellow ground), so the cuts away from it read as chapters.
- **One carrier the eye follows**: a mascot, a dot that becomes a sphere, the film being made (CENT, C2V, CLM).
- **The palette and type**, not the background, stay constant.

## 2. The hook: the first two seconds

What the official films open on, never a prompt box by default:

- **The feature working on something recognisable**, in under half a second (BGR: a basketball photo loses its
  background at 0.33 s).
- **A real moment in someone's day**: live action, a time stamp typing in ("11:54 PM"), then the message that creates
  the need ("we need to launch studio tomorrow") (STU).
- **A question with the input inside it**: "What if you could make a launch video from your ⟨website⟩?", where the
  blank is a real input the cursor fills (WEB).
- **A character speaking**: a particle orb that is the voice, captions on its words (VOI).
- **A satire of the old way**: a prompt, a clock that rolls to 30:00, "Done.", a wrong result, then "Familiar?" (CMP).
- **The partner's world**: the partner app's icon and its colour flooding the frame (CLM).
- **A sentence with a twist, whose last word becomes the picture**: "Video is made of → _layers_", and slats slice the
  word into a timeline (AUD); "Hey did you know we added → TEXTURE" (TEX); "Motion is hard…" riding a
  bezier curve like cars on a track (KEY).
- **The bug itself**: a word drops and lands one line too high, and the film is the agent fixing it (EYE); the AI's
  output staged as almost right ("Videc from code") and fixed by dragging one word (DDS).

**Then a failure or a gag, before the fix, and a before/after as the proof.** Nearly every official film lets the old way fail on screen first: the
30-minute wait and a wrong result (CMP), "no skill? fine." → "winging it..." (SKL), a summary that is still a wall of
text, "hmmm still too long..." (PR), a chat piling up "Nudge right. / Still off." (INS), an accelerating montage of
complaint posts that slams into "Until now" (FIG: gaps shrinking from 0.77 s to 0.13 s, each post bigger), the agent
rejecting its own first result (VOI). The product is the relief, and the proof is often the same shot improved in
front of the viewer: one avatar shot better after each of four asks (VAG), one scene replayed silent, with
effects, then with music (BEAT), the raw take flashing into the product's output (TALK).

Typing into a prompt box appears in many of the films, but as a story step at 4–11 s (STU, CLM, VOI), or with a human
hesitation that makes it real ("Ummm... thank you! Would you mind…", GRK; "idk make something cool i guess", CENT).
Typing as the opener, with nothing else on screen, is the tell of a generated film.

## 3. Real UI and the camera

- **Rebuilt, decluttered, one control at a time.** The UI floats flat on a brand canvas at 25–75% of the frame width
  with only the control in use readable, or one pane fills the frame; product UI is never tilted in 3D (the films tilt
  only generated content). The camera never rests on the whole app at 100%: it cycles between the window on its
  gradient, one pane, and a punch-in on one control (STU, CLM, ADS, CLD).
- **Containers morph instead of cutting**: the "+" button becomes the menu, the menu the composer, the message a bubble
  (CLD); the Slack composer stays while Slack fades and becomes the agent's input (ADS).
- **Camera moves are fast and arrive**: a push or pan of 0.4–0.6 s with motion blur straight to the control the cursor
  needs, then hold while the UI acts (CLM: about 15 such moves in 27 s and no hard cut).
- **Punch-in hard cuts for edit beats**: cut straight to a frame 3× tighter on the comment box, type, click, cut back
  wide, and the edit lands with a 0.1 s blur pulse (STU@27.1, 30.4).
- **Pull back to reveal**: the result was playing inside the product all along (STU@23.6, WEB@10.0: the film shrinks
  to one card of a four-card storyboard, scale about 1 → 0.2 over 1 s, ease-out).
- **Zoom through the player into the result**: the player grows until its video fills the frame (about 1.6× over 0.6 s,
  accelerating, blur 0 → 8 px in the last 0.25 s), then the result plays full frame (VOI@20.6, CLM@24.1).
- **The caret leads the camera on a giant prompt**: the prompt layer moves so the caret stays at about 60% of the
  width; when typing ends, a 0.25 s pan to the send button (CMP@0.25–4.0).
- Decluttered: only the active card or button is readable; sidebars and history are cropped away or empty.
- A title never sits on a dimmed screenshot of the product. A title gets its own world (a colour field, footage, a
  stage), or it lands inside the product's UI as the UI's own text.
- Jake's notes on screen entrances: one smooth scale-in, never slide-up-plus-scale; a new screen enters at the framing
  the previous one had, and only then zooms and pans to its control; a step out of a full-frame shot scales down into
  the next screen, not up.

## 4. Transitions, measured

Use 3–5 kinds in a film, each with a cause on screen. Hard cuts are allowed (0–11 a film), mostly punch-ins inside a scene; at a seam between beats they are
punctuation, and the gate allows them at no more than a third of the seams. Crossfades between worlds
are not, except a 2-frame dissolve into the end card (CLM@27.6).

| Transition               | How it is built                                                                                                                                                                                    | Seen in            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Zoom through a button    | camera tracks to the button with motion blur (0.6 s), then the button scales from ~8% to ~250% of the frame in 0.35 s, strong ease-in; its fill becomes the next frame                             | STU@10.3           |
| Object becomes the world | a URL pill's own rectangle grows past the frame in 0.65 s, ease-in-out, radius pill → 24 px; the sentence around it blurs ~15 px and fades in 0.3 s; the new content fades in while it still grows | WEB@4.4            |
| Morph                    | an app icon card widens into the prompt box: width ~110 → ~880 px in 0.2 s `power3.out`, horizontal blur 12 → 0; its label wipes out letter by letter                                              | CLM@3.3            |
| Carry across apps        | the result card shrinks 1 → 0.6 with blur peaking at 6 px mid-move (~0.3 s) and lands inside the next app's player as that app builds around it                                                    | CLM@17.9           |
| Export → object → world  | the button's label fades (0.1 s), the pill collapses to a circle (0.3 s), gains a highlight and shadow, and falls into a 3D set as the background blurs into it                                    | STU@58.9           |
| Click → ring → iris      | a 2 px ring expands from the clicked button in 0.07–0.1 s, then `clip-path: circle()` opens from that point onto the next world in 0.15 s                                                          | C2V@39.9           |
| Halftone dot burst       | from the clicked point, a disc of coloured dots (~12 px pitch) fills the frame in ~0.4 s, then resamples into the next shot over ~0.5 s                                                            | STU@50.4, CENT@3.5 |
| Colour flood             | the hero object stays put while the full-frame background changes colour in ~0.4 s `power2.inOut`                                                                                                  | CLM@1.2            |
| Whip                     | horizontal or vertical smear of 0.13–0.3 s; the arriving element lands blurred and sharpens in ~0.13 s                                                                                             | STU@2.7, 3.7       |
| Conveyor push            | the current card leaves up as the next rises from below in 0.13–0.25 s; its label swaps through a blur                                                                                             | SKL@50.4           |
| Dip cut                  | the outgoing frame darkens ~40% for 3 frames before a hard cut, so the cut reads as intended                                                                                                       | CMP                |
| Blur swap on one stage   | out: opacity → 0 and blur ~8 px in 0.13–0.2 s; in: blur → 0 in 0.13 s; the background never cuts                                                                                                   | CMP, SKL           |
| Smoke or particle wipe   | the title disintegrates into a colour that fills the frame in ~0.25 s; the cut hides under it                                                                                                      | CENT@35.0          |
| Zoom through the mascot  | the logo scales 1 → ~6× around the mascot, power-in, ~0.6 s; its eye fills the frame and the next scene is inside it                                                                               | WEB@26.4           |

Jake's rules for the cut itself: cut at the fastest frame of a move, with matching direction and speed on both sides;
match cut on the rebound of a button click; no zoom-through into a screen that should just appear at the same framing.

## 5. Type

- **A landed title is dead still.** In every official film measured, titles do not drift, slide or scale after they
  land; the motion moves to the next element, the camera, or the world behind (SKL, CMP, GRK, WEB, BGR, STU). Miguel's
  note on our films said the same: titles should be completely idle.
- **Entrances** (vary them within a film):
  - per-word blur-in: each word `blur(6px) → 0` and opacity 0 → 1 in 0.13 s, 0.067 s apart, no translate (SKL, the
    house default);
  - per-word fade from light grey to ink, 0.07–0.1 s apart, no position change (WEB);
  - blur-in of the whole line, 8 px → 0 in 0.13–0.2 s (CMP);
  - per-letter for a name, 0.1 s apart, opacity 0.3 → 1 with a slight blur (CLM);
  - cut-out ransom letters, one every 67 ms, each with its own face and ±4° (BGR);
  - text behind the subject: the person matted out, the title or a giant stat between the plate and the matte (C2V,
    BGR, JUN: a cyan stat slides in behind the host with horizontal blur and counts 174 → 200M in 0.32 s);
  - a letter-level edit inside a held title is the one motion it allows: a recolour, a resize by the product's own
    Inspector, a word swapped for a glyph ("Agent" → a robot icon; INS).
- **Holds**: 1–2 s for a title, 0.4 s for a quick chapter line; then it **exits** with a blur-out and fade of
  0.13–0.25 s, word by word, or with the scene's move.
- **Size and count**: titles 4–9% of the frame height, one or two lines, 1–7 words; one highlighted word in the accent
  colour, which carries meaning (SKL, CMP, STU: "humans" in mint). Most words in a film are the product's own UI text.
- **Scale contrast**: quiet narration lines at 2.5–4% of the height against hero words that fill 60–90% of the width
  (AUD, TEX); a word that becomes the next object (a tagline whose words act themselves out: "Drag."
  is dragged, "Drop." drops; DDS).
- **Slot words**: one word of a sentence rolls through options like a slot machine ("the perfect [launch / explainer /
  UGC ad] video", about 0.1 s a roll), or the blank opens and the real output grows out of it (SCL).
- **Voices of type**: a mono for the agent's inner monologue ("no skill? fine.", "routing..."; SKL), a serif for loader
  words against an all-sans film (CMP). Display type sits on objects and in the product, not floating detached.
- Captions only with a voice: small and centred under shots, or bold phrases on the talking head (C2V).

## 6. Grounds, light and texture

- Each world has its own ground: warm off-white (#F0EFEB, WEB), cream (CLM), a brand gradient behind the product
  window (mint → cyan → blue, STU, CLM), black for a voice or a reveal (VOI, GRK), live action, a 3D set.
- The product window floats on a brand gradient with a soft shadow; never a small window in the middle of an empty dark
  canvas.
- Textures that recur in the official films: halftone and dither dots (STU, CENT), particle spheres (C2V, VOI), a soft
  glow or radial light behind a title, film grain on dark worlds.
- **3D**, when the film earns it: a 3D set or object as the payoff (STU's marble run, C2V's point sphere). Render only
  from timeline time; light it with a warm key, a cool rim and a dark environment with two or three soft strips; turn
  the environment, not the object, so highlights sweep; a contact shadow under the object. Generated footage
  (`real-ui.md` §5) is the other way to a photoreal world.

## 7. The logo and the end card

- **The logo is never docked in a corner** in any official film. The brand shows earlier only inside the product and
  the story: an app icon in the dock, the name in a generated title, a connector row (STU, GRK).
- **The mark lands in the last 5–10% of the film**, centred, the lockup about 15–30% of the frame width, and it is
  performed:
  - the cursor clicks the mark, a gradient fills it from the bottom (0.35 s), it shrinks and moves aside, and the
    wordmark wipes in beside it (SKL, CMP, C2V);
  - a mascot carries the logo in, then "edits" it: a selection box and "Studio" typed in (BGR, VOI);
  - a 3D mark floats in its world with the wordmark wiped in (STU);
  - an integration ends on chip → arrow → logo, or on the partner's logo (CLM, GRK).
- Then the call to action (a "Download now" pill, a GitHub star clicked, or the literal command to type,
  `npx hyperframes add …`; HIC, PR), the final state held about 1.5–3 s, then black.
- The product's name may land earlier as a title ("Introducing Companion Mode", 30% in), as type, not the mark.

## 8. Motion physics

- Fast moves take 0.3–0.6 s and carry motion blur on their own ease, peaking at the fastest frame: text-sized 6–12 px,
  full-frame 15–20 px, horizontal-only on a horizontal move.
- Long-tailed ease-outs on arrivals; landing takes longer than leaving. One move is one tween.
- Jake (2026-10-08): entrances that are too snappy read as glitches: smooth every animation out on its easing curve; an
  exit is one smooth motion, never slide, stop, then leave; slowing the whole film by about a second often fixes it.
- A click into a new screen: match cut on the click's rebound; the new screen comes in slightly large and settles.
- Never: breathing, float or pulse loops standing in for motion; a slow creeping scale on a title; a slow push in the
  back half of a scene ("no movement beats bad movement"); bounce; click rings ("the click itself is enough").
- Allowed continuous motion: the product's UI working, footage playing, a character acting, a 3D world turning, a slow
  orbit of a background stage (CMP's glass at 3–5° a second).

## 9. The cursor and the character

- The cursor is big (about 4–7% of the frame), enters from off-screen, aims at the next control, and its click causes
  the next thing on the same frame. It may vanish while the camera moves and reappear at the next target (CLM).
- The agent is often a **character**: a mint pin cursor that drags out a card (STU), a pink mascot that carries a take
  into the player, draws a frame and projects light onto a browser (CENT), a particle orb that talks (VOI). A character
  gives every transition a cause and gives the film jokes: it reads "Launch Videos for Dummies", it rejects its own
  result and rewinds (VOI@31.4).
- The agent's process is a subject: a file tree scanned row by row, a checklist of real step names ticking in ~2 s
  (GRK), loader words in a contrasting face ("Thinking... Crafting... Building..."), a count-up as proof.

## 10. Timing

- Strong speed contrast: montages cut every 0.13–0.8 s (FIG, JUN), demos hold 7–10 s on one framing while the UI acts.
- Shots average 1.8–3 s, full of motion inside them. The process runs fast (a new prompt every 0.8 s, STU@44.5); the
  payoff plays at normal speed.
- Hold 0.3–0.75 s before the payoff. The payoff is the one big moment: a 3D world, a full-frame result, a number made
  physical (CENT: "1 ¢ per second" as a skyscraper).
- Films run 30–80 s; give the agent and the person a range, not an exact length.
- A few films are fast montages on purpose (an event opener at ~0.9 s a shot, a feature sizzle on the beat): a cut
  rate is a choice of genre, not a rule.
- What gets views in this set is people and real output (a live avatar, a real ad cloned into variants), more than
  effects: the effects-heavy films sit at around 12–14k views, the ones with real people and real results at 300k–1.7M.

## 11. Sound

Most official launch films are music only, with sound effects on the visible actions (clicks, typing, whooshes on
whips); a voice appears when a character, an avatar or a presenter speaks (VOI, C2V, TALK), with small
captions. Sound is structure, not a bed: a crescendo from −45 to −12 dB across the film (WEB), a dip under the title
cards, music held back until the payoff (BEAT). `sound.md` has the tools.

## 12. Notes into numbers

| The person says              | You change                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| "too fast"                   | slow every zoom and pan to 0.7× of its current speed, nothing else                  |
| "speed this up"              | speed the content and shorten the beat by the same amount; later beats move up      |
| "add a push in on the click" | the camera pushes toward the clicked target on the click frame                      |
| "the cursor just appears"    | it comes in from off-screen on a glide                                              |
| "the titles move"            | land them, then hold them dead still until they leave                               |
| "it feels like slides"       | enter the next world through an object on screen; cut a move mid-flight             |
| "make it pop", "more energy" | offer an `hf:motion` card with 2–3 transition or camera options; change nothing yet |
| "not premium"                | `boards/fixes.md`, study a Moment for that gap, port its code (`study.md` §7)       |
