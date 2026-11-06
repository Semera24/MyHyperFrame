#!/usr/bin/env node
// Lifts one recurring effect out of a soundtrack: cuts every instance (from sfx-match.mjs cluster), aligns them to the
// sample by cross-correlation, and averages them. The effect is identical in every instance while the voice and music
// under it are not, so the average keeps the effect and lowers the rest by about 10·log10(N) dB.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { ffmpegBin, round, samples } from "./media.mjs";

const USAGE = `usage: node sfx-extract.mjs <audio> --at t1,t2,… --out <file.wav> [--len 0.8] [--pre 0.03]
  e.g. --out sfx/whoosh.wav. Run it on the voice-free stem (separate.mjs) so only the music has to average away.
  Writes a 48 kHz mono WAV with short fades, peak-normalised to −1 dBFS, and prints how alike the instances were
  (below about 0.5 they are not one sound).`;
const RATE = 48000,
  MAX_LAG = Math.round(0.02 * RATE);

function corr(a, b, lag) {
  let s = 0,
    ea = 0,
    eb = 0;
  for (let i = Math.max(0, -lag); i < Math.min(a.length, b.length - lag); i++) {
    s += a[i] * b[i + lag];
    ea += a[i] * a[i];
    eb += b[i + lag] * b[i + lag];
  }
  return s / Math.sqrt(ea * eb || 1e-12);
}

export function extract(path, at, { len = 0.8, pre = 0.03 } = {}) {
  const x = samples(path, RATE);
  const n = Math.round((len + pre) * RATE),
    pad = MAX_LAG;
  const cut = (t) =>
    x.subarray(Math.round((t - pre) * RATE) - pad, Math.round((t - pre) * RATE) + n + pad);
  const ref = cut(at[0]).subarray(pad, pad + n);
  const aligned = [],
    scores = [];
  for (const t of at) {
    const seg = cut(t);
    let best = [-2, 0];
    // Coarse search every 4 samples, then refine around the best.
    for (let lag = -pad; lag <= pad; lag += 4) {
      const c = corr(ref, seg.subarray(pad + lag - 0, pad + lag + n), 0);
      if (c > best[0]) best = [c, lag];
    }
    for (let lag = best[1] - 4; lag <= best[1] + 4; lag++) {
      const c = corr(ref, seg.subarray(pad + lag, pad + lag + n), 0);
      if (c > best[0]) best = [c, lag];
    }
    aligned.push(seg.subarray(pad + best[1], pad + best[1] + n));
    scores.push(best[0]);
  }
  const out = new Float32Array(n);
  for (const a of aligned) for (let i = 0; i < n; i++) out[i] += a[i] / aligned.length;
  const fadeIn = Math.round(0.005 * RATE),
    fadeOut = Math.round(0.06 * RATE);
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) out[n - 1 - i] *= i / fadeOut;
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-9);
  const gain = 10 ** (-1 / 20) / peak;
  for (let i = 0; i < n; i++) out[i] *= gain;
  return {
    audio: out,
    alike: round(scores.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, scores.length - 1), 2),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (k) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (!args[0] || !opt("at") || !opt("out")) {
    console.error(USAGE);
    process.exit(2);
  }
  const at = opt("at").split(",").map(Number);
  const { audio, alike } = extract(args[0], at, {
    len: +(opt("len") ?? 0.8),
    pre: +(opt("pre") ?? 0.03),
  });
  execFileSync(
    ffmpegBin(),
    [
      "-nostdin",
      "-v",
      "error",
      "-y",
      "-f",
      "f32le",
      "-ar",
      String(RATE),
      "-ac",
      "1",
      "-i",
      "-",
      opt("out"),
    ],
    { input: Buffer.from(audio.buffer) },
  );
  console.log(
    JSON.stringify({
      out: opt("out"),
      instances: at.length,
      alike,
      bed_reduction_db: round(10 * Math.log10(at.length), 1),
    }),
  );
}
