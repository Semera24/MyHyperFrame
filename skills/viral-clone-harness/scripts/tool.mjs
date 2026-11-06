// What every script here shares: its arguments, its one runnable example, its errors (each says the fix), the video's
// size and clock, word files in any shape the app writes, where its files land, and running it from the command line.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ffprobeBin } from "./media.mjs";

/** An error whose message says what to run instead. */
export class Fix extends Error {
  /** @param {string} problem @param {string} fix */
  constructor(problem, fix) {
    super(`${problem}\nfix: ${fix}`);
  }
}

/** Parses a tool's arguments; `--help` prints its usage and one example that runs as written, then exits.
 * @param {string[]} argv @param {{usage: string, example: string, options?: Record<string, any>}} spec */
export function parseTool(argv, { usage, example, options = {} }) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`${usage}\n\nexample:\n  ${example}`);
    return null;
  }
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (e) {
    throw new Fix(String(/** @type {any} */ (e).message), `run it as: ${example}`);
  }
}

/** "1,2.5,4" as numbers. @param {string} text @param {string} flag */
export function numbers(text, flag) {
  const out = String(text)
    .split(",")
    .filter((s) => s.trim() !== "")
    .map(Number);
  if (!out.length || out.some((n) => !Number.isFinite(n)))
    throw new Fix(`${flag} must be numbers separated by commas, got "${text}"`, `${flag} 1.2,3.4`);
  return out;
}

/** Width, height, frame rate, duration and whether it has sound. @param {string} path */
export function probe(path) {
  if (!existsSync(path))
    throw new Fix(`no file at ${path}`, "pass the video's path from the project folder");
  const j = JSON.parse(
    execFileSync(ffprobeBin(), [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height,r_frame_rate:format=duration",
      "-of",
      "json",
      path,
    ]).toString(),
  );
  const video = j.streams.find((/** @type {any} */ s) => s.codec_type === "video");
  const [a, b] = String(video?.r_frame_rate ?? "0/1")
    .split("/")
    .map(Number);
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: video ? a / (b || 1) : 0,
    duration: Number(j.format?.duration ?? 0),
    audio: j.streams.some((/** @type {any} */ s) => s.codec_type === "audio"),
  };
}

/** Words as [{text, start, end}] from any shape the app writes: {words}, {segments: [{words}]}, a bare array, with
 * `text` or `word`. @param {string} path */
export function loadWords(path) {
  if (!existsSync(path))
    throw new Fix(`no words file at ${path}`, "transcribe the audio and pass its .json");
  const j = JSON.parse(readFileSync(path, "utf8"));
  const raw = Array.isArray(j) ? j : (j.words ?? (j.segments ?? []).flatMap((s) => s.words ?? []));
  const words = raw
    .map((/** @type {any} */ w) => ({
      text: String(w.text ?? w.word ?? "").trim(),
      start: Number(w.start),
      end: Number(w.end),
    }))
    .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end));
  if (!words.length)
    throw new Fix(`${path} holds no words with start and end`, "pass a transcript with word times");
  return words;
}

/** The folder a tool writes its pictures to, made on demand. @param {string | undefined} out @param {string} tool */
export function outDir(out, tool) {
  const dir = out ?? join(".viral-clone", "work", tool);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Runs `main` with the command line's arguments when `url` is the script node was started with; an error prints its
 * message and exits 2. @param {string} url import.meta.url @param {(args: string[]) => Promise<void>} main */
export async function runMain(url, main) {
  if (!process.argv[1] || url !== pathToFileURL(realpathSync(process.argv[1])).href) return;
  await main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(2);
  });
}
