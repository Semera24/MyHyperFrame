#!/usr/bin/env node
// Seeks every frame of a moment film and fails on a second ground, empty frames, dead time, jitter, the brand
// revealed other than once, unread lines or still seams. Node 22+, no npm dependencies.
// node film-gate.mjs --project <dir> [--film <dir>/film.json] [--url <studio-base>] [--fps 30] [--timeout 240] [--json]
//   [--beats <id,id>]: only the beats from the first named to the last, and 3.5 s either side
//   [--dump <file>] saves the capture; [--replay <file>] analyzes a saved one without a browser

import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  readFileSync,
  existsSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  openSync,
  closeSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { cliCall, onPath } from "./hfCli.mjs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import {
  timeoutSeconds,
  DEFAULT_FRAME,
  FRAME_OBSERVER,
  FRAME_METADATA,
  frameDimensions,
  PAGE_READY,
  SEEK_LANDED,
  capturePageUrl,
  hostTimingIssue,
  sectionHosts,
  timedHosts,
} from "./filmFrame.mjs";
import { partOf, readWords, words } from "./filmWords.mjs";
import { framesAt, stopFrames } from "./filmPixels.mjs";
import { stopTree } from "./processTree.mjs";

// ---------- args ----------
const argv = process.argv.slice(2);
// --help prints the usage comment at the top of this file, here and in an app run alike: the app never sees it.
if (argv.includes("--help") || argv.includes("-h")) {
  const lines = readFileSync(new URL(import.meta.url), "utf8")
    .split("\n")
    .slice(3);
  const usage = lines.slice(
    0,
    lines.findIndex((line) => !line.startsWith("//")),
  );
  writeFileSync(1, usage.map((line) => line.replace(/^\/\/ ?/, "")).join("\n") + "\n");
  process.exit(0);
}

// ---------- run by the app ----------
// In a HyperFrames app run, a sandbox stops this script's browser: the app runs the gate and this prints its answer.
// The app's side is main/agentSteps.mjs; these names are shared/agentSteps.mjs's.
if (process.env.HF_APP_STEPS && process.env.HF_APP_STEP_TOKEN) await handOff();
async function handOff() {
  const id = crypto.randomUUID();
  const request = join(process.env.HF_APP_STEPS, `${id}.request.json`);
  const answer = join(process.env.HF_APP_STEPS, `${id}.answer.json`);
  // The app checks its own studio, so a --url given here is dropped rather than refused.
  const i = argv.indexOf("--url");
  const args = i < 0 ? argv : [...argv.slice(0, i), ...argv.slice(i + 2)];
  writeFileSync(
    `${request}.part`,
    JSON.stringify({
      token: process.env.HF_APP_STEP_TOKEN,
      step: "gate",
      film: "harness",
      args,
      cwd: process.cwd(),
    }),
  );
  renameSync(`${request}.part`, request);
  const started = Date.now();
  // The app appends the gate's stderr here as it prints (shared/agentSteps.mjs progressOf): a long film is not silent.
  const progress = `${process.env.HF_APP_STEPS}-${id}.progress`;
  let printed = "";
  const sayProgress = () => {
    let text = printed;
    try {
      text = readFileSync(progress, "utf8");
    } catch {
      return;
    }
    if (text.length > printed.length) writeFileSync(2, text.slice(printed.length));
    printed = text;
  };
  while (!existsSync(answer)) {
    sayProgress();
    const waited = Date.now() - started;
    if ((existsSync(request) && waited > 15_000) || waited > 20 * 60_000) {
      rmSync(request, { force: true });
      console.error(
        "gate: nothing answered this shell. The turn that ran it ended or was stopped, or the app quit. Run it again in a new turn.",
      );
      process.exit(1);
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  const { stdout = "", stderr = "", code = 1 } = JSON.parse(readFileSync(answer, "utf8"));
  rmSync(answer, { force: true });
  sayProgress();
  if (stdout) writeFileSync(1, stdout);
  if (stderr && !printed.includes(stderr.trim())) writeFileSync(2, stderr);
  process.exit(code);
}
const flag = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes("--" + name);
const PROJECT = resolve(flag("project", "."));
const FILM_PATH = resolve(
  flag(
    "film",
    existsSync(join(PROJECT, "compositions", "film.json"))
      ? join(PROJECT, "compositions", "film.json")
      : join(PROJECT, "film.json"),
  ),
);
const FPS = Number(flag("fps", 30));
const AS_JSON = has("json");
// Seconds the whole check may take before it stops and says where it got to: under the app's 5-minute cap on it
// (main/turnCheck.mjs CHECK_TIMEOUT_MS), so a run hears why instead of nothing.
let TIMEOUT_S = Number(flag("timeout", timeoutSeconds(0))); // scaled by the frame count once the film is read, unless asked for
const BEATS =
  flag("beats", null)
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean) ?? null;

// ---------- thresholds ----------
const T = {
  groundTol: 24, // max channel distance from the ground color
  emptyContent: 0.003, // content share below this = empty frame
  emptyRun: 0.2, // seconds
  staticPx: 0.3, // summed px of movement per frame below this = static
  staticMad: 0.35, // pixel mean-abs-diff between shots 0.1 s apart below this = static
  mediaMove: 2, // mean channel change in a change-grid cell of a canvas, video or svg that counts
  deadRun: 1.5, // seconds of nothing moving (a landed title holds dead still, as in the official films)
  endHold: 3, // seconds the final still may last: the official films hold their end card about 3 s
  revLeg: 0.75, // px a leg must travel to count at all
  wobbleLeg: 12, // a reversal with a leg this short or shorter is a wobble
  revCount: 2, // wobbles on one axis ...
  revWindow: 0.8, // ... within this many seconds = jitter
  seamMotion: 2, // px of movement needed on each side of a seam
  seamArea: 200, // px^2 of picture changed between the two frames on one side of a seam that is motion there
  actMove: 3, // px per frame: a real move (slower is drift)
  actScale: 0.003, // size change per frame: a real push or pull
  actFade: 0.04, // opacity change per frame: a reveal or exit in progress
  actArea: 400, // px^2: smaller elements do not count as action
  staleRun: 2.5, // seconds with nothing new happening (drift does not count)
  collideOverlap: 0.25, // share of a text box covered by another world's element = a collision
  collideWindow: 0.7, // seconds: "arriving" / "leaving" around the overlap
  creepMin: 0.003, // size change per second: slower than this is still, not a creep
  creepMax: 0.04, // ... faster than this reads as motion
  creepRun: 0.8, // seconds of creeping that fail
  readHeight: 30, // px box height that counts as reading text
};

const cleanup = [];
process.on("exit", () =>
  cleanup.forEach((fn) => {
    try {
      fn();
    } catch {}
  }),
);

// ---------- film.json ----------
function loadFilm() {
  if (!existsSync(FILM_PATH))
    throw new Error(
      `no film.json in ${PROJECT}: the film gate checks a moment film against its plan (compositions/film.json, ` +
        "SKILL.md step 5). To check any other video, run hyperframes check.",
    );
  const film = JSON.parse(readFileSync(FILM_PATH, "utf8"));
  const errs = [];
  if (!/^#[0-9a-f]{6}$/i.test(film.ground || "")) errs.push('"ground" must be a #RRGGBB color');
  if (!Array.isArray(film.beats) || film.beats.length < 2) errs.push('"beats" needs 2+ beats');
  if (!(film.duration > 0)) errs.push('"duration" must be a number of seconds');
  for (const beat of Array.isArray(film.beats) ? film.beats : [])
    if (!Number.isFinite(beat?.start) || !Number.isFinite(beat?.end))
      errs.push(`beat "${beat?.id}" needs a "start" and an "end" in seconds`);
  if (errs.length)
    throw new Error(
      `film.json: ${errs.join("; ")}. Every field, filled in: ${fileURLToPath(new URL("../assets/film.json", import.meta.url))}`,
    );
  film.beats.sort((a, b) => a.start - b.start);
  return film;
}

/** The frames --beats checks, [from, to), and every beat from the first named to the last; null for the whole film.
 * A hold that reaches a checked beat is seen past the longest hold limit on either side, so it is judged as the whole
 * film judges it; an edge that close to the film's end goes to the end, where the final still is judged. */
function scopeOf(film) {
  if (!BEATS) return null;
  const first = film.beats.findIndex((beat) => BEATS.includes(beat.id));
  const last = film.beats.findLastIndex((beat) => BEATS.includes(beat.id));
  const unknown = BEATS.filter((id) => !film.beats.some((beat) => beat.id === id));
  if (unknown.length || first < 0)
    throw new Error(
      `--beats: no beat ${unknown.join(", ")} in film.json (${film.beats.map((b) => b.id).join(", ")})`,
    );
  const pad = Math.max(T.deadRun, T.staleRun, T.endHold) + 0.5,
    end = film.duration;
  const after = film.beats[last].end + pad;
  const from = Math.max(0, Math.floor((film.beats[first].start - pad) * FPS));
  const to = Math.floor((end - after < T.endHold ? end : after) * FPS);
  return { ids: film.beats.slice(first, last + 1).map((beat) => beat.id), from, to };
}

/** A saved capture cut to the scope's frames, as a scoped capture records them; a capture saved scoped starts at its
 * own `from`, and a scope past what it holds is refused. */
function windowed(cap, { from, to }) {
  const base = cap.from ?? 0,
    lo = from - base,
    hi = to - base;
  if (lo < 0 || hi > cap.N)
    throw new Error(
      `--replay: the capture holds frames ${base}-${base + cap.N}, not the ${from}-${to} --beats needs`,
    );
  const seamChange = Object.fromEntries(
    Object.entries(cap.seamChange ?? {})
      .filter(([f]) => f >= lo && f < hi)
      .map(([f, area]) => [f - lo, area]),
  );
  const shots = cap.shots
    .filter((shot) => shot.f >= lo && shot.f < hi)
    .map((shot) => ({ ...shot, f: shot.f - lo }));
  return { ...cap, from, N: to - from, frames: cap.frames.slice(lo, hi), shots, seamChange };
}

// ---------- server ----------
async function httpJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

// The CLI Desktop pins (its package.json): npx fetches exactly this one, never a newer or older release.
const HYPERFRAMES = "hyperframes@0.9.13";
function hfBin() {
  const app = join(
    homedir(),
    "Library",
    "Application Support",
    "HyperFrames",
    "agent-cli",
    "bin",
    "hyperframes",
  );
  if (onPath("hyperframes")) return ["hyperframes"];
  if (existsSync(app)) return [app];
  return ["npx", "--yes", HYPERFRAMES];
}

/** The port in `preview --json`'s ready line, or undefined for any other line. @param {string} line */
function readyPort(line) {
  if (!line.startsWith("{")) return undefined;
  try {
    const ready = JSON.parse(line);
    return ready?.ok && Number.isInteger(ready.result?.port) ? ready.result.port : undefined;
  } catch {
    return undefined; // expected: a line cut or not JSON says nothing about the port
  }
}

async function projectInList(base) {
  const j = await httpJson(base + "/api/projects");
  const mine = real(PROJECT);
  return j?.projects?.find((p) => p.dir && real(p.dir) === mine) || null;
}

async function compUrl() {
  let base = flag("url", null);
  let project = null;
  if (base) {
    base = base.replace(/\/$/, "");
    project = await projectInList(base);
  } else {
    const portFile = join(
      homedir(),
      "Library",
      "Application Support",
      "HyperFrames",
      "studio-port.json",
    );
    if (existsSync(portFile)) {
      try {
        const { port } = JSON.parse(readFileSync(portFile, "utf8"));
        const b = `http://localhost:${port}`;
        project = await projectInList(b);
        if (project) base = b;
      } catch {}
    }
  }
  if (!base) {
    const port = await new Promise((res, rej) => {
      // a port nothing else is using
      const srv = createServer();
      srv.once("error", rej);
      srv.listen(0, "127.0.0.1", () => {
        const p = srv.address().port;
        srv.close(() => res(p));
      });
    });
    const [bin, ...pre] = hfBin();
    const env = { ...process.env };
    delete env.HYPERFRAME_RUNTIME_URL;
    const child = spawn(
      ...cliCall(
        bin,
        [
          ...pre,
          "preview",
          "--foreground",
          "--no-open",
          "--force-new",
          "--json",
          "--port",
          String(port),
          PROJECT,
        ],
        { cwd: PROJECT, env, stdio: ["ignore", "pipe", "pipe"] },
      ),
    ); // in our group, so a kill of the gate's group ends it too
    let launchError;
    // Read, so a chatty server never blocks on a full pipe, and kept, so an early exit says why.
    let said = "";
    const keep = (d) => {
      said = (said + d).slice(-2000);
    };
    // The CLI moves up past a port taken since this one was picked, and its ready line says where it went.
    let bound = port;
    let pending = "";
    child.stdout.on("data", (d) => {
      keep(d);
      const lines = (pending + d).split("\n");
      pending = lines.pop();
      for (const line of lines) bound = readyPort(line) ?? bound;
    });
    child.stderr.on("data", keep);
    let closed = false;
    child.once("close", () => {
      closed = true;
    });
    child.once("error", (error) => {
      launchError = error;
    });
    cleanup.push(() => stopTree(child.pid)); // the launcher and the server it started
    const deadline = Date.now() + 120_000;
    while (
      Date.now() < deadline &&
      !(project = await projectInList((base = `http://localhost:${bound}`)))
    ) {
      // THIS project
      if (launchError !== undefined) throw launchError;
      if (closed)
        throw new Error(
          `preview server (${[bin, ...pre].join(" ")}) exited early: ${said.trim().split("\n").slice(-3).join(" | ") || "it printed nothing"}`,
        );
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!project) throw new Error("preview server never became ready");
  }
  if (!project) throw new Error(`the server at ${base} does not have this project open`);
  return capturePageUrl(base, project.id);
}

// ---------- chrome ----------
async function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const [bin, ...pre] = hfBin();
    if (bin !== "npx") {
      // `ensure` fetches the CLI's own headless shell, which render uses; `path` alone may answer the system Chrome,
      // and full Chrome aborts at once inside an agent's macOS sandbox.
      // Not execFileSync: a download blocks no timer, so the gate's own timeout still fires.
      progress.phase = "browser download";
      await promisify(execFile)(
        ...cliCall(bin, [...pre, "browser", "ensure"], { timeout: 300_000 }),
      ).catch(() => {});
      progress.phase = "browser";
      const out = execFileSync(
        ...cliCall(bin, [...pre, "browser", "path"], {
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 20_000,
        }),
      )
        .toString()
        .trim()
        .split("\n")
        .pop()
        .trim();
      if (out && existsSync(out)) return out;
    }
  } catch {}
  const cache = join(homedir(), ".cache", "puppeteer", "chrome-headless-shell");
  if (existsSync(cache)) {
    for (const v of readdirSync(cache).sort().reverse()) {
      for (const plat of readdirSync(join(cache, v))) {
        for (const name of ["chrome-headless-shell", "chrome-headless-shell.exe"]) {
          const bin = join(cache, v, plat, name);
          if (existsSync(bin)) return bin;
        }
      }
    }
  }
  const programs = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    join(process.env.LOCALAPPDATA ?? "", "Programs"),
  ];
  const systemChromes = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ...programs
      .filter(Boolean)
      .flatMap((dir) => [
        join(dir, "Google", "Chrome", "Application", "chrome.exe"),
        join(dir, "Microsoft", "Edge", "Application", "msedge.exe"),
      ]),
  ];
  const sys = systemChromes.find((file) => existsSync(file));
  if (sys) return sys;
  throw new Error("no Chrome found (run `hyperframes browser ensure` or set CHROME_PATH)");
}

// A refusal Chrome prints, and the launch that platform allows instead.
const REFUSALS = [
  // Codex's macOS seatbelt: Chrome's child processes can't register their mach port.
  [/bootstrap_check_in\b[^\n]*Permission denied/, "--single-process"],
  // Linux without unprivileged user namespaces (Ubuntu's AppArmor); the CLI runs Chrome this way on Linux too.
  [/No usable sandbox!|Failed to move to new namespace/, "--no-sandbox"],
];

async function launchChrome() {
  const first = process.env.CODEX_SANDBOX === "seatbelt" ? ["--single-process"] : [];
  return startChrome(first).catch((error) => {
    const allowed = REFUSALS.find(([refusal]) => refusal.test(error.stderr ?? ""))?.[1];
    if (!allowed || first.includes(allowed)) throw error;
    return startChrome([...first, allowed]);
  });
}

// DevTools on a pipe and a profile in the cache an agent sandbox may write: Chrome needs no port and no home folder.
async function startChrome(extraArgs) {
  const bin = await findChrome();
  const cache = join(homedir(), ".cache", "hyperframes");
  mkdirSync(cache, { recursive: true });
  const profile = mkdtempSync(join(cache, "film-gate-chrome-"));
  const args = [
    "--remote-debugging-pipe",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--mute-audio",
    "--hide-scrollbars",
    "--disable-extensions",
    `--window-size=${DEFAULT_FRAME.width},${DEFAULT_FRAME.height}`,
    ...extraArgs,
    "about:blank",
  ];
  if (!/headless-shell/.test(bin)) args.unshift("--headless=new");
  // Chrome's stderr goes to a file, not a pipe: what it printed before its exit or crash notice is there to read then.
  // Chrome runs in our group, like the preview.
  const stderrLog = join(profile, "stderr.log");
  const stderrFd = openSync(stderrLog, "w");
  const child = spawn(bin, args, { stdio: ["ignore", "ignore", stderrFd, "pipe", "pipe"] });
  closeSync(stderrFd);
  cleanup.push(() => child.kill("SIGKILL"));
  cleanup.push(() => rmSync(profile, { recursive: true, force: true }));
  const cdp = CDP.overPipe(child.stdio[3], child.stdio[4]);
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("Chrome DevTools pipe timeout")), 20_000);
    child.once("error", (error) => {
      clearTimeout(t);
      rej(error);
    });
    const printed = () => {
      try {
        return readFileSync(stderrLog, "utf8");
      } catch {
        return "";
      }
    };
    const said = () => printed().slice(-400).trim() || "it printed nothing";
    child.on("exit", (code, signal) => {
      clearTimeout(t);
      // A Chrome the system kills prints nothing: its code or signal and its binary are then all the report has.
      const how = signal ? `killed by ${signal}` : `exit code ${code}`;
      const error = Object.assign(new Error(`Chrome exited (${how}, ${bin}): ${said()}`), {
        stderr: printed(),
      });
      rej(error);
      cdp.fail(error);
    });
    cdp.listeners.push((msg) => {
      if (msg.method === "Inspector.targetCrashed")
        cdp.fail(new Error(`Chrome's page crashed (${bin}): ${said()}`));
    });
    cdp.send("Browser.getVersion", {}, undefined, 20_000).then(
      () => {
        clearTimeout(t);
        res(cdp);
      },
      () => {},
    );
  });
}

class CDP {
  constructor(write) {
    this.write = write;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
  }
  /** Chrome reads commands on fd 3 and writes replies on fd 4, each message ended by a NUL. */
  static overPipe(input, output) {
    const c = new CDP((text) => input.write(text + "\0"));
    let buf = "";
    output.on("data", (d) => {
      buf += d;
      for (let end; (end = buf.indexOf("\0")) >= 0; buf = buf.slice(end + 1))
        c.receive(JSON.parse(buf.slice(0, end)));
    });
    input.on("error", () => {});
    return c;
  }
  receive(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { res, rej } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) this.listeners.forEach((l) => l(msg));
  }
  /** Chrome or its page died: every waiting and later call fails now with how, not after its own timeout. */
  fail(error) {
    if (this.dead) return;
    this.dead = error;
    for (const { rej } of this.pending.values()) rej(error);
    this.pending.clear();
    for (const l of this.listeners) l.rej?.(error);
  }
  send(method, params = {}, sessionId, timeoutMs = 60_000) {
    if (this.dead) return Promise.reject(this.dead);
    const id = ++this.id;
    this.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(method + " timeout"));
        }
      }, timeoutMs);
    });
  }
  waitEvent(method, sessionId, timeoutMs = 60_000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("waiting " + method + " timeout")), timeoutMs);
      const l = (msg) => {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) {
          clearTimeout(t);
          this.listeners = this.listeners.filter((x) => x !== l);
          res(msg.params);
        }
      };
      l.rej = (error) => {
        clearTimeout(t);
        rej(error);
      };
      if (this.dead) l.rej(this.dead);
      else this.listeners.push(l);
    });
  }
}

// ---------- in-page harness ----------
const HARNESS = String.raw`window.__fg = {
  n: 0, meta: {}, brandSel: "[data-brand-mark]",
  seek(t) { __player.pause(); __player.seek(t); void document.body.offsetHeight; },
  pathOf(el) {
    const parts = []; let n = el, d = 0;
    while (n && n.nodeType === 1 && d < 4) {
      if (n.id) { parts.unshift("#" + n.id); break; }
      parts.unshift(n.tagName.toLowerCase() + (n.classList[0] ? "." + n.classList[0] : ""));
      n = n.parentElement; d++;
    }
    return parts.join(" > ");
  },
  // The nearest non-inline ancestor-or-self, as an id: glue only joins words of one block.
  blockOf(el) {
    let block = el;
    while (block.parentElement && getComputedStyle(block).display.startsWith("inline")) block = block.parentElement;
    return block.__fgb ??= ++this.n;
  },
  // 1 when an inline element's own text continues the word before it in its block: a split title's next letter.
  // A word span after a visible gap starts a word, though no space sits between the spans in the markup.
  glued(el) {
    if (!getComputedStyle(el).display.startsWith("inline")) return 0;
    const first = [...el.childNodes].find((c) => c.nodeType === 3 && c.nodeValue.trim());
    let block = el.parentElement;
    while (block && getComputedStyle(block).display.startsWith("inline")) block = block.parentElement;
    if (!first || !block) return 0;
    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(first, first.nodeValue.search(/\S/));
    if (!/\S$/.test(before.toString())) return 0;
    const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let prev = null;
    for (let n = walk.nextNode(); n && n !== first; n = walk.nextNode()) if (n.nodeValue.trim()) prev = n;
    if (!prev || Math.max(prev.nodeValue.trim().length, first.nodeValue.trim().length) < 2) return 1;
    const at = (node, i) => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); return r.getBoundingClientRect(); };
    const a = at(prev, prev.nodeValue.trimEnd().length - 1);
    const b = at(first, first.nodeValue.search(/\S/));
    const sameLine = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) / 2;
    return sameLine && b.left - a.right <= 0.2 * (parseFloat(getComputedStyle(el).fontSize) || 16) ? 1 : 0;
  },
  scan() {
    const memo = new Map();
    const op = (el) => {
      if (!el || el.nodeType !== 1) return 1;
      if (memo.has(el)) return memo.get(el);
      const v = parseFloat(getComputedStyle(el).opacity || "1") * op(el.parentElement);
      memo.set(el, v);
      return v;
    };
    const out = [];
    const W = innerWidth, H = innerHeight;
    for (const el of document.body.querySelectorAll("*")) {
      const tag = el.tagName.toUpperCase();
      if (/^(SCRIPT|STYLE|TEMPLATE|AUDIO|SOURCE|LINK|META|NOSCRIPT)$/.test(tag)) continue;
      // A graded image or video is drawn by a canvas the runtime adds after it: it carries the author's brand tag.
      const source = tag === "CANVAS" && el.getAttribute("data-hf-color-grading-canvas") === "true"
        ? el.previousElementSibling : null;
      const brand = el.matches(this.brandSel) || !!source?.matches(this.brandSel);
      const media = tag === "IMG" || tag === "VIDEO" || tag === "CANVAS" ||
        (tag === "SVG" && !(el.parentElement && el.parentElement.closest("svg")));
      if (!brand && el.closest("svg") && tag !== "SVG") continue;
      let text = "";
      if (!media) for (const c of el.childNodes) if (c.nodeType === 3) text += c.nodeValue; else if (c.tagName === "BR") text += " ";
      text = text.replace(/\s+/g, " ").trim();
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= W || r.top >= H) continue;
      const cs = getComputedStyle(el);
      let box = false;
      if (!brand && !media && !text) {      // cards, badges, chips: a painted box, not a layout wrapper
        const area = r.width * r.height;
        if (area < 1200 || area > 0.6 * W * H) continue;
        const fill = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
        const alpha = fill ? (fill[1].split(",")[3] === undefined ? 1 : parseFloat(fill[1].split(",")[3])) : 0;
        if (cs.backgroundImage === "none" && alpha < 0.5) continue;
        box = true;
      }
      if (cs.visibility !== "visible") continue;
      const o = op(el);
      if (o < 0.02) continue;
      if (!el.__fgid) {
        el.__fgid = ++this.n;
        const host = el.closest("[data-composition-id]");
        const videoOutput = source?.tagName === "VIDEO" &&
          source.getAttribute("data-hf-color-grading-source-hidden") === "true";
        this.meta[el.__fgid] = { text: text.slice(0, 90), tag: box ? "box" : videoOutput ? "video" : tag.toLowerCase(), sel: this.pathOf(el), fs: Math.round(parseFloat(cs.fontSize) || 0),
          comp: host ? host.getAttribute("data-composition-id") : "", glued: text ? this.glued(el) : 0,
          block: text ? this.blockOf(el) : 0 };
      }
      const row = [el.__fgid, Math.round((r.x + r.width / 2) * 100) / 100, Math.round((r.y + r.height / 2) * 100) / 100,
        Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100, Math.round(o * 1000) / 1000, brand ? 1 : 0];
      // A counter or typed line changes its text over the film: this frame's own text, when not what it first showed.
      if (text.slice(0, 90) !== this.meta[el.__fgid].text) row.push(text.slice(0, 90));
      out.push(row);
    }
    return out;
  },
  rootDuration() {
    const root = document.querySelector('[data-composition-id="main"]') || document.querySelector("[data-composition-id]");
    return root ? parseFloat(root.getAttribute("data-duration")) : NaN;
  },
  // What an empty shot had on the page: the clips drawn, and media not ready or still seeking.
  why() {
    const shown = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const clips = [...document.querySelectorAll(".clip, [data-composition-src]")].filter((el) => el.tagName !== "AUDIO");
    const live = (m) => { const host = m.parentElement?.closest(".clip, [data-composition-src]"); return !host || shown(host); };
    const media = [...document.querySelectorAll("video, audio")].filter((m) => live(m) && (m.readyState < 2 || m.seeking));
    return {
      clips: clips.length,
      shown: clips.filter(shown).map((el) => el.id || this.pathOf(el)),
      media: media.map((m) => (m.id || this.pathOf(m)) + " readyState " + m.readyState + (m.seeking ? " seeking" : "")),
    };
  }
};true`;

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const dist = (r, g, b, c) => Math.max(Math.abs(r - c[0]), Math.abs(g - c[1]), Math.abs(b - c[2]));

/** Shot pixels per side of a change-grid cell (CELL / SHOT_SCALE page px). */
const CELL = 8;
const SHOT_SCALE = 0.125;
/** Shots a second: the CLI draws a frame in about 0.3 s, so a 60 s film takes near two minutes. */
const SHOT_HZ = 5;
/** The seam check's own shots: fine enough that a 1 px line or an svg's own shape still shows. */
const SEAM_SCALE = 0.5;

/** Page px^2 whose color changed past groundTol between two shots of one scale. */
function changedArea(a, b, scale) {
  let n = 0;
  for (let o = 0; o < a.length; o += 3)
    if (dist(a[o], a[o + 1], a[o + 2], [b[o], b[o + 1], b[o + 2]]) > T.groundTol) n++;
  return Math.round(n / (scale * scale));
}

function shotStats({ w, h, rgb }, ground, prevRgb) {
  let content = 0,
    mad = 0;
  const cols = Math.ceil(w / CELL),
    cells = new Float64Array(cols * Math.ceil(h / CELL)),
    counts = new Uint16Array(cells.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3,
        r = rgb[o],
        g = rgb[o + 1],
        b = rgb[o + 2];
      const d = dist(r, g, b, ground);
      if (d > T.groundTol) content++;
      if (!prevRgb) continue;
      const change =
        Math.abs(r - prevRgb[o]) + Math.abs(g - prevRgb[o + 1]) + Math.abs(b - prevRgb[o + 2]);
      mad += change;
      const c = Math.floor(y / CELL) * cols + Math.floor(x / CELL);
      cells[c] += change / 3;
      counts[c]++;
    }
  }
  return {
    content: content / (w * h),
    mad: prevRgb ? mad / (w * h * 3) : null,
    // Mean channel change per cell since the last shot: where the picture moved, which no element box shows for a
    // canvas or a video.
    ...(prevRgb && {
      cols,
      cells: [...cells].map((sum, c) => Math.round((sum / counts[c]) * 10) / 10),
    }),
  };
}

/** Per frame: whether a canvas, video or svg changed its own picture since the shot before: its cells changed by
 * mediaMove add up to actArea of fully changed pixels, and a cell under another element that changed is that element's.
 * A capture saved before the grid has none, so nothing counts. */
function mediaMotion({ N, frames, shots, meta }) {
  const moving = new Array(N).fill(false);
  const side = CELL / SHOT_SCALE;
  const media = (r) => ["canvas", "video", "svg"].includes((meta[r[0]] || {}).tag);
  const cellsUnder = (r, cols, rows) => {
    const [x0, x1] = [
      Math.max(0, Math.floor((r[1] - r[3] / 2) / side)),
      Math.min(cols - 1, Math.floor((r[1] + r[3] / 2) / side)),
    ];
    const [y0, y1] = [
      Math.max(0, Math.floor((r[2] - r[4] / 2) / side)),
      Math.min(rows - 1, Math.floor((r[2] + r[4] / 2) / side)),
    ];
    const out = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * cols + x);
    return out;
  };
  for (let i = 1; i < shots.length; i++) {
    const { f, cols, cells } = shots[i];
    if (!cells) continue;
    const rows = cells.length / cols;
    const before = new Map(frames[shots[i - 1].f].map((r) => [r[0], r]));
    const after = new Map(frames[f].map((r) => [r[0], r]));
    const theirs = new Set();
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const [a, b] = [before.get(id), after.get(id)];
      if (media(a ?? b) || (a && b && [1, 2, 3, 4, 5].every((k) => a[k] === b[k]))) continue;
      for (const r of [a, b]) if (r) for (const c of cellsUnder(r, cols, rows)) theirs.add(c);
    }
    const own = new Set();
    for (const r of frames[f])
      if (media(r) && r[5] >= 0.1 && r[3] * r[4] >= T.actArea)
        for (const c of cellsUnder(r, cols, rows))
          if (!theirs.has(c) && cells[c] >= T.mediaMove) own.add(c);
    const area = [...own].reduce((sum, c) => sum + (cells[c] / 255) * side * side, 0);
    if (area >= T.actArea) for (let g = shots[i - 1].f + 1; g <= f; g++) moving[g] = true;
  }
  return moving;
}

// sections mounted by index.html, from a file or inline
function indexHosts() {
  const p = join(PROJECT, "index.html");
  return existsSync(p) ? sectionHosts(readFileSync(p, "utf8")) : [];
}

// ---------- capture ----------
async function capture(film, progress, from = 0) {
  progress.phase = "preview";
  const url = await compUrl();
  progress.phase = "browser";
  const cdp = await launchChrome();
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  // Also reports a page already crashed by now; a later crash arrives as Inspector.targetCrashed (startChrome).
  await cdp.send("Inspector.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: FRAME_OBSERVER }, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { ...DEFAULT_FRAME, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  progress.phase = "navigation";
  const loaded = cdp.waitEvent("Page.loadEventFired", sessionId, 90_000);
  await cdp.send("Page.navigate", { url }, sessionId);
  await loaded;
  // The slowest step of any frame so far, so a run that times out says what it was waiting on.
  const timed = async (phase, step) => {
    const started = Date.now();
    const result = await step;
    const ms = Date.now() - started;
    if (progress.frame !== null && ms > (progress.slowest?.ms ?? 0))
      progress.slowest = { phase, frame: progress.frame, ms };
    return result;
  };
  const ev = async (phase, expression, awaitPromise = false) => {
    progress.phase = phase;
    const r = await timed(
      phase,
      cdp.send(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise },
        sessionId,
        90_000,
      ),
    );
    if (r.exceptionDetails)
      throw new Error(
        "page error: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text),
      );
    return r.result.value;
  };
  const waitReady = async () => {
    const deadline = Date.now() + 60_000;
    while (
      Date.now() < deadline &&
      !(await ev("player readiness", "!!(window.__player && window.__playerReady !== false)"))
    )
      await new Promise((r) => setTimeout(r, 300));
    if (!(await ev("player readiness", "!!(window.__player && window.__playerReady !== false)")))
      throw new Error("the HyperFrames player never appeared at " + url);
  };
  await waitReady();
  const frame = frameDimensions(await ev("frame dimensions", FRAME_METADATA));
  if (frame.width !== DEFAULT_FRAME.width || frame.height !== DEFAULT_FRAME.height) {
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { ...frame, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    // Scene scripts must initialize with the measured frame, not the preflight viewport.
    progress.phase = "reload";
    const reloaded = cdp.waitEvent("Page.loadEventFired", sessionId, 90_000);
    await cdp.send("Page.reload", {}, sessionId);
    await reloaded;
    await waitReady();
  }
  await ev("assets ready", PAGE_READY, true);
  await ev("install capture harness", HARNESS);
  if (film.brandSelector)
    await ev(
      "brand selector",
      `__fg.brandSel = ${JSON.stringify("[data-brand-mark], " + film.brandSelector)}; true`,
    );

  const rootDur = await ev("duration", "__fg.rootDuration()");
  const N = progress.totalFrames,
    to = from + N;
  const every = Math.max(1, Math.round(FPS / SHOT_HZ));
  const frames = [],
    shots = [];
  const ground = hexRgb(film.ground);
  // Each seam's two sides, shot whole: the last two frames before it and its first two. The grid's shots fall where
  // they fall, and an svg's own shape or a 1 px line moves in no box the scan keeps.
  const seamEnds = new Set();
  for (const beat of film.beats.slice(1)) {
    const fb = Math.round(beat.start * FPS);
    seamEnds.add(fb - 1).add(fb + 1);
  }
  const seamShot = (f) => seamEnds.has(f) || seamEnds.has(f + 1);
  const seamChange = {};
  // The page is scanned at every frame; the pixels are asked of the CLI once, below, from the frames it draws.
  const wants = [];
  for (let f = from; f < to; f++) {
    const t = f / FPS;
    progress.frame = f;
    progress.time = t;
    frames.push(await ev("seek and scan", `__fg.seek(${t}); __fg.scan()`));
    progress.frames = frames.length;
    if (f % every === 0) wants.push({ f, t, scale: SHOT_SCALE, grid: true });
    if (seamShot(f)) wants.push({ f, t, scale: SEAM_SCALE, grid: false });
  }
  progress.phase = "frames from the CLI";
  progress.frame = null;
  progress.drawingSince = Date.now();
  progress.shotsWanted = wants.length;
  const pictures = await framesAt(wants, PROJECT, hfBin(), {
    onStep: (done) => {
      progress.screenshots = done;
    },
  });
  let prevRgb = null,
    seamPrev = null;
  for (const [i, { f, t, grid }] of wants.entries()) {
    const img = pictures[i];
    if (!grid) {
      if (seamEnds.has(f) && seamPrev?.f === f - 1)
        seamChange[f - from] = changedArea(seamPrev.rgb, img.rgb, SEAM_SCALE);
      seamPrev = { f, rgb: img.rgb };
      continue;
    }
    const stats = shotStats(img, ground, prevRgb);
    let why = {};
    if (stats.content < T.emptyContent) {
      // What the page had at that moment: its clips drawn, and media not ready or still seeking.
      await ev("seek", `__fg.seek(${t})`);
      await ev("seek completion", SEEK_LANDED, true);
      why = { why: await ev("empty frame", "__fg.why()") };
    }
    shots.push({ f: f - from, t, ...stats, ...why });
    prevRgb = img.rgb;
  }
  const meta = await ev("capture metadata", "__fg.meta");
  // Read last, once every section has loaded: the player's own timing, so the gate and playback never disagree.
  const clips = await ev("section timing", "window.__clipManifest?.clips ?? null");
  if (!Array.isArray(clips))
    throw new Error("the HyperFrames player published no clip timing (window.__clipManifest)");
  const hosts = timedHosts(indexHosts(), clips);
  return { url, rootDur, hosts, N, from, frames, shots, shotHz: SHOT_HZ, seamChange, meta, frame };
}

// ---------- analysis ----------
const fmt = (s) => s.toFixed(2);
/** What the page had at an empty shot, for the FAIL line; nothing for a dump saved before shots carried it. */
const emptyWhy = ({ t, why }) =>
  why
    ? ` (at ${fmt(t)}s: ${why.shown.length} of ${why.clips} clips drawn${why.shown.length ? ": " + why.shown.slice(0, 3).join(", ") : ""}` +
      `${why.media.length ? "; media not ready: " + why.media.slice(0, 3).join(", ") : ""})`
    : "";
// Text elements in reading order, each led by a space unless glued to the word before it (a split title's letters).
/** The text a row shows in its own frame: its own when it moved off the element's first (a counter), else the first. */
const textOf = (row, meta) => row[7] ?? meta[row[0]]?.text;
const readingText = (rows, meta) => {
  const sorted = [...rows].sort(
    (a, b) => Math.round(a[2] / 40) - Math.round(b[2] / 40) || a[1] - b[1],
  );
  return sorted
    .map((r, i) => {
      const glued = meta[r[0]].glued && meta[sorted[i - 1]?.[0]]?.block === meta[r[0]].block;
      return (glued ? "" : " ") + textOf(r, meta);
    })
    .join("");
};
const runs = (flags) => {
  // [[i0, i1], ...] inclusive index runs where flags[i] is true
  const out = [];
  let s = -1;
  flags.forEach((v, i) => {
    if (v && s < 0) s = i;
    if (!v && s >= 0) {
      out.push([s, i - 1]);
      s = -1;
    }
  });
  if (s >= 0) out.push([s, flags.length - 1]);
  return out;
};

// A beat keeps a floor check off only for a reference choice the person approved: film.approved is set and the beat
// ports the part its keep entry names (SKILL.md §5).
function keptBeats(film, check) {
  if (!film.approved) return [];
  return film.beats.flatMap((beat) => {
    const kept = (beat.keep || []).find(
      (k) => k?.check === check && [beat.port ?? []].flat().includes(k.port),
    );
    return kept ? [{ beat, port: kept.port }] : [];
  });
}
/** Names each beat a check kept off, so a kept choice never passes silently. */
const keptNote = (kept) =>
  kept.length
    ? `; kept for the reference: ${kept.map(({ beat, port }) => `beat "${beat.id}" (${port})`).join(", ")}`
    : "";

/** A Moment's code, every copy of it: where it was fetched, or where the app put an attached one, in a folder named
 * for its bundle's hash. */
function momentCode(id) {
  return [
    join(".hyperframes", "refs"),
    join("boards", "refs"),
    "references/moments",
    join(".hyperframes", "references", "moments"),
  ]
    .flatMap((base) => {
      const dir = join(PROJECT, base, id);
      const copies = existsSync(dir) ? readdirSync(dir).map((name) => join(dir, name)) : [];
      return [dir, ...copies].map((root) => join(root, "code", "index.html")).filter(existsSync);
    })
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}
/** A `port` pointer "M<id>:<label>" must name a timeline label of that Moment's code; a reference film's span
 * "<file>@<start>–<end>" is not checked; anything else is neither. */
const portIssues = (beat) =>
  [beat.port ?? []].flat().flatMap((pointer) => {
    const m = /^([A-Za-z]\d+):([\w-]+)$/.exec(String(pointer).trim());
    if (!m)
      return /^.+@\d+(?:\.\d+)?\s*[–-]\s*\d+(?:\.\d+)?$/.test(String(pointer).trim())
        ? []
        : [
            `beat "${beat.id}" ports ${pointer}, which is neither a Moment's label (M<id>:<label>) nor a reference film's span (<file>@<start>–<end>)`,
          ];
    const code = momentCode(m[1].toUpperCase());
    if (!code)
      return [
        `beat "${beat.id}" ports ${pointer}, but ${m[1].toUpperCase()}'s code is not in the project; fetch it first`,
      ];
    return new RegExp(`addLabel\\(\\s*['"]${m[2]}['"]`).test(code)
      ? []
      : [`beat "${beat.id}" ports ${pointer}, which its code has no timeline label for`];
  });

const MOTION_CHECKS = [
  "no dead time",
  "staged action",
  "no jitter",
  "smooth speed",
  "no creep",
  "seams in motion",
  "hard cuts",
];

function analyze(film, cap, scope) {
  const { N, frames, shots, meta } = cap;
  const dur = film.duration;
  const checks = [];
  const add = (name, status, detail, items = []) => checks.push({ name, status, detail, items });
  const dt = 1 / FPS;
  // A scoped capture starts at frame F0 of the film: frame indexes stay the capture's, times are the film's.
  const F0 = cap.from ?? 0;
  const timeOf = (f) => (f + F0) * dt;
  const inScope = (beat) => !scope || scope.ids.includes(beat.id);

  // film.json shape
  {
    const items = [];
    const b = film.beats;
    if (Math.abs(b[0].start) > 0.05) items.push(`first beat starts at ${b[0].start}s, not 0`);
    for (let i = 1; i < b.length; i++)
      if (Math.abs(b[i].start - b[i - 1].end) > 0.05)
        items.push(`gap or overlap between "${b[i - 1].id}" and "${b[i].id}"`);
    if (Math.abs(b[b.length - 1].end - dur) > 0.05)
      items.push(`last beat ends at ${b[b.length - 1].end}s, film is ${dur}s`);
    if (Number.isFinite(cap.rootDur) && Math.abs(cap.rootDur - dur) > 0.05)
      items.push(`index.html says ${cap.rootDur}s, film.json says ${dur}s`);
    if (!film.beats.some((x) => x.id === film.brandReveal))
      items.push(`brandReveal "${film.brandReveal}" is not a beat id`);
    if (!film.feature?.name || !film.feature?.after)
      items.push(
        '"feature" needs a name and an after: the film is about one feature (SKILL.md step 1)',
      );
    for (const beat of b) {
      items.push(...portIssues(beat));
      if (beat.moment && !String(beat.subject ?? "").trim())
        items.push(
          `beat "${beat.id}" ports ${beat.moment} but names no "subject"; write the product's own thing its move plays on, in place of ${beat.moment}'s`,
        );
      const h = (cap.hosts || []).find((x) => x.id === beat.id);
      if (!h) {
        items.push(`no section with data-composition-id "${beat.id}" in index.html`);
        continue;
      }
      const timing = hostTimingIssue(beat, h);
      if (timing) items.push(timing);
      if (/[.]\s*$/.test(beat.line || ""))
        items.push(`"${beat.line}" ends with a period: no trailing periods on screen`);
    }
    add(
      "film.json",
      items.length ? "FAIL" : "PASS",
      items.length ? items.join("; ") : `${b.length} beats, ${dur}s`,
      items,
    );
  }

  // empty frames
  {
    // A capture saved before the CLI drew the pixels held 10 shots a second.
    const hz = cap.shotHz ?? 10;
    const empty = shots.map((s) => s.t > 0.1 && s.content < T.emptyContent);
    const bad = runs(empty)
      .filter(([a, b]) => (b - a + 1) / hz >= T.emptyRun)
      .map(
        ([a, b]) =>
          `nothing on screen ${fmt(shots[a].t)}-${fmt(shots[b].t + 1 / hz)}s${emptyWhy(shots[a])}`,
      );
    add(
      "no empty frames",
      bad.length ? "FAIL" : "PASS",
      bad.length ? bad.join("; ") : "content in every frame",
      bad,
    );
  }

  // per-frame motion from the DOM
  const motion = new Array(N).fill(0);
  const byId = new Map(); // id -> Map(frame -> row)
  frames.forEach((rows, f) =>
    rows.forEach((r) => {
      if (!byId.has(r[0])) byId.set(r[0], new Map());
      byId.get(r[0]).set(f, r);
    }),
  );
  for (let f = 1; f < N; f++) {
    const prev = new Map(frames[f - 1].map((r) => [r[0], r]));
    let m = 0;
    for (const r of frames[f]) {
      const p = prev.get(r[0]);
      if (!p) {
        m += 50;
        continue;
      }
      m +=
        Math.abs(r[1] - p[1]) +
        Math.abs(r[2] - p[2]) +
        Math.abs(r[3] - p[3]) +
        Math.abs(r[4] - p[4]) +
        100 * Math.abs(r[5] - p[5]);
      prev.delete(r[0]);
    }
    m += 50 * prev.size;
    motion[f] = m;
  }
  // A canvas, video or svg moves in its pixels, not its box: its moving picture is motion as a box move is.
  const mediaMoving = mediaMotion(cap);
  mediaMoving.forEach((moving, f) => {
    if (moving) motion[f] += T.seamMotion;
  });
  // Beside a seam, the picture's own change from the frame before: an svg's shape or a thin line moving is motion.
  for (const [f, area] of Object.entries(cap.seamChange ?? {}))
    if (area >= T.seamArea) motion[f] += T.seamMotion;

  // The final still: the last frames where nothing moves and nothing changes size at creepMin, even below the dead-time
  // tolerance. Only the still gets the endHold allowance; what comes before it keeps the mid-video limits, and a video
  // that ends moving has no allowance at all.
  const pxStatic = new Array(N).fill(true);
  const staticMad = (T.staticMad * 10) / (cap.shotHz ?? 10);
  for (let i = 1; i < shots.length; i++)
    if (shots[i].mad >= staticMad)
      for (let f = shots[i - 1].f + 1; f <= shots[i].f; f++) pxStatic[f] = false;
  const dead = motion.map((m, f) => f > 0 && m < T.staticPx && pxStatic[f]);
  const resized = frames.map(
    (rows, f) =>
      f > 0 &&
      rows.some((r) => {
        const p = byId.get(r[0]).get(f - 1);
        return p && r[5] >= 0.5 && p[3] >= 40 && (Math.abs(r[3] - p[3]) / p[3]) * FPS >= T.creepMin;
      }),
  );
  const endsFilm = F0 + N >= Math.floor(dur * FPS);
  const still = endsFilm
    ? runs(dead.map((d, f) => d && !resized[f])).find(([, b]) => b >= N - 2)
    : undefined;
  const stillFrom = still ? still[0] - 1 : N;
  /** Seconds of [t0, t1] before the final still and within it. */
  const split = (t0, t1) => ({
    before: Math.max(0, Math.min(t1, timeOf(stillFrom)) - t0),
    held: Math.max(0, t1 - Math.max(t0, timeOf(stillFrom))),
  });
  const stillNote = (s) => (s ? `, ${fmt(s)}s of it the final still` : "");

  // dead time: DOM static and pixels static
  {
    const bad = [];
    for (const [a, b] of runs(dead)) {
      const len = (b - a + 2) * dt,
        t0 = timeOf(a - 1),
        t1 = timeOf(b + 1);
      const part = b >= N - 2 ? split(t0, t1) : { before: len, held: 0 };
      if (part.before >= T.deadRun || part.held > T.endHold)
        bad.push(`nothing moves ${fmt(t0)}-${fmt(t1)}s (${fmt(len)}s${stillNote(part.held)})`);
    }
    add(
      "no dead time",
      bad.length ? "FAIL" : "PASS",
      bad.length ? `${bad.length} still stretch(es)` : `longest still under ${T.deadRun}s`,
      bad,
    );
  }

  // staged action: something new must happen at least every staleRun seconds (drift does not count)
  {
    const act = mediaMoving.slice();
    act[0] = true;
    for (let f = 1; f < N; f++) {
      if (act[f]) continue;
      const prev = new Map(frames[f - 1].filter((r) => r[5] >= 0.1).map((r) => [r[0], r]));
      for (const r of frames[f]) {
        const area = r[3] * r[4];
        if (area < T.actArea || r[5] < 0.1) continue;
        const p = prev.get(r[0]);
        if (!p) {
          if (area >= 2000) {
            act[f] = true;
            break;
          }
          continue;
        }
        const dw = Math.abs(r[3] - p[3]),
          dh = Math.abs(r[4] - p[4]);
        if (
          Math.hypot(r[1] - p[1], r[2] - p[2]) >= T.actMove ||
          (Math.max(dw, dh) >= 1 && Math.max(dw / p[3], dh / p[4]) >= T.actScale) ||
          Math.abs(r[5] - p[5]) >= T.actFade
        ) {
          act[f] = true;
          break;
        }
      }
      if (!act[f])
        for (const [id, p] of prev) {
          if (p[3] * p[4] >= 2000 && !frames[f].some((r) => r[0] === id && r[5] >= 0.1)) {
            act[f] = true;
            break;
          }
        }
    }
    const bad = [];
    for (const [a, b] of runs(act.map((v) => !v))) {
      const len = (b - a + 1) * dt,
        t0 = timeOf(a),
        t1 = timeOf(b + 1);
      const part = b >= N - 2 ? split(t0, t1) : { before: len, held: 0 };
      if (part.before > T.staleRun || part.held > T.endHold)
        bad.push(
          `nothing new ${fmt(t0)}-${fmt(t1)}s (${fmt(len)}s${stillNote(part.held)}): only drift or stillness`,
        );
    }
    add(
      "staged action",
      bad.length ? "FAIL" : "PASS",
      bad.length
        ? `${bad.length} stretch(es) where nothing new happens`
        : `something new at least every ${T.staleRun}s`,
      bad,
    );
  }

  // jitter: direction reversals per element per axis
  {
    const bad = [],
      kinks = [],
      seenWobble = new Set();
    const keptJitter = keptBeats(film, "no jitter");
    const inKept = (t) => keptJitter.some(({ beat }) => t >= beat.start && t < beat.end);
    for (const [id, track] of byId) {
      const fs = [...track.keys()].sort((a, b) => a - b);
      for (const [axis, k] of [
        ["x", 1],
        ["y", 2],
      ]) {
        // contiguous visible stretches
        let seg = [];
        const flush = () => {
          if (seg.length < 4) {
            seg = [];
            return;
          }
          const legs = [];
          let cur = null;
          for (let i = 1; i < seg.length; i++) {
            const d = seg[i][k] - seg[i - 1][k];
            if (Math.abs(d) < 0.25) continue;
            const s = Math.sign(d);
            if (!cur || cur.s !== s) {
              cur = { s, sum: 0, f0: seg[i - 1].f, f1: seg[i].f };
              legs.push(cur);
            }
            cur.sum += d;
            cur.f1 = seg[i].f;
          }
          // a small reversal on this axis while the element travels on the other axis is a curved
          // path, not a wobble: skip it when the other axis covers 3x the small leg in that time
          const other = k === 1 ? 2 : 1;
          const at = new Map(seg.map((p) => [p.f, p]));
          const perp = (leg) =>
            Math.abs((at.get(leg.f1)?.[other] ?? 0) - (at.get(leg.f0)?.[other] ?? 0));
          const steady = (leg) => {
            // the other axis moves across 3+ frames, not in one jump
            if (leg.f1 - leg.f0 < 3) return false;
            let step = 0;
            for (let f = leg.f0 + 1; f <= leg.f1; f++)
              step = Math.max(
                step,
                Math.abs((at.get(f)?.[other] ?? 0) - (at.get(f - 1)?.[other] ?? 0)),
              );
            return step <= 0.5 * perp(leg);
          };
          const revs = [];
          for (let i = 1; i < legs.length; i++) {
            const a = Math.abs(legs[i - 1].sum),
              b = Math.abs(legs[i].sum);
            if (a < T.revLeg || b < T.revLeg || Math.min(a, b) > T.wobbleLeg) continue;
            const small = a <= b ? legs[i - 1] : legs[i];
            if (perp(small) > 3 * Math.abs(small.sum) + 2 && steady(small)) continue;
            revs.push({ f: legs[i].f0, i });
          }
          let reported = -1e9;
          for (let i = 0; i + T.revCount - 1 < revs.length; i++) {
            const a = revs[i],
              b = revs[i + T.revCount - 1];
            if ((b.f - a.f) * dt <= T.revWindow && a.f > reported) {
              const legsTxt = legs
                .slice(Math.max(0, a.i - 1), b.i + 1)
                .map((l) => Math.abs(l.sum).toFixed(0))
                .join(", ");
              const m = meta[id] || {};
              const name = m.text ? `"${m.text.slice(0, 40)}"` : `<${m.tag}>`;
              const key = `${name} ${m.sel || ""}${m.comp ? ` [${m.comp}]` : ""}: ${axis}`;
              if (!seenWobble.has(key) && !inKept(timeOf(a.f))) {
                seenWobble.add(key);
                bad.push(
                  `${key} wobbles ${b.i - a.i + 1}x in ${fmt((b.f - a.f) * dt)}s at ${fmt(timeOf(a.f))}s (legs ${legsTxt} px)`,
                );
              }
              reported = b.f + T.revWindow * FPS;
            }
          }
          // stair steps: speed jumps that then hold (linear key chains)
          let kc = [];
          for (let i = 3; i < seg.length; i++) {
            const v0 = seg[i - 2][k] - seg[i - 3][k],
              v1 = seg[i - 1][k] - seg[i - 2][k],
              v2 = seg[i][k] - seg[i - 1][k];
            if (
              Math.abs(v1) > 1.5 &&
              Math.abs(v0) > 1.5 &&
              Math.sign(v0) === Math.sign(v1) &&
              Math.abs(v1 - v0) > 0.6 * Math.max(Math.abs(v0), Math.abs(v1)) &&
              Math.abs(v2 - v1) < 0.15 * Math.abs(v1)
            )
              kc.push(seg[i - 1].f);
          }
          for (let i = 0; i + 2 < kc.length; i++)
            if ((kc[i + 2] - kc[i]) * dt <= 1) {
              const m = meta[id] || {};
              kinks.push(
                `${m.text ? `"${m.text.slice(0, 40)}"` : `<${m.tag}>`} ${m.sel || ""}: ${axis} speed jumps at ${kc
                  .slice(i, i + 3)
                  .map((f) => fmt(timeOf(f)))
                  .join(", ")}s (linear key chain?)`,
              );
              break;
            }
          seg = [];
        };
        let last = -2;
        for (const f of fs) {
          const r = track.get(f);
          if (f !== last + 1) flush();
          seg.push({ f, 1: r[1], 2: r[2] });
          last = f;
        }
        flush();
      }
    }
    add(
      "no jitter",
      bad.length ? "FAIL" : "PASS",
      (bad.length ? `${bad.length} element(s) wobble` : "every move keeps one direction") +
        keptNote(keptJitter),
      bad,
    );
    if (kinks.length)
      add(
        "smooth speed",
        "WARN",
        `${kinks.length} element(s) change speed in steps`,
        kinks.slice(0, 12),
      );
  }

  // the brand mark: the element tagged data-brand-mark is seen at least once (story.md: it lands in brandReveal)
  if (!scope || scope.ids.includes(film.brandReveal)) {
    const seen = frames.some((rows) => rows.some((r) => r[6] && r[5] > 0.3 && r[3] * r[4] > 600));
    add(
      "brand mark",
      seen ? "PASS" : "FAIL",
      seen
        ? "the tagged mark is seen"
        : "no visible element is tagged data-brand-mark: tag the brand mark where it lands",
    );
  }

  // lines on screen + viewer transcript
  const frameWords = frames.map((rows) => {
    return words(
      readingText(
        rows.filter((r) => r[5] >= 0.5 && textOf(r, meta)),
        meta,
      ),
    );
  });
  {
    const bad = [],
      long = [];
    const keptLines = keptBeats(film, "lines on screen");
    for (const beat of film.beats.filter(inScope)) {
      if (keptLines.some((k) => k.beat === beat)) continue;
      const want = words(beat.line || "");
      if (!want.length) {
        bad.push(`beat "${beat.id}" has no line`);
        continue;
      }
      const count = readWords(beat.line);
      if (count > 6) long.push(`"${beat.line}" is ${count} words`);
      const f0 = Math.max(0, Math.floor((beat.start - 0.3) * FPS) - F0),
        f1 = Math.min(N - 1, Math.ceil((beat.end + 0.3) * FPS) - F0);
      let ok = false;
      for (let f = f0; f <= f1 && !ok; f++) {
        const pool = new Map();
        frameWords[f].forEach((w) => pool.set(w, (pool.get(w) || 0) + 1));
        ok = want.every((w) => {
          const n = pool.get(w) || 0;
          if (n) pool.set(w, n - 1);
          return n > 0;
        });
      }
      if (!ok) bad.push(`"${beat.line}" (${beat.id}) is never fully on screen at once`);
    }
    add(
      "lines on screen",
      bad.length ? "FAIL" : "PASS",
      (bad.length ? bad.join("; ") : "every film.json line appears whole") + keptNote(keptLines),
      bad,
    );
    if (long.length) add("line length", "WARN", "keep lines to 6 words", long);
  }
  // no creep: a size change slower than ~4%/s held for 0.8 s makes text and thin lines shimmer
  {
    const lineOf = (id, f) => {
      // the film.json line an element belongs to, in its beat
      const ws = words(meta[id]?.text || "");
      if (!ws.length) return null;
      const t = timeOf(f);
      const b = film.beats.find(
        (x) => t >= x.start - 0.3 && t <= x.end + 0.3 && partOf(meta[id].text, x.line || ""),
      );
      return b ? b.line : null;
    };
    const creeps = [];
    for (const [id, track] of byId) {
      const m = meta[id] || {};
      const fs = [...track.keys()].sort((a, b) => a - b);
      let run = 0,
        start = -1,
        worst = 0,
        worstStart = -1,
        rateSum = 0,
        worstRate = 0;
      for (let k = 1; k < fs.length; k++) {
        const f = fs[k],
          p = track.get(fs[k - 1]),
          r = track.get(f);
        const ok = f === fs[k - 1] + 1 && r[5] >= 0.5 && p[3] >= 40;
        const rate = ok ? (Math.abs(r[3] - p[3]) / p[3]) * FPS : 0; // relative size change per second
        if (ok && rate >= T.creepMin && rate <= T.creepMax) {
          if (!run) {
            start = f;
            rateSum = 0;
          }
          run++;
          rateSum += rate;
          if (run > worst) {
            worst = run;
            worstStart = start;
            worstRate = rateSum / run;
          }
        } else run = 0;
      }
      if (worst * dt >= T.creepRun) {
        const r0 = track.get(worstStart) || [];
        const area = (r0[3] || 0) * (r0[4] || 0),
          line = lineOf(id, worstStart);
        const name = line
          ? `line "${line}"`
          : m.text
            ? `"${m.text.slice(0, 30)}"`
            : `<${m.tag}> ${m.sel || ""}`;
        creeps.push({
          area,
          line: !!line,
          text: `${name} creeps ${(worstRate * 100).toFixed(1)}%/s for ${fmt(worst * dt)}s from ${fmt(timeOf(worstStart))}s`,
        });
      }
    }
    creeps.sort((a, b) => b.line - a.line || b.area - a.area);
    const seenCreep = new Set();
    const creepList = creeps.filter((c) => {
      const k = c.text.split(" creeps ")[0];
      if (seenCreep.has(k)) return false;
      seenCreep.add(k);
      return true;
    });
    add(
      "no creep",
      creeps.length ? "FAIL" : "PASS",
      creeps.length
        ? `${creeps.length} element(s) scale too slowly to read as motion: move them for real or hold them`
        : "nothing scales slowly enough to shimmer",
      creepList.slice(0, 10).map((c) => c.text),
    );
  }

  const transcript = [];
  {
    // An element's text is read once it holds a few frames (else its last text): a typed line or a counter is read as
    // what it settles on, not as every step.
    const HOLD = 6,
      track = new Map(),
      emitted = new Set(),
      read = new Map();
    const mark = (id, st) => {
      const key = id + "\0" + st.text;
      if (emitted.has(key)) return;
      emitted.add(key);
      read.set(st.f, [...(read.get(st.f) || []), st.row]);
    };
    frames.forEach((rows, f) => {
      for (const r of rows.filter((r) => r[5] >= 0.5 && r[4] >= T.readHeight && textOf(r, meta))) {
        const text = textOf(r, meta);
        let st = track.get(r[0]);
        if (st?.text !== text) track.set(r[0], (st = { text, f, row: r }));
        if (f - st.f + 1 >= HOLD) mark(r[0], st);
      }
    });
    track.forEach((st, id) => mark(id, st));
    for (const f of [...read.keys()].sort((a, b) => a - b)) {
      const txt = readingText(read.get(f), meta);
      const last = transcript[transcript.length - 1];
      if (last && timeOf(f) - last.t < 0.12) last.text += txt;
      else transcript.push({ t: timeOf(f), text: txt.trimStart() });
    }
  }

  // worlds collide: words arriving on top of an element that is leaving (or the reverse)
  {
    const first = new Map(),
      last = new Map();
    byId.forEach((track, id) => {
      for (const [f, r] of track)
        if (r[5] >= 0.3) {
          if (!first.has(id) || f < first.get(id)) first.set(id, f);
          if (!last.has(id) || f > last.get(id)) last.set(id, f);
        }
    });
    const W = Math.round(T.collideWindow * FPS),
      pad = Math.round(0.3 * FPS);
    const hits = new Map();
    // Words of one selector in one composition are one stream (captions, a split title): a layer over its pictures.
    const streams = new Map();
    byId.forEach((track, id) => {
      const m = meta[id];
      if (m?.text)
        streams.set(m.comp + "\0" + m.sel, [...(streams.get(m.comp + "\0" + m.sel) || []), id]);
    });
    // Whether t's stream sat on picture o within W before t arrived, or does within W after t leaves: a layer
    // running across the cut, not one scene's words landing on another's picture.
    const runsAcross = (t, o, tIn, ft, lt) =>
      (streams.get(meta[t[0]].comp + "\0" + meta[t[0]].sel) || []).some((id) => {
        if (id === t[0]) return false;
        for (const [f2, r2] of byId.get(id)) {
          if (r2[5] < 0.3 || (tIn ? f2 >= ft || f2 < ft - W : f2 <= lt || f2 > lt + W)) continue;
          const ro = byId.get(o[0]).get(f2);
          if (!ro || ro[5] < 0.3) continue;
          const ix =
            Math.min(r2[1] + r2[3] / 2, ro[1] + ro[3] / 2) -
            Math.max(r2[1] - r2[3] / 2, ro[1] - ro[3] / 2);
          const iy =
            Math.min(r2[2] + r2[4] / 2, ro[2] + ro[4] / 2) -
            Math.max(r2[2] - r2[4] / 2, ro[2] - ro[4] / 2);
          if (ix > 0 && iy > 0 && (ix * iy) / (r2[3] * r2[4]) >= T.collideOverlap) return true;
        }
        return false;
      });
    const name = (id) => {
      const m = meta[id] || {};
      return m.text ? `"${m.text.slice(0, 32)}"` : `<${m.tag}> ${m.sel || ""}`;
    };
    frames.forEach((rows, f) => {
      const vis = rows.filter((r) => r[5] >= 0.3 && r[3] * r[4] >= 600);
      for (const t of vis) {
        if (!textOf(t, meta) || t[4] < 14) continue;
        const tx0 = t[1] - t[3] / 2,
          tx1 = t[1] + t[3] / 2,
          ty0 = t[2] - t[4] / 2,
          ty1 = t[2] + t[4] / 2;
        for (const o of vis) {
          if (o[0] === t[0] || o[3] * o[4] < 2000) continue;
          if (meta[o[0]]?.tag === "svg" && !o[6] && o[3] * o[4] > 150000) continue; // line-art layers, not pictures
          const ix = Math.min(tx1, o[1] + o[3] / 2) - Math.max(tx0, o[1] - o[3] / 2);
          const iy = Math.min(ty1, o[2] + o[4] / 2) - Math.max(ty0, o[2] - o[4] / 2);
          if (ix <= 0 || iy <= 0 || (ix * iy) / (t[3] * t[4]) < T.collideOverlap) continue;
          const ft = first.get(t[0]),
            lt = last.get(t[0]),
            fo = first.get(o[0]),
            lo = last.get(o[0]);
          // different worlds arrive at different times: things that land together belong together
          const tIn = f - ft <= W && lo - f <= W && lt > lo + pad && fo < ft - pad; // words arrive as the other leaves
          const tOut = lt - f <= W && f - fo <= W && lo > lt + pad && ft < fo - pad; // words leave as the other arrives
          if (!tIn && !tOut) continue;
          if (runsAcross(t, o, tIn, ft, lt)) continue;
          const key = `${t[0]}|${o[0]}`;
          const h = hits.get(key) || { f0: f, f1: f, tIn, t: t[0], o: o[0] };
          h.f1 = f;
          hits.set(key, h);
        }
      }
    });
    const bad = [...hits.values()]
      .filter((h) => h.f1 - h.f0 >= 1)
      .map(
        (h) =>
          `${name(h.t)} ${h.tIn ? "arrives on" : "is still leaving under"} ${name(h.o)} ${fmt(timeOf(h.f0))}-${fmt(timeOf(h.f1 + 1))}s`,
      );
    add(
      "worlds apart",
      bad.length ? "FAIL" : "PASS",
      bad.length
        ? `${bad.length} collision(s): one scene's words over another scene's picture or words`
        : "no scene lands on top of another",
      bad,
    );
  }

  // seams: something moving on both sides of every beat boundary
  {
    const bad = [];
    for (let i = 1; i < film.beats.length; i++) {
      const fb = Math.round(film.beats[i].start * FPS) - F0;
      if (fb < 2 || fb + 1 >= N) continue;
      // A planned hard cut (a punch-in, a cut to a new world) may land on a frame at rest.
      if (film.beats[i - 1].seam === "hard-cut") continue;
      const out = motion[fb - 1],
        inn = motion[fb + 1];
      const who = `${film.beats[i - 1].id} -> ${film.beats[i].id} at ${fmt(film.beats[i].start)}s`;
      if (out < T.seamMotion) bad.push(`${who}: the outgoing side is at rest`);
      if (inn < T.seamMotion) bad.push(`${who}: the incoming side starts from rest`);
    }
    add(
      "seams in motion",
      bad.length ? "FAIL" : "PASS",
      bad.length ? bad.join("; ") : "every seam cuts mid-move",
      bad,
    );
    // A planned hard cut is a punctuation mark: a film of them reads as scenes butted together, so at most a third.
    const keptCuts = keptBeats(film, "hard cuts");
    const hard = film.beats
      .slice(0, -1)
      .filter((b) => b.seam === "hard-cut" && !keptCuts.some((k) => k.beat === b))
      .map((b) => b.id);
    const most = Math.floor((film.beats.length - 1) / 3);
    add(
      "hard cuts",
      hard.length > most ? "FAIL" : "PASS",
      (hard.length > most
        ? `${hard.length} of ${film.beats.length - 1} seams are hard cuts (${hard.join(", ")}); at most ${most}: cut the rest while both sides move`
        : `${hard.length} planned hard cut(s)`) + keptNote(keptCuts),
    );
  }

  // A still storyboard (on in film.json, not yet approved) has no motion to read: those checks wait for the film.
  if (film.storyboard === true && !film.approved)
    for (const check of checks)
      if (MOTION_CHECKS.includes(check.name))
        Object.assign(check, {
          status: "SKIP",
          detail: "a still storyboard has no motion yet",
          items: [],
        });
  return { checks, transcript };
}

// ---------- report ----------
function report(film, cap, res, scope) {
  const fails = res.checks.filter((c) => c.status === "FAIL").length;
  const scoped = scope && { beats: scope.ids, from: scope.from / FPS, to: scope.to / FPS };
  if (AS_JSON) {
    writeFileSync(
      1,
      JSON.stringify(
        {
          project: PROJECT,
          url: cap.url,
          duration: film.duration,
          fps: FPS,
          frame: cap.frame,
          ...(scoped && { scope: scoped }),
          ...res,
          result: fails ? "FAIL" : "PASS",
        },
        null,
        2,
      ) + "\n",
    );
    return fails;
  }
  const lines = [];
  lines.push(
    `film-gate  ${film.duration}s @ ${FPS}fps  ${cap.N} frames  ${cap.shots.length} screenshots`,
  );
  if (scoped)
    lines.push(
      `only beats ${scoped.beats.join(", ")}: ${fmt(scoped.from)}-${fmt(scoped.to)}s, not the whole film`,
    );
  for (const c of res.checks) {
    lines.push(`${c.status.padEnd(5)} ${c.name.padEnd(17)} ${c.detail}`);
    if (c.status !== "PASS") for (const it of c.items.slice(0, 12)) lines.push(`        - ${it}`);
  }
  lines.push("\nwhat a viewer reads:");
  for (const l of res.transcript) lines.push(`  ${fmt(l.t).padStart(6)}  ${l.text}`);
  lines.push(fails ? `\nRESULT: FAIL (${fails}) - fix the causes and run again` : "\nRESULT: PASS");
  writeFileSync(1, lines.join("\n") + "\n");
  return fails;
}

const progress = {
  phase: "film metadata",
  frame: null,
  time: null,
  frames: 0,
  totalFrames: null,
  screenshots: 0,
};
/** Ends the check with where it got to, as JSON or text; stderr carries the summary too, for a caller that keeps only
 * a stopped check's last words. */
function stopWith(error, code = 2) {
  const { slowest } = progress;
  const slow = slowest
    ? `; slowest step: ${slowest.phase}, ${slowest.ms} ms at frame ${slowest.frame}`
    : "";
  const summary = `${progress.phase}, frame ${progress.frame ?? "not started"}: ${progress.frames}/${progress.totalFrames ?? "unknown"} frames, ${progress.screenshots} screenshots${slow}. Validation incomplete.`;
  if (AS_JSON)
    writeFileSync(1, JSON.stringify({ result: "ERROR", error, summary, progress }, null, 2) + "\n");
  else writeFileSync(1, `RESULT: ERROR\n${summary}\n`);
  writeFileSync(2, `film-gate: ${error}\n${summary}\n`);
  stopFrames();
  process.exit(code);
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stopWith(`stopped by ${sig}`, 130));
// Before its first frame a shorter film checks no faster: the stop says which stage it was in.
const STAGES = {
  "film metadata": "reading the film",
  preview: "starting the film's preview",
  "browser download":
    "fetching its browser (`hyperframes browser ensure`, about 260 MB the first time); run that, then check again",
  browser: "starting its browser",
  navigation: "opening the film in its browser",
};
/** Where a stop in the CLI's frames stood: how many it drew and at what pace, not a bare "0 screenshots". */
const drawing = () => {
  const { screenshots: done, shotsWanted: wanted } = progress,
    s = Math.round((Date.now() - progress.drawingSince) / 1000);
  const pace = done
    ? `, about ${(s / done).toFixed(1)} s each, so the rest needs about ${Math.round((s / done) * (wanted - done))} s more`
    : ", none yet";
  return (
    `ran past its ${TIMEOUT_S} s timeout while \`hyperframes snapshot\` drew the film's frames: ${done} of ${wanted} in ${s} s${pace}. ` +
    "Its snapshot is slow on this film (video clips cost it most); a shorter film or a lower --fps checks faster"
  );
};
const late = () =>
  progress.phase === "frames from the CLI"
    ? drawing()
    : progress.frame === null
      ? `ran past its ${TIMEOUT_S} s timeout before its first frame, while ${STAGES[progress.phase] ?? progress.phase}`
      : `ran past its ${TIMEOUT_S} s timeout; a shorter film or a lower --fps checks faster`;
const STARTED = Date.now();
let deadline = setTimeout(() => stopWith(late()), TIMEOUT_S * 1000).unref();
try {
  const film = loadFilm();
  const scope = scopeOf(film);
  progress.totalFrames = scope ? scope.to - scope.from : Math.floor(film.duration * FPS);
  if (!has("timeout")) {
    clearTimeout(deadline);
    TIMEOUT_S = timeoutSeconds(progress.totalFrames);
    deadline = setTimeout(
      () => stopWith(late()),
      Math.max(0, TIMEOUT_S * 1000 - (Date.now() - STARTED)),
    ).unref();
  }
  // A line now and then, so the app running this gate for an agent can tell a long film at work from a stalled one.
  // While the CLI draws, the scan's count is already whole: the pictures drawn are what still moves.
  const said = () =>
    progress.phase === "frames from the CLI"
      ? `film-gate: page scanned (${progress.frames} frames); \`hyperframes snapshot\` drew ${progress.screenshots} of ${progress.shotsWanted} pictures\n`
      : `film-gate: ${progress.phase}, ${progress.frames}/${progress.totalFrames} frames\n`;
  setInterval(() => writeFileSync(2, said()), 15_000).unref();
  // --replay <file> analyzes a capture saved with --dump, so the analysis can be checked without a browser.
  const replay = flag("replay", null) && JSON.parse(readFileSync(flag("replay"), "utf8"));
  const holds = replay && { from: replay.from ?? 0, to: (replay.from ?? 0) + replay.N };
  if (holds && !scope && (holds.from > 0 || holds.to < Math.floor(film.duration * FPS)))
    throw new Error(
      `--replay: the capture holds frames ${holds.from}-${holds.to} of the film (saved with --beats): replay it with --beats`,
    );
  const cap = replay
    ? scope
      ? windowed(replay, scope)
      : replay
    : await capture(film, progress, scope?.from);
  if (flag("dump", null)) writeFileSync(flag("dump"), JSON.stringify(cap));
  progress.phase = "analysis";
  const res = analyze(film, cap, scope);
  process.exitCode = report(film, cap, res, scope) ? 1 : 0;
} catch (e) {
  stopWith(e instanceof Error ? e.message : String(e));
}
process.exit();
