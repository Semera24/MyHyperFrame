// Ends a process and everything it started. A CLI launcher (a shell script, npx, a wrapper that guards the CLI) is the
// child the gate holds, while the server it runs is that child's own: killing only the launcher leaves the server
// running with nothing to stop it. Node 22+, no npm dependencies.
import { execFileSync } from "node:child_process";

/** `pid` and every process under it, deepest first, from one `ps` snapshot
 * (none on Windows, where taskkill walks it). */
function descendants(pid) {
  let table = "";
  try {
    table = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  } catch {
    return [pid];
  }
  const kids = new Map();
  for (const line of table.split("\n")) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(child)) kids.set(parent, [...(kids.get(parent) ?? []), child]);
  }
  const order = [];
  const walk = (at) => {
    for (const kid of kids.get(at) ?? []) walk(kid);
    order.push(at);
  };
  walk(pid);
  return order;
}

/** Stops `pid` and its descendants; one already gone is no error. @param {number | undefined} pid */
export function stopTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
    return;
  }
  for (const each of descendants(pid)) {
    try {
      process.kill(each, "SIGTERM");
    } catch {}
  }
}
