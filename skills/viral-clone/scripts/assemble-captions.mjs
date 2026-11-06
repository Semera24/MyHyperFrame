// Captions from template.json's caption rule: words grouped as the reference groups them, each word a span shown at
// its spoken start by seek-safe set calls on one paused timeline, every group and word hidden at frame zero.
import { round } from "./media.mjs";

/** @typedef {{text: string, start: number, end: number}} Word */

/** Groups of at most max_words words and max_chars letters, closed after , . ? ! ; : when break_after_punctuation.
 * @param {Word[]} words @param {{max_words?: number, max_chars?: number, break_after_punctuation?: boolean}} rule */
export function groupWords(
  words,
  { max_words = 3, max_chars = Infinity, break_after_punctuation = true },
) {
  /** @type {Word[][]} */
  const groups = [];
  let group = [];
  let chars = 0;
  for (const w of words) {
    if (group.length && (group.length >= max_words || chars + 1 + w.text.length > max_chars)) {
      groups.push(group);
      group = [];
    }
    chars = group.length ? chars + 1 + w.text.length : w.text.length;
    group.push(w);
    if (break_after_punctuation && /[,.?!;:]$/.test(w.text)) {
      groups.push(group);
      group = [];
    }
  }
  if (group.length) groups.push(group);
  return groups;
}

const esc = (/** @type {string} */ s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cased = (/** @type {string} */ text, /** @type {string | undefined} */ c) =>
  c === "upper" ? text.toUpperCase() : c === "lower" ? text.toLowerCase() : text;

/** compositions/captions.html: a group shows from its first word's start to the next group's start (the last to its
 * last word's end); its words appear at their starts (all at once with reveal "group") with the rule's entry.
 * @param {{groups: Word[][], rule: any, canvas: {width: number, height: number, fps?: number},
 *   scale: {sx: number, sy: number}, totalFrames: number, font?: {family: string, file: string}}} input */
export function captionsPage({ groups, rule, canvas, scale, totalFrames, font }) {
  const fps = canvas.fps || 30;
  const frame = (/** @type {number} */ t) =>
    Math.min(totalFrames, Math.max(0, Math.round(t * fps)));
  const at = (/** @type {number} */ f) => (f > 0 ? round(f / fps - 0.002) : 0);
  if (!(rule.size_px > 0) || !Number.isFinite(rule.y))
    throw new Error(
      "template.json captions needs size_px and y (the line's centre, reference pixels)",
    );
  const x = Number.isFinite(rule.x) ? rule.x * scale.sx : canvas.width / 2;
  const y = rule.y * scale.sy;
  const style = rule.entry?.style ?? "cut";
  const fade = (rule.entry?.frames ?? 3) / fps;
  const highlight = /^(#[0-9a-f]{3,8}|rgba?\(.+\))$/i.test(String(rule.highlight ?? ""))
    ? rule.highlight
    : null;
  const family = rule.font ? `"${rule.font}", sans-serif` : "sans-serif";
  const data = groups.map((g, gi) => {
    const on = frame(g[0].start);
    const off = Math.max(
      on + 1,
      gi + 1 < groups.length ? frame(groups[gi + 1][0].start) : frame(g[g.length - 1].end),
    );
    // reveal "group" shows a phrase whole at its first word, as phrase-by-phrase captions do
    const shown = (/** @type {Word} */ w) => (rule.reveal === "group" ? on : frame(w.start));
    return [
      at(on),
      at(off),
      g.map((w) => [at(shown(w)), at(Math.max(shown(w) + 1, frame(w.end)))]),
    ];
  });
  const markup = groups
    .map(
      (g, gi) =>
        `<div class="cap" id="captions-g${gi}">${g.map((w, wi) => `<span class="w" id="captions-g${gi}-${wi}">${esc(cased(w.text, rule.case))}</span>`).join(" ")}</div>`,
    )
    .join("\n");
  const entry =
    style === "fade" || style === "pop"
      ? `tl.fromTo(span, ${style === "pop" ? "{ opacity: 0, scale: 0.6 }" : "{ opacity: 0 }"}, { opacity: 1,${style === "pop" ? " scale: 1," : ""} duration: ${round(fade)}, ease: "${style === "pop" ? "back.out(2)" : "none"}", immediateRender: false }, start);`
      : "tl.set(span, { opacity: 1 }, start);";
  return `<!doctype html>
<html>
<body>
<template>
<style>
${font ? `@font-face { font-family: "${font.family}"; src: url("${font.file}"); font-weight: ${rule.weight ?? 400}; }\n` : ""}#captions-root { position: absolute; inset: 0; pointer-events: none; }
#captions-root .cap {
  position: absolute; left: ${round(x, 1)}px; top: ${round(y, 1)}px; transform: translate(-50%, -50%);
  width: max-content; max-width: ${round(2 * Math.min(x, canvas.width - x) * 0.95, 1)}px; text-align: center;
  font-family: ${family}; font-weight: ${rule.weight ?? 700}; font-size: ${round(rule.size_px * scale.sx, 1)}px;
  line-height: 1.15; color: ${rule.color ?? "#fff"}; opacity: 0;${typeof rule.stroke === "string" ? `\n  -webkit-text-stroke: ${rule.stroke}; paint-order: stroke fill;` : ""}${typeof rule.shadow === "string" ? `\n  text-shadow: ${rule.shadow};` : ""}
}
#captions-root .w { display: inline-block; opacity: 0; }
</style>
<div id="captions-root" data-composition-id="captions" data-width="${canvas.width}" data-height="${canvas.height}" data-layout-allow-caption-zone>
${markup}
</div>
<script>
(function () {
  const tl = gsap.timeline({ paused: true });
  const groups = ${JSON.stringify(data)};
  tl.set("#captions-root .cap, #captions-root .w", { opacity: 0 }, 0);
  groups.forEach(([on, off, words], gi) => {
    const group = document.getElementById("captions-g" + gi);
    tl.set(group, { opacity: 1 }, on);
    tl.set(group, { opacity: 0 }, off);
    words.forEach(([start, end], wi) => {
      const span = document.getElementById("captions-g" + gi + "-" + wi);
      ${entry}${highlight ? `\n      tl.set(span, { color: "${highlight}" }, start);\n      tl.set(span, { color: "${rule.color ?? "#fff"}" }, end);` : ""}
    });
  });
  tl.set({}, {}, ${round(totalFrames / fps)});
  window.__timelines["captions"] = tl;
})();
</script>
</template>
</body>
</html>
`;
}
