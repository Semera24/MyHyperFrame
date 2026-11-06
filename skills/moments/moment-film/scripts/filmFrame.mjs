export const DEFAULT_FRAME = Object.freeze({ width: 1920, height: 1080 });

// A nested composition's message must not resize the root capture.
export const FRAME_OBSERVER = String.raw`window.addEventListener("message", (event) => {
  const frame = event.data;
  if (event.source === window && frame?.source === "hf-preview" && frame.type === "stage-size") {
    window.__filmGateFrame = { width: frame.width, height: frame.height };
  }
});`;
export const FRAME_METADATA = "window.__filmGateFrame ?? null";

export function frameDimensions(frame) {
  if (frame === null) {
    throw new Error(
      "index.html: no root composition mounted: it needs data-width and data-height as positive whole pixels, " +
        "outside any <template>",
    );
  }
  const { width, height } = frame;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Runtime frame dimensions must be positive whole pixels");
  }
  return { width, height };
}

// The capture page, the whole project as the app's own capture windows load it
// (packages/studio-contracts/src/posterPath.mjs previewUrl): the
// single-file route, /preview/comp/, never loads a scene inside a scene. hf-capture keeps every image loading with it.
/** @param {string} base @param {string} projectId */
export const capturePageUrl = (base, projectId) =>
  `${base}/api/projects/${encodeURIComponent(projectId)}/preview?hf-capture=1`;

// Fonts and images decoded before the first sample; capped; incomplete assets fail capture instead of being scored.
// A broken image is named; a sourceless <img> is not an asset; a source rebound mid-decode is judged as it now shows.
// A lazy image in a hidden scene never loads by itself, so each is made eager first.
export const PAGE_READY_MS = 10_000;
export const PAGE_READY = `Promise.race([
  document.fonts.ready
    .then(() => Promise.all([...document.images].map(function decoded(image) {
      const src = image.getAttribute("src") || image.getAttribute("srcset");
      if (!src) return null;
      image.loading = "eager";
      return image.decode().then(() => null, () => {
        const now = image.getAttribute("src") || image.getAttribute("srcset");
        return now && now !== src ? decoded(image) : src.slice(0, 160);
      });
    })))
    .then((broken) => {
      const named = broken.filter(Boolean);
      if (named.length) throw new Error("these images cannot be decoded (fix or remove each <img>): " + named.slice(0, 5).join(", "));
    }),
  new Promise((_, reject) => setTimeout(() => reject(new Error("assets ready timeout")), ${PAGE_READY_MS})),
]).then(() => true)`;

// A seek's videos have painted once the runtime's barrier resolves (core 0.8.82+); capped like the app's poster
// capture; a stalled or failed video fails capture. Reading what an empty frame had on the page waits on it.
export const SEEK_LANDED_MS = 5000;
export const SEEK_LANDED = `Promise.race([
  Promise.resolve(window.__hfWaitForSeekCompletion?.()),
  new Promise((_, reject) => setTimeout(() => reject(new Error("seek completion timeout")), ${SEEK_LANDED_MS})),
]).then(() => true)`;

// Elements whose contents are text, not markup.
const RAW_TEXT = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
]);

/** Every live start and end tag with its real attributes, as the browser tokenizes them: comments and raw text are
 * skipped to their real end, and text inside a quoted value is never an attribute. @param {string} html */
function liveTags(html) {
  /** @type {{ name: string, end: boolean, attrs: Map<string, string> }[]} */
  const tags = [];
  for (let at = 0; at < html.length; ) {
    const lt = html.indexOf("<", at);
    if (lt < 0) break;
    const skipTo = (/** @type {string} */ end, from = lt + 2) => {
      const found = html.indexOf(end, from);
      return found < 0 ? html.length : found + end.length;
    };
    const open = /^<\/?([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 64));
    if (html.startsWith("<!--", lt)) at = skipTo("-->");
    else if (!open)
      at = html[lt + 1] === "!" || html[lt + 1] === "?" ? skipTo(">", lt + 1) : lt + 1;
    else {
      const tag = { name: open[1].toLowerCase(), end: html[lt + 1] === "/", attrs: new Map() };
      at = readAttributes(html, lt + open[0].length, tag.attrs);
      tags.push(tag);
      if (!tag.end && RAW_TEXT.has(tag.name)) {
        const close = new RegExp(`</${tag.name}[\\s/>]`, "gi");
        close.lastIndex = at;
        at = close.exec(html)?.index ?? html.length;
      }
    }
  }
  return tags;
}

/** HTML's attribute rules from `at` to the tag's `>`; the first of a repeated name wins. Returns the index past `>`.
 * @param {string} html @param {number} at @param {Map<string, string>} attrs */
function readAttributes(html, at, attrs) {
  const skipSpace = () => {
    while (/\s/.test(html[at] ?? "")) at++;
  };
  for (;;) {
    while (/[\s/]/.test(html[at] ?? "")) at++;
    if (at >= html.length) return at;
    if (html[at] === ">") return at + 1;
    const name = /^.[^\s/>=]*/.exec(html.slice(at))[0];
    at += name.length;
    skipSpace();
    let value = "";
    if (html[at] === "=") {
      at++;
      skipSpace();
      const quote = html[at] === '"' || html[at] === "'" ? html[at] : "";
      if (quote) {
        const close = html.indexOf(quote, at + 1);
        value = html.slice(at + 1, close < 0 ? html.length : close);
        at = close < 0 ? html.length : close + 1;
      } else {
        value = /^[^\s>]*/.exec(html.slice(at))[0];
        at += value.length;
      }
    }
    if (!attrs.has(name.toLowerCase())) attrs.set(name.toLowerCase(), value);
  }
}

// The sections the captured page mounts: from a file (data-composition-src), or inline and timed as the runtime times
// them ([data-composition-id][data-start]); one inside a <template> never mounts. Read from the file: the runtime
// rewrites host attributes.
export function sectionHosts(html) {
  const live = [];
  for (let depth = 0, tags = liveTags(html), i = 0; i < tags.length; i++) {
    if (tags[i].name === "template") depth += tags[i].end ? -1 : 1;
    else if (depth === 0) live.push(tags[i]);
  }
  return live
    .filter(({ end, attrs }) => !end && attrs.has("data-composition-id"))
    .filter(({ attrs }) => attrs.has("data-composition-src") || attrs.has("data-start"))
    .map(({ attrs }) => ({
      id: attrs.get("data-composition-id"),
      // The player plays data-end, but its clip manifest ignores it on a section (core timeline.ts).
      endOnly: attrs.has("data-end") && !usableDuration(attrs.get("data-duration")),
    }));
}

/** A data-duration the player times by, as core's resolveAuthoredTimingWindow reads it: not blank, finite, above 0.
 * @param {string | undefined} raw */
const usableDuration = (raw) => {
  const seconds = raw?.trim() ? Number(raw) : NaN;
  return seconds > 0 && Number.isFinite(seconds);
};

/** Each section timed as the player plays it: its clip manifest (window.__clipManifest) resolves numbers, clip
 * references and registered timelines. NaN for a section the player gives no window.
 * @param {{ id: string, endOnly?: boolean }[]} hosts
 * @param {{ kind?: string, compositionId?: string | null, start: number, duration: number }[]} clips */
export function timedHosts(hosts, clips) {
  return hosts.map(({ id, endOnly = false }) => {
    const clip = clips.find((c) => c.kind === "composition" && c.compositionId === id);
    return { id, endOnly, start: clip?.start ?? NaN, duration: clip?.duration ?? NaN };
  });
}

/** Why a beat's host does not run when film.json plans it, or null. A section the player gives no window, or one
 * timed by data-end alone, which the player's published window does not follow yet, fails.
 * @param {{ id: string, start: number, end: number }} beat
 * @param {{ start: number, duration: number, endOnly?: boolean }} host */
export function hostTimingIssue(beat, host) {
  if (host.endOnly)
    return `"${beat.id}" is timed by data-end alone, which the gate cannot check yet: give its host a data-duration`;
  const end = host.start + host.duration;
  if (!Number.isFinite(end))
    return `the player gives "${beat.id}" no time window: give its host a data-start and a data-duration`;
  if (Math.abs(host.start - beat.start) <= 0.05 && Math.abs(end - beat.end) <= 0.05) return null;
  return `"${beat.id}" runs ${host.start}-${+end.toFixed(3)}s in index.html but ${beat.start}-${beat.end}s in film.json`;
}
