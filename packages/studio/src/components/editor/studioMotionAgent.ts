import {
  MOTION_PRESET_CATALOG,
  compileMotionPreset,
  getMotionPresetById,
  type MotionPresetDefinition,
} from "./motionPresetCatalog";
import {
  addStudioGsapMotion,
  type StudioGsapMotion,
  type StudioGsapMotionDirection,
  type StudioMotionCategory,
  type StudioMotionManifest,
  type StudioMotionStylePreset,
  type StudioMotionTarget,
} from "./studioMotion";

export {
  installHyperFramesAgentBridge,
  type HyperFramesAgentApplyObjectEffectOptions,
  type HyperFramesAgentApplyTransitionOptions,
  type HyperFramesAgentBridge,
  type HyperFramesAgentBridgeDeps,
} from "./studioMotionAgentBridge";

export type MotionPlacementMode = "auto" | "playhead" | "start" | "end";

const SHORTHAND_ALIASES: Record<string, string> = {
  crossfade: "transition-crossfade",
  dissolve: "transition-crossfade",
  fade: "transition-crossfade",
  push: "transition-push",
  wipe: "transition-wipe",
  reveal: "transition-reveal",
  split: "transition-split",
  zoom: "transition-zoom",
  morph: "transition-morph",
  cut: "transition-cut",
  appear: "entrance-appear",
  "fade-in": "entrance-fade-in",
  fadein: "entrance-fade-in",
  "rise-up": "entrance-rise-up",
  rise: "entrance-rise-up",
  "fly-in": "entrance-fly-in",
  "slide-in": "entrance-fly-in",
  pop: "entrance-pop",
  "scale-in": "entrance-pop",
  "wipe-in": "entrance-wipe",
  "reveal-mask": "entrance-reveal-mask",
  "blur-in": "entrance-blur-in",
  pulse: "emphasis-pulse",
  glow: "emphasis-border-glow",
  "border-glow": "emphasis-border-glow",
  spotlight: "emphasis-spotlight",
  shake: "emphasis-shake",
  float: "emphasis-float",
  tilt: "emphasis-tilt",
  "zoom-hold": "emphasis-zoom-hold",
  "ken-burns": "emphasis-zoom-hold",
  "fade-out": "exit-fade-out",
  fadeout: "exit-fade-out",
  "slide-out": "exit-slide-out",
  "fly-out": "exit-slide-out",
  "shrink-out": "exit-shrink-out",
  "wipe-out": "exit-wipe-out",
  "blur-out": "exit-blur-out",
  collapse: "exit-collapse",
  line: "path-line",
  arc: "path-arc",
  curve: "path-curve",
  turn: "path-turn",
};

export function resolveMotionPresetAlias(
  rawInput: string,
  preferredCategory?: StudioMotionCategory,
): MotionPresetDefinition | undefined {
  const normalized = rawInput.trim().toLowerCase().replace(/\s+/g, "-");
  if (!normalized) return undefined;
  const exact = getMotionPresetById(normalized);
  if (exact) return exact;
  if (preferredCategory) {
    const prefixed = getMotionPresetById(`${preferredCategory}-${normalized}`);
    if (prefixed) return prefixed;
  }
  const aliasId = SHORTHAND_ALIASES[normalized];
  if (aliasId) {
    const aliased = getMotionPresetById(aliasId);
    if (aliased) return aliased;
  }
  return MOTION_PRESET_CATALOG.find(
    (p) =>
      (!preferredCategory || p.category === preferredCategory) &&
      (p.id.endsWith(`-${normalized}`) || p.name.toLowerCase() === rawInput.trim().toLowerCase()),
  );
}

export function computeSmartMotionStart(options: {
  category: StudioMotionCategory;
  duration: number;
  clipStart: number;
  clipDuration: number;
  placement?: MotionPlacementMode;
  playheadTime?: number;
}): number {
  const {
    category,
    duration,
    clipStart,
    clipDuration,
    placement = "auto",
    playheadTime = 0,
  } = options;
  const safeStart = Math.max(0, Number.isFinite(clipStart) ? clipStart : 0);
  const safeDur = Math.max(
    0.1,
    Number.isFinite(clipDuration) && clipDuration > 0 ? clipDuration : 3,
  );
  const effectDur = Math.max(0.05, Number.isFinite(duration) && duration > 0 ? duration : 0.6);

  if (placement === "playhead") return Number(Math.max(0, playheadTime).toFixed(2));
  if (placement === "start") return Number(safeStart.toFixed(2));
  if (placement === "end" || category === "exit") {
    return Number(Math.max(safeStart, safeStart + safeDur - effectDur).toFixed(2));
  }
  if (category === "emphasis") {
    return Number((safeStart + Math.max(0, (safeDur - effectDur) * 0.5)).toFixed(2));
  }
  return Number(safeStart.toFixed(2));
}

export function syncDeclarativeDomMotions(
  doc: Document | null,
  activeCompPath: string | null,
  baseManifest: StudioMotionManifest,
  defaultStylePreset: StudioMotionStylePreset = "documentary",
): { manifest: StudioMotionManifest; addedCount: number } {
  if (!doc) return { manifest: baseManifest, addedCount: 0 };

  let nextManifest = baseManifest;
  let addedCount = 0;
  const sourceFile = activeCompPath || "index.html";

  const subComps = Array.from(
    doc.querySelectorAll<HTMLElement>("[data-composition-id][data-start]"),
  )
    .filter((el) => el.getAttribute("data-composition-id") !== "master")
    .sort(
      (a, b) =>
        Number(a.getAttribute("data-start") || 0) - Number(b.getAttribute("data-start") || 0),
    );

  for (let i = 1; i < subComps.length; i++) {
    const prevEl = subComps[i - 1]!;
    const currEl = subComps[i]!;
    const rawTransition = currEl.getAttribute("data-transition")?.trim();
    if (!rawTransition) continue;

    const preset = resolveMotionPresetAlias(rawTransition, "transition");
    if (!preset || preset.category !== "transition") continue;

    const fromSceneId = prevEl.id || prevEl.getAttribute("data-composition-id") || `s0${i}`;
    const toSceneId = currEl.id || currEl.getAttribute("data-composition-id") || `s0${i + 1}`;
    const cutTime = Number(currEl.getAttribute("data-start") || 0);
    const customDur = Number.parseFloat(currEl.getAttribute("data-transition-duration") || "");
    const dur = Number.isFinite(customDur) && customDur > 0 ? customDur : preset.defaultDuration;
    const direction = (currEl.getAttribute("data-transition-direction") ||
      preset.defaultDirection) as StudioGsapMotionDirection | undefined;
    const ease = currEl.getAttribute("data-transition-ease") || undefined;
    const start = Math.max(0, Number((cutTime - dur / 2).toFixed(2)));
    const declarativeId = `decl-transition-${fromSceneId}-${toSceneId}`;

    const alreadyExists = nextManifest.motions.some(
      (m) =>
        m.id === declarativeId ||
        (m.category === "transition" &&
          m.target.id === toSceneId &&
          Math.abs((m.transition?.cutTime ?? m.start) - cutTime) < 0.5),
    );
    if (alreadyExists) continue;

    const transitionType = (preset.id.replace("transition-", "") || "crossfade") as NonNullable<
      StudioGsapMotion["transition"]
    >["type"];
    const compiled = compileMotionPreset(preset.id, {
      id: declarativeId,
      start,
      duration: dur,
      direction,
      ease,
      stylePreset: defaultStylePreset,
      transition: {
        fromSceneId,
        toSceneId,
        cutTime,
        type: transitionType,
        ...(direction ? { direction } : {}),
      },
    });

    nextManifest = addStudioGsapMotion(
      nextManifest,
      { sourceFile: "index.html", id: toSceneId, selector: `#${toSceneId}` },
      compiled,
    );
    addedCount += 1;
  }

  const SLOT_DEFS: ReadonlyArray<{
    attr: string;
    category: StudioMotionCategory;
    placement: MotionPlacementMode;
  }> = [
    { attr: "data-motion-in", category: "entrance", placement: "start" },
    { attr: "data-motion-emphasis", category: "emphasis", placement: "auto" },
    { attr: "data-motion-out", category: "exit", placement: "end" },
    { attr: "data-motion-path", category: "path", placement: "start" },
  ];

  const candidateElements = Array.from(
    doc.querySelectorAll<HTMLElement>(SLOT_DEFS.map((s) => `[${s.attr}]`).join(",")),
  );

  for (const el of candidateElements) {
    const elId = el.id || el.getAttribute("data-hf-id");
    if (!elId) continue;

    const clipStart = Number.parseFloat(el.getAttribute("data-start") || "0") || 0;
    const clipDuration = Number.parseFloat(el.getAttribute("data-duration") || "3.0") || 3.0;
    const styleAttr = el.getAttribute("data-motion-style") as StudioMotionStylePreset | null;
    const stylePreset: StudioMotionStylePreset =
      styleAttr === "subtle" || styleAttr === "documentary" || styleAttr === "energetic"
        ? styleAttr
        : defaultStylePreset;
    const elSourceFile =
      el.closest("[data-composition-src]")?.getAttribute("data-composition-src") ||
      el.closest("[data-composition-file]")?.getAttribute("data-composition-file") ||
      sourceFile;
    const target: StudioMotionTarget = {
      sourceFile: elSourceFile,
      id: el.id || undefined,
      selector: el.id ? `#${el.id}` : `[data-hf-id="${elId}"]`,
    };

    for (const slot of SLOT_DEFS) {
      const rawPreset = el.getAttribute(slot.attr)?.trim();
      if (!rawPreset) continue;
      const preset = resolveMotionPresetAlias(rawPreset, slot.category);
      if (!preset) continue;

      const declarativeId = `decl-${elId}-${slot.category}-${preset.id}`;
      const alreadyExists = nextManifest.motions.some(
        (m) =>
          m.id === declarativeId ||
          (m.target.id === target.id && m.category === slot.category && m.presetId === preset.id),
      );
      if (alreadyExists) continue;

      const customDur = Number.parseFloat(el.getAttribute(`${slot.attr}-duration`) || "");
      const dur = Number.isFinite(customDur) && customDur > 0 ? customDur : preset.defaultDuration;
      const customStart = Number.parseFloat(el.getAttribute(`${slot.attr}-start`) || "");
      const start = Number.isFinite(customStart)
        ? Math.max(0, customStart)
        : computeSmartMotionStart({
            category: slot.category,
            duration: dur,
            clipStart,
            clipDuration,
            placement: slot.placement,
          });
      const direction = (el.getAttribute(`${slot.attr}-direction`) ||
        el.getAttribute("data-motion-direction") ||
        preset.defaultDirection) as StudioGsapMotionDirection | undefined;
      const customDist = Number.parseFloat(
        el.getAttribute(`${slot.attr}-distance`) || el.getAttribute("data-motion-distance") || "",
      );
      const distance = Number.isFinite(customDist) && customDist > 0 ? customDist : undefined;
      const ease =
        el.getAttribute(`${slot.attr}-ease`) || el.getAttribute("data-motion-ease") || undefined;

      const compiled = compileMotionPreset(preset.id, {
        id: declarativeId,
        start,
        duration: dur,
        direction,
        distance,
        ease,
        stylePreset,
      });

      nextManifest = addStudioGsapMotion(nextManifest, target, compiled);
      addedCount += 1;
    }
  }

  return { manifest: nextManifest, addedCount };
}
