export interface StudioMotionRenderScriptOptions {
  activeCompositionPath?: string | null;
}

export const STUDIO_MOTION_PATH = ".hyperframes/studio-motion.json";

function hasStudioMotionEntries(manifestContent: string): boolean {
  try {
    const parsed = JSON.parse(manifestContent) as { motions?: unknown };
    return Array.isArray(parsed.motions) && parsed.motions.length > 0;
  } catch {
    return false;
  }
}

/**
 * Builds the render-time Studio motion runtime script, or null when no owned motion exists.
 */
export function createStudioMotionRenderBodyScript(
  manifestContent: string,
  options: StudioMotionRenderScriptOptions = {},
): string | null {
  if (!manifestContent.trim() || !hasStudioMotionEntries(manifestContent)) return null;
  return `(${studioMotionRenderRuntime.toString()})(${JSON.stringify(manifestContent)}, ${JSON.stringify(options.activeCompositionPath ?? null)});`;
}

function studioMotionRenderRuntime(
  manifestContent: string,
  activeCompositionPath: string | null,
): void {
  const STUDIO_MOTION_TIMELINE_ID = "studio-motion";
  const STUDIO_MOTION_ATTR = "data-hf-studio-motion";
  const ORIGINAL_TRANSFORM_ATTR = "data-hf-studio-motion-original-transform";
  const ORIGINAL_OPACITY_ATTR = "data-hf-studio-motion-original-opacity";
  const ORIGINAL_VISIBILITY_ATTR = "data-hf-studio-motion-original-visibility";
  const ORIGINAL_CLIP_PATH_ATTR = "data-hf-studio-motion-original-clip-path";
  const ORIGINAL_FILTER_ATTR = "data-hf-studio-motion-original-filter";
  const ORIGINAL_BG_COLOR_ATTR = "data-hf-studio-motion-original-bg-color";
  const ORIGINAL_BORDER_COLOR_ATTR = "data-hf-studio-motion-original-border-color";
  const ORIGINAL_COLOR_ATTR = "data-hf-studio-motion-original-color";

  const objectRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : null;

  const finiteNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const runtimeWindow = window as Window & {
    gsap?: {
      timeline?: (vars?: Record<string, unknown>) => {
        fromTo?: (
          target: HTMLElement,
          from: Record<string, unknown>,
          to: Record<string, unknown>,
          at: number,
        ) => unknown;
        totalTime?: (time: number, suppressEvents?: boolean) => unknown;
        time?: (time: number) => unknown;
        pause?: () => unknown;
        kill?: () => unknown;
      };
      set?: (target: HTMLElement, vars: Record<string, unknown>) => unknown;
      registerPlugin?: (...plugins: unknown[]) => unknown;
    };
    CustomEase?: { create?: (id: string, data: string) => unknown };
    __hf?: { seek?: (time: number) => unknown };
    __player?: {
      getTime?: () => number;
      seek?: (time: number) => unknown;
      renderSeek?: (time: number) => unknown;
    };
    __timeline?: { time?: () => number };
    __timelines?: Record<
      string,
      | {
          kill?: () => unknown;
        }
      | undefined
    >;
    __hfStudioMotionApply?: (explicitTime?: number) => number;
  };

  const parseMotionValues = (value: unknown): Record<string, unknown> | null => {
    const record = objectRecord(value);
    if (!record) return null;
    const parsed: Record<string, unknown> = {};
    for (const key of ["x", "y", "scale", "scaleX", "scaleY", "rotation", "opacity", "autoAlpha"]) {
      const next = finiteNumber(record[key]);
      if (next != null) parsed[key] = next;
    }
    for (const key of ["clipPath", "filter", "backgroundColor", "borderColor", "color"]) {
      const next = typeof record[key] === "string" ? record[key].trim() : "";
      if (next) parsed[key] = next;
    }
    return Object.keys(parsed).length > 0 ? parsed : null;
  };

  const parseCustomEase = (value: unknown): { id: string; data: string } | null => {
    const record = objectRecord(value);
    if (!record) return null;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const data = typeof record.data === "string" ? record.data.trim() : "";
    if (!id || !data) return null;
    return { id, data };
  };

  const parsedManifest = (() => {
    try {
      return objectRecord(JSON.parse(manifestContent));
    } catch {
      return null;
    }
  })();
  const manifestMotions = Array.isArray(parsedManifest?.motions) ? parsedManifest.motions : [];

  const sourceFileForElement = (element: HTMLElement): string => {
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
  };

  const elementMatchesSourceFile = (element: HTMLElement, sourceFile: string): boolean => {
    const actual = sourceFileForElement(element);
    if (actual === sourceFile) return true;
    if (sourceFile === "index.html" && !activeCompositionPath) return true;
    return false;
  };

  const isHTMLElement = (element: Element | null): element is HTMLElement =>
    element instanceof HTMLElement;

  const querySelectorCandidates = (selector: string): HTMLElement[] => {
    const className = selector.match(/^\.([A-Za-z0-9_-]+)$/)?.[1];
    if (className) {
      return Array.from(document.getElementsByTagName("*")).filter(
        (element): element is HTMLElement =>
          isHTMLElement(element) && element.classList.contains(className),
      );
    }
    if (/^[A-Za-z][A-Za-z0-9-]*$/.test(selector)) {
      return Array.from(document.getElementsByTagName(selector)).filter(isHTMLElement);
    }
    return Array.from(document.querySelectorAll(selector)).filter(isHTMLElement);
  };

  const resolveTarget = (targetRecord: Record<string, unknown>): HTMLElement | null => {
    const sourceFile = typeof targetRecord.sourceFile === "string" ? targetRecord.sourceFile : "";
    if (!sourceFile) return null;
    const id = typeof targetRecord.id === "string" ? targetRecord.id : "";
    if (id) {
      const byId = document.getElementById(id);
      if (
        isHTMLElement(byId) &&
        (elementMatchesSourceFile(byId, sourceFile) ||
          document.querySelectorAll(`[id="${id.replace(/"/g, '\\"')}"]`).length === 1)
      ) {
        return byId;
      }
    }
    const selector = typeof targetRecord.selector === "string" ? targetRecord.selector : "";
    if (!selector) return null;
    try {
      const selectorIndex = Math.max(0, Math.floor(finiteNumber(targetRecord.selectorIndex) ?? 0));
      return (
        querySelectorCandidates(selector).filter((element) =>
          elementMatchesSourceFile(element, sourceFile),
        )[selectorIndex] ?? null
      );
    } catch {
      return null;
    }
  };

  const restoreElement = (element: HTMLElement): void => {
    runtimeWindow.gsap?.set?.(element, { clearProps: "transform,opacity,visibility" });
    element.style.transform = element.getAttribute(ORIGINAL_TRANSFORM_ATTR) ?? "";
    element.style.opacity = element.getAttribute(ORIGINAL_OPACITY_ATTR) ?? "";
    element.style.visibility = element.getAttribute(ORIGINAL_VISIBILITY_ATTR) ?? "";
    if (element.hasAttribute(ORIGINAL_CLIP_PATH_ATTR)) {
      element.style.clipPath = element.getAttribute(ORIGINAL_CLIP_PATH_ATTR) ?? "";
    }
    if (element.hasAttribute(ORIGINAL_FILTER_ATTR)) {
      element.style.filter = element.getAttribute(ORIGINAL_FILTER_ATTR) ?? "";
    }
    if (element.hasAttribute(ORIGINAL_BG_COLOR_ATTR)) {
      element.style.backgroundColor = element.getAttribute(ORIGINAL_BG_COLOR_ATTR) ?? "";
    }
    if (element.hasAttribute(ORIGINAL_BORDER_COLOR_ATTR)) {
      element.style.borderColor = element.getAttribute(ORIGINAL_BORDER_COLOR_ATTR) ?? "";
    }
    if (element.hasAttribute(ORIGINAL_COLOR_ATTR)) {
      element.style.color = element.getAttribute(ORIGINAL_COLOR_ATTR) ?? "";
    }
    element.removeAttribute(STUDIO_MOTION_ATTR);
    element.removeAttribute(ORIGINAL_TRANSFORM_ATTR);
    element.removeAttribute(ORIGINAL_OPACITY_ATTR);
    element.removeAttribute(ORIGINAL_VISIBILITY_ATTR);
    element.removeAttribute(ORIGINAL_CLIP_PATH_ATTR);
    element.removeAttribute(ORIGINAL_FILTER_ATTR);
    element.removeAttribute(ORIGINAL_BG_COLOR_ATTR);
    element.removeAttribute(ORIGINAL_BORDER_COLOR_ATTR);
    element.removeAttribute(ORIGINAL_COLOR_ATTR);
  };

  const restoreStudioMotionElements = (): void => {
    for (const element of Array.from(document.querySelectorAll(`[${STUDIO_MOTION_ATTR}]`))) {
      if (isHTMLElement(element)) restoreElement(element);
    }
  };

  const readCurrentTime = (): number => {
    try {
      const playerTime = runtimeWindow.__player?.getTime?.();
      if (typeof playerTime === "number" && Number.isFinite(playerTime)) {
        return Math.max(0, playerTime);
      }
    } catch {
      // fall through
    }
    try {
      const timelineTime = runtimeWindow.__timeline?.time?.();
      if (typeof timelineTime === "number" && Number.isFinite(timelineTime)) {
        return Math.max(0, timelineTime);
      }
    } catch {
      // fall through
    }
    return 0;
  };

  const resolveEase = (motion: Record<string, unknown>): string => {
    const fallback =
      typeof motion.ease === "string" && motion.ease.trim() ? motion.ease.trim() : "none";
    const customEase = parseCustomEase(motion.customEase);
    const customEasePlugin = runtimeWindow.CustomEase;
    if (!customEase || typeof customEasePlugin?.create !== "function") return fallback;
    try {
      runtimeWindow.gsap?.registerPlugin?.(customEasePlugin);
      customEasePlugin.create(customEase.id, customEase.data);
      return customEase.id;
    } catch {
      return fallback;
    }
  };

  const applyManifest = (explicitTime?: number): number => {
    runtimeWindow.__timelines = runtimeWindow.__timelines ?? {};
    runtimeWindow.__timelines[STUDIO_MOTION_TIMELINE_ID]?.kill?.();
    delete runtimeWindow.__timelines[STUDIO_MOTION_TIMELINE_ID];
    restoreStudioMotionElements();
    const gsap = runtimeWindow.gsap;
    if (!gsap?.timeline || manifestMotions.length === 0) return 0;

    const timeline = gsap.timeline({ paused: true, defaults: { overwrite: "auto" } });
    let applied = 0;
    const seenTargets = new Set<HTMLElement>();
    const sortedMotions = [...manifestMotions].sort((a, b) => {
      const mA = objectRecord(a);
      const mB = objectRecord(b);
      const sA = (finiteNumber(mA?.start) ?? 0) + (finiteNumber(mA?.delay) ?? 0);
      const sB = (finiteNumber(mB?.start) ?? 0) + (finiteNumber(mB?.delay) ?? 0);
      return sA - sB;
    });
    for (const motionValue of sortedMotions) {
      const motion = objectRecord(motionValue);
      if (!motion || motion.kind !== "gsap-motion") continue;
      const targetRecord = objectRecord(motion.target);
      if (!targetRecord) continue;
      const target = resolveTarget(targetRecord);
      if (!target || typeof timeline.fromTo !== "function") continue;
      const start = finiteNumber(motion.start);
      const duration = finiteNumber(motion.duration);
      if (start == null || duration == null || start < 0 || duration <= 0) continue;
      const delay = finiteNumber(motion.delay) ?? 0;
      const effectiveStart = Math.max(0, start + delay);
      const ease = resolveEase(motion);
      // Scene transitions animate both outgoing and incoming scenes simultaneously
      if (motion.category === "transition") {
        const transRecord = objectRecord(motion.transition);
        const fromSceneId =
          typeof transRecord?.fromSceneId === "string" ? transRecord.fromSceneId : "s01";
        const toSceneId =
          typeof transRecord?.toSceneId === "string" ? transRecord.toSceneId : "s02";
        const fromEl = document.getElementById(fromSceneId);
        const toEl = document.getElementById(toSceneId);
        if (fromEl && toEl && typeof timeline.fromTo === "function") {
          if (!fromEl.hasAttribute(STUDIO_MOTION_ATTR)) {
            fromEl.setAttribute(ORIGINAL_OPACITY_ATTR, fromEl.style.opacity);
            fromEl.setAttribute(ORIGINAL_VISIBILITY_ATTR, fromEl.style.visibility);
            fromEl.setAttribute(STUDIO_MOTION_ATTR, "true");
          }
          if (!toEl.hasAttribute(STUDIO_MOTION_ATTR)) {
            toEl.setAttribute(ORIGINAL_OPACITY_ATTR, toEl.style.opacity);
            toEl.setAttribute(ORIGINAL_VISIBILITY_ATTR, toEl.style.visibility);
            toEl.setAttribute(STUDIO_MOTION_ATTR, "true");
          }
          timeline.fromTo(
            fromEl,
            { opacity: 1, autoAlpha: 1 },
            { opacity: 0, autoAlpha: 0, duration, ease, overwrite: "auto", immediateRender: false },
            effectiveStart,
          );
          timeline.fromTo(
            toEl,
            { opacity: 0, autoAlpha: 0 },
            { opacity: 1, autoAlpha: 1, duration, ease, overwrite: "auto", immediateRender: false },
            effectiveStart,
          );
          applied += 2;
          continue;
        }
      }

      const from = parseMotionValues(motion.from);
      const to = parseMotionValues(motion.to);
      if (!from || !to) continue;
      if (!target.hasAttribute(STUDIO_MOTION_ATTR)) {
        target.setAttribute(ORIGINAL_TRANSFORM_ATTR, target.style.transform);
        target.setAttribute(ORIGINAL_OPACITY_ATTR, target.style.opacity);
        target.setAttribute(ORIGINAL_VISIBILITY_ATTR, target.style.visibility);
        target.setAttribute(ORIGINAL_CLIP_PATH_ATTR, target.style.clipPath);
        target.setAttribute(ORIGINAL_FILTER_ATTR, target.style.filter);
        target.setAttribute(ORIGINAL_BG_COLOR_ATTR, target.style.backgroundColor);
        target.setAttribute(ORIGINAL_BORDER_COLOR_ATTR, target.style.borderColor);
        target.setAttribute(ORIGINAL_COLOR_ATTR, target.style.color);
      }
      target.setAttribute(STUDIO_MOTION_ATTR, "true");
      const isFirst = !seenTargets.has(target);
      seenTargets.add(target);
      const keyframesRaw = Array.isArray(motion.keyframes) ? motion.keyframes : null;
      if (keyframesRaw && keyframesRaw.length >= 2) {
        for (let i = 0; i < keyframesRaw.length - 1; i++) {
          const kfA = objectRecord(keyframesRaw[i]);
          const kfB = objectRecord(keyframesRaw[i + 1]);
          if (!kfA || !kfB) continue;
          const pA = finiteNumber(kfA.progress) ?? 0;
          const pB = finiteNumber(kfB.progress) ?? 1;
          const vA = parseMotionValues(kfA.values);
          const vB = parseMotionValues(kfB.values);
          if (!vA || !vB) continue;
          const segStart = effectiveStart + pA * duration;
          const segDur = Math.max(0.001, (pB - pA) * duration);
          const segEase = typeof kfB.ease === "string" && kfB.ease.trim() ? kfB.ease.trim() : ease;
          timeline.fromTo(
            target,
            vA,
            { ...vB, duration: segDur, ease: segEase, overwrite: "auto", immediateRender: false },
            segStart,
          );
        }
        applied += 1;
        continue;
      }
      if (motion.category === "entrance" && effectiveStart > 0 && isFirst) {
        timeline.fromTo(
          target,
          { ...from },
          {
            ...from,
            duration: effectiveStart,
            ease: "none",
            overwrite: "auto",
            immediateRender: false,
          },
          0,
        );
      }
      timeline.fromTo(
        target,
        from,
        { ...to, duration, ease, overwrite: "auto", immediateRender: false },
        effectiveStart,
      );
      applied += 1;
    }

    if (applied === 0) {
      timeline.kill?.();
      return 0;
    }
    runtimeWindow.__timelines[STUDIO_MOTION_TIMELINE_ID] = timeline;
    timeline.pause?.();
    const currentTime =
      typeof explicitTime === "number" && Number.isFinite(explicitTime)
        ? Math.max(0, explicitTime)
        : readCurrentTime();
    if (typeof timeline.totalTime === "function") {
      if (currentTime > 0) timeline.totalTime(0, true);
      timeline.totalTime(currentTime, false);
    } else {
      timeline.time?.(currentTime);
    }

    // -------------------------------------------------------------
    // Two-Scene Transition Compositing Pass (Both scenes visible during blend)
    // -------------------------------------------------------------
    for (const motionValue of sortedMotions) {
      const motion = objectRecord(motionValue);
      if (!motion || motion.category !== "transition") continue;
      const transRecord = objectRecord(motion.transition);
      const fromSceneId =
        typeof transRecord?.fromSceneId === "string" ? transRecord.fromSceneId : "s01";
      const toSceneId = typeof transRecord?.toSceneId === "string" ? transRecord.toSceneId : "s02";
      const fromEl = document.getElementById(fromSceneId);
      const toEl = document.getElementById(toSceneId);
      if (!fromEl || !toEl) continue;

      const start = finiteNumber(motion.start) ?? 0;
      const duration = finiteNumber(motion.duration) ?? 0.8;
      const delay = finiteNumber(motion.delay) ?? 0;
      const tStart = Math.max(0, start + delay);
      const tEnd = tStart + duration;
      const cutTime = finiteNumber(transRecord?.cutTime) ?? tStart + duration / 2;

      if (currentTime >= tStart && currentTime <= tEnd) {
        // We are within the crossfade window: both scenes must render simultaneously!
        fromEl.style.setProperty("visibility", "visible", "important");
        fromEl.style.setProperty("display", "block", "important");
        fromEl.removeAttribute(STUDIO_MOTION_ATTR);
        fromEl.removeAttribute("data-hf-clip-hidden");
        for (const c of Array.from(fromEl.querySelectorAll("[data-hf-clip-hidden]"))) {
          c.removeAttribute("data-hf-clip-hidden");
        }
        for (const item of Array.from(fromEl.querySelectorAll("*"))) {
          if (isHTMLElement(item) && item.style.visibility === "hidden") {
            item.style.removeProperty("visibility");
          }
        }

        toEl.style.setProperty("visibility", "visible", "important");
        toEl.style.setProperty("display", "block", "important");
        toEl.removeAttribute("data-hf-clip-hidden");
        for (const c of Array.from(toEl.querySelectorAll("[data-hf-clip-hidden]"))) {
          c.removeAttribute("data-hf-clip-hidden");
        }
        for (const item of Array.from(toEl.querySelectorAll("*"))) {
          if (isHTMLElement(item) && item.style.visibility === "hidden") {
            item.style.removeProperty("visibility");
          }
        }

        // Calculate smooth crossfade curve (cosine ease for perceptual linearity)
        const linearProg =
          duration > 0 ? Math.max(0, Math.min(1, (currentTime - tStart) / duration)) : 0.5;
        const smoothProg = 0.5 - 0.5 * Math.cos(Math.PI * linearProg);
        const fromAlpha = 1 - smoothProg;
        const toAlpha = smoothProg;

        fromEl.style.setProperty("opacity", String(fromAlpha), "important");
        toEl.style.setProperty("opacity", String(toAlpha), "important");

        // Outside normal range timeline synchronization:
        // When currentTime >= cutTime, outgoing scene s01 has finished its nominal slot.
        // Clamp its internal timeline to its end duration so all cards hold their final animated state.
        if (currentTime >= cutTime) {
          const s01Dur = finiteNumber(fromEl.getAttribute("data-duration")) ?? 3.0;
          const s01Tl = runtimeWindow.__timelines?.[fromSceneId];
          if (s01Tl && typeof (s01Tl as { time?: (t: number) => unknown }).time === "function") {
            (s01Tl as { time: (t: number) => unknown }).time(s01Dur);
          }
        }

        // When currentTime < cutTime, incoming scene s02 has not reached its nominal slot.
        // Clamp its internal timeline to 0 so all cards hold their start state while fading in.
        if (currentTime < cutTime) {
          const s02Tl = runtimeWindow.__timelines?.[toSceneId];
          if (s02Tl && typeof (s02Tl as { time?: (t: number) => unknown }).time === "function") {
            (s02Tl as { time: (t: number) => unknown }).time(0);
          }
        }
      } else if (currentTime < tStart) {
        fromEl.style.removeProperty("opacity");
        toEl.style.setProperty("opacity", "0", "important");
      } else if (currentTime > tEnd) {
        fromEl.style.setProperty("opacity", "0", "important");
        toEl.style.removeProperty("opacity");
      }
    }

    return applied;
  };

  runtimeWindow.__hfStudioMotionApply = applyManifest;
  const WRAPPED_MOTION_SEEK_PROP = "__hfStudioMotionRenderSeekWrapped";
  const isWrapped = (fn: (time: number) => unknown): boolean =>
    Boolean((fn as unknown as Record<string, unknown>)[WRAPPED_MOTION_SEEK_PROP]);
  const markWrapped = (fn: (time: number) => unknown): void => {
    try {
      Object.defineProperty(fn, WRAPPED_MOTION_SEEK_PROP, {
        configurable: false,
        enumerable: false,
        value: true,
      });
    } catch {
      try {
        (fn as unknown as Record<string, unknown>)[WRAPPED_MOTION_SEEK_PROP] = true;
      } catch {
        // ignore
      }
    }
  };
  const wrapSeekFn = (
    get: () => ((time: number) => unknown) | undefined,
    set: (fn: (time: number) => unknown) => void,
  ): boolean => {
    const fn = get();
    if (typeof fn !== "function") return false;
    if (isWrapped(fn)) return true;
    const wrapped = function (this: unknown, time: number): unknown {
      const res = fn.call(this, time);
      applyManifest(time);
      return res;
    };
    markWrapped(wrapped);
    set(wrapped);
    return true;
  };
  const wrapAllSeekFunctions = (): void => {
    wrapSeekFn(
      () => runtimeWindow.__hf?.seek,
      (fn) => {
        if (runtimeWindow.__hf) runtimeWindow.__hf.seek = fn;
      },
    );
    wrapSeekFn(
      () => runtimeWindow.__player?.renderSeek,
      (fn) => {
        if (runtimeWindow.__player) runtimeWindow.__player.renderSeek = fn;
      },
    );
    wrapSeekFn(
      () => runtimeWindow.__player?.seek,
      (fn) => {
        if (runtimeWindow.__player) runtimeWindow.__player.seek = fn;
      },
    );
  };

  const installSeekTrap = (
    obj: Record<string, unknown> | undefined,
    key: string,
    getter: () => ((time: number) => unknown) | undefined,
    setter: (fn: (time: number) => unknown) => void,
  ): void => {
    if (!obj) return;
    try {
      let current = obj[key];
      Object.defineProperty(obj, key, {
        configurable: true,
        enumerable: true,
        get() {
          return current;
        },
        set(value: unknown) {
          current = value;
          if (typeof value === "function" && !isWrapped(value as (time: number) => unknown)) {
            wrapSeekFn(getter, setter);
          }
        },
      });
    } catch {
      // fall back to polling
    }
  };

  applyManifest();
  wrapAllSeekFunctions();
  installSeekTrap(
    runtimeWindow.__hf as Record<string, unknown> | undefined,
    "seek",
    () => runtimeWindow.__hf?.seek,
    (fn) => {
      if (runtimeWindow.__hf) runtimeWindow.__hf.seek = fn;
    },
  );
  installSeekTrap(
    runtimeWindow.__player as Record<string, unknown> | undefined,
    "renderSeek",
    () => runtimeWindow.__player?.renderSeek,
    (fn) => {
      if (runtimeWindow.__player) runtimeWindow.__player.renderSeek = fn;
    },
  );
  let remaining = 120;
  const interval = setInterval(() => {
    wrapAllSeekFunctions();
    remaining -= 1;
    if (remaining <= 0) clearInterval(interval);
  }, 50);
}
