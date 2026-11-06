#!/usr/bin/env node
// The sound map of a film: every strong onset (sound-events.mjs) with a clip to play, the frame at that moment, the
// words around it, the nearest picture event, its run, and the other hits that are the same sound (sfx-match.mjs).
// Writes sound-map.json for the template and sound-map.html for a person to listen through; the agent cannot hear,
// so doubtful groups are settled by a listener.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { scan } from "./sound-events.mjs";
import { cluster } from "./sfx-match.mjs";
import { audioFormat, ffmpegBin, soundFailure } from "./media.mjs";
import { loadWords } from "./tool.mjs";

const USAGE = `usage: node sound-map.mjs --video <film.mp4> [--stem no_vocals.wav] [--scan <scan.json> [--min-strength n]] [--words <words.json>]
                          --out <dir> [--rise 20] [--start s --end e] [--full]
  --full: no speech, or sound as the content.`;
const keys = ["video", "stem", "scan", "words", "out", "rise", "start", "end", "min-strength"];
const { values: a } = parseArgs({
  options: {
    ...Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
    full: { type: "boolean" },
    help: { type: "boolean" },
  },
});
if (a.help || !a.video || !a.out) {
  console.error(USAGE);
  process.exit(2);
}
const audio = a.stem ?? a.video,
  rise = +(a.rise ?? 20),
  start = +(a.start ?? 0),
  end = a.end ? +a.end : Infinity;
mkdirSync(join(a.out, "clips"), { recursive: true });

const load = (p) => {
  const f = JSON.parse(readFileSync(p, "utf8"));
  return f.data ?? f;
};
// Picture events: the scan's change candidates at least --min-strength strong; by default 40% of this film's strongest,
// since a one-shot reel's strongest change is far weaker than a hard cut in a cut-heavy film.
const changes = a.scan ? load(a.scan).events.filter((e) => e.kind === "change_candidate") : [];
const minStrength = a["min-strength"]
  ? +a["min-strength"]
  : 0.4 * Math.max(0, ...changes.map((e) => e.strength));
const events = a.scan
  ? changes.filter((e) => e.strength >= minStrength).map((e) => e.seconds)
  : null;
/** @type {[number, number, string][] | null} */
let words = null;
if (a.words)
  try {
    words = loadWords(a.words).map((w) => [w.start, w.end, w.text]);
  } catch (e) {
    console.error(/** @type {Error} */ (e).message);
    process.exit(2);
  }

const res = scan(audio, { start, end, events, words, full: !!a.full });
const hits = res.list.filter((o) => o.rise_db >= rise);
const groups = cluster(
  audio,
  hits.map((o) => o.t),
  0.8,
  events,
);
const groupOf = new Map();
groups.forEach((g, i) =>
  g.times.forEach((t) =>
    groupOf.set(t, { group: `S${i + 1}`, count: g.count, periodic: g.periodic }),
  ),
);

const rows = hits.map((o, i) => {
  const id = String(i).padStart(3, "0");
  try {
    // Stereo at 44.1 kHz, the one format the MP3 encoder always takes, whatever the film's soundtrack is.
    execFileSync(
      ffmpegBin(),
      [
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-ss",
        String(Math.max(0, o.t - 0.05)),
        "-t",
        "0.7",
        "-i",
        audio,
      ]
        .concat(["-vn", "-ac", "2", "-ar", "44100", "-af", "afade=t=out:st=0.6:d=0.1"])
        .concat([join(a.out, "clips", `${id}.mp3`)]),
      { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (e) {
    console.error(soundFailure(`cut the sound clip at ${o.t.toFixed(2)} s`, e, audioFormat(audio)));
    process.exit(5);
  }
  execFileSync(ffmpegBin(), [
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-ss",
    String(o.t + 0.05),
    "-i",
    a.video,
    "-frames:v",
    "1",
    "-vf",
    "scale=240:-2",
    join(a.out, "clips", `${id}.jpg`),
  ]);
  const around = words ? words.filter(([s]) => s >= o.t - 1.2 && s <= o.t + 1.2) : [];
  return {
    id,
    t: o.t,
    band: o.band,
    rise_db: o.rise_db,
    burst: o.burst ?? null,
    ...(groupOf.get(o.t) ?? {}),
    on_picture_event: Math.abs(o.offset_s ?? 9) <= 0.067,
    word: o.word ?? null,
    word_offset: o.word_offset ?? null,
    words_around: around
      .map(([s, , w]) => (Math.abs(s - o.t) < 0.3 ? `[${w}]` : w))
      .join(words?.some(([, , w]) => / /.test(w)) ? " " : ""),
  };
});
const summary = {
  ...Object.fromEntries(Object.entries(res).filter(([k]) => k !== "list")),
  min_event_strength: Math.round(minStrength),
};
writeFileSync(
  join(a.out, "sound-map.json"),
  JSON.stringify({ source: a.video, audio, rise_db_min: rise, summary, groups, rows }, null, 1),
);

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sound map</title>
<style>body{font:14px/1.5 -apple-system,"PingFang SC",sans-serif;margin:0;padding:20px;background:#f5f4ef;color:#1c1c1a}
h1{font-size:20px;margin:0 0 4px}p{color:#6d6b65;margin:0 0 12px;max-width:900px}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #e2e0d8;padding:6px 8px;text-align:left;vertical-align:middle}th{font-size:12px;color:#6d6b65;font-weight:500}
td.n{font-variant-numeric:tabular-nums;white-space:nowrap}img{width:160px;border-radius:6px;display:block}
.b{display:inline-block;border-radius:99px;padding:0 8px;font-size:12px;margin:1px}.pe{background:#e6ebff;color:#3b5bdb}.sp{background:#e3f1e8;color:#2f7d55}
.mu{background:#eeece5;color:#6d6b65}.ru{background:#fbe4ec;color:#c2255c}audio{width:180px;height:30px}
.f button{font:inherit;font-size:12.5px;border:1px solid #e2e0d8;background:#fff;border-radius:99px;padding:2px 10px;margin:0 4px 10px 0;cursor:pointer}.f button.on{background:#1c1c1a;color:#fff}</style>
<h1>Sound map · ${esc(basename(a.video))}</h1>
<p>${rows.length} onsets rising ${rise} dB or more${a.stem ? " on the voice-free stem" : ""}. Picture event: a cut or graphic within two frames
(event lift ${esc(summary.event_lift ?? "—")}; ${summary.events ? `${Math.round(summary.share_of_events_with_sound * summary.events)} of ${summary.events} picture events have a sound` : "no picture events given"}). Speech: the word it lands on, in brackets (phrase lift ${esc(summary.phrase_lift ?? "—")}).
Run: three or more strong hits under 0.25 s apart, one gesture. Group: the same sound heard elsewhere; a regular group is likely the music.</p>
<div class="f" id="f"></div>
<table id="t"><tr><th>Time</th><th>Listen</th><th>Frame</th><th>Words around</th><th>Anchor</th><th>Group</th><th>Rise</th></tr>
${rows
  .map(
    (
      r,
    ) => `<tr data-k="${r.on_picture_event ? "pe " : ""}${r.word ? "sp " : ""}${r.burst ? "ru " : ""}${r.periodic ? "mu" : ""}"><td class="n">${r.t.toFixed(2)} s</td>
<td><audio controls preload="none" src="clips/${r.id}.mp3"></audio></td><td><img src="clips/${r.id}.jpg" loading="lazy"></td>
<td>${esc(r.words_around) || "—"}</td>
<td>${r.on_picture_event ? '<span class="b pe">picture event</span>' : ""}${r.word ? `<span class="b sp">speech: ${esc(r.word)}</span>` : ""}${r.burst ? `<span class="b ru">run ${r.burst}</span>` : ""}</td>
<td>${r.group ? `${r.group} (${r.count})${r.periodic ? ' <span class="b mu">regular</span>' : ""}` : "—"}</td>
<td class="n">+${r.rise_db} dB · ${r.band}</td></tr>`,
  )
  .join("")}</table>
<script>const F=[["all","All"],["pe","Picture event"],["sp","Speech"],["ru","Run"],["mu","Regular"]];let cur="all";
function draw(){document.getElementById("f").innerHTML=F.map(([k,l])=>'<button class="'+(cur===k?"on":"")+'" data-k="'+k+'">'+l+'</button>').join("");
document.querySelectorAll("#f button").forEach(b=>b.onclick=()=>{cur=b.dataset.k;draw()});
document.querySelectorAll("#t tr[data-k]").forEach(r=>r.hidden=cur!=="all"&&!r.dataset.k.split(" ").includes(cur))}draw()</script>`;
writeFileSync(join(a.out, "sound-map.html"), html);
console.log(JSON.stringify({ ...summary, mapped: rows.length, groups: groups.length, out: a.out }));
