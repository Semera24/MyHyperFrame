import { replacementTimelineAssetId } from "@hyperframes/core/timeline-asset-id";
import { parseHTML } from "linkedom";
import { removeElementWithGsapCascade } from "@hyperframes/parsers";
import { readMediaOffsetSeconds, readPlaybackRate } from "@hyperframes/parsers/media-duration";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { isAllowedHtmlAttribute, isSafeAttributeValue } from "@hyperframes/core/html-attr-safety";
import { sanitizeRichTextChildren } from "@hyperframes/core/rich-text-sanitize";
import {
  EXCLUDED_TAGS,
  ensureHfIds,
  mintHfId,
  walkCompositionDescendants,
} from "@hyperframes/parsers/hf-ids";
import {
  readClipTiming,
  SPLIT_BOUNDARY_EPSILON_S,
  writeClipTiming,
  type ReferenceExpression,
} from "@hyperframes/core/composition-contract";
import { relinkSplitHalves } from "@hyperframes/core/media-link";
import { parseStyleDecls, patchStyleAttrString } from "./sourceStyleMutation.js";

export interface SourceMutationTarget {
  id?: string | null;
  hfId?: string;
  selector?: string;
  selectorIndex?: number;
}

const pinnedInSource = new WeakMap<Document, ReadonlySet<string>>();

export function parseSourceDocument(raw: string): {
  document: Document;
  wrappedFragment: boolean;
} {
  const source = ensureHfIds(raw);
  const hasDocumentShell = /<!doctype|<html[\s>]/i.test(source);
  const document = hasDocumentShell
    ? parseHTML(source).document
    : parseHTML(`<!DOCTYPE html><html><head></head><body>${source}</body></html>`).document;
  pinnedInSource.set(
    document,
    new Set(Array.from(raw.matchAll(/\bdata-hf-id\s*=\s*["']?([^"'\s>]+)/gi), (m) => m[1]!)),
  );
  return { document, wrappedFragment: !hasDocumentShell };
}

/** Drops the rules that style `id` alone (every selector in the list names it), in each style sheet of the page. */
function dropCssRulesForId(document: Document, id: string): void {
  const idToken = `#${id}`;
  const namesId = (selector: string) => {
    let found = false;
    selectorParser((selectors) => {
      selectors.walkIds((node) => {
        // an id inside :not() excludes the element, so the rule styles the others
        let up = node.parent;
        while (up && !(up.type === "pseudo" && up.value === ":not")) up = up.parent as typeof up;
        if (node.value === id && !up) found = true;
      });
    }).processSync(selector);
    return found;
  };
  for (const styleEl of document.querySelectorAll("style")) {
    const css = styleEl.textContent ?? "";
    if (!css.includes(idToken)) continue;
    let root: postcss.Root;
    try {
      root = postcss.parse(css);
    } catch {
      continue;
    }
    let dropped = false;
    root.walkRules((rule) => {
      if (rule.selectors.length > 0 && rule.selectors.every(namesId)) {
        rule.remove();
        dropped = true;
      }
    });
    if (dropped) styleEl.textContent = root.toString();
  }
}

// A clone's rules replace whatever an earlier piece of that id left behind, so repeated cuts keep one set per id.
function duplicateCssRulesForId(document: Document, originalId: string, newId: string): void {
  dropCssRulesForId(document, newId);
  const idToken = `#${originalId}`;
  const transform = selectorParser((selectors) => {
    selectors.walkIds((node) => {
      if (node.value === originalId) node.value = newId;
    });
  });
  for (const styleEl of document.querySelectorAll("style")) {
    const css = styleEl.textContent ?? "";
    let root: postcss.Root;
    try {
      root = postcss.parse(css);
    } catch {
      continue;
    }
    const clones: postcss.Rule[] = [];
    root.walkRules((rule) => {
      if (!rule.selector.includes(idToken)) return;
      const newSelector = transform.processSync(rule.selector);
      if (newSelector === rule.selector) return;
      const clone = rule.clone({ selector: newSelector });
      clones.push(clone);
    });
    if (clones.length > 0) {
      for (const c of clones) root.append(c);
      styleEl.textContent = root.toString();
    }
  }
}

function querySelectorAllWithTemplates(root: Document | Element, selector: string): Element[] {
  const matches = Array.from(root.querySelectorAll(selector));
  if (matches.length > 0) return matches;
  // querySelectorAll doesn't traverse <template> content in linkedom.
  // Search directly on each template element (NOT .content — removing from
  // .content's DocumentFragment doesn't update the serialized output).
  // Recurse so NESTED templates resolve too — ensureHfIds and the SDK's
  // querySelectorAllDeep descend nested composition templates, so ids exist at
  // any template depth; a one-level search here would silently no-op
  // server-side ops on those ids while the SDK resolves them.
  const templates = Array.from(root.querySelectorAll("template"));
  for (const tmpl of templates) {
    const inner = querySelectorAllWithTemplates(tmpl, selector);
    if (inner.length > 0) return inner;
  }
  return [];
}

// Prevent CSS attribute-selector injection via a crafted hfId: escape
// backslashes first, then double-quotes. Keeps a malformed/hostile value from
// breaking out of the `[data-hf-id="…"]` selector once callers beyond the
// internal mint contract (R2+ user flows) pass values here.
function escapeCssAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function findByHfId(document: Document, hfId: string): Element | null {
  try {
    const matches = querySelectorAllWithTemplates(
      document,
      `[data-hf-id="${escapeCssAttrValue(hfId)}"]`,
    );
    if (matches.length > 1) {
      // The mint contract guarantees uniqueness; a duplicate means upstream
      // id drift. Don't silently patch an arbitrary one — surface it.
      // eslint-disable-next-line no-console
      console.warn(
        `sourceMutation: data-hf-id "${hfId}" matched ${matches.length} elements; using the first. ids must be unique per document.`,
      );
    }
    return matches[0] ?? null;
  } catch {
    // Malformed selector despite escaping — let the caller fall back.
    return null;
  }
}

export function findTargetElement(
  document: Document,
  target: SourceMutationTarget,
): Element | null {
  if (target.hfId) {
    const el = findByHfId(document, target.hfId);
    if (el) return el;
  }
  const pinned = pinnedInSource.get(document);
  const unlessPinnedElsewhere = (el: Element | null | undefined) =>
    el && !(target.hfId && pinned?.has(el.getAttribute("data-hf-id") ?? "")) ? el : null;

  if (target.id) {
    const byId = unlessPinnedElsewhere(document.getElementById(target.id));
    if (byId) return byId;
  }

  if (!target.selector) return null;
  try {
    const matches = querySelectorAllWithTemplates(document, target.selector);
    return unlessPinnedElsewhere(matches[target.selectorIndex ?? 0]);
  } catch {
    return null;
  }
}

/**
 * Removes every target in one parse and one serialization. A target nested inside one already
 * removed no longer matches, which is a normal outcome rather than a failure.
 */
export function removeElementsFromHtml(
  source: string,
  targets: readonly SourceMutationTarget[],
): string {
  const { document, wrappedFragment } = parseSourceDocument(source);
  let removed = false;
  for (const target of targets) {
    const element = findTargetElement(document, target);
    if (!element) continue;
    // Cascade GSAP & CSS cleanup for all descendants with IDs before removing the container
    const descendantsWithId = Array.from(element.querySelectorAll("[id]"));
    for (const desc of descendantsWithId) {
      const descId = desc.getAttribute("id");
      removeElementWithGsapCascade(document, desc);
      if (descId && !document.getElementById(descId)) dropCssRulesForId(document, descId);
    }
    const id = element.getAttribute("id");
    removeElementWithGsapCascade(document, element);
    if (id && !document.getElementById(id)) dropCssRulesForId(document, id);
    removed = true;
  }
  if (!removed) return source;
  return wrappedFragment ? document.body.innerHTML || "" : document.toString();
}

export function removeElementFromHtml(source: string, target: SourceMutationTarget): string {
  return removeElementsFromHtml(source, [target]);
}

export function isHTMLElement(el: Node): el is HTMLElement {
  const HTMLEl = el.ownerDocument?.defaultView?.HTMLElement;
  return HTMLEl ? el instanceof HTMLEl : el.nodeType === 1 && "style" in el;
}

// A mount's id names the root it mounts; the runtime numbers repeated mounts (id__hf1, id__hf2).
function mountsComposition(document: Document, host: Element, compositionId: string): boolean {
  if (host.hasAttribute("data-composition-src")) return true;
  return (
    host.children.length === 0 &&
    querySelectorAllWithTemplates(document, "template").some(
      (template) => template.id === `${compositionId}-template`,
    )
  );
}

export function dedupeClonedCompositionId(document: Document, clone: Element): void {
  const compositionId = clone.getAttribute("data-composition-id");
  if (!compositionId || mountsComposition(document, clone, compositionId)) return;
  const usedCompositionIds = new Set(
    querySelectorAllWithTemplates(document, "[data-composition-id]").map((node) =>
      node.getAttribute("data-composition-id"),
    ),
  );
  const base = `${compositionId}-split`;
  let nextCompositionId = base;
  let suffix = 2;
  while (usedCompositionIds.has(nextCompositionId)) nextCompositionId = `${base}-${suffix++}`;
  clone.setAttribute("data-composition-id", nextCompositionId);
}

export interface PatchOperation {
  /** `ensure-id` keeps the element's id, else writes `value` made unique in this file and `takenIds`. */
  type:
    | "inline-style"
    | "attribute"
    | "html-attribute"
    | "text-content"
    | "rich-text"
    | "ensure-id";
  property: string;
  value: string | null;
  childSelector?: string;
  childIndex?: number;
}

interface ResolvedPatchOperation {
  op: PatchOperation;
  target: HTMLElement;
}

function resolveOperationTarget(parent: HTMLElement, op: PatchOperation): HTMLElement | null {
  if (op.childSelector === undefined) return parent;
  try {
    const child = parent.querySelectorAll(op.childSelector)[op.childIndex ?? 0] ?? null;
    return child && isHTMLElement(child) ? child : null;
  } catch {
    return null;
  }
}

/**
 * Give the elements a rich-text patch just introduced their stable ids, here,
 * in the bytes about to be written and handed back.
 *
 * Otherwise the next preview request mints them and writes the file a second
 * time, after Studio has already recorded the edit in its history. The recorded
 * "after" stops matching disk, the content check refuses, and undo reports the
 * file as changed outside Studio — for every colour applied to a run of
 * characters and every text layer added. The clip split stamps its own clone
 * for exactly this reason.
 *
 * Minted one element at a time with the same function `ensureHfIds` uses, so
 * these ids are the ones the next pass would have assigned. Not `ensureHfIds`
 * itself: it takes a whole document, and handing it this element's markup would
 * put the markup back as one.
 */
function stampNewChildIds(parent: Element): void {
  const assigned = new Set<string>();
  const root = parent.ownerDocument?.body ?? parent;
  walkCompositionDescendants(root, (el) => {
    const id = el.getAttribute("data-hf-id");
    if (id) assigned.add(id);
  });
  for (const el of parent.querySelectorAll("*")) {
    if (el.getAttribute("data-hf-id")) continue;
    if (EXCLUDED_TAGS.has(el.tagName.toLowerCase())) continue;
    el.setAttribute("data-hf-id", mintHfId(el, assigned));
  }
}

// fallow-ignore-next-line complexity
export function patchElementInHtml(
  source: string,
  target: SourceMutationTarget,
  operations: PatchOperation[],
  takenIds?: ReadonlySet<string>,
): { html: string; matched: boolean; elementId?: string | null } {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const el = findTargetElement(document, target);
  if (!el || !isHTMLElement(el)) return { html: source, matched: false };
  const htmlEl = el;
  const originalHtml = wrappedFragment ? document.body.innerHTML || "" : document.toString();

  const resolved: ResolvedPatchOperation[] = [];
  for (const op of operations) {
    const opTarget = resolveOperationTarget(htmlEl, op);
    if (!opTarget) return { html: source, matched: false };
    resolved.push({ op, target: opTarget });
  }

  for (const { op, target: opTarget } of resolved) {
    switch (op.type) {
      case "inline-style":
        // linkedom's CSSStyleDeclaration does not support CSS custom properties
        // (--foo) or newer individual transform properties (translate, rotate,
        // scale) via style.setProperty(). Manipulate the style attribute string
        // directly so all property names survive the round-trip.
        {
          const raw = opTarget.getAttribute("style") ?? "";
          const patched = patchStyleAttrString(raw, op.property, op.value);
          opTarget.setAttribute("style", patched);
        }
        break;
      case "attribute":
        {
          const fullAttr = op.property.startsWith("data-") ? op.property : `data-${op.property}`;
          if (op.value != null) {
            opTarget.setAttribute(fullAttr, op.value);
          } else {
            opTarget.removeAttribute(fullAttr);
          }
        }
        break;
      case "html-attribute":
        if (!isAllowedHtmlAttribute(op.property)) break;
        if (op.value != null) {
          if (!isSafeAttributeValue(op.property, op.value)) break;
          const replacementId =
            op.property === "src" ? replacementTimelineAssetId(document, opTarget, op.value) : null;
          if (replacementId !== null) opTarget.setAttribute("id", replacementId);
          opTarget.setAttribute(op.property, op.value);
        } else {
          opTarget.removeAttribute(op.property);
        }
        break;
      case "ensure-id":
        if (opTarget.getAttribute("id") || !op.value) break;
        opTarget.setAttribute("id", nextUniqueId(document, op.value, takenIds));
        break;
      case "text-content":
        if (op.value != null) {
          const inner = opTarget.children.length === 1 ? opTarget.firstElementChild : null;
          const textTarget = inner && isHTMLElement(inner) ? inner : opTarget;
          textTarget.textContent = op.value;
        }
        break;
      // The one operation that can write markup, so the one that has to check
      // it. Assigned first and sanitised after, rather than sanitising a
      // string: parsing is what turns a payload into the tree the allowlist
      // can actually judge, and linkedom never runs anything it parses.
      case "rich-text":
        if (op.value != null) {
          opTarget.innerHTML = op.value;
          sanitizeRichTextChildren(opTarget);
          stampNewChildIds(opTarget);
        }
        break;
    }
  }

  const html = wrappedFragment ? document.body.innerHTML || "" : document.toString();
  const elementId = htmlEl.getAttribute("id");
  if (html === originalHtml) return { html: source, matched: true, elementId };
  return { html: ensureHfIds(html), matched: true, elementId };
}

export function nextUniqueId(
  document: Document,
  base: string,
  takenIds?: ReadonlySet<string>,
): string {
  let id = base;
  let suffix = 2;
  while (document.getElementById(id) || takenIds?.has(id)) id = `${base}-${suffix++}`;
  return id;
}

/** Whether each target exists in `source`; the document is parsed once however many targets ask. */
export function probeElementsInSource(
  source: string,
  targets: readonly SourceMutationTarget[],
): boolean[] {
  const { document } = parseSourceDocument(source);
  return targets.map((target) => {
    if (!target.id && !target.hfId && !target.selector) return false;
    const el = findTargetElement(document, target);
    return el != null && isHTMLElement(el);
  });
}

export function probeElementInSource(source: string, target: SourceMutationTarget): boolean {
  return probeElementsInSource(source, [target])[0] ?? false;
}

/** Why a split changed nothing: the cut route says it, so a report names the cause and not just "rejected". */
export type SplitRefusal =
  | "target-not-found"
  | "reference-without-range"
  | "no-duration"
  | "outside-clip";

export interface SplitElementResult {
  html: string;
  matched: boolean;
  newId: string | null;
  refusal?: SplitRefusal;
}

const refused = (html: string, refusal: SplitRefusal): SplitElementResult => ({
  html,
  matched: false,
  newId: null,
  refusal,
});

function resolveElementTiming(el: Element): {
  start: number;
  duration: number;
} {
  const timing = readClipTiming(el);
  return { start: timing.start ?? 0, duration: timing.duration ?? 0 };
}

const roundMs = (seconds: number) => Math.round(seconds * 1000) / 1000;

function setElementDuration(
  el: Element,
  start: number | ReferenceExpression,
  duration: number,
  trackIndex?: number,
): void {
  writeClipTiming(el, {
    start: typeof start === "number" ? Math.round(start * 1000) / 1000 : start,
    duration: Math.round(duration * 1000) / 1000,
    ...(trackIndex != null ? { trackIndex } : {}),
  });
}

/** True when the media has an authored window and the row's range (if given) is that window. */
function isWindowOf(
  media: { start: number; duration: number },
  row?: { start: number; duration: number },
): boolean {
  if (media.duration <= 0) return false;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
  return !row || (near(media.start, row.start) && near(media.duration, row.duration));
}

// fallow-ignore-next-line complexity
export function splitElementInHtml(
  source: string,
  target: SourceMutationTarget,
  splitTime: number,
  newId: string,
  fallbackTiming?: {
    start: number;
    duration: number;
    playbackStart?: number;
    playbackRate?: number;
    // The element's current resolved track (authored, or the runtime's
    // positional-index fallback when unauthored). Stamped onto both halves so
    // inserting the clone can't shift either one to a different row — see
    // parseAuthoredTrack's fallback in core/runtime/timeline.ts.
    track?: number;
  },
): SplitElementResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const el = findTargetElement(document, target);
  if (!el || !isHTMLElement(el)) return refused(source, "target-not-found");

  // An untimed wrapper whose row is its timed media's own window is a view of that
  // media: cut the media and leave the wrappers untimed. A GSAP scene keeps its own window.
  const timedMediaSelector = "video[data-start], audio[data-start]";
  const innerMedia =
    el.hasAttribute("data-start") ||
    resolveElementTiming(el).duration > 0 ||
    el.matches("[data-composition-src], [data-composition-id]")
      ? null
      : el.querySelector(timedMediaSelector);
  const timedMedia =
    innerMedia && isWindowOf(resolveElementTiming(innerMedia), fallbackTiming) ? innerMedia : null;
  const timed = timedMedia ?? el;

  const timing = resolveElementTiming(timed);
  let { start, duration } = timing;
  // A start that names another clip ("intro", "intro - 0.5") resolves to where that clip ends, which only the
  // client's resolved range knows; reading it as 0 cut the wrong span, or rewrote the clip to start at 0.
  const reference = readClipTiming(timed).startExpression;
  const startsAfter = reference?.kind === "reference" ? reference : null;
  if (startsAfter) {
    if (!fallbackTiming) return refused(source, "reference-without-range");
    start = fallbackTiming.start;
  }
  // GSAP-animated elements carry their timing in the script, not in data-* attrs,
  // so the source has no authored duration. Fall back to the store's (GSAP-derived)
  // range — the runtime windows visibility off data-start/data-duration regardless
  // of class, so stamping both halves below makes each half show only in its window.
  if (duration <= 0 && fallbackTiming && fallbackTiming.duration > 0) {
    start = fallbackTiming.start;
    duration = fallbackTiming.duration;
  }
  if (duration <= 0) return refused(source, "no-duration");
  if (
    splitTime < start + SPLIT_BOUNDARY_EPSILON_S ||
    splitTime > start + duration - SPLIT_BOUNDARY_EPSILON_S
  ) {
    return refused(source, "outside-clip");
  }

  newId = nextUniqueId(document, newId);

  const firstDuration = splitTime - start;
  const secondDuration = duration - firstDuration;

  const clone = el.cloneNode(true);
  if (!isHTMLElement(clone)) return refused(source, "target-not-found");
  clone.setAttribute("id", newId);
  dedupeClonedCompositionId(document, clone);
  clone.removeAttribute("data-hf-id");
  // Descendants carry their own data-hf-id; leaving them duplicates the id of
  // every nested node (e.g. an inner <span>), so strip them on the clone too.
  for (const node of clone.querySelectorAll("[data-hf-id]")) node.removeAttribute("data-hf-id");
  const clonedTimed = timedMedia ? clone.querySelector(timedMediaSelector)! : clone;
  if (timedMedia?.id) {
    const mediaId = nextUniqueId(document, `${timedMedia.id}-split`, new Set([newId]));
    duplicateCssRulesForId(document, timedMedia.id, mediaId);
    clonedTimed.setAttribute("id", mediaId);
  }
  setElementDuration(
    clonedTimed,
    startsAfter
      ? { ...startsAfter, offset: roundMs(startsAfter.offset + firstDuration) }
      : splitTime,
    secondDuration,
    fallbackTiming?.track,
  );

  // Keep the "clip" class — the runtime uses it to control visibility
  // based on data-start/data-duration timing.

  // A split creates two views over the same media source or sub-composition.
  // Even an untrimmed one needs an explicit zero in-point stamped on the first
  // half so the second half can advance from it instead of restarting at zero.
  const playbackStartAttr = timed.hasAttribute("data-playback-start")
    ? "data-playback-start"
    : timed.hasAttribute("data-media-start")
      ? "data-media-start"
      : timed.matches("[data-composition-src], [data-composition-id]")
        ? "data-playback-start"
        : timed.matches("audio, video")
          ? "data-media-start"
          : null;
  if (playbackStartAttr) {
    const readAttr = (name: string) => timed.getAttribute(name);
    const authoredTrim = timed.getAttribute(playbackStartAttr);
    const currentTrim =
      authoredTrim !== null
        ? readMediaOffsetSeconds(readAttr)
        : (fallbackTiming?.playbackStart ?? 0);
    const rate = readPlaybackRate(readAttr, fallbackTiming?.playbackRate);
    if (authoredTrim === null || Number(authoredTrim) !== currentTrim)
      timed.setAttribute(playbackStartAttr, String(Math.round(currentTrim * 1000) / 1000));
    clonedTimed.setAttribute(
      playbackStartAttr,
      String(Math.round((currentTrim + firstDuration * rate) * 1000) / 1000),
    );
  }

  // Duplicate CSS rules targeting the original ID so the clone inherits the same styles.
  const originalId = el.getAttribute("id");
  if (originalId) {
    duplicateCssRulesForId(document, originalId, newId);
  }

  // Trim the original element's duration. A GSAP element had no data-start; stamp
  // it so the runtime windows the first half (visibility selects on [data-start]).
  setElementDuration(timed, startsAfter ?? start, firstDuration, fallbackTiming?.track);

  // Insert clone after original
  if (el.nextSibling) {
    el.parentElement!.insertBefore(clone, el.nextSibling);
  } else {
    el.parentElement!.appendChild(clone);
  }

  const html = wrappedFragment ? document.body.innerHTML || "" : document.toString();
  return {
    // The split owns its new nodes' stable ids. Leaving the clone unstamped makes
    // the next preview request persist different bytes after history is recorded.
    html: ensureHfIds(html),
    matched: true,
    newId,
  };
}

// --- Element grouping -------------------------------------------------------
// A group is a real `<div data-hf-group="…">` wrapping its members in the DOM.
// Wrapping rebases each member's left/top so its absolute position is unchanged:
// the wrapper sits at the selection bbox top-left, and each child's new left/top
// is its old left/top minus the wrapper origin (computed client-side, where live
// layout is available, and passed in via `rebases`). GSAP x/y, CSS translate and
// --hf-studio-offset vars are deltas relative to flow position and stay untouched.

export interface WrapElementsResult {
  html: string;
  matched: boolean;
  groupId: string | null;
  error?: string;
}

export interface UnwrapElementsResult {
  html: string;
  unwrapped: boolean;
  /** The unwrapped wrapper's id, so callers can strip GSAP that targeted it
   *  (the wrapper is gone; a leftover `gsap.set("#id")` would throw at runtime). */
  unwrappedGroupId?: string;
  /** Members (id'd children) with their absolute layout centres (post un-rebase),
   *  so the caller can BAKE the group's GSAP transform into each member before
   *  stripping it — otherwise the group's moves are lost on ungroup. */
  members?: Array<{ id: string; cx: number; cy: number }>;
  /** The wrapper's layout centre — the pivot for baking the group's rotation/scale. */
  groupCenter?: { cx: number; cy: number };
}

export interface ElementRebase {
  target: SourceMutationTarget;
  left: number;
  top: number;
  /** The member's current resolved track (authored, or the runtime's
   * positional-index fallback). Stamped explicitly so moving it into the
   * wrapper can't shift its computed row — same hazard split closes. */
  track?: number;
}

function getInlineStylePx(el: Element, property: string): number {
  const style = (isHTMLElement(el) ? el.getAttribute("style") : null) ?? "";
  const { props } = parseStyleDecls(style);
  const raw = props.get(property);
  if (!raw) return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function setInlineLeftTop(el: HTMLElement, left: number, top: number): void {
  let style = el.getAttribute("style") ?? "";
  style = patchStyleAttrString(style, "left", `${left}px`);
  style = patchStyleAttrString(style, "top", `${top}px`);
  el.setAttribute("style", style);
}

// Slug the group name ("Group 1" → "group-1") into a unique, valid element id.
function uniqueGroupDomId(document: Document, groupId: string): string {
  const base =
    groupId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      // Normalization above leaves at most one hyphen at either edge.
      .replace(/^-|-$/g, "") || "group";
  return nextUniqueId(document, base);
}

// fallow-ignore-next-line complexity
export function wrapElementsInHtml(
  source: string,
  targets: SourceMutationTarget[],
  groupId: string,
  bbox: { left: number; top: number; width: number; height: number },
  rebases: ElementRebase[],
): WrapElementsResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  if (targets.length === 0) {
    return { html: source, matched: false, groupId: null, error: "no targets" };
  }

  // Resolve + dedupe by element ref (two targets may point at the same node).
  const els: HTMLElement[] = [];
  const seen = new Set<Element>();
  for (const target of targets) {
    const el = findTargetElement(document, target);
    if (!el || !isHTMLElement(el) || seen.has(el)) continue;
    seen.add(el);
    els.push(el);
  }
  if (els.length === 0) {
    return { html: source, matched: false, groupId: null, error: "no targets matched" };
  }

  // P1: require a single common parent (LCA multi-parent wrapping is P2).
  const parent = els[0]?.parentElement;
  if (!parent || els.some((el) => el.parentElement !== parent)) {
    return {
      html: source,
      matched: false,
      groupId: null,
      error: "grouped elements must share a single parent",
    };
  }

  // Order members by their position in the parent (= z-order / stacking order).
  const memberSet = new Set<Element>(els);
  const ordered = Array.from(parent.children).filter((c): c is HTMLElement => memberSet.has(c));

  // Map each member to its rebased left/top and track (resolved against the same document).
  const rebaseByEl = new Map<Element, { left: number; top: number; track?: number }>();
  for (const rebase of rebases) {
    const el = findTargetElement(document, rebase.target);
    if (el) rebaseByEl.set(el, { left: rebase.left, top: rebase.top, track: rebase.track });
  }

  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-hf-group", groupId);
  // A real `id` (slug of the group name) makes the wrapper a first-class node in the
  // clip manifest / timeline parent-map (both keyed by id) and a clean GSAP target —
  // without it the wrapper is invisible to the timeline and breaks child enumeration.
  wrapper.setAttribute("id", uniqueGroupDomId(document, groupId));
  // Adopt the topmost member's stacking level. A group is one stacking unit, so a
  // non-member interleaved between two selected members can't stay "between" them
  // once they unify. Matching Figma/Sketch, the group lifts to the topmost selected
  // layer: the wrapper goes at the LAST member's slot and carries the max member
  // z-index — so an interleaved non-member falls below the group instead of hoisting
  // above it, and explicit member z-indexes are honored.
  const memberZIndexes = ordered
    .map((el) =>
      Number.parseInt(
        parseStyleDecls(el.getAttribute("style") ?? "").props.get("z-index") ?? "",
        10,
      ),
    )
    .filter((z) => Number.isFinite(z));
  const maxZ = memberZIndexes.length > 0 ? Math.max(...memberZIndexes) : null;
  wrapper.setAttribute(
    "style",
    `position: absolute; left: ${bbox.left}px; top: ${bbox.top}px; width: ${bbox.width}px; height: ${bbox.height}px` +
      (maxZ !== null ? `; z-index: ${maxZ}` : ""),
  );

  // Insert the wrapper at the topmost member's slot, then move members into it.
  parent.insertBefore(wrapper, ordered[ordered.length - 1] ?? null);
  for (const el of ordered) {
    const rebase = rebaseByEl.get(el);
    if (rebase) setInlineLeftTop(el, rebase.left, rebase.top);
    if (rebase?.track != null) writeClipTiming(el, { trackIndex: Math.round(rebase.track) });
    wrapper.appendChild(el); // appendChild moves the node, preserving order
  }

  return {
    html: wrappedFragment ? document.body.innerHTML || "" : document.toString(),
    matched: true,
    groupId,
  };
}

export interface UnwrapChildTrack {
  target: SourceMutationTarget;
  /** The child's current resolved track, same hazard and fix as wrap's members. */
  track?: number;
}

// Only children actually inside the group and given a resolved track qualify —
// same hazard and fix as wrap's members, scoped to this group's own children.
function buildChildTrackMap(
  document: Document,
  group: Element,
  childTracks: UnwrapChildTrack[],
): Map<Element, number> {
  const trackByEl = new Map<Element, number>();
  for (const entry of childTracks) {
    const el = findTargetElement(document, entry.target);
    if (el && group.contains(el) && entry.track != null) trackByEl.set(el, entry.track);
  }
  return trackByEl;
}

// Undoes the wrap-side rebase (child absolute = child rebased + wrapper
// origin), stamps each child's resolved track where one was given, and moves
// every child back into the parent ahead of the wrapper — preserving order.
function relocateGroupChildren(
  group: Element,
  parent: Element,
  wLeft: number,
  wTop: number,
  trackByEl: Map<Element, number>,
): Array<{ id: string; cx: number; cy: number }> {
  const members: Array<{ id: string; cx: number; cy: number }> = [];
  for (const child of Array.from(group.children)) {
    if (isHTMLElement(child)) {
      const newLeft = getInlineStylePx(child, "left") + wLeft;
      const newTop = getInlineStylePx(child, "top") + wTop;
      setInlineLeftTop(child, newLeft, newTop);
      const track = trackByEl.get(child);
      if (track != null) writeClipTiming(child, { trackIndex: Math.round(track) });
      if (child.id) {
        members.push({
          id: child.id,
          cx: newLeft + getInlineStylePx(child, "width") / 2,
          cy: newTop + getInlineStylePx(child, "height") / 2,
        });
      }
    }
    parent.insertBefore(child, group);
  }
  return members;
}

export function unwrapElementsFromHtml(
  source: string,
  groupTarget: SourceMutationTarget,
  childTracks: UnwrapChildTrack[] = [],
): UnwrapElementsResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const group = findTargetElement(document, groupTarget);
  if (!group || !isHTMLElement(group)) return { html: source, unwrapped: false };
  // Shape guard mirroring the wrap-side contract: only ever dissolve an actual
  // group wrapper. A stale/desynced selection that resolves to a plain <div>
  // would otherwise be unwrapped — rebasing its children by the parent's origin
  // (silent corruption). Wrap enforces invariants; unwrap must too.
  if (!group.hasAttribute("data-hf-group")) return { html: source, unwrapped: false };

  const parent = group.parentElement;
  if (!parent) return { html: source, unwrapped: false };

  const trackByEl = buildChildTrackMap(document, group, childTracks);

  // Undo the rebase: child absolute position = child (rebased) + wrapper origin.
  const wLeft = getInlineStylePx(group, "left");
  const wTop = getInlineStylePx(group, "top");
  const groupCenter = {
    cx: wLeft + getInlineStylePx(group, "width") / 2,
    cy: wTop + getInlineStylePx(group, "height") / 2,
  };

  const members = relocateGroupChildren(group, parent, wLeft, wTop, trackByEl);
  const groupId = group.id || undefined;
  group.remove();

  return {
    html: wrappedFragment ? document.body.innerHTML || "" : document.toString(),
    unwrapped: true,
    unwrappedGroupId: groupId,
    members,
    groupCenter,
  };
}

/** After a cut, give each linked group's right halves their own `data-link` and `data-sync-origin`. */
export function relinkSplitHalvesInHtml(source: string, rightHalfIds: readonly string[]): string {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const carriesPairing = (id: string) => {
    const el = document.getElementById(id);
    return Boolean(el?.hasAttribute("data-link") || el?.hasAttribute("data-sync-origin"));
  };
  if (!rightHalfIds.some(carriesPairing)) {
    return source;
  }
  relinkSplitHalves(document, rightHalfIds);
  return wrappedFragment ? document.body.innerHTML || "" : document.toString();
}

export type DocumentaryPresetId = "callout-card" | "map-badge" | "stat-card" | "subscribe-cta";

export interface InsertElementRequest {
  kind: "text" | "image" | "group" | "preset";
  presetId?: DocumentaryPresetId;
  start: number;
  duration: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  text?: string;
  src?: string;
  track?: number;
}

export interface InsertElementResult {
  html: string;
  inserted: boolean;
  elementId?: string;
  hfId?: string;
}

export function insertElementInHtml(
  source: string,
  req: InsertElementRequest,
): InsertElementResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const compRoots = querySelectorAllWithTemplates(document, "[data-composition-id]");
  const container = compRoots[0] ?? document.body;
  if (!container) return { html: source, inserted: false };

  let maxTrack = 0;
  let maxZ = 90;
  for (const node of querySelectorAllWithTemplates(document, "*")) {
    const trkRaw = node.getAttribute("data-track-index") ?? node.getAttribute("data-track");
    if (trkRaw != null) {
      const trk = Number.parseInt(trkRaw, 10);
      if (Number.isFinite(trk) && trk > maxTrack) maxTrack = trk;
    }
    const styleRaw = node.getAttribute("style") ?? "";
    const zMatch = styleRaw.match(/(?:^|;|\s)z-index\s*:\s*(-?\d+)/i);
    if (zMatch?.[1]) {
      const zv = Number.parseInt(zMatch[1], 10);
      if (Number.isFinite(zv) && zv > maxZ) maxZ = zv;
    }
  }
  const trackIndex =
    req.track != null && Number.isFinite(req.track) ? Math.round(req.track) : maxTrack + 1;
  const topZ = Math.max(100, maxZ + 10);

  const prefix =
    req.kind === "text"
      ? "text-layer"
      : req.kind === "image"
        ? "image-layer"
        : req.kind === "group"
          ? "group"
          : `preset-${req.presetId ?? "card"}`;
  const id = nextUniqueId(document, prefix);
  const hfId = `hf-${id}`;
  const startNum = Math.max(0, Number((req.start ?? 0).toFixed(3)));
  const startStr = String(startNum);
  const durationStr = String(Math.max(0.1, Number((req.duration ?? 5).toFixed(3))));

  let el: Element;
  if (req.kind === "text") {
    el = document.createElement("div");
    el.setAttribute("id", id);
    el.setAttribute("data-hf-id", hfId);
    el.setAttribute("data-start", startStr);
    el.setAttribute("data-duration", durationStr);
    el.setAttribute("data-track-index", String(trackIndex));
    const left = Math.round(req.left ?? 200);
    const top = Math.round(req.top ?? 200);
    el.setAttribute(
      "style",
      `position: absolute; left: ${left}px; top: ${top}px; z-index: ${topZ}; opacity: 1; visibility: visible; font-size: 40px; font-weight: 800; color: #FFFFFF; line-height: 1.2; text-shadow: 0 2px 12px rgba(0,0,0,0.65);`,
    );
    el.textContent = req.text?.trim() || "New Text";
  } else if (req.kind === "group") {
    el = document.createElement("div");
    el.setAttribute("id", id);
    el.setAttribute("data-hf-id", hfId);
    el.setAttribute("data-hf-group", req.text?.trim() || "Group");
    el.setAttribute("data-start", startStr);
    el.setAttribute("data-duration", durationStr);
    el.setAttribute("data-track-index", String(trackIndex));
    const left = Math.round(req.left ?? 240);
    const top = Math.round(req.top ?? 180);
    const width = Math.round(req.width ?? 600);
    const height = Math.round(req.height ?? 400);
    el.setAttribute(
      "style",
      `position: absolute; left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px; z-index: ${topZ}; opacity: 1; visibility: visible; overflow: visible;`,
    );
  } else if (req.kind === "preset") {
    el = document.createElement("div");
    el.setAttribute("id", id);
    el.setAttribute("data-hf-id", hfId);
    el.setAttribute("data-start", startStr);
    el.setAttribute("data-duration", durationStr);
    el.setAttribute("data-track-index", String(trackIndex));
    const presetId = req.presetId ?? "callout-card";
    if (presetId === "map-badge") {
      const left = Math.round(req.left ?? 220);
      const top = Math.round(req.top ?? 160);
      el.setAttribute(
        "style",
        `position: absolute; left: ${left}px; top: ${top}px; z-index: ${topZ}; opacity: 1; visibility: visible; background: rgba(20,40,56,0.94); padding: 8px 16px; border-left: 4px solid #357F83; font-size: 18px; font-weight: 800; letter-spacing: 1px; color: #F5F0E6; text-transform: uppercase; box-shadow: 0 6px 18px rgba(0,0,0,0.45);`,
      );
      el.textContent = req.text?.trim() || "STRATEGIC CHOKEPOINT";
    } else if (presetId === "stat-card") {
      const left = Math.round(req.left ?? 140);
      const top = Math.round(req.top ?? 220);
      el.setAttribute(
        "style",
        `position: absolute; left: ${left}px; top: ${top}px; width: 520px; z-index: ${topZ}; opacity: 1; visibility: visible; background: rgba(20,40,56,0.94); padding: 24px 28px; border-top: 5px solid #C49A44; border-radius: 4px; box-shadow: 0 14px 32px rgba(0,0,0,0.55);`,
      );
      el.innerHTML =
        `<div id="${id}-metric" data-hf-id="hf-${id}-metric" style="font-size: 56px; font-weight: 900; color: #C49A44; line-height: 1.05;">21M bbl/d</div>` +
        `<div id="${id}-desc" data-hf-id="hf-${id}-desc" style="font-size: 28px; font-weight: 700; color: #FFFFFF; margin-top: 8px; line-height: 1.25;">Daily maritime transit volume through the strait</div>` +
        `<div id="${id}-cite" data-hf-id="hf-${id}-cite" style="font-size: 16px; color: #E8DFD0; margin-top: 10px; letter-spacing: 0.5px;">Source: U.S. EIA Chokepoint Assessment</div>`;
    } else if (presetId === "subscribe-cta") {
      const left = Math.round(req.left ?? 720);
      const top = Math.round(req.top ?? 860);
      el.setAttribute(
        "style",
        `position: absolute; left: ${left}px; top: ${top}px; z-index: ${topZ}; opacity: 1; visibility: visible; background: linear-gradient(135deg, #D9383A 0%, #9E2426 100%); border: 2px solid #F5F0E6; border-radius: 6px; padding: 16px 32px; color: #FFFFFF; font-size: 28px; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase; box-shadow: 0 12px 28px rgba(0,0,0,0.55);`,
      );
      el.textContent = req.text?.trim() || "SUBSCRIBE · TURNING POINT STORIES";
    } else {
      // Default: Editorial Callout Card
      const left = Math.round(req.left ?? 90);
      const top = Math.round(req.top ?? 760);
      el.setAttribute(
        "style",
        `position: absolute; left: ${left}px; top: ${top}px; width: 1740px; z-index: ${topZ}; opacity: 1; visibility: visible; background: rgba(20,40,56,0.94); padding: 22px 32px; border-left: 6px solid #C49A44; border-radius: 4px; box-shadow: 0 14px 32px rgba(0,0,0,0.55);`,
      );
      el.innerHTML =
        `<div id="${id}-kicker" data-hf-id="hf-${id}-kicker" style="font-size: 15px; letter-spacing: 2px; text-transform: uppercase; color: #F5F0E6; font-weight: 700;">Turning Point Analysis</div>` +
        `<div id="${id}-headline" data-hf-id="hf-${id}-headline" style="font-size: 32px; font-weight: 900; color: #FFFFFF; margin-top: 6px; line-height: 1.2;">Control of narrow waterways reshapes global leverage.</div>`;
    }
  } else {
    el = document.createElement("img");
    el.setAttribute("id", id);
    el.setAttribute("data-hf-id", hfId);
    el.setAttribute("data-start", startStr);
    el.setAttribute("data-duration", durationStr);
    el.setAttribute("data-track-index", String(trackIndex));
    const left = Math.round(req.left ?? 360);
    const top = Math.round(req.top ?? 180);
    const width = Math.round(req.width ?? 480);
    el.setAttribute("src", req.src || "");
    el.setAttribute("alt", req.text || id);
    el.setAttribute(
      "style",
      `position: absolute; left: ${left}px; top: ${top}px; width: ${width}px; height: auto; z-index: ${topZ}; opacity: 1; visibility: visible; object-fit: contain;`,
    );
  }

  const firstScript = Array.from(container.children).find(
    (child) => child.tagName.toLowerCase() === "script",
  );
  if (firstScript) {
    container.insertBefore(el, firstScript);
    const scriptText = firstScript.textContent ?? "";
    const tlVarMatch = scriptText.match(
      /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*gsap\.timeline/,
    );
    if (tlVarMatch?.[1]) {
      const tlVar = tlVarMatch[1];
      const tweenLine = `      ${tlVar}.fromTo('#${id}', { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' }, ${startNum});\n`;
      if (scriptText.includes("window.__timelines")) {
        firstScript.textContent = scriptText.replace(
          /(\s*window\.__timelines\b)/,
          `\n${tweenLine}$1`,
        );
      }
    }
  } else {
    container.appendChild(el);
  }

  return {
    html: wrappedFragment ? document.body.innerHTML || "" : document.toString(),
    inserted: true,
    elementId: id,
    hfId,
  };
}

export interface UnbundleChildEntry {
  target: SourceMutationTarget;
  left: number;
  top: number;
  width: number;
  height: number;
  zIndex?: number;
  start?: number;
  duration?: number;
  track?: number;
}

export interface UnbundleContainerRequest {
  containerTarget?: SourceMutationTarget;
  containerBox?: { left: number; top: number; width: number; height: number };
  children: UnbundleChildEntry[];
}

export interface UnbundleContainerResult {
  html: string;
  unbundled: boolean;
  childIds: string[];
}

export function unbundleContainerInHtml(
  source: string,
  req: UnbundleContainerRequest,
): UnbundleContainerResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  let changed = false;
  const childIds: string[] = [];

  if (req.containerTarget) {
    const container = findTargetElement(document, req.containerTarget);
    if (container && isHTMLElement(container)) {
      container.style.removeProperty("grid-template-columns");
      container.style.removeProperty("grid-template-rows");
      container.style.removeProperty("gap");
      container.style.removeProperty("column-gap");
      container.style.removeProperty("row-gap");
      container.style.removeProperty("flex-direction");
      container.style.removeProperty("justify-content");
      container.style.removeProperty("align-items");
      container.style.removeProperty("flex-wrap");
      container.style.removeProperty("overflow");
      container.style.removeProperty("overflow-x");
      container.style.removeProperty("overflow-y");
      container.style.display = "block";
      container.style.overflow = "visible";
      if (req.containerBox) {
        container.style.removeProperty("inset");
        container.style.removeProperty("right");
        container.style.removeProperty("bottom");
        container.style.position = "absolute";
        container.style.left = `${Math.round(req.containerBox.left)}px`;
        container.style.top = `${Math.round(req.containerBox.top)}px`;
        container.style.width = `${Math.round(req.containerBox.width)}px`;
        container.style.height = `${Math.round(req.containerBox.height)}px`;
      }
      changed = true;
    }
  }

  for (const [idx, item] of (req.children ?? []).entries()) {
    const child = findTargetElement(document, item.target);
    if (!child || !isHTMLElement(child)) continue;
    if (!child.id) {
      const tag = child.tagName.toLowerCase();
      child.id = nextUniqueId(document, tag === "img" ? "layer-img" : "layer-item");
    }
    if (!child.getAttribute("data-hf-id")) {
      child.setAttribute("data-hf-id", `hf-${child.id}`);
    }
    if (item.start != null && Number.isFinite(item.start) && !child.hasAttribute("data-start")) {
      child.setAttribute("data-start", String(Math.max(0, Number(item.start.toFixed(3)))));
    }
    if (
      item.duration != null &&
      Number.isFinite(item.duration) &&
      item.duration > 0 &&
      !child.hasAttribute("data-duration")
    ) {
      child.setAttribute("data-duration", String(Math.max(0.1, Number(item.duration.toFixed(3)))));
    }
    if (item.track != null && Number.isFinite(item.track)) {
      child.setAttribute("data-track-index", String(Math.round(item.track)));
    }

    child.style.removeProperty("inset");
    child.style.removeProperty("right");
    child.style.removeProperty("bottom");
    child.style.removeProperty("flex");
    child.style.removeProperty("grid-column");
    child.style.removeProperty("grid-row");
    if (child.children.length > 0 && child.tagName.toLowerCase() !== "svg") {
      child.style.removeProperty("grid-template-columns");
      child.style.removeProperty("grid-template-rows");
      child.style.removeProperty("gap");
      child.style.removeProperty("column-gap");
      child.style.removeProperty("row-gap");
      child.style.removeProperty("flex-direction");
      child.style.removeProperty("justify-content");
      child.style.removeProperty("align-items");
      child.style.removeProperty("flex-wrap");
      child.style.removeProperty("overflow");
      child.style.removeProperty("overflow-x");
      child.style.removeProperty("overflow-y");
      child.style.display = "block";
      child.style.overflow = "visible";
    }
    child.style.position = "absolute";
    child.style.left = `${Math.round(item.left)}px`;
    child.style.top = `${Math.round(item.top)}px`;
    child.style.width = `${Math.round(item.width)}px`;
    child.style.height = `${Math.round(item.height)}px`;
    child.style.margin = "0px";
    child.style.boxSizing = "border-box";
    if (item.zIndex != null && Number.isFinite(item.zIndex)) {
      child.style.zIndex = String(Math.round(item.zIndex));
    } else if (!child.style.zIndex) {
      child.style.zIndex = String(10 + idx);
    }
    childIds.push(child.id);
    changed = true;
  }

  if (!changed) return { html: source, unbundled: false, childIds: [] };
  return {
    html: wrappedFragment ? document.body.innerHTML || "" : document.toString(),
    unbundled: true,
    childIds,
  };
}

export interface GroupElementMemberEntry {
  target: SourceMutationTarget;
  left: number;
  top: number;
  width: number;
  height: number;
  zIndex?: number;
}

export interface GroupElementsRequest {
  groupLabel?: string;
  bbox: { left: number; top: number; width: number; height: number };
  start?: number;
  duration?: number;
  zIndex?: number;
  members: GroupElementMemberEntry[];
}

export interface GroupElementsResult {
  html: string;
  grouped: boolean;
  groupId?: string;
  hfId?: string;
}

export function groupElementsInHtml(
  source: string,
  req: GroupElementsRequest,
): GroupElementsResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  if (!Array.isArray(req.members) || req.members.length === 0) {
    return { html: source, grouped: false };
  }

  const resolved: Array<{ el: HTMLElement; entry: GroupElementMemberEntry }> = [];
  const seen = new Set<Element>();
  for (const entry of req.members) {
    const el = findTargetElement(document, entry.target);
    if (!el || !isHTMLElement(el) || seen.has(el)) continue;
    seen.add(el);
    resolved.push({ el, entry });
  }
  if (resolved.length === 0) {
    return { html: source, grouped: false };
  }

  const groupId = nextUniqueId(document, "group");
  const hfId = `hf-${groupId}`;
  const wrapper = document.createElement("div");
  wrapper.setAttribute("id", groupId);
  wrapper.setAttribute("data-hf-id", hfId);
  wrapper.setAttribute("data-hf-group", req.groupLabel?.trim() || "Group");
  if (req.start != null && Number.isFinite(req.start)) {
    wrapper.setAttribute("data-start", String(Math.max(0, Number(req.start.toFixed(3)))));
  }
  if (req.duration != null && Number.isFinite(req.duration) && req.duration > 0) {
    wrapper.setAttribute("data-duration", String(Math.max(0.1, Number(req.duration.toFixed(3)))));
  }
  const zIndex = req.zIndex ?? 45;
  wrapper.setAttribute(
    "style",
    `position: absolute; left: ${Math.round(req.bbox.left)}px; top: ${Math.round(req.bbox.top)}px; width: ${Math.max(1, Math.round(req.bbox.width))}px; height: ${Math.max(1, Math.round(req.bbox.height))}px; z-index: ${Math.round(zIndex)}; overflow: visible;`,
  );

  const firstParent =
    resolved[0]!.el.parentElement ??
    querySelectorAllWithTemplates(document, "[data-composition-id]")[0] ??
    document.body;
  firstParent.insertBefore(wrapper, resolved[0]!.el);

  resolved.forEach(({ el, entry }, idx) => {
    if (!el.id) {
      el.id = nextUniqueId(document, "group-item");
    }
    if (!el.getAttribute("data-hf-id")) {
      el.setAttribute("data-hf-id", `hf-${el.id}`);
    }
    el.style.removeProperty("inset");
    el.style.removeProperty("right");
    el.style.removeProperty("bottom");
    el.style.position = "absolute";
    el.style.left = `${Math.round(entry.left)}px`;
    el.style.top = `${Math.round(entry.top)}px`;
    el.style.width = `${Math.max(1, Math.round(entry.width))}px`;
    el.style.height = `${Math.max(1, Math.round(entry.height))}px`;
    el.style.margin = "0px";
    el.style.zIndex = String(entry.zIndex ?? 10 + idx);
    wrapper.appendChild(el);
  });

  return {
    html: wrappedFragment ? document.body.innerHTML || "" : document.toString(),
    grouped: true,
    groupId,
    hfId,
  };
}

export interface ReorderTrackEntry {
  target: SourceMutationTarget;
  trackIndex: number;
  zIndex: number;
}

export interface ReorderTracksRequest {
  entries: ReorderTrackEntry[];
}

export interface ReorderTracksResult {
  html: string;
  changed: boolean;
}

export function reorderTracksInHtml(
  source: string,
  req: ReorderTracksRequest,
): ReorderTracksResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  if (!Array.isArray(req.entries) || req.entries.length === 0) {
    return { html: source, changed: false };
  }
  let changed = false;
  for (const entry of req.entries) {
    const el = findTargetElement(document, entry.target);
    if (!el || !isHTMLElement(el)) continue;
    if (Number.isFinite(entry.trackIndex)) {
      el.setAttribute("data-track-index", String(Math.round(entry.trackIndex)));
      changed = true;
    }
    if (Number.isFinite(entry.zIndex)) {
      let style = el.getAttribute("style") ?? "";
      if (!/(?:^|;|\s)position\s*:/i.test(style)) {
        style = patchStyleAttrString(style, "position", "relative");
      }
      style = patchStyleAttrString(style, "z-index", String(Math.round(entry.zIndex)));
      el.setAttribute("style", style);
      changed = true;
    }
  }
  if (!changed) return { html: source, changed: false };
  return {
    html: wrappedFragment ? document.body.innerHTML || "" : document.toString(),
    changed: true,
  };
}
