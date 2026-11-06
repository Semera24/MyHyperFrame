#!/usr/bin/env node
// How a voice is delivered, as numbers you can compare without hearing it: pitch (median Hz, the p10–p90 range in
// semitones, and how much it moves), the share of phrases that end rising, and pauses (per minute, median, longest).
// Pitch is a YIN estimate on 40 ms windows; music left under the voice makes it unreliable.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { samples, round } from "./media.mjs";

const USAGE = `usage: node prosody.mjs <audio-or-video> [--start s] [--seconds n] [--compare <other> [--other-start s]]
  Run it on the reference speaker's vocal stem (separate.mjs) and on our take over the same kind of passage.`;
const RATE = 16000,
  WIN = 640,
  HOP = 320; // 40 ms windows every 20 ms

function pitch(x) {
  const minT = Math.floor(RATE / 400),
    maxT = Math.ceil(RATE / 70);
  const out = [];
  for (let i = 0; i + WIN + maxT < x.length; i += HOP) {
    let e = 0;
    for (let j = i; j < i + WIN; j++) e += x[j] * x[j];
    const rms = Math.sqrt(e / WIN);
    const d = new Float32Array(maxT + 1);
    for (let t = minT; t <= maxT; t++) {
      let s = 0;
      for (let j = i; j < i + WIN; j++) {
        const v = x[j] - x[j + t];
        s += v * v;
      }
      d[t] = s;
    }
    let sum = 0,
      best = 0,
      bestV = 1;
    for (let t = minT; t <= maxT; t++) {
      sum += d[t];
      const c = (d[t] * (t - minT + 1)) / (sum || 1e-12);
      if (c < 0.15) {
        while (t + 1 <= maxT && d[t + 1] < d[t]) t++;
        best = t;
        bestV = c;
        break;
      }
      if (c < bestV) ((bestV = c), (best = t));
    }
    out.push({ t: i / RATE, rms, f0: bestV < 0.3 && best ? RATE / best : 0 });
  }
  return out;
}

export function prosody(path, start = 0, seconds = 0) {
  const all = samples(path, RATE);
  const x = all.subarray(
    Math.floor(start * RATE),
    seconds ? Math.floor((start + seconds) * RATE) : all.length,
  );
  const fr = pitch(x);
  const loud = [...fr.map((f) => f.rms)].sort((a, b) => a - b);
  const floor = Math.max(1e-4, loud[Math.floor(loud.length * 0.95)] * 0.08); // silence: under 8% of the loud level
  const voiced = fr.filter((f) => f.f0 && f.rms > floor).map((f) => f.f0);
  const sorted = [...voiced].sort((a, b) => a - b);
  const q = (p) => sorted[Math.floor(sorted.length * p)] ?? 0;
  const med = q(0.5);
  const st = voiced.map((f) => 12 * Math.log2(f / (med || 1)));
  const sd = Math.sqrt(st.reduce((a, v) => a + v * v, 0) / Math.max(1, st.length));
  // pauses: silent runs of 0.2 s or more between sound; phrase ends: pitch over the last 0.3 s before each pause
  const pauses = [];
  let rising = 0,
    phrases = 0;
  for (let i = 0, run = 0; i < fr.length; i++) {
    if (fr[i].rms <= floor) run++;
    else {
      if (run * 0.02 >= 0.2 && i - run > 0) {
        pauses.push(run * 0.02);
        const end = fr
          .slice(Math.max(0, i - run - 15), i - run)
          .filter((f) => f.f0 && f.rms > floor)
          .map((f) => f.f0);
        if (end.length >= 6) {
          phrases++;
          const a = end.slice(0, 3).reduce((s, v) => s + v, 0) / 3,
            b = end.slice(-3).reduce((s, v) => s + v, 0) / 3;
          if (12 * Math.log2(b / a) > 1) rising++;
        }
      }
      run = 0;
    }
  }
  const ps = [...pauses].sort((a, b) => a - b);
  const minutes = x.length / RATE / 60;
  return {
    path,
    start,
    seconds: round(x.length / RATE, 1),
    f0_median_hz: round(med, 0),
    f0_range_semitones: round(12 * Math.log2((q(0.9) || 1) / (q(0.1) || 1)), 1),
    f0_sd_semitones: round(sd, 2),
    rising_phrase_share: round(rising / Math.max(1, phrases), 2),
    pauses_per_min: round(pauses.length / Math.max(1e-6, minutes), 1),
    median_pause_s: round(ps[Math.floor(ps.length / 2)] ?? 0, 2),
    longest_pause_s: round(ps.at(-1) ?? 0, 2),
    voiced_share: round(voiced.length / Math.max(1, fr.length), 2),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : dflt;
  };
  const start = Number(opt("--start", 0)),
    seconds = Number(opt("--seconds", 0)),
    other = opt("--compare", null),
    oStart = Number(opt("--other-start", 0));
  if (args.length !== 1 || args[0] === "--help") {
    console.error(USAGE);
    process.exit(2);
  }
  const a = prosody(args[0], start, seconds);
  if (!other) console.log(JSON.stringify(a, null, 1));
  else {
    const b = prosody(other, oStart, seconds);
    const keys = [
      "f0_range_semitones",
      "f0_sd_semitones",
      "rising_phrase_share",
      "pauses_per_min",
      "median_pause_s",
    ];
    console.log(
      JSON.stringify(
        {
          ref: a,
          ours: b,
          semitones_apart: round(12 * Math.log2((b.f0_median_hz || 1) / (a.f0_median_hz || 1)), 1),
          ratio: Object.fromEntries(keys.map((k) => [k, a[k] ? round(b[k] / a[k], 2) : null])),
        },
        null,
        1,
      ),
    );
  }
}
