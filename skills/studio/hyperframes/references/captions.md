# Captions

## Words and timings

- A voiceover from `voice.generateVoiceover` and a transcript from `voice.transcribeAudio` come with every word's start and end. Work from those as `[{ "id": "w0", "text": "Hello", "start": 0.0, "end": 0.5 }, …]`.
- Reuse existing transcript or voiceover word timings. When recognition is needed, use `voice.transcribeAudio` through Desktop, which uses HeyGen Scribe v2 with speaker labels and exact word timings. Transcription requires an internet connection.
- For Chinese, Japanese and other unspaced scripts, check that the returned characters match what is said. Keep supplied word timings; do not invent word-level timing by spreading a sentence across characters.
- Read the transcript before using it. More than 20% `♪` or `�` tokens, or nonsense words, means it failed. Check the source audio and report the failure; do not automatically submit another paid transcription. Drop non-word tokens before building groups.

## Structure

- One sub-composition host with `data-track-kind="captions"` holds every caption group, so Studio shows them on one captions track.
- Ready-made styles: `hyperframes catalog --tag caption-style --json`. An installed one is source you can restyle.

## Groups

- 2–3 words for high energy, 3–5 conversational, 4–6 calm. Break at a sentence end, a pause of 150 ms or more, or the word limit.
- One group visible at a time.
- Every group ends with a hard kill after its exit, or a stale group can stay on screen:

```js
tl.to(group, { opacity: 0, duration: 0.12, ease: "power2.in" }, end - 0.12);
tl.set(group, { opacity: 0, visibility: "hidden" }, end);
```

`tl.set` is an instant flip, so setting `visibility` on the group is fine; never tween it on a `.clip`.

## Fit and place

- Size each group to fit: `window.__hyperframes.fitTextFontSize(text, { fontFamily, fontWeight, maxWidth })` returns `{ fontSize }`. Defaults: `maxWidth` 1600 landscape, 900 portrait; base 78, minimum 42, step 2. When a word scales up for emphasis, divide `maxWidth` by that scale.
- A full-width absolute container, centred with text alignment. Never `left: 50%; transform: translateX(-50%)`, which clips at the frame edges.
- `overflow: visible`, not `hidden`, which cuts off scaled words and glows.
- Landscape: 80–120 px from the bottom. Portrait: about 600–700 px from the bottom. Never over the speaker's face; inside the 80% title-safe box.
