# ⓪ The ask: find out what the person wants, in one round

The reference fixes the form; the person owns the content. Settle what only they can settle before the watch, since
the answers decide what the watch must measure (a cutdown needs its opening, a rebrand needs every element bound to the
original product), and before any generation is paid for. Ask **once**, in **one round**: the person, voice and words
questions the reference needs ([Who appears and speaks](../SKILL.md#who-appears-and-speaks)), plus **at most two more**, then build. There is no brief to confirm: the answers are the go.

## 1. What is already answered: ask none of it

Read these first and drop every question they settle.

- **The message.** Each bracketed part (`[person: …]`, `[brand: …]`, `[words: …]`) is an answer. `[model: …]` names the route for the person's speaking shots and for their silent and moving shots ([media.md](media.md#speaking-footage)). A part it leaves
  out is still open, and the reference's people, voice and words never fill it. A stated format ("vertical, 30 seconds
  max"), a product name or a URL answers its field. "Just build it", "you decide" or a message that already says everything: ask nothing, and every
  open field becomes your own choice, said in one line of your reply.
- **The reference and their files.** The message names the reference video apart ("The reference video, to study
  only") from the person's own files ("Use these project files"). Study the reference; only their files are material
  for the new video. "My clip" or "my voice" in a later ask is one of their files, never the reference: with none of
  their own, ask for the file in one line.
- **What the app already holds for them.** The brand kit note on the message, an attached `frame.md`, logo, website,
  script or recording answers its field. In the app's reference flow the person chose their brand before you were
  sent the video: never ask about the brand, its colors, fonts or logo. A brand kit dresses what is the brand's own:
  its product, its claims, its logo, and the reference's own channel moments (an end card, a subscribe prompt). When
  the topic is not the brand's (an explainer about a tower, a volcano, a law), the reference's colors and fonts stay
  everywhere else; say so in one line.
- **A brand site with no kit.** A `Brand: <site>` line the brand kit note doesn't match is still their brand: reuse
  the kit `read_brand_kit` (no kitId) names for that site, else make one with a `brand_kit_ops` create (site). Set it on the project
  with a `use` op in the next call, say so in one line ("Made a brand kit from hyperframes.dev and set it on this project."), and
  build with it (`read_brand_kit` shows its scan filling in). Never ask about the brand look. If its scan ends
  `failed` or `cancelled`, say so in one line ("Couldn't make a brand kit from hyperframes.dev: its scan failed.") and
  build without a kit.
- **The template.** A saved template answers whatever its `TEMPLATE.md` slots hold; a gallery example's parts say
  which elements it expects to change.

Never ask again what any of these answered, and never ask what is cheap to change after the build: wording, colors,
a logo swap, fonts, a music pick. Choose those yourself. Facts are not yours to choose: a call to action, a price, a
figure, a date or a claim comes only from the person's message, files, site or kit; when none holds it, ask for it in
the round or leave it out and say so.

## 2. A quick look (minutes, not the watch)

- `hf-media evidence probe` for runtime, canvas, frame rate and audio; the overview sheets of
  [watch.md](watch.md#the-loop) step 1, which the watch reuses; `voice.transcribeAudio` when it speaks.
- From them write `.viral-clone/<slug>/intake.md`:
  - **the kind of film** (one row of SKILL.md's format table);
  - **its slots**: the segments in order with their seconds and what each carries (hook, hero feature, supporting
    features, proof, call to action);
  - **the bound list**: everything tied to the original's identity, with its time: names and logos, product screens
    and the features they show, claims and numbers, people, place, photos and product shots, music, URL and call to
    action.

## 3. One round, at most two more questions

Build a checklist from two sources, then keep only what is still open and costly:

| Source              | Items                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Every film (preset) | what we are making · format (canvas and length) · what the product is and who it is for                                 |
| This reference      | the kind's own questions (table below) · each bound element (a) or (b) must change · the person's material in its slots |

What we are making: (a) its style and structure for my product · (b) its style, my own story. "For it", "for our
company" or a product name settles (a). "Exactly as it is" keeps the form and still changes the people, voice and
words. An inferred answer is not a stated one: "something like this" leaves it open.
Either way the form is the reference's: (a) and (b) change the content, never the layout, the motion or the
shots. A motion-graphics reference is rebuilt 1:1 first, as much of it as its length and kind call for; a talking-head or creator reference has its pieces rebuilt
one at a time ([SKILL.md](../SKILL.md#choose-the-work)).

| Kind                              | Ask                                                                   |
| --------------------------------- | --------------------------------------------------------------------- |
| UGC, talking heads, avatar ads    | them, their avatar or a new person; whose voice; their words          |
| Product and UI films, MG launches | the product's real screens, a recording or the URL to capture; Stills |
| Music-driven edits                | their track, or one found to the reference's tempo                    |
| Explainers with data              | the data and its source                                               |
| Narrated films                    | a voiceover or none, and whose voice                                  |

**Homework first, then propose.** People rarely answer "what do you want to show?"; they pick well. Read their website,
kit or docs (app.capture when it is offered, otherwise `npx hyperframes capture URL`, for a URL they gave) and put their material into the reference's slots
before you ask, then propose: "Which feature goes here?" with B first, "(Recommended)", "shows best on screen".
Say a contradiction at once with its fix (15 s with six features; a dark reference against a cream brand).

**Merge to stay within two.** One question can settle several fields:

- **Bundle the options.** Format is one question whose options each set canvas, length and where it plays:
  "9:16, 30–45 s, for TikTok and Reels (Recommended)" · "16:9, 37 s, as the reference" · "16:9, about 20 s".
  Order them by the message: "for our TikTok" puts vertical first; otherwise the reference's own comes first.
- **One place, one question.** What goes in one part and the material that shows it are one question:
  "[at 0:13–0:19] Which feature, shown with which screens?".
- **Over two, keep the most costly**, in this order: what we are making · format · the hero slot and the product's
  real material · claims and proof bound to the original · the rest. Everything you
  drop becomes your own choice, said in one line of your reply.

**How each question is written.** Ask with your question tool: `hf_send_user_message`'s `questions` in the
HyperFrames agent, `AskUserQuestion` in Claude Code, `request_user_input` in Codex. A Codex without it asks with its
own `send_user_message` and ends the turn; the answers come back as the person's next message. At most four questions in a call (a fifth goes in a second call straight after). The person reads it in a small bubble on the canvas, so keep it short:

- **Question:** one sentence, at most 12 words. Never describe the reference: the bubble stands on the moment and it is
  playing. "Which feature goes here?", not "At this point the reference shows a cursor walking through…".
- **Plain words.** Write for someone who has never edited a video. Name what they see ("this part", "the opening",
  "these screens"), never an editing or production term: no slot, chapter, beat, angle, hero, panel, B-roll, cut or
  a count of the reference's parts ("the seven chapters"). "Which features should this part show?", not "Which
  Studio features fill the seven chapters?".
- **No times in the words.** The place tag below anchors the bubble on the moment, so neither the question nor an
  option says a time or a range.
- **Header:** one or two everyday words ("Features", "Format").
- **Options:** two to four, each label at most 6 words. The recommended one first, "(Recommended)" at the end of its
  label, and every option carries a reason of at most 10 words in its description (a choice's `detail` in
  `hf_send_user_message`), never empty: `AskUserQuestion` refuses the whole card over one missing.
- **The reference's way is the recommended one** when the message leaves it open. A presenter named "with her own
  voice" picks a voice for any speech; it does not ask for speech the reference never has. Ask "[at video] Should she
  speak?" with "Silent like hers (Recommended)" first and the speaking version second; only words that ask for the
  change ("make her talk", "add a voiceover") settle it the other way.
- **Each option says what they will see in their film**, in their words: "Your site's main features", "Real screens
  from your app". Never a strategy name: "Open-source and install angle" means nothing to someone who did not write
  it.
- **Every option is a whole answer the person can click and be done:** never "I'll give the URL" or "I'll type the
  numbers", which leave you waiting for words they think they gave. When only their own words answer it (a URL, real
  figures, a name), ask for them in the question ("Your site's URL?") and offer the defaults that need nothing more
  ("You pick from our site", "Leave the chart out").
- Your reasoning, the reference's details and the counts behind an estimate go in `.viral-clone/ask.md`, not in the
  question. Language is the person's own unless the reference speaks another.

**Say where it applies.** The app shows each question on the canvas where it belongs, so start every question with a
place tag, then the words:

| Tag              | Use for                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- |
| `[at 0:13–0:19]` | a stretch of the reference (minutes:seconds, start and end); `[at 0:28]` for one moment |
| `[at video]`     | the film as a whole: what we are making, format, product, voice                         |
| `[at brand]`     | only when their kit and the reference truly conflict (a dark reference, a cream brand)  |

"[at 0:13–0:19] Which feature goes here?" The tag is read off before the person sees the
question; never refer to the tag in the words. With `hf_send_user_message`, set the question's `about` instead of the
tag: `{ "start": 13, "end": 19 }` in seconds, `"video"` or `"brand"`. A question may only ask about what is on the person's
screen: never point at a script, beat sheet or draft that sits in a file or in your thinking.

### Whose voice

Whenever the remix has speech, ask `[at video]` "Whose voice should
speak?", header "Voice", unless the message or an attached recording already answers it, or the person picked their
own HeyGen avatar: its own voice speaks, said in one line of your reply. The options, in this order,
each one a route in [media.md](media.md#voice):

| Label                                        | Description                                 |
| -------------------------------------------- | ------------------------------------------- |
| My own recording of the script (Recommended) | Your voice and timing, exactly as recorded. |
| My voice, the creator's rhythm               | Upload 30 s–3 min of you talking.           |
| The avatar's own voice                       | Its voice at the creator's pace and pauses. |

With no HeyGen avatar in the film, the third reads "A ready-made voice". Never offer the creator's own voice.
Never offer the creator's exact intonation in the person's voice: HeyGen has no voice-conversion route. When they
pick the first or second and attached no audio, ask for the file in one line of your reply after the round; it is the
one follow-up the round allows, and the build waits only for it.

The app's setup asks this itself on every path, so its message carries the answer. With the person's takes,
`[voice: the voice in my takes, as recorded]` is route 1 with the takes' own sound. A HeyGen voice over the takes
(`[voice: … (<id>), saying my takes' words in place of their own voice]`) re-voices them. With one of their instant
clones, `voice.generateVoiceover` with the take as `target`. With a catalog voice, `voice.transcribeAudio` the takes, speak those words in that voice_id at the takes' pace (route 2 or 3), lay it
under the cut and drop the takes' own speech. The lips will not match on camera; the person was told so when they picked it.
`[voice: none, no spoken voiceover]` is a film with no voiceover: make no voice and ask nothing more about it. Any other
`[voice: "…"]` is the person's own words: follow them.

## 4. After the answers

- **Nothing paid planned:** say in one line what you will build and what you chose yourself, put up the first
  preview ([SKILL.md](../SKILL.md)), then start the watch.
- **Paid generations planned** (a person, a voice, generated shots, generated music): call the tool directly.
  It goes out at once; the person is never asked about the cost. Do not ask a cost question.
- Save the answers and your own choices as `.viral-clone/ask.md` and carry them into `frame.md`'s intent. Ask nothing
  new after the round, beyond the whose-voice file, unless the build finds something the answers could not know.
- Write every ask into `.viral-clone/asks.json`, one entry each: `{"ask": "<short words>", "from": "setup", "met":
null}` for every setup choice, `"from": "message"` for every line of the brief, and `"follow-up"` for each request
  a later message adds. Fill `met` as `{"at": "<seconds, as 12.0-15.5, or whole>", "how": "<one line of evidence>"}`
  only once a render shows it. `node scripts/vc.mjs asks` lists the open ones; the final waits until none is open.
  When the person asks to keep the reference's own words, quote them in that ask: the copy check lets quoted words
  through and holds every other run of 8 words or more.
