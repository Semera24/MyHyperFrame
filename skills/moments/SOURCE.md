# Source

The moment-film skill makes every launch film in HyperFrames Desktop, with or without Moments: a feature launch,
product promo, demo or announcement from a website, a repo or PR, screenshots, Figma frames or an idea. It started
from Miguel's moment-film handoff (2026-10-03), took over its work in 2026-10 from the launch-film skill written for
the app (2026-10-08, reworked 2026-10-13), and keeps the moment-film name. It reads what the person wants, studies
Moments by eye (`refs wall`) and by their code, pitches three storylines, and builds by porting the Moments' code into
the product's story, with an optional storyboard stop in the Storyboard tab. Its craft (`references/craft.md`) was
measured frame by frame from 48 official HyperFrames and HeyGen launch films (2026-05 to 2026-10), with Jake Moran's
directing notes from the team channel; the per-film notes are in `docs/launch-film-official-films/`. It exists nowhere
public yet, so it is tracked here like `skills/talking-head`.

`main/appGuides.mjs` unpacks it as its own plugin, `main/momentAssets.mjs` names it in the note of any message carrying
a Moment, and `main/chatRules.mjs` sends it every launch, promo or demo request in place of product-launch-video; the
#Storyboard ability (`src/chat/abilities.ts`) turns its storyboard stops on. `scripts/refs.mjs` holds the Moment wall,
downloads with a strip of every frame, measurements, and `refs check`, which holds the study's depth before the gate
and fails a beat that ports a Moment without a `subject`, the product's own thing in place of the Moment's.
`scripts/film-gate.mjs` checks every frame: no empty frames, no dead time past 1.5 s, something new every 2.5 s, no
jitter or creep, every line on screen, worlds apart, seams in motion except a planned hard cut, and at most a third of
the seams planned as hard cuts. Each seam's two sides are shot whole at half scale, so a thin line or an svg's own
shape moving beside it counts. A held title, a logo shown only where the story lands it, and a background per world
all pass, as in the official films. A beat whose `keep` names `no jitter`, `lines on screen` or `hard cuts` with a finding it borrows is left out of
that check once the person approves the plan, and the report names it. The gate uses the runtime frame size for its viewport, screenshot crop and area
comparisons, refuses a root without data-width and data-height, and finds each beat's section as the runtime times it,
inline or mounted from a file. An image that cannot decode fails capture by its path; an `<img>` with no source is
skipped, as it loads nothing. Word counts keep accented letters and combining
marks together; Chinese and Japanese match per character, in runs that sit together in the line, and read per
dictionary word. `--dump <file>` saves a capture and `--replay <file>` analyzes one without a browser. `--beats <ids>`
checks only the beats from the first named to the last, for a later turn's edit: it sees 3.5 s either side, past the
longest hold limit, and to the film's end when that is nearer than 3 s, so a hold reaching those beats is judged as the
whole film judges it.
An app run gates through the film-gate script, which hands the gate to the app: the app runs it outside the agent's
sandbox on the studio's copy of the film (`main/agentSteps.mjs`). The skills run
their scripts as `node <SKILL_DIR>/scripts/<name>.mjs`, never through `sh` (Windows' PowerShell has none): a run's
PATH has the app's own Node when the machine has none that works (`main/agentCli.mjs`).

The moment-harvest skill (Miao, 2026-10-13) cuts a finished project into Moments in the same format: each is the
film's own code retimed to its window, with clip, still, dense.md, REMIX.md and a role. It ships as its own plugin
(`hyperframes-harvest`), loaded by a run only while `desktop-moment-harvest` is on (`main/appGuides.mjs`). Its scripts run
like moment-film's, and `tests/momentHarvest.test.mjs` checks the unpack, the flag, the cut and these hashes.

Examples in moment-film use `M<id>`, never a real Moment: an id named there becomes the agent's default pick, so
`tests/momentFilmNoExampleIds.test.mjs` fails on one.

Check a copy from this folder with `sed -n '/^```text$/,/^```$/p' SOURCE.md | grep -v '```' | shasum -a 256 -c`.

```text
d0c982cef673152e2529fb2fb078e9d2eb8746902ebec93b3180a0223a3ada92  ./moment-film/SKILL.md
30206f6c6b38d7c02644a7531d470610225a33a98acf8235529352b54151b04c  ./moment-film/assets/film.json
fd27e16403db99c854f36e6a483981ce656bec7f362c192dd1cb03822d5fb3da  ./moment-film/assets/fixes.md
0a5f4b037e4e1929cf35f0c7830ebe9c4148743bfe76201f3fbedf0cda61dcff  ./moment-film/assets/refs.md
159f94eccf30c79e1c8d43d2299b87adf676be733c21fcc1088a0a21ca1651e6  ./moment-film/assets/storyboard.html
f1ca20e2ffd4d92663fe6703c38c5ea0149fc2e95fab7a9405b34a05df9380d6  ./moment-film/references/borrow.md
d54f2290adf4a45256b7fd23a2bf480c14fc7b76a31eb28b5e38bf720d136345  ./moment-film/references/craft.md
0319b48bc8a1b6feda55c139a2fcc61899a70cee87bd709d734202e909a987e0  ./moment-film/references/floor.md
0b99eb9988f02f3d8656498bcd2ec87ae6d66feeaee48c9110ea6b30ac0e9b66  ./moment-film/references/real-ui.md
98790a9b04b7d2f3a42fd3d758d75933f10095b84fefbec073c28da0311cf29f  ./moment-film/references/sound.md
13c1edf626710161ff44cdbb9f6d5b7df1302020e94ce877c50129a5dcbf2bc7  ./moment-film/references/story.md
b23b0416a13d609972143978a5c67e7a66319199d7bb71f231357a222757142c  ./moment-film/references/study.md
3162e35111a403f8f5938dec4c07db46605135406e8cfb9bd8c61a4cae04b885  ./moment-film/scripts/features.mjs
0a25de4fb0817ef5e425d991c6599e936be8d114704088c0490eba062267e6f0  ./moment-film/scripts/film-gate.mjs
49f7fd4668748d1c5f8a3b6baeaba658e4d8426ffdab25c042fd914716582588  ./moment-film/scripts/filmFrame.mjs
f80819dec1443691b23a47f6559e20aa9a5daf55b74974d8c5d8e05556cb1e39  ./moment-film/scripts/filmPixels.mjs
f14a660f8b47fea3aa2a7d07d297d7bc887c435c5c717b0eca1f7dfddcbb198c  ./moment-film/scripts/filmWords.mjs
c561d41d91770fa7fbc844e84016c4863d8ed24aa3e06ccb4c87251b3b59c770  ./moment-film/scripts/hfCli.mjs
7b20bd31658599d1712873f47ff4d9c50fe4d2975825dd8b9438aa79d1c8efcf  ./moment-film/scripts/processTree.mjs
1401d960f7ddf08fd04c2e0f76b6fdfce453102f575f1cde9472f974a719088a  ./moment-film/scripts/refs.mjs
c46f425ba83015dd9289f0689750869bbafb38692388d14d44dd62a7181e41d5  ./moment-harvest/SKILL.md
2713b2533f6cf6d1d7706dd0baae3ab214f94e8e21fbca86a4e236d0c05abed6  ./moment-harvest/scripts/harvest-gate.mjs
c9c074748be14fe84005863dd5718f5ead33e223863e803dabd67a285027c88c  ./moment-harvest/scripts/harvest.mjs
c561d41d91770fa7fbc844e84016c4863d8ed24aa3e06ccb4c87251b3b59c770  ./moment-harvest/scripts/hfCli.mjs
```
