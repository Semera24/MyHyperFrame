# Floor

What every launch film keeps, whatever the storyline or the Moment. Only the person can lift a rule here, by asking for
it in words. `scripts/film-gate.mjs` checks most of it and must exit 0 before you reply.

## 1. Rules

1. **Real UI only**, rebuilt from the product's screenshots, capture or recordings (`real-ui.md`). Never an invented
   screen; a missing one is a labelled placeholder.
2. **Readable**: every line shown whole, long enough to read, at a size a phone can read; the UI the story is about
   big enough to read too.
3. **Motion that is either real or none**: a move covers distance at a speed you can see, or the thing holds dead
   still. No creeping scale, no wobble, no breathing loops.
4. **Motion blur on fast moves**, riding the move's own ease (`craft.md` §8).
5. **The person's facts and assets as given**: no invented numbers, customers or quotes; their fonts, music and footage
   used, never swapped for something similar; the brand's real logo, never redrawn.

## 2. What the gate checks

`film.json` against `index.html`: times match and beats are contiguous, every beat has a `line` of at most 6 words with
no trailing period (`""` for a wordless beat), `feature.name` and `feature.after` are set, `brandReveal` names a beat. Then every frame, seeked:

- no empty frames, and no whole frame frozen for more than 1.5 s except the final hold, which may last 3 s;
- something happening at least every 2.5 s;
- no jitter (an element reversing on short legs), and no creep (a scale change too slow to read as motion);
- every `film.json` line fully on screen at some moment, and no scene's words landing on another scene's picture;
- the brand mark, tagged `data-brand-mark`, seen at least once;
- every cut taken while both sides move, unless it is a hard cut you planned, and at most a third of the seams are
  planned hard cuts.

A beat whose `keep` names one of `no jitter`, `lines on screen` or `hard cuts` with a finding it borrows is left out
of that check once `approved` is set: the person's reference does it on purpose. The report names each kept check.

A held title, a logo that appears only where the story lands it, and a different background per world all pass: the
official films do all three.
