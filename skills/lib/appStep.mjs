// @ts-check
// How an agent's shell asks the app to run a browser step and waits for its answer: one owner for the shell's side,
// which the app's shim (main/agentStepClient.mjs) and moment-film's gate both import. No app imports and no npm
// dependencies: the gate runs from the unpacked guides folder, where only skills/lib travels with it.
import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs";
import { appendFileSync, existsSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const STEPS_DIR_ENV = "HF_APP_STEPS";
export const STEP_TOKEN_ENV = "HF_APP_STEP_TOKEN";
/** The harness's context for a CLI call: main/agentStepContext.mjs accepts its capabilities and substitutes a private
 * event target. The shell appends returned events under its own permissions. */
export const TOOL_CONTEXT_ENV = "HF_TOOL_CONTEXT";
/** Where each run's own request folder sits, inside the project's app-owned .hyperframes. */
export const STEPS_FOLDER = ".hyperframes/agent-steps";
export const REQUEST = ".request.json";
export const ANSWER = ".answer.json";
/** A shell waiting on hf-media's setup writes Date.now() here every HEARTBEAT_MS until it has its answer (a sandboxed
 * shell's pid means nothing outside its namespace). Beside the run's folder, never in it, so an ended run's folder
 * still goes (agentStepTokens.mjs revokeSteps) and the shell sees it go. @param {string} dir @param {string} id */
export const heartbeatOf = (dir, id) => `${dir}-${id}.alive`;
export const HEARTBEAT_MS = 1000;
/** The app writes the steps a taken request waits behind here, beside the run's folder like the heartbeat; the shell
 * prints one line from it and removes it. @param {string} dir @param {string} id */
export const waitingOf = (dir, id) => `${dir}-${id}.waiting`;
/** The app appends a running step's stderr here, beside the run's folder; the shell prints what is new as it
 * comes, so a long step is not silent. @param {string} dir @param {string} id */
export const progressOf = (dir, id) => `${dir}-${id}.progress`;

/** Long enough for the app's once-a-second follow to start watching a run that just began. */
const TAKEN_MS = 15_000;
/** The slot's wait and the CLI's own cap, with room: the app answers a step it stopped too. A render, a check, the
 * film gate and hf-media's setup have no cap: each ends with its progress, the person's stop or its own limit. */
const ANSWER_MS = 20 * 60_000;
const UNCAPPED = ["render", "check", "gate", "media-tools"];

/** Whether the shell stops waiting for the app: the app never took the request, or a capped step ran out its wait.
 * @param {string} step @param {number} waited @param {boolean} untaken */
export const givesUp = (step, waited, untaken) =>
  (untaken && waited > TAKEN_MS) || (waited > ANSWER_MS && !UNCAPPED.includes(step));

/** What the shell says when no answer will come: the app answers only while the turn works. @param {string} step */
export const unanswered = (step) =>
  `${step}: nothing answered this shell. The turn that ran it ended or was stopped, or the app quit. Run it again in a new turn.`;

/** Writes all of `data` to `fd`. A pipe node has used is non-blocking, so a slow reader (`| tail`) makes a write throw
 * EAGAIN: wait and write the rest. @param {number} fd @param {string | Uint8Array} data */
export function writeAll(fd, data) {
  let rest = typeof data === "string" ? Buffer.from(data) : data;
  while (rest.length) {
    try {
      rest = rest.subarray(writeSync(fd, rest));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EAGAIN") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

/** The file moves a caller may harden (the app retries a Windows file another program holds); plain fs by default.
 * @typedef {{ renameSync: typeof nodeFs.renameSync, rmSync: typeof nodeFs.rmSync }} FileOps */

/** Puts a request in the app's folder whole: written beside it, then renamed in, so the app never reads half of one.
 * @param {string} request @param {unknown} body @param {FileOps} [ops] */
export function postRequest(request, body, ops = nodeFs) {
  writeFileSync(`${request}.part`, JSON.stringify(body));
  ops.renameSync(`${request}.part`, request);
}

/** @typedef {{ stdout: string, stderr: string, code: number }} StepAnswer */

/** The app's answer to `step`; exits when the app does not take the request.
 * @param {string} step
 * @param {string[]} args @param {NodeJS.ProcessEnv} env @param {FileOps} [ops]
 * @returns {Promise<StepAnswer>} */
export async function askApp(step, args, env, ops = nodeFs) {
  const dir = /** @type {string} */ (env[STEPS_DIR_ENV]);
  const id = randomUUID();
  const request = join(dir, id + REQUEST);
  const answer = join(dir, id + ANSWER);
  // The app asks whether this shell still waits (mediaToolsReady.mjs beating) before and while it runs the step.
  const alive = heartbeatOf(dir, id);
  const toolContext = env[TOOL_CONTEXT_ENV];
  const body = {
    token: env[STEP_TOKEN_ENV],
    step,
    args,
    cwd: process.cwd(),
    ...(toolContext && { toolContext }),
  };
  // Beating before the request goes in, so the app never takes one whose shell looks gone.
  let beat = Date.now();
  let beaten = beatAt(alive, ops);
  postRequest(request, body, ops);
  const started = beat;
  const waiting = waitingOf(dir, id);
  const progress = progressOf(dir, id);
  const wait = { since: 0, spoke: 0 };
  let printed = "";
  while (!existsSync(answer)) {
    sayWhatWaitsFor(step, waiting, wait);
    printed = sayProgress(progress, printed);
    const now = Date.now();
    // An ended run's folder is removed (agentStepTokens.mjs revokeSteps), so no answer can land there.
    if (!existsSync(dir) || givesUp(step, now - started, existsSync(request))) {
      ops.rmSync(request, { force: true });
      ops.rmSync(alive, { force: true });
      console.error(unanswered(step));
      process.exit(1);
    }
    // A beat that did not land (a slow, full or busy drive) is tried again at the next tick, not a second later.
    if (!beaten || now - beat >= HEARTBEAT_MS) {
      beat = now;
      beaten = beatAt(alive, ops);
    }
    await sleep(200);
  }
  ops.rmSync(alive, { force: true });
  const {
    stdout = "",
    stderr = "",
    code = 1,
    toolEvents,
  } = JSON.parse(readFileSync(answer, "utf8"));
  ops.rmSync(answer, { force: true });
  appendStepEvents(toolContext, toolEvents);
  printed = sayProgress(progress, printed);
  ops.rmSync(progress, { force: true });
  // The answer's stderr is the end of what the shell already printed live; only what is not is still to say.
  return { stdout, stderr: unprinted(printed, stderr), code };
}

/** The answer's stderr, unless the live lines already showed it: it is the end of what the CLI printed.
 * @param {string} printed @param {string} stderr */
export const unprinted = (printed, stderr) => (printed.includes(stderr.trim()) ? "" : stderr);

/** Prints what the app has appended to the step's progress file since `printed`, so a long step is not silent.
 * @param {string} file @param {string} printed @param {(text: string) => void} [say] the shell's stderr
 * @returns {string} everything printed so far */
export function sayProgress(file, printed, say = (text) => writeAll(2, text)) {
  let text = printed;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return printed; // expected: nothing has been printed yet, or the answer came first and the file went
  }
  if (text.length > printed.length) say(text.slice(printed.length));
  return text;
}

/** A step that has printed nothing yet is at "none": a check with --json says nothing until it ends.
 * @param {{ step: string, stage?: string, ran_s?: number }} held */
const holding = ({ step, stage, ran_s }) =>
  ran_s === undefined
    ? step
    : `${step} (running ${ran_s} s, ${stage === "none" ? "no output yet" : `at ${stage}`})`;

/** @param {number} s */
const span = (s) => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);

const STILL_WAITING_MS = 15_000;

/** While the app has this step queued behind others, says which at first, then how long it has waited every 15 s: the
 * app runs one check or snapshot at a time, so a second one is silent until the first ends. The app removes the
 * marker when it starts the step. @param {string} step @param {string} waiting
 * @param {{ since: number, spoke: number }} [wait] what was said so far @param {number} [now] */
export function sayWhatWaitsFor(step, waiting, wait = { since: 0, spoke: 0 }, now = Date.now()) {
  if (!existsSync(waiting)) return;
  /** @type {any} */
  let marker;
  try {
    marker = JSON.parse(readFileSync(waiting, "utf8"));
  } catch {
    return; // expected: the notice is never worth the step; the next poll reads it whole or the answer comes first
  }
  const behind = marker?.behind;
  if (!Array.isArray(behind) || !behind.length) return;
  // Bounds only the wait to start (abandonQueued): a started step runs to its own end. None behind a film gate.
  const within = typeof marker.start_wait_s === "number" ? span(marker.start_wait_s) : null;
  if (wait.since) {
    if (now - wait.spoke < STILL_WAITING_MS) return;
    wait.spoke = now;
    const names = behind.map((held) => held.step).join(" and ");
    const soFar = `${Math.round((now - wait.since) / 1000)} s so far`;
    return console.error(
      `${step}: still waiting for ${names}, ${soFar}${within ? ` (the app gives up at ${within} if it has not started)` : ""}.`,
    );
  }
  wait.since = wait.spoke = now;
  console.error(
    `${step}: waiting for ${behind.map(holding).join(" and ")} to finish. The app runs one check or snapshot at a time${
      within ? `; if it has not started within ${within}, the app gives up waiting` : ""
    }.`,
  );
}

/** Writes the time into the heartbeat, renamed in whole so the app never reads half a beat. False when the write did
 * not land, so the caller tries again at once; true too when the run ended and took its folder (the wait loop's next
 * check says so). @param {string} alive @param {FileOps} ops */
function beatAt(alive, ops) {
  try {
    writeFileSync(`${alive}.part`, String(Date.now()));
    ops.renameSync(`${alive}.part`, alive);
    return true;
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
}

/** This write stays inside the requesting shell's sandbox, never in the app or its CLI child.
 * @param {string | undefined} raw @param {unknown} events */
function appendStepEvents(raw, events) {
  if (!raw || typeof events !== "string") return;
  try {
    const target = JSON.parse(raw).capabilities.events.transport.path;
    appendFileSync(target, events);
  } catch (error) {
    // expected: the step's answer still prints; only its attachments are lost, and the shell is told why
    console.error(`Tool events could not be written: ${/** @type {Error} */ (error).message}`);
  }
}
