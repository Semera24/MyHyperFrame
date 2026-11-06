#!/usr/bin/env node
// Rank candidate tracks by the structure a reference needs: where the strongest drop is (quiet → loud step), how
// big it is, the beat period, and the section energy curve. For a reference with a drop, the drop decides fit; for one
// without (a steady bed, an acoustic track), choose by beat period, energy curve and ending. Window correlation against
// the reference does not decide fit.
import { samples, round } from "./media.mjs";

const USAGE = `usage: node music-scan.mjs [--ref <ref.mp4>] [--cuts t1,t2,… [--tol 0.034]] <track>...
  --ref prints the reference's own drop and beat first; --cuts reports the share of those cut times on each file's beat
  grid beside the chance rate, which is how "cuts on the beat" is decided.`;
const HOP = 0.05;
const RATE = 16000;

function envelopes(path) {
  const x = samples(path, RATE);
  const h = Math.round(RATE * HOP);
  const full = [];
  for (let i = 0; i + h <= x.length; i += h) {
    let f = 0;
    for (let j = i; j < i + h; j++) f += x[j] * x[j];
    full.push(Math.sqrt(f / h));
  }
  return { full, x };
}

// Tempo from the autocorrelation of onset strength (rises in low-band and full-band energy, 10 ms hops), normalised per
// lag and weighted toward 120 BPM so a half or double tempo does not win on a smooth envelope.
function beat(x) {
  const hop = Math.round(RATE * 0.01);
  const lp = new Float32Array(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc += x[i] - (i >= 40 ? x[i - 40] : 0);
    lp[i] = acc / 40;
  }
  const flux = [];
  let prevF = 0,
    prevL = 0;
  for (let i = 0; i + hop <= x.length; i += hop) {
    let f = 0,
      l = 0;
    for (let j = i; j < i + hop; j++) {
      f += x[j] * x[j];
      l += lp[j] * lp[j];
    }
    const ef = Math.log10(f / hop + 1e-9),
      el = Math.log10(l / hop + 1e-9);
    flux.push(Math.max(0, ef - prevF) + Math.max(0, el - prevL));
    prevF = ef;
    prevL = el;
  }
  const sm = flux.map(
    (_, i) => [1, 2, 3, 2, 1].reduce((a, w, j) => a + w * (flux[i + j - 2] ?? 0), 0) / 9,
  );
  const m = sm.reduce((a, v) => a + v, 0) / sm.length;
  const e = sm.map((v) => v - m);
  const r = [];
  for (let k = 25; k <= 150; k++) {
    let s = 0;
    for (let i = 0; i + k < e.length; i++) s += e[i] * e[i + k];
    r[k] = s / (e.length - k);
  }
  let best = 25;
  const w = (k) => Math.exp(-0.5 * (Math.log2(6000 / k / 120) / 1.4) ** 2);
  for (let k = 26; k <= 150; k++) if (r[k] * w(k) > r[best] * w(best)) best = k;
  const a = r[best - 1] ?? r[best],
    b = r[best],
    c = r[best + 1] ?? r[best];
  const period = (best + (a - c) / (2 * (a - 2 * b + c) || 1)) * 0.01;
  let phase = [0, -1];
  for (let p = 0; p < period; p += 0.01) {
    let s = 0;
    for (let t = p; t / 0.01 < flux.length; t += period) s += flux[Math.round(t / 0.01)] ?? 0;
    if (s > phase[1]) phase = [p, s];
  }
  const sd = Math.sqrt(e.reduce((a, v) => a + v * v, 0) / e.length);
  let onsets = 0;
  for (let i = 0, last = -9; i < sm.length; i++)
    if (
      sm[i] > m + 1.5 * sd &&
      sm[i] >= (sm[i - 1] ?? 0) &&
      sm[i] >= (sm[i + 1] ?? 0) &&
      i - last >= 5
    )
      (onsets++, (last = i));
  return {
    beat_s: round(period, 3),
    bpm: round(60 / period, 1),
    phase_s: round(phase[0], 2),
    onsets_per_s: round(onsets / (flux.length * 0.01), 2),
  };
}

function onGrid(cuts, { beat_s, phase_s }, tol) {
  const off = cuts.map((t) => {
    const d = (((t - phase_s) % beat_s) + beat_s) % beat_s;
    return Math.min(d, beat_s - d);
  });
  return {
    cuts: cuts.length,
    on_beat: round(off.filter((d) => d <= tol).length / cuts.length, 2),
    chance: round((2 * tol) / beat_s, 2),
  };
}

function drop(full) {
  const pre = Math.round(6.5 / HOP),
    gap = Math.round(0.8 / HOP),
    post = Math.round(3 / HOP);
  let best = [0, 0];
  const avg = (a, b) => full.slice(a, b).reduce((s, v) => s + v, 0) / Math.max(1, b - a);
  for (let i = Math.min(pre, Math.round(2 / HOP)); i < full.length - post; i++) {
    const ratio = avg(i, i + post) / (avg(Math.max(0, i - pre), i - gap) + 1e-6);
    if (ratio > best[0]) best = [ratio, i];
  }
  return { at: round(best[1] * HOP, 2), ratio: round(best[0], 2) };
}

const args = process.argv.slice(2);
const refAt = args.indexOf("--ref");
const ref = refAt >= 0 ? args.splice(refAt, 2)[1] : null;
const cutsAt = args.indexOf("--cuts");
const cuts = cutsAt >= 0 ? args.splice(cutsAt, 2)[1].split(",").map(Number) : null;
const tolAt = args.indexOf("--tol");
const tol = tolAt >= 0 ? Number(args.splice(tolAt, 2)[1]) : 0.034;
if ((!args.length && !ref) || args.includes("--help")) {
  console.error(USAGE);
  process.exit(2);
}
for (const [label, path] of [...(ref ? [["ref", ref]] : []), ...args.map((p) => ["track", p])]) {
  const { full, x } = envelopes(path);
  const tempo = beat(x);
  const sections = [];
  for (let i = 0; i < full.length; i += Math.round(2 / HOP)) {
    const seg = full.slice(i, i + Math.round(2 / HOP));
    sections.push(round(20 * Math.log10(seg.reduce((s, v) => s + v, 0) / seg.length + 1e-9), 1));
  }
  console.log(
    JSON.stringify({
      label,
      path,
      seconds: round(full.length * HOP, 1),
      drop: drop(full),
      ...tempo,
      ...(cuts ? { cuts_on_beat: onGrid(cuts, tempo, tol) } : {}),
      section_db_every_2s: sections,
    }),
  );
}
