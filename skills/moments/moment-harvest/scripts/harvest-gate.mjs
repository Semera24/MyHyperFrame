#!/usr/bin/env node
// Checks a project's harvested Moments before the reply. Node 22+, no npm dependencies.
//   node harvest-gate.mjs --project <dir> [--frames] [--json]
// --frames also renders each Moment's code/ and compares it with its clip frame by frame (SSIM >= 0.95 on every frame),
// which is what catches a retime that shows a clip outside its window or lands cuts a frame late.
// One line per failure, `FAIL <rule>: <what and where>`, then RESULT: PASS or RESULT: FAIL (exit 1).

import { spawnSync } from "node:child_process";
import { cliCall } from "./hfCli.mjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { momentIds } from "./harvest.mjs";

const ROLES = ["hook", "setup", "proof", "turn", "payoff", "cta"];
const argv = process.argv.slice(2);
const i = argv.indexOf("--project");
const PROJECT = resolve(i >= 0 ? argv[i + 1] : ".");
const OUT = join(PROJECT, "moments");
const FFMPEG = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
const FFPROBE = (process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg").replace(
  /ffmpeg(\.exe)?$/,
  "ffprobe$1",
);
/** Why a frame comparison fails, or null: FFmpeg must succeed and score every frame of the clip, each SSIM >= 0.95.
 * @param {{ status: number | null, stdout: string }} result @param {number} expected the clip's frame count */
export function framesFailure(result, expected) {
  const scores = [...result.stdout.matchAll(/n:(\d+).*All:([\d.]+)/g)].map(([, n, v]) => [
    Number(n),
    Number(v),
  ]);
  if (result.status !== 0) return "FFmpeg could not compare it with its clip";
  if (scores.length < expected)
    return `only ${scores.length} of its ${expected} frames were compared`;
  const bad = scores.filter(([, v]) => v < 0.95).map(([n]) => n);
  return bad.length
    ? `differs from its clip on ${bad.length} frames, first at frame ${bad[0]}`
    : null;
}

const fails = [];
const fail = (rule, what) => fails.push({ rule, what });

const frames = (file) =>
  Number(
    spawnSync(
      FFPROBE,
      [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=nb_read_frames",
        "-of",
        "csv=p=0",
        file,
      ],
      { encoding: "utf8" },
    ).stdout,
  );
const duration = (file) =>
  Number(
    spawnSync(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { encoding: "utf8" },
    ).stdout,
  );

function gate() {
  if (!existsSync(join(OUT, "moments.json")))
    fail("cut", "moments/moments.json is missing: run `harvest cut` first");
  else {
    const summary = JSON.parse(readFileSync(join(OUT, "moments.json"), "utf8"));
    const ids = momentIds(OUT);
    if (ids.join() !== summary.moments.map((m) => m.id).join())
      fail("set", `folders ${ids.join(",")} differ from moments.json`);
    let at = 0;
    for (const id of ids) {
      const dir = join(OUT, id);
      if (!existsSync(join(dir, "moment.json"))) {
        fail("files", `${id} lacks moment.json`);
        continue;
      }
      const m = JSON.parse(readFileSync(join(dir, "moment.json"), "utf8"));
      if (Math.abs(m.start_s - at) > 0.002)
        fail("windows", `${id} starts at ${m.start_s} s, the window before ends at ${at} s`);
      at = m.end_s;
      if (
        argv.includes("--frames") &&
        existsSync(join(dir, "clip.mp4")) &&
        existsSync(join(dir, "code/index.html"))
      ) {
        const out = join(OUT, ".work", `${id}-check.mp4`);
        const r = spawnSync(
          ...cliCall("hyperframes", ["render", join(dir, "code"), "-o", out, "--quiet"], {
            encoding: "utf8",
          }),
        );
        if (r.status !== 0)
          fail(
            "render",
            `${id} code/ does not render: ${(r.stderr || r.stdout).trim().split("\n").pop()}`,
          );
        else {
          const lavfi =
            "[0]setpts=PTS-STARTPTS,scale=540:-2[a];[1]setpts=PTS-STARTPTS,scale=540:-2[b];[a][b]ssim=stats_file=-";
          const result = spawnSync(
            FFMPEG,
            [
              "-v",
              "error",
              "-i",
              out,
              "-i",
              join(dir, "clip.mp4"),
              "-lavfi",
              lavfi,
              "-f",
              "null",
              "-",
            ],
            { encoding: "utf8", maxBuffer: 1 << 26 },
          );
          const why = framesFailure(result, frames(join(dir, "clip.mp4")));
          if (why) fail("frames", `${id} code/ ${why}`);
        }
      }
      const need = [
        "clip.mp4",
        "still.jpg",
        "dense.md",
        "bundle.tar.gz",
        "code/index.html",
        "code/REMIX.md",
      ];
      const missing = need.filter((f) => !existsSync(join(dir, f)));
      if (missing.length) {
        fail("files", `${id} lacks ${missing.join(", ")}`);
        continue;
      }
      for (const f of ["moment.json", "dense.md", "code/REMIX.md"])
        if (readFileSync(join(dir, f), "utf8").includes("TODO"))
          fail("todo", `${id}/${f} still has TODO`);
      if (!ROLES.includes(m.role))
        fail("role", `${id} role "${m.role}" is not one of ${ROLES.join(", ")}`);
      if (!m.name?.trim() || m.name.length > 120)
        fail("name", `${id} name is empty or over 120 characters`);
      if (!m.why?.trim()) fail("why", `${id} has no why`);
      const clip = duration(join(dir, "clip.mp4"));
      if (!(Math.abs(clip - m.duration_s) <= 0.1))
        fail("clip", `${id} clip.mp4 is ${clip.toFixed(2)} s, the window ${m.duration_s} s`);
      const code = readFileSync(join(dir, "code/index.html"), "utf8");
      const rootTag = code.match(/<[^>]*data-composition-id=[^>]*>/)?.[0] ?? "";
      if (
        !rootTag.includes(`data-duration="${m.duration_s}"`) ||
        !code.includes(`tweenFromTo(${m.start_s},`)
      )
        fail(
          "code",
          `${id} code/index.html is not the film retimed to ${m.start_s} s for ${m.duration_s} s`,
        );
      const digest = createHash("sha256")
        .update(readFileSync(join(dir, "bundle.tar.gz")))
        .digest("hex");
      if (m.bundle?.sha256 !== digest)
        fail("bundle", `${id} bundle.tar.gz changed after pack: run \`harvest pack\` again`);
    }
    if (ids.length && Math.abs(at - summary.duration_s) > 0.002)
      fail("windows", `the last window ends at ${at} s, the film at ${summary.duration_s} s`);
  }

  if (argv.includes("--json")) console.log(JSON.stringify({ pass: !fails.length, fails }));
  else {
    for (const f of fails) console.log(`FAIL ${f.rule}: ${f.what}`);
    console.log(fails.length ? "RESULT: FAIL" : "RESULT: PASS");
  }
  process.exit(fails.length ? 1 : 0);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) gate();
