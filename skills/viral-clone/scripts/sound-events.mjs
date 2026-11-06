#!/usr/bin/env node
// Sound-effect candidates: sharp attacks in the air band above 9 kHz (whoosh, pop, click, swipe, typing, cash
// register), where speech carries little energy, and in the low band under 150 Hz (impact, boom, bass hit), found as a
// jump in short-time energy (10 ms frames) of at least --rise dB over the median of the 150 ms before it.
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { ffmpegBin, round, samples } from "./media.mjs";

const USAGE = `usage: node sound-events.mjs <video> [--start s --end e] [--events …] [--min-strength 20] [--words words.json] [--rise 12] [--full]
       node sound-events.mjs --selftest
Run it on the voice-free stem (separate.mjs) when there is speech; on the full mix a candidate inside speech is only a
candidate.
- With --events (seconds, comma-separated, a JSON list, or \`hf-media evidence temporal-scan\` output with
  --min-strength), each onset gets its nearest visual event, and event_lift is the onset rate within two frames of
  an event over the rate elsewhere: near 1, the edit leaves its cuts and graphics silent; well above 1, it sounds them.
- With --words (a transcript JSON with word start, end and text), each onset names the word it lands on (word,
  word_offset), and phrase_lift does for phrase starts what event_lift does for picture events: an effect can be
  anchored to speech rather than to the picture.
- A run of three or more strong hits under 0.25 s apart carries a burst number: one effect (a stutter, a run).
- With --full (no speech, or sound as the content: ASMR, foley) it also scans 1–8 kHz, where taps, crinkles and most
  foley sit; with speech that band is mostly the voice.`;

function energyDb(x, rate) {
  const hop = rate / 100; // 10 ms
  const out = new Float32Array(Math.floor(x.length / hop));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += x[j] * x[j];
    out[i] = 10 * Math.log10(s / hop + 1e-10);
  }
  return out;
}

function onsets(db, rise, band) {
  const found = [];
  let last = -1e9;
  for (let i = 15; i < db.length; i++) {
    const before = Array.from(db.subarray(i - 15, i)).sort((a, b) => a - b)[7];
    const peak = Math.max(db[i], db[i + 1] ?? -200, db[i + 2] ?? -200);
    if (peak - before >= rise && db[i] - db[i - 1] >= rise / 3 && i - last >= 12 && peak > -70) {
      found.push({ t: i / 100, band, rise_db: round(peak - before, 1), level_db: round(peak, 1) });
      last = i;
    }
  }
  return found;
}

function readList(v, minStrength = 0) {
  if (!v) return null;
  const raw = existsSync(v) ? JSON.parse(readFileSync(v, "utf8")) : v.split(",").map(Number);
  const list = Array.isArray(raw) ? raw : (raw.events ?? []);
  return list
    .filter(
      (e) =>
        typeof e === "number" ||
        e.kind === undefined ||
        (e.kind === "change_candidate" && (e.strength ?? 0) >= minStrength),
    )
    .map((e) => (typeof e === "number" ? e : (e.t ?? e.seconds ?? e.time ?? e.start)))
    .filter(Number.isFinite);
}

// One sound often trips both bands; keep one onset per 30 ms with the bands it hit.
function merge(list) {
  const out = [];
  for (const o of list.sort((a, b) => a.t - b.t)) {
    const prev = out.at(-1);
    if (prev && o.t - prev.t <= 0.03) {
      if (!prev.band.includes(o.band)) prev.band += `+${o.band}`;
      prev.rise_db = Math.max(prev.rise_db, o.rise_db);
    } else out.push({ ...o });
  }
  return out;
}

function readWords(v) {
  if (!v) return null;
  const file = JSON.parse(readFileSync(v, "utf8")),
    raw = file.data ?? file;
  const list = Array.isArray(raw)
    ? raw
    : (raw.words ?? raw.segments?.flatMap((s) => s.words ?? []) ?? []);
  return list
    .map((w) => [w.start, w.end, (w.word ?? w.text ?? "").trim()])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
}

/** How much more often onsets fall within ±win of the anchors than elsewhere (1 = chance). */
function anchorLift(onsets, anchors, seconds, win) {
  if (!anchors.length) return null;
  let covered = 0,
    open = null;
  for (const [a, b] of anchors.map((e) => [e - win, e + win]).sort((x, y) => x[0] - y[0])) {
    if (!open || a > open[1]) {
      if (open) covered += open[1] - open[0];
      open = [a, b];
    } else open[1] = Math.max(open[1], b);
  }
  if (open) covered += open[1] - open[0];
  const near = onsets.filter((t) => anchors.some((e) => Math.abs(e - t) <= win)).length;
  return seconds > covered
    ? near / covered / ((onsets.length - near || 0.5) / (seconds - covered))
    : null;
}

export function scan(
  path,
  {
    start = 0,
    end = Infinity,
    rise = 12,
    events = null,
    words = null,
    fps = 30,
    full = false,
  } = {},
) {
  const hi = energyDb(samples(path, 44100, "highpass=f=9000"), 44100);
  const lo = energyDb(samples(path, 16000, "lowpass=f=150"), 16000);
  const mid = full
    ? onsets(energyDb(samples(path, 22050, "highpass=f=1000,lowpass=f=8000"), 22050), rise, "mid")
    : [];
  let all = merge([...onsets(hi, rise, "high"), ...onsets(lo, rise, "low"), ...mid]).filter(
    (o) => o.t >= start && o.t <= end,
  );
  const frame2 = 2 / fps;
  all = all.map((o) => {
    const extra = {};
    if (events?.length) {
      const near = events.reduce((a, e) => (Math.abs(e - o.t) < Math.abs(a - o.t) ? e : a));
      Object.assign(extra, { near_event: round(near, 3), offset_s: round(o.t - near, 3) });
    }
    if (words?.length) {
      extra.in_speech = words.some(([a, b]) => o.t >= a && o.t <= b);
      // The word the effect lands on: the word starting nearest to it within 0.3 s, else the one it falls inside.
      const near = words.reduce(
        (best, w) => (Math.abs(w[0] - o.t) < Math.abs((best?.[0] ?? 1e9) - o.t) ? w : best),
        null,
      );
      const w =
        near && Math.abs(near[0] - o.t) <= 0.3
          ? near
          : words.find(([a, b]) => o.t >= a && o.t <= b);
      if (w) Object.assign(extra, { word: w[2], word_offset: round(o.t - w[0], 3) });
    }
    return { ...o, ...extra };
  });
  // A run of three or more strong hits (20 dB or more) under 0.25 s apart is one effect (a stutter, a typing run).
  const strong = all.filter((o) => o.rise_db >= 20);
  let burst = 0;
  for (let i = 0; i < strong.length; i++) {
    let j = i;
    while (j + 1 < strong.length && strong[j + 1].t - strong[j].t <= 0.25) j++;
    if (j - i >= 2) {
      burst++;
      for (let k = i; k <= j; k++) strong[k].burst = burst;
    }
    i = j;
  }
  const seconds = Math.min(end, hi.length / 100) - start,
    minutes = seconds / 60;
  const ev = events?.filter((e) => e >= start && e <= end) ?? [];
  // Phrase starts: a word after a pause of 0.25 s or more (or the first word). Character-timed languages put a word
  // start every 0.2 s, so anchoring is judged on phrases rather than on single words.
  const phrases = (words ?? [])
    .filter(([a], i, w) => i === 0 || a - w[i - 1][1] >= 0.25)
    .map(([a]) => a)
    .filter((a) => a >= start && a <= end);
  const lift = anchorLift(
    all.map((o) => o.t),
    ev,
    seconds,
    frame2,
  );
  const phraseLift = anchorLift(
    all.map((o) => o.t),
    phrases,
    seconds,
    frame2,
  );
  return {
    onsets: all.length,
    per_minute: round(all.length / minutes, 1),
    high: all.filter((o) => o.band === "high").length,
    low: all.filter((o) => o.band === "low").length,
    ...(ev.length
      ? {
          events: ev.length,
          share_of_events_with_sound: round(
            ev.filter((e) => all.some((o) => Math.abs(o.t - e) <= frame2)).length / ev.length,
            2,
          ),
          event_lift: round(lift, 2),
        }
      : {}),
    ...(words
      ? {
          outside_speech: all.filter((o) => !o.in_speech).length,
          phrases: phrases.length,
          share_of_phrases_with_sound: round(
            phrases.filter((p) => all.some((o) => Math.abs(o.t - p) <= frame2)).length /
              (phrases.length || 1),
            2,
          ),
          phrase_lift: round(phraseLift, 2),
        }
      : {}),
    bursts: burst,
    list: all,
  };
}

async function selftest() {
  const f = `${mkdtempSync(`${tmpdir()}/sfx-`)}/t.wav`;
  // A quiet tone bed, two noise bursts (whooshes) at 1.0 and 2.5 s, a 60 Hz thump at 4.0 s.
  execFileSync(ffmpegBin(), [
    "-nostdin",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=f=440:d=6:r=44100",
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=d=6:c=white:a=0.6:r=44100",
    "-f",
    "lavfi",
    "-i",
    "sine=f=60:d=0.3:r=44100",
    "-filter_complex",
    "[0]volume=0.05[bed];[1]highpass=f=4000,volume='if(between(t,1,1.1)+between(t,2.5,2.6),1,0)':eval=frame[n];" +
      "[2]afade=t=in:d=0.08,afade=t=out:st=0.15:d=0.15,adelay=4000:all=1[k];[bed][n][k]amix=inputs=3:normalize=0:duration=first",
    "-ac",
    "1",
    f,
  ]);
  const r = scan(f, { events: [1, 4, 5.5] });
  const has = (t, band) => r.list.some((o) => o.band.includes(band) && Math.abs(o.t - t) <= 0.06);
  const ok =
    has(1, "high") &&
    has(2.5, "high") &&
    has(4, "low") &&
    r.onsets <= 4 &&
    r.share_of_events_with_sound === 0.67;
  console.log(
    JSON.stringify({
      ok,
      found: r.list.map((o) => [o.t, o.band]),
      share_of_events_with_sound: r.share_of_events_with_sound,
      event_lift: r.event_lift,
    }),
  );
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--selftest") await selftest();
  else {
    const pos = [],
      opt = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--full") opt.full = true;
      else args[i].startsWith("--") ? (opt[args[i].slice(2)] = args[++i]) : pos.push(args[i]);
    }
    if (!pos[0]) {
      console.error(USAGE);
      process.exit(2);
    }
    console.log(
      JSON.stringify(
        scan(pos[0], {
          start: +(opt.start ?? 0),
          end: opt.end ? +opt.end : Infinity,
          rise: +(opt.rise ?? 12),
          fps: +(opt.fps ?? 30),
          events: readList(opt.events, +(opt["min-strength"] ?? 0)),
          words: readWords(opt.words),
          full: "full" in opt,
        }),
      ),
    );
  }
}
