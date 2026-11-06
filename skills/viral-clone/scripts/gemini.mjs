#!/usr/bin/env node
// Gemini watches the video: read lists every graphic kind and instance and how each is built, so the build follows
// it; perform reads the presenter beat by beat for the person shots; review lists what a draft's structure lacks.
// Argon, not 3.8 Flash: on 2026-10-16 3.8 called a boiling title still and split 50/50 on footage vs still, Argon got
// both. Neither sees a 1-2 px boil in a rebuild; scripts measure that. With no key it prints skipped.
import { execFileSync, spawnSync } from "node:child_process";
import { createSign, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ffmpegBin, ffprobeBin } from "./media.mjs";

const USAGE = `usage: node gemini.mjs read REF --out reference/gemini-read.json
       node gemini.mjs perform REF --out reference/gemini-perform.json
       perform: the presenter beat by beat (words, hands, body, head and face, object, camera); no beats without one.
       node gemini.mjs review REF DRAFT [--at 3.1,16.3] --out .viral-clone/work/gemini-review.json
       --at: reference seconds to describe in both films. Times only: a finding written into the question is echoed.
       node gemini.mjs look REF OURS --at 0.8[,0.8] --seconds 2 --roi x,y,w,h[,x,y,w,h] --out look.json
       look: one box, cropped from both and seen in high resolution; what differs in how the graphic looks.
       node gemini.mjs verify REF OURS --at 9.5,9.5 --seconds 5.8 [--sound] --out verify.json
       verify: what is wrong in those seconds of OURS (motion, timing, text on screen) beside the reference's same
       moment; --sound also listens to both soundtracks. Times are OURS' seconds.
       node gemini.mjs --selftest
       Key: HF_GEMINI_SA_JSON or GEMINI_PREFAB_KEY (service-account JSON), or ~/.hyperframes/gemini-sa.json; without
       one, HeyGen's /v3/video-analyses on HEYGEN_API_BASE and HEYGEN_API_KEY (an app run has both). GEMINI_VIA=heygen
       takes HeyGen even with a Vertex key.`;
const MODEL = "gemini-4-argon";
// Argon refuses more output per request.
const MAX_OUTPUT = 32768;
// Inline request cap on Vertex; a proxy past it is refused rather than sent.
const INLINE = 19_000_000;
// A segment past this is read in parts cut at the reference's own cuts, so a long film never asks one huge request.
const SEGMENT = 60;
// 12 fps sees an insert or badge a few frames long; finer motion is the scripts' job.
const FPS = 12;
// HeyGen's route samples at most 2 fps at low resolution and takes one video of at most 180 s, sampling 2 fps only up
// to 90 s. So a clip is slowed until 2 fps there is the frame rate asked here, two clips are stacked into one, and the
// answer's times are scaled back.
const HEYGEN_FPS = 2;
const HEYGEN_MAX_SECONDS = 90;
const HEYGEN_ROUTE = "/v3/video-analyses";
const HEYGEN_INLINE = 16 * 1024 * 1024;
// The app's gateway's answers when the HyperFrames plan can't pay (heygenProxy.mjs PLAN_NEEDS). Video analysis is
// charged after the model answers, so this may follow a run: a new attempt would only run it again.
const PLAN_CARDS = new Set(["hyperframes_usage_exhausted", "hyperframes_plan_required"]);

const READ = `This is a creator's short video. Walk it from start to end and list EVERY on-screen graphic event over or
instead of the footage, in time order: titles, captions' style changes, cards, screen recordings in a frame, product
or B-roll inserts in a card, memes and reaction clips, badges, stickers, pills, lower thirds, full-frame inserts, end
cards, transitions. One event per appearance, even when it repeats: start and end seconds (one decimal), its box as
left, top, width and height in percent of the frame, its text if any, what it is made of and how it is built (e.g. each letter a separate torn-paper
scrap, a phone screen recording in a rounded card, a meme clip full frame), how it enters, what it does while it holds (still, plays footage, animates,
letters or shapes jumping between poses, scrolls, cursor moves), how it exits, and a short KIND name shared by every
event with the same look. Expect dozens of events in a busy edit. Also give the sections (hook, steps, call to action)
and the caption rule. Say "unsure" rather than guess; never call a graphic still unless you are sure.`;
// Tested 2026-10-20 on Cindy (16 moments) and Ali Abdaal (17): finger counts, the mic hand and its switch at a cut,
// waves, hand to ear, typing mime within about 0.5 s; it missed actions under graphic overlays and sometimes named the
// wrong hand. HeyGen's route got as many right at 2 fps with sound as Vertex at 12 fps.
const PERFORM = `This is a creator's short video. If no person talks on camera in it, set talking_person false and give no
beats. Otherwise describe the PERSON's performance so another actor could re-perform it beat for beat. Walk it from
start to end. Start a new beat at each new sentence or each clear change of gesture, whichever comes first. For each
beat give start and end seconds (one decimal), the words said, and:
- hands: what each hand does (which hand, gesture shape such as open palm, point, count on fingers, pinch, chop,
  hold an object, out of frame), where it is (in front of chest, beside face, low), and its motion (raises, sweeps
  left, taps, holds still);
- body: lean in or back, turn, shift, step, sit or stand, shoulders;
- head_face: nods, shakes, tilts, raised brows, smile, eye line (to the lens, down at notes, off to one side);
- object: anything held, picked up, shown to camera or pointed at, else "none";
- camera: the framing (close-up, medium, wide) and any camera move or cut at this beat.
Say "still" when a part does not move and "not visible" when it is out of frame. Say "unsure" rather than guess.
Ignore on-screen graphics, captions and inserts unless the person interacts with them. Also describe the person's
look and setting once.`;
const REVIEW = `Video 1 is a creator's REFERENCE. Video 2 is our REMIX: new words, topic, presenter, room, voice and
product on purpose; never report those, nor likeness or whether pictures resemble. The remix must keep the EDIT: the
same kinds of graphics in the same places doing the same things, captions, cut rhythm, camera, transitions, pacing,
sound feel. Report each structural difference once, most important first, with times in BOTH videos: a kind or an
instance the remix lacks or adds, a different order, a badge or cutaway missing, pacing. Empty is fine; do not
invent.`;
const LOOK = `Clip 1 is one on-screen graphic cropped from a creator's REFERENCE video, over its footage. Clip 2 is our
rebuild of the same graphic, cropped the same way, alone on flat green. Ignore the background, people and footage,
and ignore motion and timing (measured elsewhere). For EACH clip describe literally how the graphic is built: its
pieces (how many separate shapes, papers, cards or frames, gaps between them, tilt, edges, shadows), lettering of every
line (style, weight, case, word spacing), colors and size in the box. Then list each difference a viewer would
notice, most important first, as major (the build or lettering differs) or minor. Empty when they match; do not
invent.`;
const VERIFY = `Clip 1 is a stretch of a creator's REFERENCE video. Clip 2 is the same moment of our REMIX: new words,
topic, presenter, room and product on purpose; never report those, nor likeness. Watch Clip 2 closely and report what
a viewer would notice is wrong: in its motion (a stutter, a jump, a graphic that pops, freezes or flickers, elements
that collide or leave the frame), in its timing against Clip 1 (an entry or exit late or early, a hold too long or too
short) and in its text on screen (cut off, misspelled, unreadable, covered). Give each issue's start and end in seconds
from the start of Clip 2. Empty when nothing is wrong; do not invent.`;
const VERIFY_SOUND = `Clip 1 is a stretch of a creator's REFERENCE video. Clip 2 is the same moment of our REMIX: new words,
voice and music on purpose; never report those. Music levels, effects and gaps are measured apart; listen to Clip 2's
speech against Clip 1's and report what a listener would notice is wrong: a word mis-stressed, a pause mid-sentence, a
word cut off. Give each issue's start and end in seconds from the start of Clip 2.
Empty when it sounds right; do not invent.`;

const SCHEMAS = {
  read: {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            start: { type: "number" },
            end: { type: "number" },
            kind: { type: "string" },
            box: {
              type: "object",
              properties: {
                left: { type: "number" },
                top: { type: "number" },
                width: { type: "number" },
                height: { type: "number" },
              },
              required: ["left", "top", "width", "height"],
            },
            text: { type: "string" },
            build: { type: "string" },
            entry: { type: "string" },
            hold: { type: "string" },
            exit: { type: "string" },
          },
          required: ["start", "end", "kind", "box", "build", "entry", "hold", "exit"],
        },
      },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            start: { type: "number" },
            end: { type: "number" },
          },
          required: ["name", "start", "end"],
        },
      },
      captions: { type: "string" },
    },
    required: ["events", "sections", "captions"],
  },
  perform: {
    type: "object",
    properties: {
      talking_person: { type: "boolean" },
      person: { type: "string" },
      beats: {
        type: "array",
        items: {
          type: "object",
          properties: {
            start: { type: "number" },
            end: { type: "number" },
            words: { type: "string" },
            hands: { type: "string" },
            body: { type: "string" },
            head_face: { type: "string" },
            object: { type: "string" },
            camera: { type: "string" },
          },
          required: ["start", "end", "words", "hands", "body", "head_face", "object", "camera"],
        },
      },
    },
    required: ["talking_person", "person", "beats"],
  },
  look: {
    type: "object",
    properties: {
      reference: { type: "string" },
      ours: { type: "string" },
      differences: {
        type: "array",
        items: {
          type: "object",
          properties: {
            what: { type: "string" },
            severity: { type: "string", enum: ["major", "minor"] },
          },
          required: ["what", "severity"],
        },
      },
    },
    required: ["reference", "ours", "differences"],
  },
  review: {
    type: "object",
    properties: {
      moments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref_time: { type: "number" },
            ref_shows: { type: "string" },
            ours_time: { type: "number" },
            ours_shows: { type: "string" },
            same_structure: { type: "boolean" },
          },
          required: ["ref_time", "ref_shows", "ours_time", "ours_shows", "same_structure"],
        },
      },
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            element: { type: "string" },
            ref_time: { type: "string" },
            ours_time: { type: "string" },
            expected: { type: "string" },
            observed: { type: "string" },
            severity: { type: "string", enum: ["major", "minor"] },
          },
          required: ["element", "ref_time", "ours_time", "expected", "observed", "severity"],
        },
      },
      summary: { type: "string" },
    },
    required: ["issues", "summary"],
  },
  verify: {
    type: "object",
    properties: {
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            start: { type: "number" },
            end: { type: "number" },
            kind: { type: "string", enum: ["motion", "timing", "text", "sound"] },
            what: { type: "string" },
            severity: { type: "string", enum: ["major", "minor"] },
          },
          required: ["start", "end", "kind", "what", "severity"],
        },
      },
      summary: { type: "string" },
    },
    required: ["issues", "summary"],
  },
};

/** The service account, or null when this machine has none. */
export function serviceAccount(
  env = process.env,
  file = join(homedir(), ".hyperframes", "gemini-sa.json"),
) {
  const text =
    env.HF_GEMINI_SA_JSON ||
    env.GEMINI_PREFAB_KEY ||
    (existsSync(file) ? readFileSync(file, "utf8") : "");
  if (!text.trim()) return null;
  const sa = JSON.parse(text);
  return sa.type === "service_account" && sa.private_key && sa.project_id ? sa : null;
}

/** What `call` sends through: the Vertex service account, else HeyGen's route on the run's key, else null.
 * @returns {any} */
export function geminiAccess(env = process.env, file = undefined) {
  const heygen =
    env.HEYGEN_API_BASE && env.HEYGEN_API_KEY
      ? { base: env.HEYGEN_API_BASE.replace(/\/$/, ""), key: env.HEYGEN_API_KEY }
      : null;
  const sa = env.GEMINI_VIA === "heygen" ? null : serviceAccount(env, file);
  return sa ?? (heygen ? { heygen } : null);
}

const b64url = (v) =>
  Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claims)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Vertex token refused: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

const probe = (path, entries) =>
  execFileSync(ffprobeBin(), ["-v", "error", "-show_entries", entries, "-of", "csv=p=0", path])
    .toString()
    .trim();
/** A file's length in seconds; a file with none (ffprobe says N/A, as for a clip cut from past its source's end) is an
 * error, never NaN: NaN reached ffmpeg's -t. @param {string} path */
export function durationOf(path) {
  const seconds = Number(probe(path, "format=duration"));
  if (!Number.isFinite(seconds))
    throw new Error(`${path} has no readable duration (an empty or cut-off file)`);
  return seconds;
}

/** The seconds `verify` can compare: the asked length, cut to what each film has left from its start. A clip cut from
 * past a film's end is empty, so a span the reference or ours does not reach is said, never passed on as a length.
 * @param {number} asked @param {[number, number]} left seconds the reference and ours have from their starts */
export function verifyStretch(asked, [refLeft, oursLeft]) {
  const seconds = Math.min(asked, refLeft, oursLeft);
  if (!(seconds >= 0.1))
    throw new Error(
      `nothing to compare in that span: the reference has ${Math.max(0, refLeft).toFixed(2)} s left from there and ours ${Math.max(0, oursLeft).toFixed(2)} s`,
    );
  return Math.round(seconds * 1000) / 1000;
}

/** Cut times (seconds) where the picture changes, by ffmpeg's scene score (showinfo logs to stderr).
 * @param {string} path */
function cutsOf(path) {
  const { stderr } = spawnSync(
    ffmpegBin(),
    [
      "-nostdin",
      "-hide_banner",
      "-i",
      path,
      "-vf",
      "select='gt(scene,0.4)',showinfo",
      "-an",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  return [...String(stderr).matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
}

/** Segments of at most `max` seconds, each ending at the last cut that fits (mid-shot only when a shot is longer).
 * @param {number} duration @param {number[]} cutTimes @param {number} [max] @returns {[number, number][]} */
export function segments(duration, cutTimes, max = SEGMENT) {
  const out = [];
  let start = 0;
  while (duration - start > max) {
    const fit = cutTimes.filter((t) => t > start + 1 && t <= start + max);
    const end = fit.length ? fit[fit.length - 1] : start + max;
    out.push([start, end]);
    start = end;
  }
  out.push([start, duration]);
  return out;
}

/** A small proxy of `path` for the request: at most 640 px wide, optionally one stretch of it. */
function proxy(path, dir, name, { start = 0, seconds = 0 } = {}) {
  const out = join(dir, `${name}.mp4`);
  execFileSync(ffmpegBin(), [
    "-nostdin",
    "-v",
    "error",
    "-y",
    ...(start ? ["-ss", String(start)] : []),
    "-i",
    path,
    ...(seconds ? ["-t", String(seconds)] : []),
    "-vf",
    "scale='min(640,iw)':-2",
    "-c:v",
    "libx264",
    "-crf",
    "28",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    out,
  ]);
  return out;
}

/** One box of `path` from `start` for `seconds`, at most 720 px wide, silent. @param {number[]} roi x,y,w,h */
function cropClip(path, dir, name, start, seconds, [x, y, w, h]) {
  const out = join(dir, `${name}.mp4`);
  execFileSync(ffmpegBin(), [
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-ss",
    String(start),
    "-i",
    path,
    "-t",
    String(seconds),
    "-vf",
    `crop=${w}:${h}:${x}:${y},scale='min(720,iw)':-2`,
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "18",
    out,
  ]);
  return out;
}

/** The generateContent body for `prompt` over `videos`. @param {string} prompt @param {string[]} videos
 * @param {any} schema @param {number} fps @param {string} [resolution] */
export function body(prompt, videos, schema, fps, resolution = "MEDIA_RESOLUTION_LOW") {
  const parts = [{ text: prompt }];
  for (const v of videos)
    parts.push({
      inlineData: { mimeType: "video/mp4", data: readFileSync(v).toString("base64") },
      videoMetadata: { fps },
    });
  return {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      mediaResolution: resolution,
      maxOutputTokens: MAX_OUTPUT,
    },
  };
}

async function call(sa, request) {
  const size = Buffer.byteLength(JSON.stringify(request));
  if (size > INLINE)
    throw new Error(`request is ${size} bytes, over Vertex's inline cap; cut the clip shorter`);
  const url =
    `https://aiplatform.googleapis.com/v1beta1/projects/${sa.project_id}/locations/global/publishers/google/` +
    `models/${MODEL}:generateContent`;
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await accessToken(sa)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(900_000),
  });
  const value = await res.json();
  if (!res.ok)
    throw new Error(`Gemini HTTP ${res.status}: ${value?.error?.message ?? ""}`.slice(0, 300));
  const candidate = value.candidates?.[0];
  if (candidate?.finishReason !== "STOP")
    throw new Error(`Gemini stopped: ${candidate?.finishReason ?? "no answer"}`);
  const text = candidate.content.parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  const usage = value.usageMetadata ?? {};
  return {
    answer: JSON.parse(text),
    receipt: {
      model: value.modelVersion,
      seconds: (Date.now() - started) / 1000,
      tokens: usage.totalTokenCount,
    },
  };
}

/** How much slower a clip of `seconds` is sent to HeyGen so its 2 fps samples it at `fps`, within 90 s.
 * @param {number} fps @param {number} seconds */
export function slowBy(fps, seconds) {
  return Math.max(1, Math.min(fps / HEYGEN_FPS, HEYGEN_MAX_SECONDS / seconds));
}

/** Every start, end, ref_time and ours_time number in `answer`, divided by `factor`.
 * @param {any} answer @param {number} factor */
export function unslow(answer, factor) {
  if (Array.isArray(answer)) return answer.map((v) => unslow(v, factor));
  if (!answer || typeof answer !== "object") return answer;
  return Object.fromEntries(
    Object.entries(answer).map(([k, v]) => [
      k,
      typeof v === "number" && /^(start|end|ref_time|ours_time)$/.test(k)
        ? Math.round((v / factor) * 100) / 100
        : unslow(v, factor),
    ]),
  );
}

/** One video for HeyGen from `videos`: two stacked top to bottom when `wide`, else side by side, with a white line
 * between, slowed by `factor`, silent once slowed. @param {string[]} videos @param {string} dir @param {number} factor
 * @param {boolean} wide */
function joined(videos, dir, factor, wide) {
  const out = join(dir, `heygen-${videos.length}-${Date.now()}.mp4`);
  const fit = wide ? "scale=720:-2" : "scale=-2:720";
  const each = videos.map(
    (_, i) =>
      `[${i}:v]${fit},setsar=1${i < videos.length - 1 ? `,pad=${wide ? "iw:ih+8" : "iw+8:ih"}:0:0:white` : ""},tpad=stop_mode=clone:stop_duration=600[v${i}]`,
  );
  const stack =
    videos.length > 1
      ? `${videos.map((_, i) => `[v${i}]`).join("")}${wide ? "v" : "h"}stack=inputs=${videos.length}`
      : "[v0]null";
  const longest = Math.max(...videos.map(durationOf));
  execFileSync(ffmpegBin(), [
    "-nostdin",
    "-v",
    "error",
    "-y",
    ...videos.flatMap((v) => ["-i", v]),
    "-filter_complex",
    `${each.join(";")};${stack},setpts=${factor}*PTS[out]`,
    "-map",
    "[out]",
    ...(factor === 1 && videos.length === 1 ? ["-map", "0:a?", "-c:a", "aac"] : ["-an"]),
    "-t",
    String(longest * factor),
    "-r",
    String(HEYGEN_FPS * 2),
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    out,
  ]);
  return out;
}

/** The answer to `prompt` over `videos`, through Vertex or HeyGen's route. @param {any} via @param {string} dir
 * @param {string} prompt @param {string[]} videos @param {any} schema @param {number} fps
 * @param {string} [resolution] @param {string} [attempt] the HeyGen Idempotency-Key, fresh unless retrying */
async function ask(via, dir, prompt, videos, schema, fps, resolution, attempt = randomUUID()) {
  if (!via.heygen) return call(via, body(prompt, videos, schema, fps, resolution));
  const factor = slowBy(fps, Math.max(...videos.map(durationOf)));
  const wide =
    Number(probe(videos[0], "stream=width")) >= Number(probe(videos[0], "stream=height"));
  const video = joined(videos, dir, factor, wide);
  const notes = [
    videos.length > 1
      ? `The ${videos.length} clips come as one video, stacked ${wide ? "top to bottom" : "left to right"} in order (1 first), split by a white line.`
      : "",
    factor > 1
      ? `It plays at 1/${factor.toFixed(2)} speed and has no sound; judge motion as if at normal speed.`
      : "",
  ].filter(Boolean);
  const { answer, receipt } = await callHeygen(
    via.heygen,
    [prompt, ...notes].join("\n"),
    video,
    schema,
    attempt,
  );
  return { answer: unslow(answer, factor), receipt: { ...receipt, slow: factor } };
}

/** One analysis on HeyGen's route, waited for. A call that got no answer at all throws with `unknown` set: whether
 * the job started is not known, so only a retry under the same `attempt` may follow it.
 * @param {{ base: string, key: string }} heygen @param {string} prompt @param {string} video @param {any} schema
 * @param {string} attempt */
async function callHeygen({ base, key }, prompt, video, schema, attempt) {
  const bytes = readFileSync(video);
  if (bytes.length > HEYGEN_INLINE)
    throw new Error(
      `video is ${bytes.length} bytes, over HeyGen's 16 MB inline cap; cut the clip shorter`,
    );
  const started = Date.now();
  const headers = { "x-api-key": key, "content-type": "application/json" };
  const unknown = (/** @type {string} */ why) =>
    Object.assign(new Error(`HeyGen gave no answer: ${why}`), { unknown: true });
  // Known only when HeyGen said what happened: a readable refusal or a job with a status. A 5xx, a body that cannot
  // be read or a reply without a job may follow a job HeyGen already started.
  const job = async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    const res = await fetch(url, init).catch((e) => {
      throw unknown(e?.message ?? String(e));
    });
    const value = await res.json().catch(() => null);
    if (value === null || res.status >= 500)
      throw unknown(
        `HTTP ${res.status}${value === null ? " with a body that could not be read" : ""}`,
      );
    if (!res.ok)
      throw Object.assign(
        new Error(
          `HeyGen HTTP ${res.status}: ${value?.error?.message ?? value?.message ?? ""}`.slice(
            0,
            300,
          ),
        ),
        { code: value?.error?.code },
      );
    const data = value.data ?? value;
    if (!data?.status || !data?.id) throw unknown(`HTTP ${res.status} without a job id and status`);
    return data;
  };
  const body = JSON.stringify({
    model: MODEL,
    video: { type: "base64", media_type: "video/mp4", data: bytes.toString("base64") },
    prompt,
    response_schema: schema,
    max_output_tokens: MAX_OUTPUT,
  });
  let data = await job(`${base}${HEYGEN_ROUTE}`, {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": attempt, Prefer: "wait=50" },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  while (data.status === "pending" || data.status === "processing") {
    // Still running is not an outcome: the retry keeps the key, so HeyGen hands back this job to wait on again.
    if (Date.now() - started > 600_000)
      throw unknown(`analysis ${data.id} still ${data.status} after 10 min`);
    await new Promise((r) => setTimeout(r, 5000));
    data = await job(`${base}${HEYGEN_ROUTE}/${encodeURIComponent(data.id)}`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
  }
  if (data.status !== "completed")
    throw new Error(
      `HeyGen analysis failed: ${data.failure_code ?? data.status} ${data.failure_message ?? ""}`.slice(
        0,
        300,
      ),
    );
  return {
    answer: data.output.json,
    receipt: {
      model: data.model,
      via: "heygen",
      id: data.id,
      seconds: (Date.now() - started) / 1000,
      tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    },
  };
}

/** Moves an answer's times (every list's start and end) from its segment's clock onto the film's.
 * @param {any} answer @param {number} offset */
export function shift(answer, offset) {
  const at = (t) => Math.round((t + offset) * 10) / 10;
  return Object.fromEntries(
    Object.entries(answer).map(([k, v]) => [
      k,
      Array.isArray(v) ? v.map((e) => ({ ...e, start: at(e.start), end: at(e.end) })) : v,
    ]),
  );
}

/** Events grouped by kind, each kind with its instances in time order: one window per distinct entry or exit style
 * is enough; the other instances reuse its piece. @param {any[]} events */
export function kinds(events) {
  const byKind = new Map();
  for (const e of [...events].sort((a, b) => a.start - b.start)) {
    const key = e.kind.trim().toLowerCase();
    byKind.set(key, [...(byKind.get(key) ?? []), e]);
  }
  return [...byKind].map(([kind, instances]) => ({
    kind,
    count: instances.length,
    instances,
  }));
}

async function read(sa, dir, ref) {
  const max = sa.heygen ? HEYGEN_MAX_SECONDS / (FPS / HEYGEN_FPS) : SEGMENT;
  const parts = segments(durationOf(ref), cutsOf(ref), max);
  const answers = await Promise.all(
    parts.map(async ([start, end], i) => {
      const clip = proxy(ref, dir, `read-${i}`, { start, seconds: end - start });
      const { answer, receipt } = await ask(sa, dir, READ, [clip], SCHEMAS.read, FPS);
      return { answer: shift(answer, start), receipt: { ...receipt, segment: [start, end] } };
    }),
  );
  const all = answers.map((a) => a.answer);
  return {
    segments: parts,
    kinds: kinds(all.flatMap((a) => a.events)),
    sections: all.flatMap((a) => a.sections),
    captions: all.map((a) => a.captions),
    receipts: answers.map((a) => a.receipt),
  };
}

/** The presenter's beats on the film's clock, from segments read in parallel. HeyGen's route gets the clip as it is,
 * at its 2 fps with sound: slowed to 12 fps it goes silent and the words lose their times. @param {any} via
 * @param {string} dir @param {string} ref */
async function perform(via, dir, ref) {
  const fps = via.heygen ? HEYGEN_FPS : FPS;
  const parts = segments(durationOf(ref), cutsOf(ref), via.heygen ? HEYGEN_MAX_SECONDS : SEGMENT);
  const answers = await Promise.all(
    parts.map(async ([start, end], i) => {
      const clip = proxy(ref, dir, `perform-${i}`, { start, seconds: end - start });
      const { answer, receipt } = await ask(via, dir, PERFORM, [clip], SCHEMAS.perform, fps);
      return { answer: shift(answer, start), receipt: { ...receipt, segment: [start, end] } };
    }),
  );
  return joinPerform(
    answers.map((a) => a.answer),
    fps,
    answers.map((a) => a.receipt),
  );
}

/** One perform answer from each segment's: a person when any segment saw one talk, no one only when every segment
 * answered so, else null; every beat in time order.
 * @param {any[]} answers @param {number} fps @param {any[]} receipts */
export function joinPerform(answers, fps, receipts) {
  const talking = answers.filter((a) => a?.talking_person === true);
  const allSaidNo = answers.length > 0 && answers.every((a) => a?.talking_person === false);
  return {
    fps,
    talking_person: talking.length > 0 ? true : allSaidNo ? false : null,
    person: talking.map((a) => a.person).join(" / "),
    beats: talking.flatMap((a) => a.beats).sort((a, b) => a.start - b.start),
    receipts,
  };
}

/** The review question, with the reference moments to describe in both films when there are any. Only times go in:
 * given a script's finding instead, Gemini agreed with it every time, a false one too (2026-10-16).
 * @param {number[]} at */
export function reviewPrompt(at) {
  if (!at.length) return REVIEW;
  return (
    `${REVIEW}\nAlso, for each of these REFERENCE moments, describe what is on screen in the reference and at the ` +
    "matching moment of the remix (the same beat or section, which may sit at another time), give that remix time, " +
    `and say whether the structure is the same there: ${at.join(", ")} s.`
  );
}

async function review(sa, dir, [ref, draft], at) {
  const videos = [proxy(ref, dir, "review-ref"), proxy(draft, dir, "review-draft")];
  const { answer, receipt } = await ask(sa, dir, reviewPrompt(at), videos, SCHEMAS.review, FPS);
  return { ...answer, receipts: [receipt] };
}

/** Clip 1 then clip 2 as one video with both soundtracks, at clip 1's size: HeyGen's route takes one video, and
 * stacked clips go silent. @param {string[]} clips @param {string} dir */
function sequenced([first, second], dir) {
  const out = join(dir, "verify-heard.mp4");
  const [w, h] = probe(first, "stream=width,height").split("\n").find(Boolean).split(",");
  const each = (/** @type {number} */ i) =>
    `[${i}:v]scale=${w}:${h},setsar=1,fps=30[v${i}];[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`;
  execFileSync(ffmpegBin(), [
    ...["-nostdin", "-v", "error", "-y", "-i", first, "-i", second, "-filter_complex"],
    `${each(0)};${each(1)};[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`,
    ...["-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "28", "-c:a", "aac", out],
  ]);
  return out;
}

/** What is wrong in `seconds` of `ours` from `oursStart`, beside the reference's same moment from `refStart`, on
 * ours' clock; with `sound`, its soundtrack too. @param {any} via @param {string} dir @param {string[]} videos
 * @param {number[]} at refStart, oursStart @param {{ seconds: string, sound?: boolean }} f */
async function verify(via, dir, [ref, ours], [refStart, oursStart], f) {
  const seconds = verifyStretch(Number(f.seconds), [
    durationOf(ref) - refStart,
    durationOf(ours) - oursStart,
  ]);
  const clips = [
    proxy(ref, dir, "verify-ref", { start: refStart, seconds }),
    proxy(ours, dir, "verify-ours", { start: oursStart, seconds }),
  ];
  const heard = !f.sound
    ? null
    : via.heygen
      ? callHeygen(
          via.heygen,
          `${VERIFY_SOUND}\nThe two clips come as one video, Clip 1 for its first ${seconds} s, then Clip 2.`,
          sequenced(clips, dir),
          SCHEMAS.verify,
          randomUUID(),
        )
      : ask(via, dir, VERIFY_SOUND, clips, SCHEMAS.verify, FPS);
  const answers = await Promise.all([ask(via, dir, VERIFY, clips, SCHEMAS.verify, FPS), heard]);
  const said = answers.filter(Boolean);
  return {
    ...shift({ issues: said.flatMap((a) => a.answer.issues) }, oursStart),
    summary: said.map((a) => a.answer.summary).join(" "),
    receipts: said.map((a) => a.receipt),
  };
}

/** How one graphic looks in the reference and in our solo render, from its box in high resolution: a whole-film read
 * called Cindy's scrap-per-letters title one strip, its box told the two apart. @param {any} sa @param {string} dir
 * @param {any} w ref, refStart, ours, oursStart, seconds, refRoi, oursRoi */
export async function look(sa, dir, w) {
  const clips = [
    cropClip(w.ref, dir, "look-ref", w.refStart, w.seconds, w.refRoi),
    cropClip(w.ours, dir, "look-ours", w.oursStart, w.seconds, w.oursRoi),
  ];
  // One retry: under the same attempt when the first got no answer, so a job it may have started replays; as a new
  // attempt after a known outcome, which a replay would only repeat.
  const once = (/** @type {string} */ attempt) =>
    ask(sa, dir, LOOK, clips, SCHEMAS.look, 24, "MEDIA_RESOLUTION_HIGH", attempt);
  const first = randomUUID();
  const { answer, receipt } = await once(first).catch((e) =>
    PLAN_CARDS.has(e?.code) ? Promise.reject(e) : once(e?.unknown ? first : randomUUID()),
  );
  return { ...answer, receipts: [receipt] };
}

/** The look command's window from its flags. @param {string[]} args [REF, OURS] @param {Record<string, string>} f */
function lookWindow([ref, ours], f) {
  const [refStart, oursStart = refStart] = times(f.at);
  const roi = f.roi.split(",").map(Number);
  if (!(roi.length === 4 || roi.length === 8) || roi.some((v) => !Number.isFinite(v)))
    throw new Error(`--roi takes x,y,w,h (and ours' x,y,w,h); got "${f.roi}"`);
  return {
    ref,
    ours,
    refStart,
    oursStart,
    seconds: Number(f.seconds),
    refRoi: roi.slice(0, 4),
    oursRoi: roi.length === 8 ? roi.slice(4) : roi.slice(0, 4),
  };
}

const COMMANDS = {
  read: (sa, dir, args) => read(sa, dir, args[0]),
  perform: (sa, dir, args) => perform(sa, dir, args[0]),
  review,
  look: (sa, dir, args, _at, f) => look(sa, dir, lookWindow(args, f)),
  verify,
};

/** A flag's value and the arguments without it. @param {string[]} argv @param {string} name */
function flag(argv, name) {
  const i = argv.indexOf(name);
  return i < 0 ? ["", argv] : [argv[i + 1] ?? "", argv.filter((_, j) => j !== i && j !== i + 1)];
}

/** "3.1,16.3" as seconds; anything else is refused. @param {string} text */
export function times(text) {
  const at = text ? text.split(",").map(Number) : [];
  if (at.some((t) => !Number.isFinite(t) || t < 0))
    throw new Error(`--at takes seconds, e.g. 3.1,16.3; got "${text}"`);
  return at;
}
const ARITY = { read: 1, perform: 1, review: 2, look: 2, verify: 2 };

function selftest() {
  const check = (ok, what) => {
    if (!ok) throw new Error(`selftest failed: ${what}`);
  };
  check(JSON.stringify(segments(43, [3, 20])) === "[[0,43]]", "a short film is one segment");
  const cutAt = JSON.stringify(segments(150, [10, 55, 70, 118, 140]));
  check(cutAt === "[[0,55],[55,70],[70,118],[118,150]]", "segments end at the last cut that fits");
  check(
    JSON.stringify(segments(130, [])) === "[[0,60],[60,120],[120,130]]",
    "a cutless film splits every 60 s",
  );
  check(serviceAccount({}, "/nonexistent") === null, "no key reads as none");
  const viaHeygen = geminiAccess(
    { HEYGEN_API_BASE: "http://g/", HEYGEN_API_KEY: "t" },
    "/nonexistent",
  );
  check(viaHeygen?.heygen?.base === "http://g", "no Vertex key goes through HeyGen's route");
  check(
    slowBy(24, 2) === 12 && slowBy(12, 44) < 3 && slowBy(1, 10) === 1,
    "slowed to the asked fps, within 90 s",
  );
  const back = unslow(
    { events: [{ start: 12, end: 24.6, text: "12" }], moments: [{ ref_time: 6 }] },
    6,
  );
  check(
    back.events[0].start === 2 && back.events[0].end === 4.1 && back.moments[0].ref_time === 1,
    "times scale back",
  );
  const moved = shift(
    { events: [{ kind: "t", start: 1, end: 2.04 }], sections: [], captions: "" },
    55,
  );
  check(moved.events[0].start === 56 && moved.events[0].end === 57, "times move onto the film");
  const beats = shift({ person: "p", beats: [{ start: 1, end: 2.04, words: "hi" }] }, 90);
  check(beats.person === "p" && beats.beats[0].start === 91, "beats move onto the film");
  const joinedBeats = joinPerform(
    [
      { talking_person: true, person: "a", beats: [{ start: 95 }] },
      { talking_person: false, person: "", beats: [{ start: 1 }] },
      { talking_person: true, person: "b", beats: [{ start: 3 }] },
    ],
    2,
    [],
  );
  check(
    joinedBeats.talking_person &&
      joinedBeats.person === "a / b" &&
      joinedBeats.beats.map((b) => b.start).join() === "3,95",
    "beats join in time order, none from a segment with no one talking",
  );
  check(slowBy(HEYGEN_FPS, 88) === 1, "perform goes to HeyGen unslowed, so it keeps its sound");
  const grouped = kinds([
    { kind: "Step badge", start: 9, entry: "pop", exit: "cut" },
    { kind: "step badge", start: 2, entry: "pop", exit: "cut" },
  ]);
  check(grouped.length === 1 && grouped[0].count === 2, "same kind groups, case aside");
  check(
    reviewPrompt([]) === REVIEW && reviewPrompt([3.1, 16.3]).endsWith(": 3.1, 16.3 s."),
    "moments are times only",
  );
  console.log(JSON.stringify({ selftest: "ok" }));
}

async function main(argv) {
  if (argv[0] === "--selftest") return selftest();
  const sound = argv.includes("--sound");
  const [out, rest] = flag(
    argv.filter((a) => a !== "--sound"),
    "--out",
  );
  const [secondsText, rest2] = flag(rest, "--seconds");
  const [roiText, rest3] = flag(rest2, "--roi");
  const [atText, [cmd, ...args]] = flag(rest3, "--at");
  const at = cmd === "look" ? [] : times(atText);
  const flags = { at: atText, seconds: secondsText, roi: roiText, sound };
  if (cmd === "look" && !(atText && Number(secondsText) > 0 && roiText)) {
    console.error(USAGE);
    process.exit(2);
  }
  if (cmd === "verify" && !(at.length === 2 && Number(secondsText) > 0)) {
    console.error(USAGE);
    process.exit(2);
  }
  if (!COMMANDS[cmd] || args.length !== ARITY[cmd] || !out) {
    console.error(USAGE);
    process.exit(2);
  }
  const sa = geminiAccess();
  const result = sa
    ? {
        model: MODEL,
        via: sa.heygen ? "heygen" : "vertex",
        ...(await COMMANDS[cmd](sa, mkdtempSync(join(tmpdir(), "gemini-")), args, at, flags)),
      }
    : {
        skipped:
          "no Vertex key on this machine (HF_GEMINI_SA_JSON, GEMINI_PREFAB_KEY or ~/.hyperframes/gemini-sa.json) and no HeyGen key (HEYGEN_API_BASE, HEYGEN_API_KEY)",
      };
  writeFileSync(out, JSON.stringify(result, null, 1));
  console.log(
    JSON.stringify({
      out,
      ...(result.skipped ? { skipped: result.skipped } : { receipts: result.receipts }),
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  await main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(2);
  });
