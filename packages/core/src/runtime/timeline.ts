import type {
  RuntimeTimelineClip,
  RuntimeTimelineMessage,
  RuntimeTimelineScene,
  RuntimeTimelineLike,
} from "./types";
import { stableClipId } from "./clipTree";
import { findRootCompositionElement, parseCompositionDimension } from "./compositionDimension";
import {
  AUTHORED_DURATION_ATTR,
  AUTHORED_END_ATTR,
  resolveAuthoredTimingWindow,
} from "./authoredTiming";
import { swallow } from "./diagnostics";
import { readTimelineDurationSeconds } from "./timelineDuration";
import { readElementPlaybackRate, readMediaStart } from "./playbackRate";
import {
  parseStrictFiniteTimingNumber,
  resolveMediaElementDurationSeconds,
  resolveNaturalMediaTimelineDuration,
  resolveTimedImageDurationSeconds,
} from "./playbackRate";
import { resolveCssStackingContextId } from "./stackingContext";
import { createRuntimeStartTimeResolver } from "./startResolver";
import { isClipOnScreenAt } from "./clipWindow";
import { isSceneLikeCompositionId } from "../slideshow/index.js";
import { COMPOSITION_CONTRACT_VERSION } from "../compositionContract.js";
import { runtimeProtocolMetadata } from "./protocol.js";
import { isElementNode, isMediaElement } from "./domRealm";
import { LOOP_INFLATED_TIMELINE_SECONDS } from "./compositionLength";
import { cutToHostSlots } from "../mediaTiming";

export function runtimeElementWindow(
  rawNode: Element,
  options: {
    timelineRegistry: Record<string, RuntimeTimelineLike | undefined>;
    resolver: ReturnType<typeof createRuntimeStartTimeResolver>;
  },
): { start: number; end: number } | null {
  const tag = rawNode.tagName.toLowerCase();
  if (tag === "script" || tag === "style" || tag === "link" || tag === "meta") {
    return null;
  }

  const isMedia = tag === "video" || tag === "audio";
  const start = isMedia
    ? options.resolver.resolveMediaStartForElement(rawNode)
    : options.resolver.resolveStartForElement(rawNode, 0);
  let duration = options.resolver.resolveDurationForElement(rawNode);
  const compId = rawNode.getAttribute("data-composition-id");
  if (compId) {
    const compTimeline = options.timelineRegistry[compId];
    const liveDuration = readTimelineDurationSeconds(compTimeline);
    const hasAuthoredTiming =
      rawNode.hasAttribute("data-duration") ||
      rawNode.hasAttribute("data-end") ||
      rawNode.hasAttribute(AUTHORED_DURATION_ATTR) ||
      rawNode.hasAttribute(AUTHORED_END_ATTR);
    if (
      !hasAuthoredTiming &&
      (duration == null || duration <= 0) &&
      liveDuration != null &&
      liveDuration > 0
    ) {
      duration = liveDuration;
    }
  }
  const isRoot = compId !== null && rawNode === findRootCompositionElement(rawNode.ownerDocument);
  return {
    start,
    end: !isRoot && duration != null && duration > 0 ? start + duration : Number.POSITIVE_INFINITY,
  };
}

export function isRuntimeElementVisibleAt(
  rawNode: Element,
  options: {
    currentTime: number;
    compositionDuration: number;
    canonicalFps: number;
    timelineRegistry: Record<string, RuntimeTimelineLike | undefined>;
    resolver: ReturnType<typeof createRuntimeStartTimeResolver>;
  },
): boolean {
  const span = runtimeElementWindow(rawNode, options);
  if (!span) return false;
  return isClipOnScreenAt(
    options.currentTime,
    span.start,
    span.end,
    options.canonicalFps,
    options.compositionDuration,
  );
}

function parseNum(value: string | null | undefined): number | null {
  return parseStrictFiniteTimingNumber(value);
}

export function parseElementDurationAttr(element: Element): number | null {
  const publicDuration = element.getAttribute("data-duration");
  const authoredDuration = element.getAttribute(AUTHORED_DURATION_ATTR);
  const resolved = resolveAuthoredTimingWindow({
    start: 0,
    duration: publicDuration,
    authoredDuration,
  })?.duration;
  if (resolved != null) return resolved;
  const hasExplicitNonpositive = [publicDuration, authoredDuration]
    .map(parseNum)
    .some((duration) => duration != null && duration <= 0);
  return hasExplicitNonpositive ? 0 : null;
}

function parseElementEndAttr(element: Element): number | null {
  return (
    resolveAuthoredTimingWindow({
      start: 0,
      end: element.getAttribute("data-end"),
      authoredEnd: element.getAttribute(AUTHORED_END_ATTR),
    })?.end ?? null
  );
}

function readInlineZIndex(element: Element): number {
  try {
    const inline = (element as HTMLElement).style?.zIndex;
    if (inline && inline !== "auto") {
      const parsed = parseInt(inline, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  } catch {
    return 0;
  }
}

function maxDefinedNumber(...values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => Number.isFinite(value ?? null));
  if (finite.length === 0) return null;
  return Math.max(...finite);
}

/**
 * Parse an authored track attribute, honoring 0 (a valid top-lane index).
 * `parseInt(...) || fallback` silently replaced authored track 0 with the
 * synthetic fallback, so track-0 clips drifted to the bottom of the timeline.
 */
export function parseAuthoredTrack(el: Element, fallback: number): number {
  const raw = el.getAttribute("data-track-index") ?? el.getAttribute("data-track");
  if (raw == null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toAbsoluteAssetUrl(rawValue: string | null | undefined): string | null {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (lowered.startsWith("data:") || lowered.startsWith("javascript:")) return null;
  try {
    return new URL(raw, document.baseURI).toString();
  } catch {
    return raw;
  }
}

function resolveNodeAssetUrl(node: Element): string | null {
  const src = node.getAttribute("src") ?? node.getAttribute("data-src");
  if (src) return toAbsoluteAssetUrl(src);
  const compositionSrc = node.getAttribute("data-composition-src");
  if (compositionSrc) return toAbsoluteAssetUrl(compositionSrc);
  const mediaDescendant = node.querySelector("img[src], video[src], audio[src], source[src]");
  if (!mediaDescendant) return null;
  return toAbsoluteAssetUrl(mediaDescendant.getAttribute("src"));
}

function getFirstClassToken(node: Element): string | null {
  const className = (node as HTMLElement).className;
  if (typeof className !== "string") return null;
  return (
    className
      .split(/\s+/)
      .map((value) => value.trim())
      .find((value) => value && value !== "clip" && !value.startsWith("__hf-")) ?? null
  );
}

function filenameFromAssetUrl(url: string | null): string | null {
  if (!url) return null;
  let filename: string | undefined;
  try {
    const parsed = new URL(url, document.baseURI);
    filename = parsed.pathname.split("/").filter(Boolean).at(-1);
  } catch {
    filename = url
      .replace(/[?#].*$/, "")
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1);
  }
  if (!filename) return null;
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

function textPreview(node: Element): string | null {
  const text = node.textContent?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > 32 ? `${text.slice(0, 31)}...` : text;
}

function humanizeTimelineToken(value: string): string {
  const normalized = value
    .replace(/\.[^.]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return value;
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function authoredCompositionId(node: Element): string | null {
  return (
    node.getAttribute("data-hf-original-composition-id") ?? node.getAttribute("data-composition-id")
  );
}

function buildTimelineClipLabel(node: Element, kind: RuntimeTimelineClip["kind"], ordinal: number) {
  const explicit =
    node.getAttribute("data-timeline-label") ??
    node.getAttribute("data-label") ??
    node.getAttribute("aria-label") ??
    null;
  if (explicit?.trim()) return explicit.trim();

  const compositionId = authoredCompositionId(node);
  if (compositionId) return humanizeTimelineToken(compositionId);

  const id = (node as HTMLElement).id;
  if (id) return humanizeTimelineToken(id);

  const classToken = getFirstClassToken(node);
  if (classToken) return humanizeTimelineToken(classToken);

  const assetName = filenameFromAssetUrl(resolveNodeAssetUrl(node));
  if (assetName) return humanizeTimelineToken(assetName);

  const text = textPreview(node);
  if (text) return text;

  return `${humanizeTimelineToken(kind)} ${ordinal + 1}`;
}

export type ParkedTimelineScene = { name: string; host: () => Element };

export function collectRuntimeTimelinePayload(params: {
  canonicalFps: number;
  parked?: ParkedTimelineScene[];
  parkedClips?: Map<string, RuntimeTimelineClip[]>;
}): RuntimeTimelineMessage {
  const stackingByParent = new Map<Element | null, string>();
  const runtimeWindow = window as Window & {
    __timelines?: Record<string, RuntimeTimelineLike | undefined>;
  };
  const timelineRegistry = runtimeWindow.__timelines ?? {};
  const startResolver = createRuntimeStartTimeResolver({
    timelineRegistry,
    includeAuthoredTimingAttrs: true,
  });
  const resolveTimelineDurationSeconds = (compositionId: string | null): number | null => {
    if (!compositionId) return null;
    const duration = readTimelineDurationSeconds(timelineRegistry[compositionId]);
    return duration != null && duration > 0 ? duration : null;
  };
  const resolveMediaWindowEndSeconds = (): number | null => {
    const mediaNodes = Array.from(
      document.querySelectorAll("video[data-start], audio[data-start]"),
    ) as Array<HTMLVideoElement | HTMLAudioElement>;
    if (mediaNodes.length === 0) return null;
    let maxWindowEndSeconds = 0;
    for (const mediaNode of mediaNodes) {
      const start = startResolver.resolveMediaStartForElement(mediaNode);
      if (!Number.isFinite(start)) continue;
      const duration = resolveMediaElementDurationSeconds(mediaNode);
      if (duration == null || duration <= 0) continue;
      maxWindowEndSeconds = Math.max(maxWindowEndSeconds, Math.max(0, start) + duration);
    }
    return maxWindowEndSeconds > 0 ? maxWindowEndSeconds : null;
  };
  const resolveNearestCompositionContext = (
    node: Element,
    root: Element | null,
  ): {
    parentCompositionId: string | null;
    compositionAncestors: string[];
    inheritedStart: number | null;
    inheritedDuration: number | null;
  } => {
    const ancestors: string[] = [];
    let inheritedStart: number | null = null;
    let inheritedDuration: number | null = null;
    let parentCompositionId: string | null = null;
    let cursor = node.parentElement;
    while (cursor) {
      const compositionId = cursor.getAttribute("data-composition-id");
      if (compositionId) {
        ancestors.push(compositionId);
        if (!parentCompositionId && cursor !== root) {
          parentCompositionId = compositionId;
        }
        if (inheritedStart == null) {
          inheritedStart = startResolver.resolveStartForElement(cursor, 0);
        }
        if (inheritedDuration == null) {
          inheritedDuration =
            parseNum(cursor.getAttribute("data-duration")) ??
            resolveTimelineDurationSeconds(compositionId) ??
            null;
        }
      }
      cursor = cursor.parentElement;
    }
    return {
      parentCompositionId,
      compositionAncestors: ancestors.reverse(),
      inheritedStart,
      inheritedDuration,
    };
  };

  const root = findRootCompositionElement();
  const compositionNodes = Array.from(document.querySelectorAll("[data-composition-id]"));
  const rootCompositionId = root?.getAttribute("data-composition-id") ?? null;
  const rootCompositionStart = root ? startResolver.resolveStartForElement(root, 0) : 0;
  const mediaWindowEnd = resolveMediaWindowEndSeconds();
  const mediaWindowDuration =
    mediaWindowEnd != null ? Math.max(0, mediaWindowEnd - Math.max(0, rootCompositionStart)) : null;
  const rootDurationFromTimeline = resolveTimelineDurationSeconds(rootCompositionId);
  const rootDurationFromAttr = parseElementDurationAttr(root ?? document.body);
  const compositionWindowEnd = maxDefinedNumber(
    ...compositionNodes
      .filter((node) => node !== root)
      .map((node) => {
        const start = startResolver.resolveStartForElement(node, 0);
        const duration =
          startResolver.resolveDurationForElement(node) ??
          resolveTimelineDurationSeconds(node.getAttribute("data-composition-id")) ??
          null;
        if (!Number.isFinite(start) || duration == null || duration <= 0) return null;
        return Math.max(0, start) + duration;
      }),
  );
  const compositionWindowDuration =
    compositionWindowEnd != null
      ? Math.max(0, compositionWindowEnd - Math.max(0, rootCompositionStart))
      : null;
  const timelineDurationCandidate =
    typeof rootDurationFromTimeline === "number" &&
    Number.isFinite(rootDurationFromTimeline) &&
    rootDurationFromTimeline > 0
      ? rootDurationFromTimeline
      : null;
  const attrDurationCandidate =
    typeof rootDurationFromAttr === "number" &&
    Number.isFinite(rootDurationFromAttr) &&
    rootDurationFromAttr > 0
      ? rootDurationFromAttr
      : null;
  const mediaWindowDurationCandidate =
    typeof mediaWindowDuration === "number" &&
    Number.isFinite(mediaWindowDuration) &&
    mediaWindowDuration > 0
      ? mediaWindowDuration
      : null;
  const compositionWindowDurationCandidate =
    typeof compositionWindowDuration === "number" &&
    Number.isFinite(compositionWindowDuration) &&
    compositionWindowDuration > 0
      ? compositionWindowDuration
      : null;
  const finiteWindowFloor = maxDefinedNumber(
    mediaWindowDurationCandidate,
    compositionWindowDurationCandidate,
  );
  const timelineLooksLoopInflated =
    timelineDurationCandidate != null &&
    finiteWindowFloor != null &&
    timelineDurationCandidate >= LOOP_INFLATED_TIMELINE_SECONDS;
  // Prefer explicit authored root duration first.
  // If absent, guard against loop-inflated GSAP durations by trusting finite media window.
  const preferredRootDuration =
    attrDurationCandidate ??
    (timelineLooksLoopInflated
      ? finiteWindowFloor
      : maxDefinedNumber(
          timelineDurationCandidate,
          mediaWindowDurationCandidate,
          compositionWindowDurationCandidate,
        ));
  const rootCompositionDuration = preferredRootDuration ?? null;
  const rootCompositionEnd =
    rootCompositionDuration != null ? rootCompositionStart + rootCompositionDuration : null;
  const timelineWindowEnd =
    rootCompositionEnd ??
    (typeof mediaWindowEnd === "number" && Number.isFinite(mediaWindowEnd) && mediaWindowEnd > 0
      ? mediaWindowEnd
      : null);
  const clampDurationToRootWindow = (start: number, duration: number): number => {
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    if (timelineWindowEnd == null || !Number.isFinite(timelineWindowEnd)) return duration;
    if (!Number.isFinite(start) || start >= timelineWindowEnd) return 0;
    return Math.max(0, Math.min(duration, timelineWindowEnd - start));
  };
  const clips: RuntimeTimelineClip[] = [];
  const scenes: RuntimeTimelineScene[] = [];
  // Only collect elements that are explicitly part of the timeline:
  // - Elements with data-start or data-track-index (timed clips)
  // - Elements with data-composition-id (sub-compositions)
  // - Media elements (video, audio, img)
  // Elements without data-start (e.g. GSAP-animated scenes) are not included
  // as clips — they have no declared timing so the timeline can't show their
  // actual visibility window. They can still appear as scenes via the separate
  // scene collection below.
  const CLIP_NODES = "[data-start], [data-track-index], [data-composition-id], video, audio, img";
  const nodes = Array.from(document.querySelectorAll(CLIP_NODES));
  let maxEnd = 0;
  const clipOf = (node: Element, i: number): RuntimeTimelineClip | null => {
    if (node === root) return null;
    if (["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT"].includes(node.tagName))
      return null;
    const compositionContext = resolveNearestCompositionContext(node, root);
    const tag = node.tagName.toLowerCase();
    let start =
      tag === "video" || tag === "audio"
        ? startResolver.resolveMediaStartForElement(node)
        : startResolver.resolveStartForElement(node, compositionContext.inheritedStart ?? 0);
    const nodeCompositionId = node.getAttribute("data-composition-id");
    const isNestedHost = !!nodeCompositionId && nodeCompositionId !== rootCompositionId;
    let duration = parseElementDurationAttr(node);
    if (duration == null && isNestedHost) {
      duration = resolveTimelineDurationSeconds(nodeCompositionId);
    }
    if (duration == null && isMediaElement(node)) {
      if (Number.isFinite(node.duration)) {
        duration = resolveNaturalMediaTimelineDuration(node, node.duration);
      }
    }
    if (duration == null) duration = resolveTimedImageDurationSeconds(node, start);
    if (duration == null) {
      const inheritedDuration = compositionContext.inheritedDuration;
      if (inheritedDuration != null && inheritedDuration > 0) {
        const inheritedStart = compositionContext.inheritedStart ?? 0;
        const inheritedEnd = inheritedStart + inheritedDuration;
        duration = Math.max(0, inheritedEnd - start);
      }
    }
    if (duration == null || duration <= 0) return null;
    duration = clampDurationToRootWindow(start, duration);
    if (duration <= 0) return null;
    const slots = startResolver.resolveHostSlotsForElement(node);
    if (slots.length > 0) {
      const played = cutToHostSlots({ start, end: start + duration }, slots);
      const keepZeroLengthSoStudioNestsChildren = isNestedHost;
      if (played.end <= played.start && !keepZeroLengthSoStudioNestsChildren) return null;
      start = played.start;
      duration = played.end - played.start;
    }
    const kind: RuntimeTimelineClip["kind"] =
      nodeCompositionId && nodeCompositionId !== rootCompositionId
        ? "composition"
        : tag === "video"
          ? "video"
          : tag === "audio"
            ? "audio"
            : tag === "img"
              ? "image"
              : "element";
    return {
      id: stableClipId(node) ?? nodeCompositionId ?? null,
      label: buildTimelineClipLabel(node, kind, clips.length),
      start,
      duration,
      track: parseAuthoredTrack(node, isNestedHost ? 1 : i),
      zIndex: readInlineZIndex(node),
      stackingContextId: resolveCssStackingContextId(node, stackingByParent),
      kind,
      tagName: tag,
      compositionId: node.getAttribute("data-composition-id"),
      compositionAncestors: compositionContext.compositionAncestors,
      parentCompositionId: compositionContext.parentCompositionId,
      nodePath: null,
      compositionSrc: toAbsoluteAssetUrl(node.getAttribute("data-composition-src")),
      playbackStart: readMediaStart(node),
      playbackRate: readElementPlaybackRate(node),
      assetUrl: resolveNodeAssetUrl(node),
      timelineRole: node.getAttribute("data-timeline-role"),
      timelineLabel: node.getAttribute("data-timeline-label"),
      timelineGroup: node.getAttribute("data-timeline-group"),
      timelinePriority: parseNum(node.getAttribute("data-timeline-priority")),
    };
  };
  const addClip = (clip: RuntimeTimelineClip) => {
    clips.push(clip);
    maxEnd = Math.max(maxEnd, clip.start + clip.duration);
  };
  for (const [i, node] of nodes.entries()) {
    const clip = clipOf(node, i);
    if (clip) addClip(clip);
  }
  for (const scene of params.parked ?? []) {
    let parkedClips = params.parkedClips?.get(scene.name);
    if (!parkedClips) {
      const offset = nodes.length;
      parkedClips = Array.from(scene.host().querySelectorAll(CLIP_NODES)).flatMap(
        (node, j) => clipOf(node, offset + j) ?? [],
      );
      params.parkedClips?.set(scene.name, parkedClips);
    }
    for (const clip of parkedClips) addClip(clip);
  }
  // ── GSAP introspection ──────────────────────────────────────────────────
  // Discover scene and child layers animated by GSAP (or static visual layers
  // inside compositions) across the root composition and all mounted
  // sub-composition hosts.
  const gsapClipIds = new Set(clips.map((c) => c.id));
  const rootCompositionIdForGsap = root?.getAttribute("data-composition-id") ?? null;
  const gsapHosts = compositionNodes.length > 0 ? compositionNodes : root ? [root] : [];
  let nextGsapTrack = clips.length > 0 ? Math.max(...clips.map((c) => c.track)) + 1 : 0;

  for (const compHost of gsapHosts) {
    const compId = compHost.getAttribute("data-composition-id") ?? null;
    const compTimeline = compId ? (timelineRegistry[compId] ?? null) : null;
    if (!compTimeline) continue;
    const isRootHost = compHost === root;
    const hostStart = isRootHost
      ? rootCompositionStart
      : startResolver.resolveStartForElement(compHost, 0);
    const hostDuration = isRootHost
      ? rootCompositionDuration
      : (parseElementDurationAttr(compHost) ??
        resolveTimelineDurationSeconds(compId) ??
        rootCompositionDuration);

    type GsapTween = {
      targets?: () => Element[];
      startTime?: () => number;
      duration?: () => number;
      parent?: GsapTween;
      vars?: Record<string, unknown>;
    };
    const tlWithChildren = compTimeline as typeof compTimeline & {
      getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => GsapTween[];
    };
    if (typeof tlWithChildren.getChildren === "function") {
      try {
        const tweens = tlWithChildren.getChildren(true, true, false) ?? [];
        const directTweenTargets = new Set<Element>();
        for (const tween of tweens) {
          if (typeof tween.targets !== "function") continue;
          for (const target of tween.targets()) {
            if (isElementNode(target) && compHost.contains(target) && target !== compHost) {
              directTweenTargets.add(target);
            }
          }
        }

        type SceneElementRange = {
          id: string;
          start: number;
          end: number;
          hasRealVars: boolean;
          hasExitTween: boolean;
          hasDirectTween: boolean;
        };
        const sceneElements = new Map<Element, SceneElementRange>();
        const INLINE_TEXT_TAGS = new Set([
          "span",
          "strong",
          "em",
          "b",
          "i",
          "br",
          "small",
          "sub",
          "sup",
        ]);
        const hasDirectTextNode = (el: Element): boolean => {
          for (const node of Array.from(el.childNodes)) {
            if (node.nodeType === 3 && node.textContent && node.textContent.trim().length > 0) {
              return true;
            }
          }
          return false;
        };

        const collectSceneTargets = (container: Element) => {
          for (const child of Array.from(container.children)) {
            const childEl = child as HTMLElement;
            if (childEl !== compHost && childEl.hasAttribute("data-composition-id")) {
              continue;
            }
            const tag = childEl.tagName.toLowerCase();
            if (
              tag === "script" ||
              tag === "style" ||
              tag === "link" ||
              tag === "meta" ||
              tag === "defs" ||
              tag === "template" ||
              tag === "noscript" ||
              tag === "audio"
            ) {
              continue;
            }
            if (
              childEl.classList?.contains("wash-dark") ||
              childEl.classList?.contains("wash-vignette")
            ) {
              continue;
            }
            const isInlineTag = INLINE_TEXT_TAGS.has(tag);
            const isDirectTarget = directTweenTargets.has(childEl);
            if (isInlineTag && !isDirectTarget && !childEl.id) {
              continue;
            }
            const hfId = childEl.getAttribute("data-hf-id");
            const elemId = childEl.id || hfId || "";
            const isMediaOrSvg = tag === "img" || tag === "svg" || tag === "video";
            const isLeafText =
              Boolean(hfId) &&
              hasDirectTextNode(childEl) &&
              Array.from(childEl.children).every((c) =>
                INLINE_TEXT_TAGS.has(c.tagName.toLowerCase()),
              );

            if (
              elemId &&
              (Boolean(childEl.id) || isDirectTarget || isMediaOrSvg || isLeafText) &&
              !sceneElements.has(childEl)
            ) {
              sceneElements.set(childEl, {
                id: elemId,
                start: Infinity,
                end: -Infinity,
                hasRealVars: false,
                hasExitTween: false,
                hasDirectTween: false,
              });
            }

            if (tag !== "svg" && childEl.children.length > 0) {
              collectSceneTargets(childEl);
            }
          }
        };
        collectSceneTargets(compHost);

        // Walk all tweens and accumulate time ranges on targets and their scene ancestors
        for (const tween of tweens) {
          if (typeof tween.targets !== "function") continue;
          if (typeof tween.startTime !== "function" || typeof tween.duration !== "function")
            continue;
          let tweenStart = tween.startTime();
          let parent = tween.parent;
          while (parent && parent !== compTimeline && typeof parent.startTime === "function") {
            tweenStart += parent.startTime();
            parent = parent.parent;
          }
          const tweenDur = tween.duration();
          const tweenEnd = tweenStart + tweenDur;
          if (!Number.isFinite(tweenStart) || !Number.isFinite(tweenEnd)) continue;

          const vars = tween.vars as Record<string, unknown> | undefined;
          const hasVarsObj = vars != null && typeof vars === "object";
          const isInitialZeroHide =
            hasVarsObj &&
            tweenDur === 0 &&
            tweenStart === 0 &&
            !vars.runBackwards &&
            (vars.opacity === 0 || vars.autoAlpha === 0 || vars.display === "none");
          if (isInitialZeroHide) continue;

          const isExitVars =
            hasVarsObj &&
            !vars.runBackwards &&
            (vars.opacity === 0 ||
              vars.autoAlpha === 0 ||
              vars.display === "none" ||
              vars.visibility === "hidden");

          for (const target of tween.targets()) {
            if (!isElementNode(target) || !compHost.contains(target) || target === compHost) {
              continue;
            }
            let cursor: Element | null = target;
            while (cursor && cursor !== compHost) {
              const range = sceneElements.get(cursor);
              if (range) {
                if (cursor === target) {
                  range.hasDirectTween = true;
                  if (hasVarsObj) range.hasRealVars = true;
                  if (
                    isExitVars &&
                    (range.start < Infinity ? tweenStart >= range.start : tweenStart > 0)
                  ) {
                    range.hasExitTween = true;
                  }
                }
                range.start = Math.min(range.start, tweenStart);
                range.end = Math.max(range.end, tweenEnd);
              }
              cursor = cursor.parentElement;
            }
          }
        }

        // Extend entrance-only real GSAP tweens to the end of the composition window (Bug C)
        for (const [, range] of sceneElements) {
          if (range.start === Infinity || range.end === -Infinity) continue;
          if (
            range.hasRealVars &&
            !range.hasExitTween &&
            hostDuration != null &&
            Number.isFinite(hostDuration) &&
            hostDuration > range.end
          ) {
            range.end = Math.max(range.end, hostDuration);
          }
        }

        // Inherit parent visibility window for untweened children inside tweened containers,
        // or surface static visual assets/labels spanning the composition window (Bug D)
        for (const [element, range] of sceneElements) {
          if (range.start !== Infinity && range.end !== -Infinity) continue;
          let anc = element.parentElement;
          while (anc && anc !== compHost) {
            const ancRange = sceneElements.get(anc);
            if (ancRange && ancRange.start !== Infinity && ancRange.end !== -Infinity) {
              range.start = ancRange.start;
              range.end = ancRange.end;
              break;
            }
            anc = anc.parentElement;
          }
          if (
            (range.start === Infinity || range.end === -Infinity) &&
            hostDuration != null &&
            hostDuration > 0
          ) {
            const el = element as HTMLElement;
            const tag = el.tagName.toLowerCase();
            const isVisualAsset = tag === "img" || tag === "svg" || tag === "video";
            const isHFTextOrCard = el.hasAttribute("data-hf-id") && Boolean(el.textContent?.trim());
            if (isVisualAsset || isHFTextOrCard) {
              const computed = window.getComputedStyle(el);
              if (
                computed.display !== "none" &&
                computed.visibility !== "hidden" &&
                computed.opacity !== "0"
              ) {
                range.start = 0;
                range.end = hostDuration;
              }
            }
          }
        }

        // Create or refine clips for discovered scene elements (Bug A & Bug B)
        for (const [element, range] of sceneElements) {
          if (range.start === Infinity || range.end === -Infinity) continue;
          const el = element as HTMLElement;
          const clipId = el.id || range.id;
          if (!clipId) continue;
          const globalStart = hostStart + range.start;
          const localDuration = Math.max(0, range.end - range.start);
          if (localDuration <= 0) continue;
          const maxHostRemaining =
            hostDuration != null && Number.isFinite(hostDuration)
              ? Math.max(0, hostDuration - range.start)
              : localDuration;
          const clampedDuration = clampDurationToRootWindow(
            globalStart,
            Math.min(localDuration, maxHostRemaining),
          );
          if (clampedDuration <= 0) continue;

          if (gsapClipIds.has(clipId)) {
            if (!el.hasAttribute("data-start")) {
              const existing = clips.find((c) => c.id === clipId);
              if (existing) {
                existing.start = globalStart;
                existing.duration = clampedDuration;
              }
            }
            continue;
          }

          maxEnd = Math.max(maxEnd, globalStart + clampedDuration);
          const tag = el.tagName.toLowerCase();
          const kind: RuntimeTimelineClip["kind"] =
            tag === "video"
              ? "video"
              : tag === "audio"
                ? "audio"
                : tag === "img"
                  ? "image"
                  : "element";
          const compositionContext = resolveNearestCompositionContext(el, root);
          const fallbackLabel = el.id
            ? el.id
            : (textPreview(el) ?? filenameFromAssetUrl(resolveNodeAssetUrl(el)) ?? clipId);
          clips.push({
            id: clipId,
            label:
              el.getAttribute("data-timeline-label") ??
              el.getAttribute("data-label") ??
              el.getAttribute("aria-label") ??
              fallbackLabel,
            start: globalStart,
            duration: clampedDuration,
            track: parseAuthoredTrack(el, nextGsapTrack++),
            zIndex: readInlineZIndex(el),
            stackingContextId: resolveCssStackingContextId(el, stackingByParent),
            kind,
            tagName: tag,
            compositionId: el.getAttribute("data-composition-id"),
            compositionAncestors:
              compositionContext.compositionAncestors.length > 0
                ? compositionContext.compositionAncestors
                : compId
                  ? [compId]
                  : [],
            parentCompositionId:
              compositionContext.parentCompositionId ?? (isRootHost ? null : compId),
            nodePath: null,
            compositionSrc: null,
            playbackStart: readMediaStart(el),
            playbackRate: readElementPlaybackRate(el),
            assetUrl: resolveNodeAssetUrl(el),
            timelineRole: el.getAttribute("data-timeline-role"),
            timelineLabel: el.getAttribute("data-timeline-label"),
            timelineGroup: el.getAttribute("data-timeline-group"),
            timelinePriority: parseNum(el.getAttribute("data-timeline-priority")),
          });
          gsapClipIds.add(clipId);
        }
      } catch (err) {
        // GSAP introspection is best-effort — don't break timeline if it fails
        swallow("runtime.timeline.site1", err);
      }
    }
  }

  // ── Persistent overlays ─────────────────────────────────────────────────
  // Direct children of root that are pure structural overlays should only
  // surface in the timeline when authors explicitly opt them in. Otherwise
  // background layers like "backdrop" make the whole composition read as a
  // long clip, which is misleading in Studio.
  if (root && rootCompositionDuration != null && rootCompositionDuration > 0) {
    const overlayTrack = clips.length > 0 ? Math.max(...clips.map((c) => c.track)) + 1 : 0;
    for (const child of root.children) {
      const el = child as HTMLElement;
      if (!el.id) continue;
      if (gsapClipIds.has(el.id)) continue;
      const timelineRole = el.getAttribute("data-timeline-role");
      if (timelineRole !== "overlay" && timelineRole !== "persistent-overlay") continue;
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "link" || tag === "meta") continue;
      // Skip elements that are invisible (display:none in their CSS class)
      const computed = window.getComputedStyle(el);
      if (computed.display === "none") continue;
      const clampedDuration = clampDurationToRootWindow(0, rootCompositionDuration);
      if (clampedDuration <= 0) continue;
      maxEnd = Math.max(maxEnd, clampedDuration);
      clips.push({
        id: el.id,
        label:
          el.getAttribute("data-timeline-label") ??
          el.getAttribute("data-label") ??
          el.getAttribute("aria-label") ??
          el.id,
        start: 0,
        duration: clampedDuration,
        track: parseAuthoredTrack(el, overlayTrack),
        zIndex: readInlineZIndex(el),
        stackingContextId: resolveCssStackingContextId(el, stackingByParent),
        kind: "element",
        tagName: tag,
        compositionId: el.getAttribute("data-composition-id"),
        compositionAncestors: rootCompositionIdForGsap ? [rootCompositionIdForGsap] : [],
        parentCompositionId: rootCompositionIdForGsap,
        nodePath: null,
        compositionSrc: null,
        playbackStart: readMediaStart(el),
        playbackRate: readElementPlaybackRate(el),
        assetUrl: null,
        timelineRole,
        timelineLabel: el.getAttribute("data-timeline-label"),
        timelineGroup: el.getAttribute("data-timeline-group"),
        timelinePriority: parseNum(el.getAttribute("data-timeline-priority")),
      });
      gsapClipIds.add(el.id);
    }
  }

  // Track assignment honors the authored data-track-index verbatim: a clip stays
  // on the track it was placed on, regardless of kind. (Previously mixed-kind
  // tracks were split onto separate rows, but that renumbered tracks — breaking
  // "drop a clip onto an existing track" and causing the written track to drift
  // from the displayed one on every move. Track index is display-only; render
  // never reads it, so honoring it verbatim is the correct NLE behavior.)

  for (const compositionNode of compositionNodes) {
    if (compositionNode === root) continue;
    const compositionId = compositionNode.getAttribute("data-composition-id");
    if (!compositionId || !isSceneLikeCompositionId(compositionId)) continue;
    const start = startResolver.resolveStartForElement(compositionNode, 0);
    let durationFromAttr = parseElementDurationAttr(compositionNode);
    if (
      (durationFromAttr == null || durationFromAttr <= 0) &&
      parseElementEndAttr(compositionNode) != null
    ) {
      const end = parseElementEndAttr(compositionNode)!;
      durationFromAttr = Math.max(0, end - start);
    }
    const durationFromTimeline = resolveTimelineDurationSeconds(compositionId);
    const duration =
      durationFromAttr && durationFromAttr > 0 ? durationFromAttr : durationFromTimeline;
    if (duration == null || duration <= 0) continue;
    const clampedDuration = clampDurationToRootWindow(start, duration);
    if (clampedDuration <= 0) continue;
    scenes.push({
      id: compositionId,
      label:
        compositionNode.getAttribute("data-label") ??
        authoredCompositionId(compositionNode) ??
        compositionId,
      start,
      duration: clampedDuration,
      thumbnailUrl: toAbsoluteAssetUrl(compositionNode.getAttribute("data-thumbnail-url")),
      avatarName: null,
    });
  }
  // Timeline payload duration should reflect the playable composition window,
  // not just the furthest currently-surfaced clip. Studio can intentionally
  // hide structural/background tracks from the timeline UI; if we collapse the
  // payload duration down to the last visible clip end, the controls jump even
  // though playback still runs for the full authored root duration.
  const knownDuration = Math.max(maxEnd || 0, rootCompositionDuration ?? 0);
  const safeDuration = knownDuration > 0 ? knownDuration : 1;
  const durationInFrames = Math.max(1, Math.ceil(safeDuration * Math.max(1, params.canonicalFps)));
  return {
    ...runtimeProtocolMetadata(params.canonicalFps),
    source: "hf-preview",
    type: "timeline",
    compositionContractVersion: COMPOSITION_CONTRACT_VERSION,
    durationSeconds: safeDuration,
    durationInFrames,
    clips,
    scenes,
    compositionWidth: parseCompositionDimension(root?.getAttribute("data-width")) ?? 1920,
    compositionHeight: parseCompositionDimension(root?.getAttribute("data-height")) ?? 1080,
  };
}
