#!/usr/bin/env node
// A creator's sound palette, and the closest library sound for each piece of it. Each hit is described by its
// spectrum over time (24 log-spaced bands, 80 Hz–11 kHz, 11.6 ms frames, the 0.6 s after the attack), level-normalised,
// and two hits are compared by cosine similarity at the best shift within ±3 frames.
import { pathToFileURL } from "node:url";
import { readFileSync, realpathSync } from "node:fs";
import { samples, round } from "./media.mjs";

const USAGE = `usage: node sfx-match.mjs cluster <video> <events.json> [--min 0.8] [--events <scan.json> --min-strength 80]
       node sfx-match.mjs rank <video> --at t1,t2,… <candidate>…
cluster: <events.json> is sound-events.mjs output (or a JSON list of seconds). Groups hits that are the same sound: a
  creator reuses a few effects, so the big groups are the palette. Voice and music under each hit differ from one
  instance to the next while the effect stays the same, so it is the effect that groups. A group whose hits fall on a
  regular period is marked periodic: that is the music's drums, not an effect. Run it on the voice-free stem
  (separate.mjs) for a cleaner palette. With --events (temporal-scan output, --min-strength) each group reports the
  share of its hits on a visual event: an edit's effect sits on its cuts and graphics, a drum does not.
rank: averages the reference instances at those times, then ranks candidate files (say, media.find sound effects)
  by similarity to it. Above about 0.8 is the same kind of sound; above about 0.9 is very likely the same file.`;

const RATE = 22050,
  N = 1024,
  HOP = 256,
  FRAMES = 52,
  BANDS = 24,
  SHIFT = 3;
const EDGES = Array.from({ length: BANDS + 1 }, (_, i) => 80 * (11000 / 80) ** (i / BANDS));

function fft(re, im) {
  for (let i = 1, j = 0; i < re.length; i++) {
    let bit = re.length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= re.length; len <<= 1) {
    const a = (-2 * Math.PI) / len,
      wr = Math.cos(a),
      wi = Math.sin(a);
    for (let i = 0; i < re.length; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k],
          ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci,
          vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

const hann = Float64Array.from(
  { length: N },
  (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N),
);
const BAND_OF = Int8Array.from({ length: N / 2 }, (_, k) =>
  EDGES.findIndex((e, i) => i < BANDS && (k * RATE) / N >= e && (k * RATE) / N < EDGES[i + 1]),
);

/** Band-energy matrix (frames × bands, dB, max 0) of the 0.6 s after `t` in mono samples `x`. */
export function features(x, t) {
  const start = Math.max(0, Math.round((t - 0.03) * RATE));
  const out = [];
  for (let f = 0; f < FRAMES; f++) {
    const re = new Float64Array(N),
      im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (x[start + f * HOP + i] ?? 0) * hann[i];
    fft(re, im);
    const row = new Float64Array(BANDS);
    for (let k = 1; k < N / 2; k++)
      if (BAND_OF[k] >= 0) row[BAND_OF[k]] += re[k] * re[k] + im[k] * im[k];
    out.push(Array.from(row, (v) => 10 * Math.log10(v + 1e-12)));
  }
  const max = Math.max(...out.flat());
  return out.map((r) => r.map((v) => Math.max(-60, v - max)));
}

/** Cosine similarity of two feature matrices at the best frame shift. */
export function similarity(a, b) {
  let best = -1;
  for (let s = -SHIFT; s <= SHIFT; s++) {
    const x = [],
      y = [];
    for (let f = Math.max(0, s); f < Math.min(FRAMES, FRAMES + s); f++) {
      x.push(...a[f]);
      y.push(...b[f - s]);
    }
    const mx = x.reduce((p, v) => p + v, 0) / x.length,
      my = y.reduce((p, v) => p + v, 0) / y.length;
    let num = 0,
      dx = 0,
      dy = 0;
    for (let i = 0; i < x.length; i++) {
      num += (x[i] - mx) * (y[i] - my);
      dx += (x[i] - mx) ** 2;
      dy += (y[i] - my) ** 2;
    }
    best = Math.max(best, num / Math.sqrt(dx * dy || 1e-12));
  }
  return best;
}

const mean = (mats) =>
  mats[0].map((row, f) => row.map((_, b) => mats.reduce((p, m) => p + m[f][b], 0) / mats.length));

/** True when most hits sit between two equal gaps (or gaps in a 1:2 ratio): a drum on the beat, not an effect. */
function periodic(ts) {
  if (ts.length < 4) return false;
  let onBeat = 0;
  for (let i = 1; i < ts.length - 1; i++) {
    const r = (ts[i] - ts[i - 1]) / (ts[i + 1] - ts[i]);
    if ([0.5, 1, 2].some((k) => Math.abs(r / k - 1) < 0.08)) onBeat++;
  }
  return onBeat / (ts.length - 2) >= 0.5;
}

export function cluster(path, times, min = 0.8, events = null) {
  // Bands of one sound can trigger twice within 0.1 s; keep the first.
  times = times.filter((t, i) => i === 0 || t - times[i - 1] > 0.1);
  const x = samples(path, RATE);
  const feats = times.map((t) => features(x, t));
  const left = new Set(times.map((_, i) => i)),
    groups = [];
  for (const i of times.map((_, i) => i)) {
    if (!left.has(i)) continue;
    const members = [...left].filter((j) => j === i || similarity(feats[i], feats[j]) >= min);
    members.forEach((j) => left.delete(j));
    if (members.length >= 2) groups.push(members);
  }
  return groups
    .sort((a, b) => b.length - a.length)
    .map((g) => {
      const ts = g.map((j) => times[j]).sort((a, b) => a - b);
      const onEvents = events?.length
        ? round(
            ts.filter((t) => events.some((e) => Math.abs(e - t) <= 0.067)).length / ts.length,
            2,
          )
        : undefined;
      return {
        count: g.length,
        times: ts,
        periodic: periodic(ts),
        on_events: onEvents,
        consistency: round(
          g.reduce((p, j) => p + similarity(feats[g[0]], feats[j]), 0) / g.length,
          2,
        ),
      };
    });
}

export function rank(path, at, candidates) {
  const x = samples(path, RATE);
  const ref = mean(at.map((t) => features(x, t)));
  return candidates
    .map((c) => {
      const y = samples(c, RATE);
      // A library file's sound can start anywhere in its first half second: take the start that matches best.
      let best = [-1, 0];
      for (let t = 0; t <= Math.min(0.5, y.length / RATE - 0.1); t += 0.01) {
        const sc = similarity(ref, features(y, t + 0.03));
        if (sc > best[0]) best = [sc, t];
      }
      return { file: c, score: round(best[0], 3), starts_at: round(best[1], 2) };
    })
    .sort((a, b) => b.score - a.score);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [mode, video, ...rest] = process.argv.slice(2);
  const opt = (k) => {
    const i = rest.indexOf(`--${k}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (mode === "cluster" && video && rest[0]) {
    const raw = JSON.parse(readFileSync(rest[0], "utf8"));
    const times = (Array.isArray(raw) ? raw : raw.list).map((o) =>
      typeof o === "number" ? o : o.t,
    );
    let events = null;
    if (opt("events")) {
      const e = JSON.parse(readFileSync(opt("events"), "utf8"));
      events = (Array.isArray(e) ? e : e.events)
        .filter(
          (x) =>
            typeof x === "number" ||
            (x.kind === "change_candidate" && (x.strength ?? 0) >= +(opt("min-strength") ?? 0)),
        )
        .map((x) => (typeof x === "number" ? x : x.seconds));
    }
    console.log(
      JSON.stringify({
        hits: times.length,
        groups: cluster(video, times, +(opt("min") ?? 0.8), events),
      }),
    );
  } else if (mode === "rank" && video && opt("at")) {
    const files = rest.filter((r, i) => !r.startsWith("--") && rest[i - 1] !== "--at");
    console.log(JSON.stringify(rank(video, opt("at").split(",").map(Number), files)));
  } else {
    console.error(USAGE);
    process.exit(2);
  }
}
