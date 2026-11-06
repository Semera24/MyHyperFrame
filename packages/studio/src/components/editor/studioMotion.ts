// Public surface — re-exports types, constants, and ops; owns DOM application logic.

export {
  STUDIO_MOTION_PATH,
  STUDIO_MOTION_TIMELINE_ID,
  STUDIO_GSAP_EASE_OPTIONS,
  type StudioMotionCategory,
  type StudioMotionStylePreset,
  type StudioMotionTarget,
  type StudioGsapMotionValues,
  type StudioMotionKeyframe,
  type StudioMotionPathPoint,
  type StudioMotionPathConfig,
  type StudioSceneTransitionConfig,
  type StudioGsapCustomEase,
  type StudioCustomEaseControlPoints,
  type StudioGsapMotion,
  type StudioGsapMotionPreset,
  type StudioGsapMotionDirection,
  type StudioGsapPresetMotionOptions,
  type StudioMotionManifest,
  type StudioGsapTimeline,
  type StudioMotionWindow,
} from "./studioMotionTypes";

export {
  clampStudioCustomEasePoints,
  parseStudioCustomEaseData,
  serializeStudioCustomEaseData,
  controlPointsForGsapEase,
  buildStudioGsapPresetMotion,
  emptyStudioMotionManifest,
  parseStudioMotionManifest,
  serializeStudioMotionManifest,
  isStudioMotionManifestPath,
  selectionTarget,
  targetKey,
  sameSelectionTarget,
  upsertStudioGsapMotion,
  addStudioGsapMotion,
  updateStudioGsapMotionById,
  removeStudioGsapMotionById,
  duplicateStudioGsapMotionById,
  reorderStudioGsapMotionById,
  removeStudioMotionForSelection,
  getStudioMotionForSelection,
  getStudioMotionsForSelection,
  readStudioMotionFromElement,
  readStudioMotionsFromElement,
  writeStudioMotionToElement,
  writeStudioMotionsToElement,
  clearStudioMotionFromElement,
  type StudioElementMotionPayload,
} from "./studioMotionOps";

import { isHtmlElement } from "@hyperframes/core/runtime/dom-realm";
import { readStudioMotionsFromElement, type StudioElementMotionPayload } from "./studioMotionOps";
import {
  STUDIO_MOTION_ATTR,
  STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR,
  STUDIO_MOTION_ORIGINAL_OPACITY_ATTR,
  STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR,
  STUDIO_MOTION_ORIGINAL_CLIP_PATH_ATTR,
  STUDIO_MOTION_ORIGINAL_FILTER_ATTR,
  STUDIO_MOTION_ORIGINAL_BG_COLOR_ATTR,
  STUDIO_MOTION_ORIGINAL_BORDER_COLOR_ATTR,
  STUDIO_MOTION_ORIGINAL_COLOR_ATTR,
  STUDIO_MOTION_TIMELINE_ID,
  type StudioGsapMotion,
  type StudioMotionManifest,
  type StudioMotionTarget,
  type StudioMotionWindow,
} from "./studioMotionTypes";

// ── DOM Helpers ──

function sourceFileForElement(element: HTMLElement, activeCompositionPath: string | null): string {
  let current: HTMLElement | null = element;
  while (current) {
    const sourceFile =
      current.getAttribute("data-composition-file") ??
      current.getAttribute("data-composition-src") ??
      current.getAttribute("data-src");
    if (sourceFile) return sourceFile;
    current = current.parentElement;
  }
  return activeCompositionPath ?? "index.html";
}

function elementMatchesSourceFile(
  element: HTMLElement,
  sourceFile: string,
  activeCompositionPath: string | null,
): boolean {
  const actual = sourceFileForElement(element, activeCompositionPath);
  if (actual === sourceFile) return true;
  if (sourceFile === "index.html" && !activeCompositionPath) return true;
  return false;
}

function querySelectorCandidates(document: Document, selector: string): HTMLElement[] {
  const className = selector.match(/^\.([A-Za-z0-9_-]+)$/)?.[1];
  if (className) {
    return Array.from(document.getElementsByTagName("*")).filter(
      (element): element is HTMLElement =>
        isHtmlElement(element) && element.classList.contains(className),
    );
  }
  if (/^[A-Za-z][A-Za-z0-9-]*$/.test(selector)) {
    return Array.from(document.getElementsByTagName(selector)).filter(isHtmlElement);
  }
  return Array.from(document.querySelectorAll(selector)).filter(isHtmlElement);
}

function resolveTarget(
  document: Document,
  target: StudioMotionTarget,
  activeCompositionPath: string | null,
): HTMLElement | null {
  if (target.id) {
    const byId = document.getElementById(target.id);
    if (
      isHtmlElement(byId) &&
      (elementMatchesSourceFile(byId, target.sourceFile, activeCompositionPath) ||
        document.querySelectorAll(`[id="${target.id.replace(/"/g, '\\"')}"]`).length === 1)
    ) {
      return byId;
    }
  }
  if (!target.selector) return null;
  try {
    const matches = querySelectorCandidates(document, target.selector).filter((element) =>
      elementMatchesSourceFile(element, target.sourceFile, activeCompositionPath),
    );
    return matches[Math.max(0, Math.floor(target.selectorIndex ?? 0))] ?? null;
  } catch {
    return null;
  }
}

function captureOriginalMotionStyles(element: HTMLElement): void {
  if (element.hasAttribute(STUDIO_MOTION_ATTR)) return;
  element.setAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR, element.style.transform);
  element.setAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR, element.style.opacity);
  element.setAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR, element.style.visibility);
  element.setAttribute(STUDIO_MOTION_ORIGINAL_CLIP_PATH_ATTR, element.style.clipPath);
  element.setAttribute(STUDIO_MOTION_ORIGINAL_FILTER_ATTR, element.style.filter);
  element.setAttribute(STUDIO_MOTION_ORIGINAL_BG_COLOR_ATTR, element.style.backgroundColor);
  element.setAttribute(STUDIO_MOTION_ORIGINAL_BORDER_COLOR_ATTR, element.style.borderColor);
  element.setAttribute(STUDIO_MOTION_ORIGINAL_COLOR_ATTR, element.style.color);
}

function restoreElementInlineStylesKeepAttr(
  element: HTMLElement,
  gsap: StudioMotionWindow["gsap"],
): void {
  gsap?.set?.(element, { clearProps: "transform,opacity,visibility" });
  element.style.transform = element.getAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR) ?? "";
  element.style.opacity = element.getAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR) ?? "";
  element.style.visibility = element.getAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR) ?? "";
  if (element.hasAttribute(STUDIO_MOTION_ORIGINAL_CLIP_PATH_ATTR)) {
    element.style.clipPath = element.getAttribute(STUDIO_MOTION_ORIGINAL_CLIP_PATH_ATTR) ?? "";
  }
  if (element.hasAttribute(STUDIO_MOTION_ORIGINAL_FILTER_ATTR)) {
    element.style.filter = element.getAttribute(STUDIO_MOTION_ORIGINAL_FILTER_ATTR) ?? "";
  }
  if (element.hasAttribute(STUDIO_MOTION_ORIGINAL_BG_COLOR_ATTR)) {
    element.style.backgroundColor =
      element.getAttribute(STUDIO_MOTION_ORIGINAL_BG_COLOR_ATTR) ?? "";
  }
  if (element.hasAttribute(STUDIO_MOTION_ORIGINAL_BORDER_COLOR_ATTR)) {
    element.style.borderColor =
      element.getAttribute(STUDIO_MOTION_ORIGINAL_BORDER_COLOR_ATTR) ?? "";
  }
  if (element.hasAttribute(STUDIO_MOTION_ORIGINAL_COLOR_ATTR)) {
    element.style.color = element.getAttribute(STUDIO_MOTION_ORIGINAL_COLOR_ATTR) ?? "";
  }
}

function restoreStudioMotionElement(element: HTMLElement, gsap: StudioMotionWindow["gsap"]): void {
  if (!element.hasAttribute(STUDIO_MOTION_ATTR)) return;
  restoreElementInlineStylesKeepAttr(element, gsap);
  element.removeAttribute(STUDIO_MOTION_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_CLIP_PATH_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_FILTER_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_BG_COLOR_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_BORDER_COLOR_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_COLOR_ATTR);
}

function restoreStudioMotionElements(document: Document, gsap: StudioMotionWindow["gsap"]): void {
  for (const element of Array.from(document.querySelectorAll(`[${STUDIO_MOTION_ATTR}]`))) {
    if (isHtmlElement(element) && element.getAttribute(STUDIO_MOTION_ATTR) === "true") {
      restoreStudioMotionElement(element, gsap);
    }
  }
}

function scheduleMotionTweensOnTimeline(
  win: StudioMotionWindow,
  timeline: NonNullable<StudioMotionWindow["__timelines"]>[string],
  element: HTMLElement,
  motion: StudioElementMotionPayload,
  isFirstMotionOnElement: boolean,
): number {
  if (!timeline?.fromTo) return 0;
  const effectiveStart = Math.max(0, motion.start + (motion.delay ?? 0));
  const duration = motion.duration;
  const ease = resolveGsapEaseFromPayload(win, motion);

  if (motion.keyframes && motion.keyframes.length >= 2) {
    const sorted = [...motion.keyframes].sort((a, b) => a.progress - b.progress);
    let count = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const kfA = sorted[i]!;
      const kfB = sorted[i + 1]!;
      const segStart = effectiveStart + kfA.progress * duration;
      const segDur = Math.max(0.001, (kfB.progress - kfA.progress) * duration);
      const segEase = kfB.ease ?? ease;
      timeline.fromTo(
        element,
        { ...kfA.values },
        {
          ...kfB.values,
          duration: segDur,
          ease: segEase,
          overwrite: "auto",
          immediateRender: false,
        },
        segStart,
      );
      count += 1;
    }
    return count > 0 ? 1 : 0;
  }

  if (motion.category === "entrance" && effectiveStart > 0 && isFirstMotionOnElement) {
    timeline.fromTo(
      element,
      { ...motion.from },
      {
        ...motion.from,
        duration: effectiveStart,
        ease: "none",
        overwrite: "auto",
        immediateRender: false,
      },
      0,
    );
  }

  const fromVars: Record<string, unknown> = { ...motion.from };
  const toVars: Record<string, unknown> = {
    ...motion.to,
    duration,
    ease,
    overwrite: "auto",
    immediateRender: false,
  };
  timeline.fromTo(element, fromVars, toVars, effectiveStart);
  return 1;
}

function readCurrentTime(win: StudioMotionWindow, fallback?: number): number {
  if (typeof fallback === "number" && Number.isFinite(fallback)) return Math.max(0, fallback);
  try {
    const playerTime = win.__player?.getTime?.();
    if (typeof playerTime === "number" && Number.isFinite(playerTime))
      return Math.max(0, playerTime);
  } catch {
    // fall through
  }
  try {
    const timelineTime = win.__timeline?.time?.();
    if (typeof timelineTime === "number" && Number.isFinite(timelineTime)) {
      return Math.max(0, timelineTime);
    }
  } catch {
    // fall through
  }
  return 0;
}

export function applyStudioMotionManifest(
  document: Document,
  manifest: StudioMotionManifest,
  activeCompositionPath: string | null = null,
  currentTime?: number,
): number {
  const win = document.defaultView as
    | (StudioMotionWindow & { __hfStudioMotionApplying?: boolean })
    | null;
  if (!win || win.__hfStudioMotionApplying) return 0;
  win.__hfStudioMotionApplying = true;
  try {
    const gsap = win.gsap;
    win.__timelines = win.__timelines ?? {};
    win.__timelines[STUDIO_MOTION_TIMELINE_ID]?.kill?.();
    delete win.__timelines[STUDIO_MOTION_TIMELINE_ID];
    restoreStudioMotionElements(document, gsap);
    win.__hfStudioMotionManifest = manifest;
    win.__hfStudioMotionActiveComp = activeCompositionPath;
    if (!gsap?.timeline || manifest.motions.length === 0) return 0;

    const timeline = gsap.timeline({
      paused: true,
      defaults: { overwrite: "auto" },
    });
    let applied = 0;
    const seenElements = new Set<HTMLElement>();
    const sortedMotions = [...manifest.motions].sort((a, b) => {
      const diff = a.start + (a.delay ?? 0) - (b.start + (b.delay ?? 0));
      if (Math.abs(diff) > 1e-6) return diff;
      return (a.order ?? 0) - (b.order ?? 0);
    });

    for (const motion of sortedMotions) {
      const element = resolveTarget(document, motion.target, activeCompositionPath);
      if (!element || !timeline.fromTo) continue;
      captureOriginalMotionStyles(element);
      if (!element.hasAttribute(STUDIO_MOTION_ATTR)) {
        element.setAttribute(STUDIO_MOTION_ATTR, "true");
      }
      const isFirst = !seenElements.has(element);
      seenElements.add(element);
      applied += scheduleMotionTweensOnTimeline(win, timeline, element, motion, isFirst);
    }

    if (applied === 0) {
      timeline.kill?.();
      return 0;
    }
    win.__timelines[STUDIO_MOTION_TIMELINE_ID] = timeline;
    timeline.pause?.();
    const safeTime = readCurrentTime(win, currentTime);
    if (timeline.totalTime) {
      if (safeTime > 0) timeline.totalTime(0, true);
      timeline.totalTime(safeTime, false);
    } else {
      timeline.time?.(safeTime);
    }
    return applied;
  } finally {
    win.__hfStudioMotionApplying = false;
  }
}

/**
 * Reads motion data from `data-hf-studio-motion` JSON attributes in the DOM,
 * builds a GSAP timeline, and seeks to the current time.
 */
export function applyStudioMotionFromDom(document: Document, currentTime?: number): number {
  const win = document.defaultView as
    | (StudioMotionWindow & { __hfStudioMotionApplying?: boolean })
    | null;
  if (!win || win.__hfStudioMotionApplying) return 0;
  const gsap = win.gsap;
  win.__timelines = win.__timelines ?? {};
  win.__timelines[STUDIO_MOTION_TIMELINE_ID]?.kill?.();
  delete win.__timelines[STUDIO_MOTION_TIMELINE_ID];

  const motionEntries: Array<{
    element: HTMLElement;
    motions: StudioElementMotionPayload[];
  }> = [];

  for (const el of Array.from(document.querySelectorAll(`[${STUDIO_MOTION_ATTR}]`))) {
    if (!isHtmlElement(el)) continue;
    const motions = readStudioMotionsFromElement(el);
    if (motions.length > 0) {
      restoreElementInlineStylesKeepAttr(el, gsap);
      const sorted = [...motions].sort((a, b) => {
        const diff = a.start + (a.delay ?? 0) - (b.start + (b.delay ?? 0));
        if (Math.abs(diff) > 1e-6) return diff;
        return (a.order ?? 0) - (b.order ?? 0);
      });
      motionEntries.push({ element: el, motions: sorted });
    }
  }

  if (motionEntries.length === 0) {
    if (win.__hfStudioMotionManifest && win.__hfStudioMotionManifest.motions.length > 0) {
      return applyStudioMotionManifest(
        document,
        win.__hfStudioMotionManifest,
        win.__hfStudioMotionActiveComp ?? null,
        currentTime,
      );
    }
    return 0;
  }

  if (!gsap?.timeline) return 0;

  win.__hfStudioMotionApplying = true;
  try {
    const timeline = gsap.timeline({
      paused: true,
      defaults: { overwrite: "auto" },
    });
    let applied = 0;
    for (const { element, motions } of motionEntries) {
      if (!timeline.fromTo) continue;
      motions.forEach((motion, index) => {
        applied += scheduleMotionTweensOnTimeline(win, timeline, element, motion, index === 0);
      });
    }

    if (applied === 0) {
      timeline.kill?.();
      return 0;
    }
    win.__timelines[STUDIO_MOTION_TIMELINE_ID] = timeline;
    timeline.pause?.();
    const safeTime = readCurrentTime(win, currentTime);
    if (timeline.totalTime) {
      if (safeTime > 0) timeline.totalTime(0, true);
      timeline.totalTime(safeTime, false);
    } else {
      timeline.time?.(safeTime);
    }
    return applied;
  } finally {
    win.__hfStudioMotionApplying = false;
  }
}

function resolveGsapEaseFromPayload(
  win: StudioMotionWindow,
  motion: { ease: string; customEase?: { id: string; data: string } },
): string {
  const customEase = motion.customEase;
  if (!customEase) return motion.ease;
  const customEasePlugin = win.CustomEase;
  if (typeof customEasePlugin?.create !== "function") return motion.ease;
  try {
    win.gsap?.registerPlugin?.(customEasePlugin);
    customEasePlugin.create(customEase.id, customEase.data);
    return customEase.id;
  } catch {
    return motion.ease;
  }
}

export function installStudioMotionSeekReapply(win: Window, apply: () => void): boolean {
  const studioWin = win as StudioMotionWindow;
  studioWin.__hfStudioMotionApply = () => {
    apply();
    return 0;
  };
  if (studioWin.__hfStudioMotionWrapped) return false;
  const player = studioWin.__player;
  if (!player) return false;

  const wrapPlayerMethod = (key: "renderSeek" | "seek") => {
    const original = player[key];
    if (typeof original !== "function") return;
    player[key] = (time: number) => {
      original.call(player, time);
      studioWin.__hfStudioMotionApply?.();
    };
  };
  wrapPlayerMethod("renderSeek");
  wrapPlayerMethod("seek");
  studioWin.__hfStudioMotionWrapped = true;
  return true;
}
