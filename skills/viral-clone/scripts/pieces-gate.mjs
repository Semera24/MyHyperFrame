#!/usr/bin/env node
// G0.5's verdict on .viral-clone/pieces/scores.json against the motion windows G0 recorded: the same judge the app
// runs before paid video and voice.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { judge } from "./pieces-judge.mjs";

const USAGE =
  "usage: node pieces-gate.mjs .viral-clone/pieces/scores.json templates/<slug>/reference/motion-windows.json";

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [scoresPath, windowsPath] = process.argv.slice(2);
  if (!scoresPath || !windowsPath) {
    console.error(USAGE);
    process.exit(2);
  }
  const windows = JSON.parse(readFileSync(windowsPath, "utf8"));
  const verdict = judge(JSON.parse(readFileSync(scoresPath, "utf8")), windows);
  console.log(JSON.stringify(verdict, null, 1));
  process.exit(verdict.pass ? 0 : 1);
}
