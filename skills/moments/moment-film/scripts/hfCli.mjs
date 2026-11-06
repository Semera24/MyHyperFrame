// Starts the HyperFrames CLI on any platform, never through a shell. Node 22+, no npm dependencies. The copy in
// moment-harvest/scripts is byte for byte this one, since each skill unpacks alone (tests/momentCli.test.mjs).
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

/** The file `name` runs from in the search path, or null. Windows tries each extension it runs (npm adds a .cmd). */
export function onPath(name, platform = process.platform, env = process.env) {
  const windows = platform === "win32";
  // A Windows folder holds the extensionless sh launcher beside the .cmd: only the extensions it runs count.
  const endings =
    windows && !extname(name)
      ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const dir of (env.PATH ?? env.Path ?? "").split(windows ? ";" : ":").filter(Boolean))
    for (const ending of endings) {
      const file = join(dir.replace(/^"(.*)"$/, "$1"), name + ending);
      try {
        accessSync(file, windows ? constants.F_OK : constants.X_OK);
        return file;
      } catch {}
    }
  return null;
}

// The script a Windows launcher (.cmd) runs on node: the last quoted word before its %*, with the launcher's folder
// (%dp0%, %~dp0) and any variable filled in. Null when the launcher is no such wrapper.
function shimScript(shim, env) {
  const line = readFileSync(shim, "utf8")
    .split(/\r?\n/)
    .findLast((text) => /"\s+%\*/.test(text));
  // Exactly the node and the script: a launcher with more words before %* adds arguments this would drop.
  const words = line?.match(/((?:"[^"]*"\s*)+)%\*\s*$/)?.[1].match(/"[^"]*"/g);
  const word = words?.length === 2 ? words[1].slice(1, -1) : null;
  if (!word) return null;
  const filled = word
    .replace(/%~?dp0%?\\?/gi, dirname(shim) + "\\")
    .replace(/%([^%]+)%/g, (_, name) => env[name] ?? env[name.toUpperCase()] ?? "");
  const path = process.platform === "win32" ? filled : filled.replaceAll("\\", "/");
  return /\.[cm]?js$/i.test(path) ? path : null;
}

// Node's own npx.cmd sets its script in a variable the launcher text does not hold: it is the one beside it.
function npxScript(shim) {
  const script = join(dirname(shim), "node_modules", "npm", "bin", "npx-cli.js");
  return /^npx\.cmd$/i.test(basename(shim)) && existsSync(script) ? script : null;
}

/** The arguments for spawn, spawnSync, execFile or execFileSync that start `file`. A Windows .cmd (npm's launcher for
 * the CLI and npx) is not started: its script goes to this process's own node, so no shell reads the arguments.
 * Throws when a .cmd is not such a launcher. @returns {[string, string[], object]} */
export function cliCall(file, args, options = {}, platform = process.platform, env = process.env) {
  if (platform !== "win32") return [file, args, options];
  const found = /[\\/]/.test(file) ? file : onPath(file, platform, env);
  if (found && /\.exe$/i.test(found)) return [found, args, options];
  if (!found) return [file, args, options];
  const script = /\.(cmd|bat)$/i.test(found) ? (npxScript(found) ?? shimScript(found, env)) : null;
  if (!script) throw new Error(`${found} is not a launcher this can start without a shell`);
  return [process.execPath, [script, ...args], options];
}
