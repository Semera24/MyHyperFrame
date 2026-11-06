#!/usr/bin/env node
// Writes a 3D .cube LUT for one of the named grades: node grade-lut.mjs <name> [-o file] [--size 17]
// Model per colour: S-curve contrast, saturation about luma, split toning in shadows/mids/highlights, and an optional
// duotone mix for looks that recolour the whole frame. No dependencies.
import { writeFileSync } from "node:fs";

const hsv = (h, s = 1, v = 1) => {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
};
const tint = (h) => {
  const c = hsv(h);
  const m = (c[0] + c[1] + c[2]) / 3;
  return c.map((x) => x - m);
};
// wheels: [hue, amount] per zone; duotone: [shadow rgb, highlight rgb, mix]
export const GRADES = {
  "bleached-warm": {
    contrast: 0.05,
    sat: -0.12,
    shadows: [28, 0.5],
    mids: [38, 0.2],
    highs: [48, 0.38],
    lift: 0.05,
  },
  "hyper-neon": {
    contrast: 0.15,
    sat: 0.45,
    shadows: [135, 1.0],
    mids: [300, 0.3],
    highs: [320, 1.0],
  },
  "teal-orange": {
    contrast: 0.12,
    sat: 0.1,
    shadows: [188, 0.85],
    mids: [28, 0.15],
    highs: [30, 0.7],
  },
  "sodium-decay": {
    contrast: 0.1,
    sat: 0.15,
    shadows: [150, 0.85],
    mids: [100, 0.25],
    highs: [52, 0.85],
  },
  "cold-steel": {
    contrast: 0.08,
    sat: -0.15,
    shadows: [215, 0.6],
    mids: [210, 0.4],
    highs: [205, 0.35],
  },
  "bleach-bypass": { contrast: 0.32, sat: -0.55 },
  "candy-pink": {
    contrast: 0,
    sat: 0.2,
    shadows: [335, 0.5],
    mids: [332, 0.9],
    highs: [340, 0.7],
    duo: [[0.16, 0.02, 0.12], [1, 0.72, 0.86], 0.35],
  },
  "lime-jam": {
    contrast: 0,
    sat: 0.25,
    shadows: [110, 0.5],
    mids: [92, 1.0],
    highs: [75, 0.85],
    duo: [[0.03, 0.14, 0.02], [0.92, 1, 0.45], 0.4],
  },
  "nostalgic-blue": {
    contrast: -0.06,
    sat: -0.12,
    shadows: [222, 0.6],
    mids: [210, 0.42],
    highs: [200, 0.15],
    lift: 0.18,
  },
  "classic-bw": { sat: -1, contrast: 0.12 },
};

export function grade(p, [r, g, b]) {
  const luma = (x, y, z) => 0.2126 * x + 0.7152 * y + 0.0722 * z;
  let c = [r, g, b].map((x) => {
    if (p.contrast > 0) return x + (x * x * (3 - 2 * x) - x) * p.contrast * 2;
    if (p.contrast < 0) return 0.5 + (x - 0.5) * (1 + p.contrast);
    return x;
  });
  if (p.lift) c = c.map((x) => p.lift * 0.5 + x * (1 - p.lift * 0.5));
  let L = luma(...c);
  c = c.map((x) => L + (x - L) * (1 + (p.sat ?? 0)));
  L = luma(...c);
  const ws = (1 - L) ** 2,
    wh = L ** 2,
    wm = 4 * L * (1 - L);
  const z = [
    [p.shadows, ws],
    [p.mids, wm],
    [p.highs, wh],
  ];
  for (const [w, k] of z)
    if (w) {
      const t = tint(w[0]);
      c = c.map((x, i) => x + 0.35 * w[1] * k * t[i]);
    }
  if (p.duo) {
    const [lo, hi, mix] = p.duo;
    L = luma(...c);
    c = c.map((x, i) => x + mix * (lo[i] + (hi[i] - lo[i]) * L - x));
  }
  return c.map((x) => Math.min(1, Math.max(0, x)));
}

export function cube(name, size = 17) {
  const p = GRADES[name];
  if (!p) throw new Error(`grade must be one of ${Object.keys(GRADES).join(", ")}`);
  const lines = [`TITLE "${name}"`, `LUT_3D_SIZE ${size}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  for (let bi = 0; bi < size; bi++)
    for (let gi = 0; gi < size; gi++)
      for (let ri = 0; ri < size; ri++)
        lines.push(
          grade(p, [ri / (size - 1), gi / (size - 1), bi / (size - 1)])
            .map((x) => x.toFixed(5))
            .join(" "),
        );
  return lines.join("\n") + "\n";
}

if (process.argv[1]?.endsWith("grade-lut.mjs")) {
  const [name, ...rest] = process.argv.slice(2);
  const out = rest.includes("-o") ? rest[rest.indexOf("-o") + 1] : `${name}.cube`;
  const size = rest.includes("--size") ? Number(rest[rest.indexOf("--size") + 1]) : 17;
  writeFileSync(out, cube(name, size));
  console.log(out);
}
