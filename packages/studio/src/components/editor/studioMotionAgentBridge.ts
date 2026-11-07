import { MOTION_PRESET_CATALOG, compileMotionPreset } from "./motionPresetCatalog";
import {
  addStudioGsapMotion,
  emptyStudioMotionManifest,
  removeStudioGsapMotionById,
  updateStudioGsapMotionById,
  type StudioElementMotionPayload,
  type StudioGsapMotion,
  type StudioGsapMotionDirection,
  type StudioMotionCategory,
  type StudioMotionManifest,
  type StudioMotionStylePreset,
} from "./studioMotion";
import {
  computeSmartMotionStart,
  resolveMotionPresetAlias,
  type MotionPlacementMode,
} from "./studioMotionAgent";

export interface HyperFramesAgentApplyObjectEffectOptions {
  targetId: string;
  presetId: string;
  placement?: MotionPlacementMode;
  start?: number;
  duration?: number;
  direction?: StudioGsapMotionDirection;
  distance?: number;
  ease?: string;
  stylePreset?: StudioMotionStylePreset;
  mode?: "replace" | "combine";
  sourceFile?: string;
}

export interface HyperFramesAgentApplyTransitionOptions {
  presetId: string;
  cutIndex?: number;
  fromSceneId?: string;
  toSceneId?: string;
  duration?: number;
  direction?: StudioGsapMotionDirection;
  ease?: string;
  stylePreset?: StudioMotionStylePreset;
  applyToAllCuts?: boolean;
}

export interface HyperFramesAgentBridge {
  help: () => Record<string, unknown>;
  listPresets: (category?: StudioMotionCategory) => ReadonlyArray<{
    id: string;
    name: string;
    category: StudioMotionCategory;
    defaultDuration: number;
    defaultEase: string;
    summary: string;
  }>;
  listTargets: () => {
    activeCompPath: string;
    layers: Array<{
      id: string;
      label: string;
      sourceFile: string;
      start: number;
      duration: number;
    }>;
    sceneCuts: Array<{
      index: number;
      fromSceneId: string;
      toSceneId: string;
      cutTime: number;
      appliedTransitionId: string | null;
      appliedTransitionName: string | null;
    }>;
    activeMotionsCount: number;
  };
  getManifest: () => StudioMotionManifest;
  applyObjectEffect: (options: HyperFramesAgentApplyObjectEffectOptions) => Promise<{
    ok: boolean;
    error?: string;
    motion?: StudioGsapMotion;
    manifest: StudioMotionManifest;
  }>;
  applySceneTransition: (options: HyperFramesAgentApplyTransitionOptions) => Promise<{
    ok: boolean;
    error?: string;
    transitions?: StudioGsapMotion[];
    manifest: StudioMotionManifest;
  }>;
  updateMotion: (
    motionId: string,
    patch: Partial<StudioElementMotionPayload>,
  ) => Promise<{ ok: boolean; error?: string; manifest: StudioMotionManifest }>;
  removeMotion: (motionId: string) => Promise<{ ok: boolean; manifest: StudioMotionManifest }>;
  removeSceneTransition: (options?: {
    toSceneId?: string;
    cutIndex?: number;
  }) => Promise<{ ok: boolean; removedCount: number; manifest: StudioMotionManifest }>;
  clearAllMotions: () => Promise<{ ok: boolean; manifest: StudioMotionManifest }>;
}

export interface HyperFramesAgentBridgeDeps {
  getManifest: () => StudioMotionManifest;
  getActiveStylePreset: () => StudioMotionStylePreset;
  getActiveCompPath: () => string | null;
  getCurrentTime: () => number;
  getIframeDoc: () => Document | null;
  getTimelineElements: () => ReadonlyArray<{
    id: string;
    domId?: string;
    label?: string;
    start: number;
    duration: number;
    sourceFile?: string;
    compositionSrc?: string;
    tag?: string;
  }>;
  commitManifest: (nextManifest: StudioMotionManifest, label: string) => Promise<void>;
  setSelectedMotionId: (id: string | null) => void;
  requestSeek: (time: number) => void;
}

declare global {
  interface Window {
    __hyperframesAgent?: HyperFramesAgentBridge;
    hyperframesAgent?: HyperFramesAgentBridge;
  }
}

export function installHyperFramesAgentBridge(deps: HyperFramesAgentBridgeDeps): () => void {
  if (typeof window === "undefined") return () => {};

  const discoverSceneCuts = () => {
    const doc = deps.getIframeDoc();
    const manifest = deps.getManifest();
    const cuts: Array<{
      index: number;
      fromSceneId: string;
      toSceneId: string;
      cutTime: number;
      appliedTransition: StudioGsapMotion | null;
    }> = [];

    if (doc) {
      const subComps = Array.from(
        doc.querySelectorAll<HTMLElement>("[data-composition-id][data-start]"),
      )
        .filter((el) => el.getAttribute("data-composition-id") !== "master")
        .sort(
          (a, b) =>
            Number(a.getAttribute("data-start") || 0) - Number(b.getAttribute("data-start") || 0),
        );
      for (let i = 0; i < subComps.length - 1; i++) {
        const a = subComps[i]!;
        const b = subComps[i + 1]!;
        const cutTime = Number(b.getAttribute("data-start") || 0);
        const fromSceneId = a.id || a.getAttribute("data-composition-id") || `s0${i + 1}`;
        const toSceneId = b.id || b.getAttribute("data-composition-id") || `s0${i + 2}`;
        const applied =
          manifest.motions.find(
            (m) =>
              m.category === "transition" &&
              m.target.id === toSceneId &&
              Math.abs((m.transition?.cutTime ?? m.start) - cutTime) < 1.0,
          ) ?? null;
        cuts.push({ index: i, fromSceneId, toSceneId, cutTime, appliedTransition: applied });
      }
    }

    if (cuts.length === 0) {
      const scenes = [...deps.getTimelineElements()]
        .filter(
          (el) =>
            el.duration > 0 && (Boolean(el.compositionSrc) || /^s\d+$/i.test(el.domId || el.id)),
        )
        .sort((a, b) => a.start - b.start);
      for (let i = 0; i < scenes.length - 1; i++) {
        const a = scenes[i]!;
        const b = scenes[i + 1]!;
        const cutTime = b.start;
        const fromSceneId = a.domId || a.id;
        const toSceneId = b.domId || b.id;
        const applied =
          manifest.motions.find(
            (m) =>
              m.category === "transition" &&
              m.target.id === toSceneId &&
              Math.abs((m.transition?.cutTime ?? m.start) - cutTime) < 1.0,
          ) ?? null;
        cuts.push({ index: i, fromSceneId, toSceneId, cutTime, appliedTransition: applied });
      }
    }
    return cuts;
  };

  const discoverLayers = () => {
    const activeCompPath = deps.getActiveCompPath() || "index.html";
    const doc = deps.getIframeDoc();
    const seen = new Set<string>();
    const layers: Array<{
      id: string;
      label: string;
      sourceFile: string;
      start: number;
      duration: number;
    }> = [];

    for (const el of deps.getTimelineElements()) {
      const id = el.domId || el.id.split("/").pop() || el.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      layers.push({
        id,
        label: el.label || id,
        sourceFile: el.sourceFile || el.compositionSrc || activeCompPath,
        start: el.start,
        duration: el.duration,
      });
    }

    if (doc) {
      for (const node of Array.from(doc.querySelectorAll<HTMLElement>("[id],[data-hf-id]"))) {
        const id = node.id || node.getAttribute("data-hf-id") || "";
        if (!id || id === "root" || id === "master-stage" || seen.has(id)) continue;
        seen.add(id);
        layers.push({
          id,
          label: node.getAttribute("data-label") || id,
          sourceFile: activeCompPath,
          start: Number.parseFloat(node.getAttribute("data-start") || "0") || 0,
          duration: Number.parseFloat(node.getAttribute("data-duration") || "3.0") || 3.0,
        });
      }
    }
    return layers;
  };

  const bridge: HyperFramesAgentBridge = {
    help: () => ({
      description:
        "HyperFrames Studio AI Agent Motion & Transition SDK. Inspect, apply, update, or remove object motion effects and scene transitions.",
      methods: {
        "listPresets(category?)":
          "List all 48 presets (entrance, emphasis, exit, path, transition).",
        "listTargets()":
          "List addressable layer elements and scene cuts in the current composition.",
        "applyObjectEffect({ targetId, presetId, placement?, start?, duration?, direction?, distance?, ease?, stylePreset?, mode? })":
          "Apply an Entrance, Emphasis, Exit, or Path effect by element ID with smart placement.",
        "applySceneTransition({ presetId, toSceneId?, cutIndex?, duration?, direction?, ease?, applyToAllCuts? })":
          "Apply a two-scene transition ('crossfade', 'push', 'wipe', 'reveal', 'split', 'zoom', 'morph') to a scene cut or all cuts.",
        "updateMotion(motionId, patch)": "Update timing, duration, direction, distance, or ease.",
        "removeMotion(motionId)": "Remove a specific motion or transition by ID.",
        "removeSceneTransition({ toSceneId?, cutIndex? })":
          "Remove a scene transition and restore a hard cut.",
      },
    }),

    listPresets: (category) =>
      MOTION_PRESET_CATALOG.filter((p) => !category || p.category === category).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        defaultDuration: p.defaultDuration,
        defaultEase: p.defaultEase,
        summary: p.summary,
      })),

    listTargets: () => ({
      activeCompPath: deps.getActiveCompPath() || "index.html",
      layers: discoverLayers(),
      sceneCuts: discoverSceneCuts().map((c) => ({
        index: c.index,
        fromSceneId: c.fromSceneId,
        toSceneId: c.toSceneId,
        cutTime: c.cutTime,
        appliedTransitionId: c.appliedTransition?.id ?? null,
        appliedTransitionName: c.appliedTransition?.name ?? null,
      })),
      activeMotionsCount: deps.getManifest().motions.length,
    }),

    getManifest: () => deps.getManifest(),

    applyObjectEffect: async (options) => {
      const preset = resolveMotionPresetAlias(options.presetId);
      if (!preset) {
        return {
          ok: false,
          error: `Unknown motion preset '${options.presetId}'. Call __hyperframesAgent.listPresets() for valid IDs.`,
          manifest: deps.getManifest(),
        };
      }

      const cleanTargetId = options.targetId.replace(/^#/, "").trim();
      const layerInfo = discoverLayers().find((l) => l.id === cleanTargetId);
      const sourceFile =
        options.sourceFile || layerInfo?.sourceFile || deps.getActiveCompPath() || "index.html";
      const duration = options.duration ?? preset.defaultDuration;
      const start =
        typeof options.start === "number" && Number.isFinite(options.start)
          ? Math.max(0, options.start)
          : computeSmartMotionStart({
              category: preset.category,
              duration,
              clipStart: layerInfo?.start ?? 0,
              clipDuration: layerInfo?.duration ?? 3.0,
              placement: options.placement ?? "auto",
              playheadTime: deps.getCurrentTime(),
            });

      const compiled = compileMotionPreset(preset.id, {
        start,
        duration,
        direction: options.direction,
        distance: options.distance,
        ease: options.ease,
        stylePreset: options.stylePreset ?? deps.getActiveStylePreset(),
      });

      let workingManifest = deps.getManifest();
      if (options.mode === "replace") {
        for (const c of workingManifest.motions.filter(
          (m) => m.target.id === cleanTargetId && m.category === preset.category,
        )) {
          if (c.id) workingManifest = removeStudioGsapMotionById(workingManifest, c.id);
        }
      }

      const nextManifest = addStudioGsapMotion(
        workingManifest,
        { sourceFile, id: cleanTargetId, selector: `#${cleanTargetId}` },
        compiled,
      );
      const added = nextManifest.motions.at(-1);
      if (added?.id) deps.setSelectedMotionId(added.id);

      await deps.commitManifest(
        nextManifest,
        `Agent: Apply ${preset.name} to #${cleanTargetId} @ ${start.toFixed(2)}s`,
      );
      return { ok: true, motion: added, manifest: nextManifest };
    },

    applySceneTransition: async (options) => {
      const preset = resolveMotionPresetAlias(options.presetId, "transition");
      if (!preset || preset.category !== "transition") {
        return {
          ok: false,
          error: `Unknown transition preset '${options.presetId}'. Valid transitions: crossfade, push, wipe, reveal, split, zoom, morph.`,
          manifest: deps.getManifest(),
        };
      }

      const cuts = discoverSceneCuts();
      if (cuts.length === 0) {
        return {
          ok: false,
          error: "No scene cuts found in the active composition.",
          manifest: deps.getManifest(),
        };
      }

      const targetCuts = options.applyToAllCuts
        ? cuts
        : [
            cuts.find(
              (c) =>
                (typeof options.cutIndex === "number" && c.index === options.cutIndex) ||
                (options.toSceneId && c.toSceneId === options.toSceneId.replace(/^#/, "")) ||
                (options.fromSceneId && c.fromSceneId === options.fromSceneId.replace(/^#/, "")),
            ) ?? cuts[0]!,
          ];

      const dur = options.duration ?? preset.defaultDuration;
      const stylePreset = options.stylePreset ?? deps.getActiveStylePreset();
      const transitionType = (preset.id.replace("transition-", "") || "crossfade") as NonNullable<
        StudioGsapMotion["transition"]
      >["type"];

      let nextManifest = deps.getManifest();
      const addedTransitions: StudioGsapMotion[] = [];

      for (const cut of targetCuts) {
        if (cut.appliedTransition?.id) {
          nextManifest = removeStudioGsapMotionById(nextManifest, cut.appliedTransition.id);
        }
        const start = Math.max(0, Number((cut.cutTime - dur / 2).toFixed(2)));
        const compiled = compileMotionPreset(preset.id, {
          start,
          duration: dur,
          direction: options.direction,
          ease: options.ease,
          stylePreset,
          transition: {
            fromSceneId: cut.fromSceneId,
            toSceneId: cut.toSceneId,
            cutTime: cut.cutTime,
            type: transitionType,
            ...(options.direction ? { direction: options.direction } : {}),
          },
        });
        nextManifest = addStudioGsapMotion(
          nextManifest,
          {
            sourceFile: deps.getActiveCompPath() || "index.html",
            id: cut.toSceneId,
            selector: `#${cut.toSceneId}`,
          },
          compiled,
        );
        const added = nextManifest.motions.at(-1);
        if (added) addedTransitions.push(added);
      }

      const lastAdded = addedTransitions.at(-1);
      if (lastAdded?.id) deps.setSelectedMotionId(lastAdded.id);
      if (targetCuts[0]) deps.requestSeek(targetCuts[0].cutTime);

      await deps.commitManifest(nextManifest, `Agent: Apply ${preset.name} transition (${dur}s)`);
      return { ok: true, transitions: addedTransitions, manifest: nextManifest };
    },

    updateMotion: async (motionId, patch) => {
      const current = deps.getManifest();
      if (!current.motions.some((m) => m.id === motionId)) {
        return { ok: false, error: `Motion '${motionId}' not found`, manifest: current };
      }
      const nextManifest = updateStudioGsapMotionById(current, motionId, patch);
      await deps.commitManifest(nextManifest, `Agent: Update motion ${motionId}`);
      return { ok: true, manifest: nextManifest };
    },

    removeMotion: async (motionId) => {
      const nextManifest = removeStudioGsapMotionById(deps.getManifest(), motionId);
      await deps.commitManifest(nextManifest, `Agent: Remove motion ${motionId}`);
      return { ok: true, manifest: nextManifest };
    },

    removeSceneTransition: async (options) => {
      const current = deps.getManifest();
      const cuts = discoverSceneCuts();
      const targetCut = options
        ? cuts.find(
            (c) =>
              (typeof options.cutIndex === "number" && c.index === options.cutIndex) ||
              (options.toSceneId && c.toSceneId === options.toSceneId.replace(/^#/, "")),
          )
        : undefined;

      const toRemove = current.motions.filter((m) => {
        if (m.category !== "transition") return false;
        if (!options?.toSceneId && typeof options?.cutIndex !== "number") return true;
        if (targetCut && m.target.id === targetCut.toSceneId) return true;
        if (options?.toSceneId && m.target.id === options.toSceneId.replace(/^#/, "")) return true;
        return false;
      });

      let nextManifest = current;
      for (const item of toRemove) {
        if (item.id) nextManifest = removeStudioGsapMotionById(nextManifest, item.id);
      }
      if (toRemove.length > 0) {
        await deps.commitManifest(
          nextManifest,
          `Agent: Remove ${toRemove.length} scene transition(s)`,
        );
      }
      return { ok: true, removedCount: toRemove.length, manifest: nextManifest };
    },

    clearAllMotions: async () => {
      const nextManifest = emptyStudioMotionManifest();
      await deps.commitManifest(nextManifest, "Agent: Clear all motions");
      return { ok: true, manifest: nextManifest };
    },
  };

  window.__hyperframesAgent = bridge;
  window.hyperframesAgent = bridge;

  return () => {
    if (window.__hyperframesAgent === bridge) delete window.__hyperframesAgent;
    if (window.hyperframesAgent === bridge) delete window.hyperframesAgent;
  };
}
