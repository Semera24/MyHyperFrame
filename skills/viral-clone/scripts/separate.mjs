#!/usr/bin/env node
// Splits a soundtrack into voice and everything else with Demucs (htdemucs), so effects can be found and lifted
// without the voice under them. The first run downloads Demucs and its model through uv (about 2 GB, once); a two-
// minute soundtrack then takes under a minute on a recent Mac. Prints the path of the voice-free stem.
//   node separate.mjs VIDEO_OR_AUDIO OUT_DIR
import { execFileSync, spawnSync } from "node:child_process";
import { basename, extname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { ffmpegBin, hasAudio, NEEDS_UV } from "./media.mjs";

const [input, outDir] = process.argv.slice(2);
if (!input || !outDir) {
  console.error("usage: node separate.mjs VIDEO_OR_AUDIO OUT_DIR");
  process.exit(2);
}
if (!hasAudio(input)) {
  console.error("This file has no audio track, so there is nothing to separate.");
  process.exit(3);
}
if (spawnSync("uvx", ["--version"]).error) {
  console.error(
    "Demucs needs uv (uvx), which this app does not include, so the voice-free stem cannot be made here. " +
      "Go on without it: the sound map can be built from the full soundtrack, which has the voice in it.",
  );
  process.exit(NEEDS_UV);
}
mkdirSync(outDir, { recursive: true });
const name = basename(input, extname(input));
const wav = join(outDir, `${name}.wav`);
execFileSync(ffmpegBin(), [
  "-nostdin",
  "-v",
  "error",
  "-y",
  "-i",
  input,
  "-vn",
  "-ac",
  "2",
  "-ar",
  "44100",
  wav,
]);
try {
  execFileSync(
    "uvx",
    [
      "--python",
      "3.11",
      "--with",
      "soundfile",
      "--from",
      "demucs",
      "demucs",
      "-n",
      "htdemucs",
      "--two-stems",
      "vocals",
      "-o",
      outDir,
      wav,
    ],
    { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", maxBuffer: 1 << 28 },
  );
} catch (error) {
  // vc watch's table keeps the last lines, so they are uv's or Demucs's own reason, never Node's trace.
  const err =
    /** @type {{ status?: number | null, signal?: string | null, code?: string, stderr?: string, message: string }} */ (
      error
    );
  const said = String(err.stderr ?? "")
    .split(/[\r\n]+/)
    .filter((line) => line.trim() && !/^\s*\d+%\|/.test(line))
    .slice(-6)
    .join("\n");
  const outcome = err.signal
    ? `terminated by ${err.signal}`
    : err.status != null
      ? `exited with ${err.status}`
      : `could not start${err.code ? `: ${err.code}` : ""}`;
  console.error(`Demucs could not run (uvx ${outcome}):\n${said || err.message}`);
  process.exit(1);
}
console.log(
  JSON.stringify({
    no_vocals: join(outDir, "htdemucs", name, "no_vocals.wav"),
    vocals: join(outDir, "htdemucs", name, "vocals.wav"),
  }),
);
