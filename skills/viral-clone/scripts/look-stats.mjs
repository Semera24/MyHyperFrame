#!/usr/bin/env node
// The look of a stretch of film as numbers, so a remix's grade can be compared with the reference's beat by beat:
// mean luma and contrast (0–255), mean saturation (0–1, HSV), the share of frames that are black and white
// (under 2% of mid-tone pixels carry color, so a color face in a white room is not black and white), and warmth
// (mean R − B, negative is cool). Sampled at --fps (default 2), 160 px wide; --roi measures one region, e.g. a person.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ffprobeBin, frames, roi, round } from "./media.mjs";
import { execFileSync } from "node:child_process";

const USAGE = `usage: node look-stats.mjs <video> <start> <seconds> [--fps 2] [--roi x,y,w,h]
       node look-stats.mjs --compare <ref> <ref-start> <draft> <draft-start> <seconds> [--roi x,y,w,h] [--draft-roi x,y,w,h]`;

function size(path) {
  const out = execFileSync(ffprobeBin(), [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    path,
  ])
    .toString()
    .trim()
    .split(",")
    .map(Number);
  return out;
}

export function look(path, start, seconds, fps = 2, box = null) {
  const [w, h] = size(path);
  const fs = frames(path, start, seconds, box ?? [0, 0, w, h], { fps, width: 160 });
  const per = fs.map((f) => {
    let l = 0,
      l2 = 0,
      s = 0,
      warm = 0,
      mid = 0,
      tinted = 0;
    const n = f.length / 3;
    for (let i = 0; i < f.length; i += 3) {
      const [r, g, b] = [f[i], f[i + 1], f[i + 2]];
      const y = 0.299 * r + 0.587 * g + 0.114 * b,
        mx = Math.max(r, g, b),
        mn = Math.min(r, g, b);
      l += y;
      l2 += y * y;
      s += mx ? (mx - mn) / mx : 0;
      warm += r - b;
      if (y > 40 && y < 220) (mid++, mx - mn > 25 && tinted++);
    }
    const mean = l / n;
    return {
      luma: mean,
      contrast: Math.sqrt(Math.max(0, l2 / n - mean * mean)),
      sat: s / n,
      warm: warm / n,
      bw: tinted < 0.02 * Math.max(1, mid),
    };
  });
  const avg = (k) => per.reduce((a, p) => a + p[k], 0) / (per.length || 1);
  return {
    frames: per.length,
    luma: round(avg("luma"), 1),
    contrast: round(avg("contrast"), 1),
    saturation: round(avg("sat"), 3),
    bw_share: round(per.filter((p) => p.bw).length / (per.length || 1), 2),
    warmth: round(avg("warm"), 1),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--compare") {
    const opt = (name) => {
      const i = args.indexOf(name);
      return i >= 0 ? roi(args.splice(i, 2)[1]) : null;
    };
    const rBox = opt("--roi"),
      dBox = opt("--draft-roi");
    if (args.length < 6) {
      console.error(USAGE);
      process.exit(2);
    }
    const [, ref, rs, draft, ds, secs] = args;
    const a = look(ref, +rs, +secs, 2, rBox),
      b = look(draft, +ds, +secs, 2, dBox);
    const ratio = (k) => round(b[k] / (a[k] || 1e-9), 2);
    console.log(
      JSON.stringify({
        ref: a,
        draft: b,
        luma_ratio: ratio("luma"),
        contrast_ratio: ratio("contrast"),
        saturation_ratio: ratio("saturation"),
        bw_share_diff: round(b.bw_share - a.bw_share, 2),
        warmth_diff: round(b.warmth - a.warmth, 1),
      }),
    );
  } else {
    const pos = [],
      opt = {};
    for (let i = 0; i < args.length; i++)
      args[i].startsWith("--") ? (opt[args[i].slice(2)] = args[++i]) : pos.push(args[i]);
    if (pos.length < 3) {
      console.error(USAGE);
      process.exit(2);
    }
    console.log(
      JSON.stringify(
        look(pos[0], +pos[1], +pos[2], +(opt.fps ?? 2), opt.roi ? roi(opt.roi) : null),
      ),
    );
  }
}
