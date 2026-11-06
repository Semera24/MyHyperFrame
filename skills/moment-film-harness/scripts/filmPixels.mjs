// A moment film's pixels are the frames `hyperframes snapshot` draws, as a render does: it takes each video's frame
// with ffmpeg, which a page screenshot cannot (headless Chrome plays no HEVC). Node 22+, no npm dependencies.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";
import { cliCall } from "./hfCli.mjs";
import { stopTree } from "./processTree.mjs";

const run = promisify(execFile);
// Times per snapshot run: each run starts a browser, so fewer runs; each is one progress step, so not too many.
const CHUNK = 25;
/** The snapshot runs now going; a gate that stops ends them and their browsers rather than leave them behind. */
const running = new Set();
export const stopFrames = () => running.forEach((child) => stopTree(child.pid));
/** A time as the snapshot names it: milliseconds, no more. */
const at = (t) => Math.round(t * 1000) / 1000;

/** The 8-bit PNG as rgb. */
export function decodePng(buf) {
  let pos = 8,
    w = 0,
    h = 0,
    depth = 0,
    type = 0,
    interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    pos += 12 + len;
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || interlace || !bpp) throw new Error("unsupported PNG");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const rgb = Buffer.alloc(w * h * 3);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0,
        b = prev[x],
        c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const i = x * bpp,
        o = (y * w + x) * 3;
      if (bpp >= 3) {
        rgb[o] = line[i];
        rgb[o + 1] = line[i + 1];
        rgb[o + 2] = line[i + 2];
      } else rgb[o] = rgb[o + 1] = rgb[o + 2] = line[i];
    }
    prev = line;
  }
  return { w, h, rgb };
}

/** The picture averaged down to `scale` of its size, in whole blocks (a 1920 px frame at 0.125 is 240 px wide). */
export function shrink({ w, h, rgb }, scale) {
  const k = Math.max(1, Math.round(1 / scale));
  const nw = Math.ceil(w / k),
    nh = Math.ceil(h / k);
  const out = Buffer.alloc(nw * nh * 3);
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++) {
      const sum = [0, 0, 0];
      let n = 0;
      for (let yy = y * k; yy < Math.min(h, y * k + k); yy++)
        for (let xx = x * k; xx < Math.min(w, x * k + k); xx++, n++) {
          const o = (yy * w + xx) * 3;
          sum[0] += rgb[o];
          sum[1] += rgb[o + 1];
          sum[2] += rgb[o + 2];
        }
      const o = (y * nw + x) * 3;
      out[o] = Math.round(sum[0] / n);
      out[o + 1] = Math.round(sum[1] / n);
      out[o + 2] = Math.round(sum[2] / n);
    }
  return { w: nw, h: nh, rgb: out };
}

/** The CLI's frame at each of `wants` ({ t, scale }), shrunk to its scale, in order; `onStep` hears the count done.
 * @param {{ t: number, scale: number }[]} wants @param {string} project @param {string[]} cli [bin, ...leading words]
 * @param {{ env?: NodeJS.ProcessEnv, onStep?: (done: number) => void }} [options] */
export async function framesAt(wants, project, cli, { env = process.env, onStep } = {}) {
  const folder = mkdtempSync(join(tmpdir(), "hf-gate-frames-"));
  const [bin, ...pre] = cli;
  const pictures = [];
  try {
    for (let from = 0; from < wants.length; from += CHUNK) {
      const chunk = wants.slice(from, from + CHUNK);
      const times = [...new Set(chunk.map((want) => at(want.t)))];
      const args = [
        ...pre,
        "snapshot",
        project,
        "--at",
        times.join(","),
        "--no-end",
        "--describe",
        "false",
        "--keep",
        "-o",
        folder,
      ];
      try {
        const call = run(...cliCall(bin, args, { cwd: project, env, maxBuffer: 16 * 1024 * 1024 }));
        running.add(call.child);
        await call.finally(() => running.delete(call.child));
      } catch (error) {
        const said = String(error.stderr || error.stdout || error.message)
          .trim()
          .split("\n")
          .slice(-3)
          .join(" | ");
        throw new Error(
          `hyperframes snapshot could not draw frames ${times[0]}-${times.at(-1)}s: ${said}`,
        );
      }
      // Named at-<seconds>s.png, with no trailing zeros: read the time back from the name.
      const files = new Map(
        readdirSync(folder).flatMap((name) => {
          const t = /^at-([\d.]+)s\.png$/.exec(name)?.[1];
          return t === undefined ? [] : [[Number(t), name]];
        }),
      );
      for (const { t, scale } of chunk) {
        const name = files.get(at(t));
        if (name === undefined) throw new Error(`hyperframes snapshot drew no frame at ${t}s`);
        pictures.push(shrink(decodePng(readFileSync(join(folder, name))), scale));
      }
      onStep?.(pictures.length);
    }
    return pictures;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
