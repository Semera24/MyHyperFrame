// Reference films for moment-film: search Moments, fetch a film, and turn it into frames and numbers you can read.
// What it downloads and draws lands under .hyperframes/refs/ in the current project, where the person's media list and
// change report never count it. Usage: `refs` with no arguments.
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join } from "node:path";

const MOMENTS = "https://static.heygen.ai/hyperframes-oss/desktop/moments";
const FFMPEG = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.HYPERFRAMES_FFPROBE_PATH || "ffprobe";
const REFS = join(".hyperframes", "refs");
const FRAMES = join(REFS, "frames");
// The library as this project last read it: what `refs` answers from when the host can't be reached.
const MANIFEST = join(REFS, "manifest.json");

const USAGE = `refs wall                       every Moment's still in labelled sheets (.hyperframes/refs/frames/wall-N.jpg): look, then pick
refs moments <words… | <id>…> search Moments by what they do (role, mechanic, why it works), or by id
refs get <<id> | .mp4 url>   download into .hyperframes/refs/ (a Moment also brings its code, dense.md and a strip of the clip)
refs sheet <video> [every=1.5]  contact sheet: a frame every N s, 8 a row, time-stamped
refs strip <video> <start> <seconds> [fps=10]   dense frames of one passage, to read a move
refs cuts <video>               duration, hard cuts and big visual changes, measured
refs light <video> <t>          luma at t: YLOW (10th pct), YAVG, YHIGH (90th), YMAX`;

// Node reports a refused lookup or connection only as "fetch failed". Codex marks the sandbox it runs with no network.
/** @param {string} url */
async function fetchFrom(url, init) {
  try {
    return await fetch(url, init);
  } catch (error) {
    const code = error.cause?.code;
    if (!code) throw error;
    const failed = `can't reach ${new URL(url).host} (${code})`;
    throw new Error(
      process.env.CODEX_SANDBOX_NETWORK_DISABLED === "1"
        ? `${failed}: this shell has no network, so the Moments library can't load here. Tell the person; running it again won't help.`
        : failed,
    );
  }
}

async function manifest() {
  let rows;
  try {
    const response = await fetchFrom(`${MOMENTS}/v3/manifest.json`);
    if (!response.ok) throw new Error(`Moments manifest: HTTP ${response.status}`);
    rows = await response.json();
  } catch (error) {
    if (!existsSync(MANIFEST)) throw error;
    console.log(
      `The Moments library can't be reached (${error.message}); using the copy this project read last.`,
    );
    return JSON.parse(readFileSync(MANIFEST, "utf8"));
  }
  try {
    mkdirSync(REFS, { recursive: true });
    writeFileSync(MANIFEST, JSON.stringify(rows));
  } catch (error) {
    console.log(`The library read fine but no copy is kept for offline use (${error.message}).`);
  }
  return rows;
}

async function moments(...words) {
  const rows = await manifest();
  if (!words.length) {
    const count = (key) => {
      const seen = {};
      for (const row of rows) for (const v of [row[key]].flat()) seen[v] = (seen[v] || 0) + 1;
      return Object.entries(seen)
        .sort((a, b) => b[1] - a[1])
        .map(([v, n]) => `${v} ${n}`)
        .join(", ");
    };
    console.log(
      `${rows.length} Moments.\nroles: ${count("role")}\nmechanics: ${count("mechanic")}`,
    );
    return;
  }
  const terms = words.map((w) => w.toLowerCase());
  const hits = rows
    .map((row) => {
      const text = [
        row.id,
        row.name,
        row.why,
        row.film_title,
        row.role,
        row.mechanic,
        row.swap_slot,
      ]
        .flat()
        .join(" ")
        .toLowerCase();
      return { row, score: terms.filter((t) => text.includes(t)).length };
    })
    .filter((hit) => hit.score)
    .sort((a, b) => b.score - a.score || (b.row.x_views || 0) - (a.row.x_views || 0))
    .slice(0, 12);
  if (!hits.length)
    console.log("No Moment matches. Run `refs moments` for the roles and mechanics to search by.");
  for (const { row } of hits)
    console.log(
      `${row.id}  ${row.role}  ${row.mechanic.join(",")}  ${row.duration_s}s  ${Math.round((row.x_views || 0) / 1000)}k views\n` +
        `  ${row.name}\n  why: ${row.why}\n  still: ${MOMENTS}/v3/${row.still}`,
    );
}

/** Every Moment's still, labelled with its id, 8 a row and 40 a sheet. A word search only finds the look its words
 * already name; the wall shows the whole library, so the pick is made by eye. The order is shuffled per project, so
 * every film does not start reading the library from the same sheet. Each sheet is built and printed as soon as its
 * stills land, so a stopped run keeps the sheets it made; a still that fails or stalls is named and left off. */
async function wall() {
  const rows = seeded(await manifest());
  const dir = join(REFS, "wall");
  mkdirSync(dir, { recursive: true });
  mkdirSync(FRAMES, { recursive: true });
  const missing = [];
  for (let start = 0, n = 1; start < rows.length; start += 40, n++) {
    const page = rows.slice(start, start + 40);
    for (let i = 0; i < page.length; i += 16)
      await Promise.all(
        page.slice(i, i + 16).map((row) => still(row, dir).catch(() => missing.push(row.id))),
      );
    const shown = page.filter((row) => !missing.includes(row.id));
    if (shown.length)
      console.log(`${sheetOf(shown, dir, n)}: ${shown.map((row) => row.id).join(" ")} (8 a row)`);
  }
  if (missing.length) console.log(`No still came for ${missing.join(" ")}; they are on no sheet.`);
  console.log(
    "Open every sheet and look. Then `refs moments <id>` for a pick's job and film, `refs get <id>` to study it.",
  );
}

// A still is a few kB: one that has not landed in this long is stalled, and would hold its whole sheet back.
const STILL_MS = Number(process.env.HF_REFS_STILL_MS) || 20_000;

/** One Moment's still, fetched once per project. */
async function still(row, dir) {
  const raw = join(dir, `${row.id}.jpg`);
  if (!existsSync(raw))
    await download(`${MOMENTS}/v3/${row.still}`, raw, false, AbortSignal.timeout(STILL_MS));
}

/** wall-N.jpg: these Moments' stills, each labelled with its id. */
function sheetOf(shown, dir, n) {
  const fit = "scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2";
  // Fresh each time: a tile left from a longer run would land on this sheet after its own.
  const tiles = join(dir, "tiles", String(n));
  rmSync(tiles, { recursive: true, force: true });
  mkdirSync(tiles, { recursive: true });
  shown.forEach((row, k) => {
    const raw = join(dir, `${row.id}.jpg`);
    const tile = join(tiles, `${String(k).padStart(2, "0")}.jpg`);
    const label = `drawtext=text='${row.id}':x=6:y=6:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.7`;
    try {
      ff("-i", raw, "-vf", `${fit},${label}`, tile);
    } catch {
      ff("-i", raw, "-vf", fit, tile);
    }
  });
  const out = join(FRAMES, `wall-${n}.jpg`);
  ff(
    "-i",
    join(tiles, "%02d.jpg"),
    "-vf",
    `tile=8x${Math.ceil(shown.length / 8)}:padding=4:color=white`,
    "-vframes",
    "1",
    out,
  );
  return out;
}

/** The rows in an order fixed by HF_REFS_SEED or the project folder's name: stable within one project, different
 * across projects. */
function seeded(rows) {
  const key = process.env.HF_REFS_SEED || basename(process.cwd());
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const next = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), h / 4294967296);
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Pages that hold a video rather than serve one; the app's video.downloadFromLink brings these in.
const VIDEO_PAGES = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|x\.com|twitter\.com)$/;
const IMPORT = "a post or page's video comes in with video.downloadFromLink";

/** `file`, fetched from `url`. Written whole or not at all, so a broken download never passes for a kept copy. */
async function download(url, file, video = false, signal = undefined) {
  const response = await fetchFrom(url, { signal });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (video && !/^(video\/|application\/octet-stream)/.test(type))
    throw new Error(`${url} is ${type || "not a video file"}; ${IMPORT}`);
  writeFileSync(`${file}.part`, Buffer.from(await response.arrayBuffer()));
  renameSync(`${file}.part`, file);
  return file;
}

async function get(source, dir = REFS) {
  if (!source) throw new Error("name a Moment id or a video file URL");
  mkdirSync(dir, { recursive: true });
  if (/^M\d+$/i.test(source)) return getMoment(source, dir);
  if (/^https?:\/\//.test(source)) {
    const url = new URL(source);
    if (VIDEO_PAGES.test(url.hostname)) throw new Error(IMPORT);
    const name = basename(url.pathname) || "ref.mp4";
    return console.log(
      await download(source, join(dir, extname(name) ? name : `${name}.mp4`), true),
    );
  }
  if (existsSync(source)) return console.log(`${source} is already local`);
  throw new Error(`only Moment ids and video file URLs download here; ${IMPORT}`);
}

/** A Moment an earlier `refs get` left in `dir`, as a manifest row naming only what is on disk; null when its clip
 * is not there. */
function keptMoment(id, dir) {
  const name = readdirSync(dir).find((file) => file.toLowerCase() === `${id.toLowerCase()}.mp4`);
  if (!name) return null;
  const moment = basename(name, ".mp4");
  const bundle = existsSync(join(dir, `${moment}.tar.gz`))
    ? { key: `${moment}.tar.gz` }
    : undefined;
  return { id: moment, clip: name, bundle };
}

/** A Moment's file as this project kept it, else downloaded. Moments are versioned, so a kept one never goes stale;
 * a URL's basename is no such name, so `get <url>` always downloads. */
const momentFile = (url, file) => (existsSync(file) ? file : download(url, file));

async function getMoment(id, dir) {
  const rows = await manifest().catch((error) => {
    const kept = keptMoment(id, dir);
    if (!kept) throw error;
    console.log(
      `The Moments library can't be reached (${error.message}); using the ${kept.id} this project kept.`,
    );
    return [kept];
  });
  const row = rows.find((m) => m.id.toLowerCase() === id.toLowerCase());
  if (!row) throw new Error(`no Moment ${id}`);
  const video = await momentFile(`${MOMENTS}/v3/${row.clip}`, join(dir, `${row.id}.mp4`));
  if (row.bundle) {
    const archive = await momentFile(
      `${MOMENTS}/bundles/${row.bundle.key}`,
      join(dir, `${row.id}.tar.gz`),
    );
    const into = join(dir, row.id);
    mkdirSync(into, { recursive: true });
    // Git Bash's GNU tar can't open a backslash path, so tar gets no path from join: it runs inside `into`.
    execFileSync("tar", ["xzf", `../${basename(archive)}`], { cwd: into });
  }
  console.log(
    `${video}\n${row.bundle ? `${join(dir, row.id)}/dense.md and code/ (its HTML source)` : "no code bundle"}`,
  );
  if (row.film_title) console.log(`from ${row.x_url || "an official film"}: ${row.film_title}`);
  // The clip is a few seconds long: every frame of it, at 10 fps, is what the code is trying to make.
  await strip(video, "0", duration(video).toFixed(2));
}

const ff = (...a) =>
  execFileSync(FFMPEG, ["-hide_banner", "-v", "error", "-y", ...a], { stdio: "pipe" });
const duration = (video) =>
  Number(
    execFileSync(FFPROBE, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      video,
    ]).toString(),
  );
const stamp = (offset = 0) =>
  `drawtext=text='%{pts\\:hms\\:${offset}}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6`;

/** Tiles frames into one image, time-stamped when this FFmpeg can draw text. */
function tile(input, filters, columns, rows, out, offset) {
  mkdirSync(FRAMES, { recursive: true });
  const chain = (withStamp) =>
    [
      ...filters,
      "scale=320:-2",
      ...(withStamp ? [stamp(offset)] : []),
      `tile=${columns}x${rows}`,
    ].join(",");
  try {
    ff(...input, "-vf", chain(true), "-frames:v", "1", out);
  } catch {
    ff(...input, "-vf", chain(false), "-frames:v", "1", out);
  }
  return out;
}

/** A number argument as usage shows it, `1.5` or `every=1.5`: above 0, or at 0 too when `zero`; anything else is
 * refused with its command's usage line, never handed to FFmpeg. */
function numberArg(raw, name, usage, zero = false) {
  const value = Number(String(raw ?? "").replace(new RegExp(`^${name}=`), ""));
  if (
    raw === undefined ||
    raw === "" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (value === 0 && !zero)
  )
    throw new Error(
      `${name} must be a ${zero ? "" : "positive "}number, as N or ${name}=N (got "${raw}"). Usage: ${usage}`,
    );
  return String(value);
}

async function sheet(video, every = "1.5") {
  every = numberArg(every, "every", "refs sheet <video> [every=1.5]");
  const count = Math.floor(duration(video) / Number(every)) + 1;
  const out = join(FRAMES, `${basename(video, extname(video))}-sheet.jpg`);
  tile(["-i", video], [`fps=1/${every}`], 8, Math.ceil(count / 8), out, 0);
  console.log(`${out}: ${count} frames, one every ${every}s, 8 a row from 0s`);
}

async function strip(video, start, seconds, fps = "10") {
  const usage = "refs strip <video> <start> <seconds> [fps=10]";
  start = numberArg(start, "start", usage, true);
  seconds = numberArg(seconds, "seconds", usage);
  fps = numberArg(fps, "fps", usage);
  const count = Math.ceil(Number(seconds) * Number(fps));
  const out = join(FRAMES, `${basename(video, extname(video))}-${start}s.jpg`);
  tile(
    ["-ss", start, "-t", seconds, "-i", video],
    [`fps=${fps}`],
    6,
    Math.ceil(count / 6),
    out,
    Number(start),
  );
  console.log(
    `${out}: ${count} frames at ${fps} fps from ${start}s, 6 a row (1 frame = ${(1 / Number(fps)).toFixed(3)}s)`,
  );
}

/** FFmpeg's log (stderr), where showinfo and signalstats print. */
const ffLog = (...a) =>
  spawnSync(FFMPEG, ["-hide_banner", ...a, "-f", "null", "-"], { encoding: "utf8" }).stderr;

const sceneTimes = (video, threshold) =>
  [
    ...ffLog("-i", video, "-vf", `select='gt(scene,${threshold})',showinfo`).matchAll(
      /pts_time:([\d.]+)/g,
    ),
  ].map((m) => Number(m[1]).toFixed(2));

async function cuts(video) {
  const hard = sceneTimes(video, 0.3);
  const big = sceneTimes(video, 0.12);
  console.log(`duration ${duration(video).toFixed(2)}s`);
  console.log(`hard cuts (scene > 0.3): ${hard.length}  ${hard.join(" ")}`);
  console.log(
    `big visual changes (scene > 0.12, transitions included): ${big.length}  ${big.join(" ")}`,
  );
}

async function light(video, t) {
  t = numberArg(t, "t", "refs light <video> <t>", true);
  const out = ffLog("-ss", t, "-i", video, "-frames:v", "1", "-vf", "signalstats,metadata=print");
  const read = (key) => out.match(new RegExp(`signalstats\\.${key}=([\\d.]+)`))?.[1];
  console.log(
    `at ${t}s: YLOW ${read("YLOW")}  YAVG ${Math.round(read("YAVG"))}  YHIGH ${read("YHIGH")}  YMAX ${read("YMAX")} (0–255)`,
  );
}

const [cmd, ...args] = process.argv.slice(2);
const commands = { wall, moments, get, sheet, strip, cuts, light };
if (!commands[cmd]) {
  console.log(USAGE);
  process.exit(cmd ? 2 : 0);
}
try {
  await commands[cmd](...args);
} catch (error) {
  console.error(`refs ${cmd}: ${error.message}`);
  process.exit(1);
}
