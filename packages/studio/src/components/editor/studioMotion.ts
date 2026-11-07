// Public surface — re-exports types, constants, and ops; owns DOM application logic.

export * from "./studioMotionTypes";
export * from "./studioMotionOps";

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

const STUDIO_TRANSITION_SCENE_ATTR = "data-hf-studio-transition-scene";
const ORIGINAL_STYLE_ATTR_PAIRS = [
  [STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR, "transform"],
  [STUDIO_MOTION_ORIGINAL_OPACITY_ATTR, "opacity"],
  [STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR, "visibility"],
  [STUDIO_MOTION_ORIGINAL_CLIP_PATH_ATTR, "clipPath"],
  [STUDIO_MOTION_ORIGINAL_FILTER_ATTR, "filter"],
  [STUDIO_MOTION_ORIGINAL_BG_COLOR_ATTR, "backgroundColor"],
  [STUDIO_MOTION_ORIGINAL_BORDER_COLOR_ATTR, "borderColor"],
  [STUDIO_MOTION_ORIGINAL_COLOR_ATTR, "color"],
] as const;

function captureOriginalMotionStyles(element: HTMLElement): void {
  if (element.hasAttribute(STUDIO_MOTION_ATTR)) return;
  const isTimedOrScene =
    element.hasAttribute("data-start") || element.hasAttribute("data-composition-id");
  for (const [attr, prop] of ORIGINAL_STYLE_ATTR_PAIRS) {
    const raw = element.style[prop];
    const val = prop === "visibility" && isTimedOrScene && raw === "hidden" ? "" : raw;
    element.setAttribute(attr, val);
  }
}

function syncSceneNominalVisibility(sceneEl: HTMLElement, safeTime: number): void {
  const sceneStart = Number.parseFloat(sceneEl.getAttribute("data-start") || "0") || 0;
  const sceneDur = Number.parseFloat(sceneEl.getAttribute("data-duration") || "3.0") || 3.0;
  const inSceneWindow = safeTime >= sceneStart && safeTime < sceneStart + sceneDur - 1e-6;
  sceneEl.style.removeProperty("opacity");
  if (!inSceneWindow) {
    sceneEl.style.setProperty("visibility", "hidden", "important");
    sceneEl.setAttribute("data-hf-clip-hidden", "");
    return;
  }
  sceneEl.style.setProperty("visibility", "visible", "important");
  sceneEl.removeAttribute("data-hf-clip-hidden");
  const localTime = safeTime - sceneStart;
  sceneEl.querySelectorAll("*").forEach((c) => {
    if (!isHtmlElement(c) || c.hasAttribute("data-hidden")) return;
    if (c.hasAttribute("data-start")) {
      const cStart = Number.parseFloat(c.getAttribute("data-start") || "0") || 0;
      const cDur =
        Number.parseFloat(c.getAttribute("data-duration") || String(sceneDur)) || sceneDur;
      const cInWindow = localTime >= cStart - 1e-6 && localTime < cStart + cDur + 1e-6;
      if (cInWindow) c.removeAttribute("data-hf-clip-hidden");
      else c.setAttribute("data-hf-clip-hidden", "");
      c.style.setProperty("visibility", cInWindow ? "visible" : "hidden", "important");
    } else if (c.style.visibility === "hidden") {
      c.style.removeProperty("visibility");
    }
  });
}

function restoreElementInlineStylesKeepAttr(
  element: HTMLElement,
  gsap: StudioMotionWindow["gsap"],
): void {
  gsap?.set?.(element, { clearProps: "transform,opacity,visibility" });
  for (const [attr, prop] of ORIGINAL_STYLE_ATTR_PAIRS) {
    if (
      prop === "transform" ||
      prop === "opacity" ||
      prop === "visibility" ||
      element.hasAttribute(attr)
    ) {
      element.style[prop] = element.getAttribute(attr) ?? "";
    }
  }
}

function restoreStudioMotionElement(element: HTMLElement, gsap: StudioMotionWindow["gsap"]): void {
  if (!element.hasAttribute(STUDIO_MOTION_ATTR)) return;
  restoreElementInlineStylesKeepAttr(element, gsap);
  element.removeAttribute(STUDIO_MOTION_ATTR);
  for (const [attr] of ORIGINAL_STYLE_ATTR_PAIRS) element.removeAttribute(attr);
}

function restoreStudioMotionElements(
  document: Document,
  gsap: StudioMotionWindow["gsap"],
  safeTime = 0,
): void {
  for (const element of Array.from(document.querySelectorAll(`[${STUDIO_MOTION_ATTR}]`))) {
    if (isHtmlElement(element) && element.getAttribute(STUDIO_MOTION_ATTR) === "true") {
      restoreStudioMotionElement(element, gsap);
    }
  }
  for (const sceneEl of Array.from(
    document.querySelectorAll(`[${STUDIO_TRANSITION_SCENE_ATTR}]`),
  )) {
    if (isHtmlElement(sceneEl)) {
      sceneEl.removeAttribute(STUDIO_TRANSITION_SCENE_ATTR);
      syncSceneNominalVisibility(sceneEl, safeTime);
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

  if (motion.category === "transition") {
    const fromSceneId = motion.transition?.fromSceneId || "s01";
    const fromEl = win.document?.getElementById(fromSceneId);
    if (fromEl) {
      captureOriginalMotionStyles(fromEl);
      fromEl.setAttribute(STUDIO_MOTION_ATTR, "true");
      fromEl.setAttribute(STUDIO_TRANSITION_SCENE_ATTR, "true");
      fromEl.setAttribute("data-hf-scene-no-swap", "studio-transition");
      timeline.fromTo(
        fromEl,
        { opacity: 1 },
        { opacity: 0, duration, ease, overwrite: "auto", immediateRender: false },
        effectiveStart,
      );
    }
    element.setAttribute(STUDIO_TRANSITION_SCENE_ATTR, "true");
    element.setAttribute("data-hf-scene-no-swap", "studio-transition");
  }

  const fromVars: Record<string, unknown> = { ...motion.from };
  const toVars: Record<string, unknown> = {
    ...motion.to,
    duration,
    ease,
    overwrite: "auto",
    immediateRender: false,
  };
  if (motion.category === "transition") {
    delete fromVars.autoAlpha;
    delete toVars.autoAlpha;
    if (fromVars.opacity === undefined) fromVars.opacity = 0;
    if (toVars.opacity === undefined) toVars.opacity = 1;
  }
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

function seekSceneTimeline(win: StudioMotionWindow, sceneId: string, targetTime: number): void {
  const tl = win.__timelines?.[sceneId] as
    | { totalTime?: (t: number, s?: boolean) => unknown; time?: (t: number) => unknown }
    | undefined;
  if (typeof tl?.totalTime === "function") tl.totalTime(targetTime, true);
  else if (typeof tl?.time === "function") tl.time(targetTime);
}

function applySceneTransitionsPass(
  document: Document,
  win: StudioMotionWindow,
  motions: Array<{
    category: string;
    duration: number;
    start: number;
    delay?: number | undefined;
    transition?:
      | {
          fromSceneId?: string | undefined;
          toSceneId?: string | undefined;
          cutTime?: number | undefined;
        }
      | undefined;
  }>,
  safeTime: number,
): void {
  const heldSceneParts = new Set<string>();
  for (const motion of motions) {
    if (motion.category !== "transition") continue;
    const fromSceneId = motion.transition?.fromSceneId || "s01";
    const toSceneId = motion.transition?.toSceneId || "s02";
    const fromEl = document.getElementById(fromSceneId);
    const toEl = document.getElementById(toSceneId);
    if (!fromEl || !toEl) continue;

    for (const sceneEl of [fromEl, toEl]) {
      sceneEl.setAttribute(STUDIO_TRANSITION_SCENE_ATTR, "true");
      sceneEl.setAttribute("data-hf-scene-no-swap", "studio-transition");
      sceneEl.removeAttribute("data-hf-far-scene");
      const partName = sceneEl.getAttribute("data-hf-scene-part") || sceneEl.id;
      if (partName) heldSceneParts.add(partName);
    }

    const tStart = Math.max(0, motion.start + (motion.delay ?? 0));
    const duration = motion.duration;
    const tEnd = tStart + duration;
    const cutTime = motion.transition?.cutTime ?? tStart + duration / 2;

    if (safeTime >= tStart && safeTime <= tEnd) {
      for (const el of [fromEl, toEl]) {
        el.style.setProperty("visibility", "visible", "important");
        el.style.setProperty("display", "block", "important");
        el.removeAttribute("data-hf-clip-hidden");
        el.querySelectorAll("[data-hf-clip-hidden]").forEach((c) =>
          c.removeAttribute("data-hf-clip-hidden"),
        );
        el.querySelectorAll("*").forEach((c) => {
          if (isHtmlElement(c) && !c.hasAttribute("data-hidden") && c.style.visibility === "hidden")
            c.style.setProperty("visibility", "visible", "important");
        });
      }

      const linearProg =
        duration > 0 ? Math.max(0, Math.min(1, (safeTime - tStart) / duration)) : 0.5;
      const smoothProg = 0.5 - 0.5 * Math.cos(Math.PI * linearProg);
      fromEl.style.setProperty("opacity", String(1 - smoothProg), "important");
      toEl.style.setProperty("opacity", String(smoothProg), "important");

      if (safeTime >= cutTime) {
        const s01Dur = parseFloat(fromEl.getAttribute("data-duration") || "3.0");
        seekSceneTimeline(win, fromSceneId, s01Dur);
      } else {
        seekSceneTimeline(win, toSceneId, 0);
      }
    } else if (safeTime < tStart) {
      syncSceneNominalVisibility(fromEl, safeTime);
      toEl.style.setProperty("opacity", "0", "important");
      toEl.style.setProperty("visibility", "hidden", "important");
      toEl.setAttribute("data-hf-clip-hidden", "");
    } else if (safeTime > tEnd) {
      fromEl.style.setProperty("opacity", "0", "important");
      fromEl.style.setProperty("visibility", "hidden", "important");
      fromEl.setAttribute("data-hf-clip-hidden", "");
      syncSceneNominalVisibility(toEl, safeTime);
    }
  }

  const holdScenesFn = (
    win as unknown as { __hfHoldScenes?: (names: string[], holder?: string) => Promise<void> }
  ).__hfHoldScenes;
  if (typeof holdScenesFn === "function" && heldSceneParts.size > 0) {
    void holdScenesFn([...heldSceneParts], "studio-transition");
  }
}

function compareMotionsByTime(
  a: { start: number; delay?: number | undefined; order?: number | undefined },
  b: { start: number; delay?: number | undefined; order?: number | undefined },
): number {
  const diff = a.start + (a.delay ?? 0) - (b.start + (b.delay ?? 0));
  return Math.abs(diff) > 1e-6 ? diff : (a.order ?? 0) - (b.order ?? 0);
}

function finalizeStudioTimeline(
  win: StudioMotionWindow,
  timeline: NonNullable<StudioMotionWindow["__timelines"]>[string],
  safeTime: number,
): void {
  win.__timelines = win.__timelines ?? {};
  win.__timelines[STUDIO_MOTION_TIMELINE_ID] = timeline;
  timeline.pause?.();
  if (timeline.totalTime) {
    if (safeTime > 0) timeline.totalTime(0, true);
    timeline.totalTime(safeTime, false);
  } else {
    timeline.time?.(safeTime);
  }
}

export function applyStudioMotionManifest(
  document: Document,
  manifest: StudioMotionManifest,
  activeCompositionPath: string | null = null,
  currentTime?: number,
): number {
  const win = document.defaultView as
    | (StudioMotionWindow & {
        __hfStudioMotionApplying?: boolean;
        __hfStudioMotionSyncAtTime?: (time: number) => void;
      })
    | null;
  if (!win || win.__hfStudioMotionApplying) return 0;
  win.__hfStudioMotionApplying = true;
  try {
    const gsap = win.gsap;
    const safeTime = readCurrentTime(win, currentTime);
    win.__timelines = win.__timelines ?? {};
    win.__timelines[STUDIO_MOTION_TIMELINE_ID]?.kill?.();
    delete win.__timelines[STUDIO_MOTION_TIMELINE_ID];
    restoreStudioMotionElements(document, gsap, safeTime);
    win.__hfStudioMotionManifest = manifest;
    win.__hfStudioMotionActiveComp = activeCompositionPath;
    win.__hfStudioMotionSyncAtTime = (syncTime: number) => {
      if (win.__hfStudioMotionApplying) return;
      const activeManifest = win.__hfStudioMotionManifest;
      if (!activeManifest || activeManifest.motions.length === 0) return;
      const tl = win.__timelines?.[STUDIO_MOTION_TIMELINE_ID];
      if (tl?.totalTime) tl.totalTime(syncTime, true);
      else tl?.time?.(syncTime);
      applySceneTransitionsPass(document, win, activeManifest.motions, syncTime);
    };
    if (!gsap?.timeline || manifest.motions.length === 0) {
      const holdScenesFn = (
        win as unknown as { __hfHoldScenes?: (names: string[], holder?: string) => Promise<void> }
      ).__hfHoldScenes;
      if (typeof holdScenesFn === "function") void holdScenesFn([], "studio-transition");
      return 0;
    }

    const timeline = gsap.timeline({ paused: true, defaults: { overwrite: "auto" } });
    let applied = 0;
    const seenElements = new Set<HTMLElement>();
    const sortedMotions = [...manifest.motions].sort(compareMotionsByTime);

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
    finalizeStudioTimeline(win, timeline, safeTime);
    applySceneTransitionsPass(document, win, sortedMotions, safeTime);
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
      motionEntries.push({ element: el, motions: [...motions].sort(compareMotionsByTime) });
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
    const timeline = gsap.timeline({ paused: true, defaults: { overwrite: "auto" } });
    let applied = 0;
    const allDomMotions: StudioElementMotionPayload[] = [];
    for (const { element, motions } of motionEntries) {
      if (!timeline.fromTo) continue;
      motions.forEach((motion, index) => {
        allDomMotions.push(motion);
        applied += scheduleMotionTweensOnTimeline(win, timeline, element, motion, index === 0);
      });
    }

    if (applied === 0) {
      timeline.kill?.();
      return 0;
    }
    const safeTime = readCurrentTime(win, currentTime);
    finalizeStudioTimeline(win, timeline, safeTime);
    applySceneTransitionsPass(document, win, allDomMotions, safeTime);
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
