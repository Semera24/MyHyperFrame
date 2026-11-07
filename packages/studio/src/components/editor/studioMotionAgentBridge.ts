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

export interface HyperFramesAgentTransitionConflict {
  hadExistingTransition: boolean;
  resolution: "replaced";
  replacedTransitionIds: string[];
  replacedTransitionNames: string[];
}

export interface HyperFramesAgentApplyTransitionResult {
  ok: boolean;
  error?: string;
  cutId: string | null;
  fromSceneId?: string;
  toSceneId?: string;
  fps?: number;
  startTime?: number;
  cutTime?: number;
  endTime?: number;
  duration?: number;
  startFrame?: number;
  cutFrame?: number;
  endFrame?: number;
  saveStatus: "saved" | "failed" | "rejected";
  manifestPath: string;
  conflict: HyperFramesAgentTransitionConflict | null;
  transition?: StudioGsapMotion;
  transitions?: StudioGsapMotion[];
  manifest: StudioMotionManifest;
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
      cutId: string;
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
  applySceneTransition: (
    options: HyperFramesAgentApplyTransitionOptions,
  ) => Promise<HyperFramesAgentApplyTransitionResult>;
  updateMotion: (
    motionId: string,
    patch: Partial<StudioElementMotionPayload>,
  ) => Promise<{
    ok: boolean;
    error?: string;
    cutId?: string | null;
    startTime?: number;
    cutTime?: number;
    endTime?: number;
    duration?: number;
    startFrame?: number;
    cutFrame?: number;
    endFrame?: number;
    saveStatus?: "saved" | "failed" | "rejected";
    motion?: StudioGsapMotion;
    manifest: StudioMotionManifest;
  }>;
  removeMotion: (motionId: string) => Promise<{ ok: boolean; manifest: StudioMotionManifest }>;
  removeSceneTransition: (options?: {
    toSceneId?: string;
    fromSceneId?: string;
    cutIndex?: number;
  }) => Promise<{
    ok: boolean;
    removedCount: number;
    saveStatus: "saved" | "failed";
    manifest: StudioMotionManifest;
  }>;
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

  const MANIFEST_PATH = ".hyperframes/studio-motion.json";

  const resolvePreviewDoc = (): Document | null => {
    const direct = deps.getIframeDoc();
    if (direct) return direct;
    try {
      const playerHost = document.querySelector("hyperframes-player");
      const shadowIframe = playerHost?.shadowRoot?.querySelector(
        "iframe",
      ) as HTMLIFrameElement | null;
      if (shadowIframe?.contentDocument) return shadowIframe.contentDocument;
    } catch {
      // ignore
    }
    return null;
  };

  const resolveFps = (): number => {
    const doc = resolvePreviewDoc();
    const fpsAttr =
      doc?.querySelector("[data-fps]")?.getAttribute("data-fps") ??
      doc?.getElementById("master-stage")?.getAttribute("data-fps");
    const parsed = fpsAttr ? Number.parseFloat(fpsAttr) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  };

  const discoverSceneCuts = () => {
    const doc = resolvePreviewDoc();
    const manifest = deps.getManifest();
    const cuts: Array<{
      index: number;
      cutId: string;
      fromSceneId: string;
      toSceneId: string;
      fromDuration: number;
      toDuration: number;
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
        const fromDuration = Number.parseFloat(a.getAttribute("data-duration") || "3.0") || 3.0;
        const toDuration = Number.parseFloat(b.getAttribute("data-duration") || "3.0") || 3.0;
        const fromSceneId = a.id || a.getAttribute("data-composition-id") || `s0${i + 1}`;
        const toSceneId = b.id || b.getAttribute("data-composition-id") || `s0${i + 2}`;
        const cutId = `cut-${fromSceneId}-${toSceneId}`;
        const applied =
          manifest.motions.find(
            (m) =>
              m.category === "transition" &&
              (m.target.id === toSceneId || m.transition?.toSceneId === toSceneId) &&
              Math.abs((m.transition?.cutTime ?? m.start + m.duration / 2) - cutTime) < 1.0,
          ) ?? null;
        cuts.push({
          index: i,
          cutId,
          fromSceneId,
          toSceneId,
          fromDuration,
          toDuration,
          cutTime,
          appliedTransition: applied,
        });
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
        const cutId = `cut-${fromSceneId}-${toSceneId}`;
        const applied =
          manifest.motions.find(
            (m) =>
              m.category === "transition" &&
              (m.target.id === toSceneId || m.transition?.toSceneId === toSceneId) &&
              Math.abs((m.transition?.cutTime ?? m.start + m.duration / 2) - cutTime) < 1.0,
          ) ?? null;
        cuts.push({
          index: i,
          cutId,
          fromSceneId,
          toSceneId,
          fromDuration: a.duration || 3.0,
          toDuration: b.duration || 3.0,
          cutTime,
          appliedTransition: applied,
        });
      }
    }
    return cuts;
  };

  const discoverLayers = () => {
    const activeCompPath = deps.getActiveCompPath() || "index.html";
    const doc = resolvePreviewDoc();
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
        "applySceneTransition({ presetId, toSceneId?, fromSceneId?, cutIndex?, duration?, direction?, ease?, applyToAllCuts? })":
          "Apply a two-scene transition ('crossfade', 'push', 'wipe', 'reveal', 'split', 'zoom', 'morph') to a scene cut or all cuts. Returns cutId, startFrame, cutFrame, endFrame, saveStatus, and conflict info.",
        "updateMotion(motionId, patch)": "Update timing, duration, direction, distance, or ease.",
        "removeMotion(motionId)": "Remove a specific motion or transition by ID.",
        "removeSceneTransition({ toSceneId?, fromSceneId?, cutIndex? })":
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
        cutId: c.cutId,
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
          cutId: null,
          saveStatus: "rejected",
          manifestPath: MANIFEST_PATH,
          conflict: null,
          manifest: deps.getManifest(),
        };
      }

      if (options.duration !== undefined) {
        if (
          typeof options.duration !== "number" ||
          !Number.isFinite(options.duration) ||
          options.duration <= 0 ||
          options.duration > 5.0
        ) {
          return {
            ok: false,
            error: `Invalid transition duration '${String(options.duration)}'. Duration must be a finite number between 0.05s and 5.0s.`,
            cutId: null,
            saveStatus: "rejected",
            manifestPath: MANIFEST_PATH,
            conflict: null,
            manifest: deps.getManifest(),
          };
        }
      }

      const cuts = discoverSceneCuts();
      if (cuts.length === 0) {
        return {
          ok: false,
          error: "No scene cuts found in the active composition.",
          cutId: null,
          saveStatus: "rejected",
          manifestPath: MANIFEST_PATH,
          conflict: null,
          manifest: deps.getManifest(),
        };
      }

      const cleanFromId = options.fromSceneId?.replace(/^#/, "").trim() || undefined;
      const cleanToId = options.toSceneId?.replace(/^#/, "").trim() || undefined;
      const hasCutIndex = typeof options.cutIndex === "number";
      const hasExplicitSelector =
        cleanFromId !== undefined || cleanToId !== undefined || hasCutIndex;

      let targetCuts = cuts;
      if (!options.applyToAllCuts) {
        if (hasExplicitSelector) {
          if (hasCutIndex && !Number.isFinite(options.cutIndex)) {
            return {
              ok: false,
              error: `Invalid cutIndex '${String(options.cutIndex)}'.`,
              cutId: null,
              saveStatus: "rejected",
              manifestPath: MANIFEST_PATH,
              conflict: null,
              manifest: deps.getManifest(),
            };
          }
          const matched = cuts.find((c) => {
            if (hasCutIndex && c.index !== options.cutIndex) return false;
            if (cleanFromId !== undefined && c.fromSceneId !== cleanFromId) return false;
            if (cleanToId !== undefined && c.toSceneId !== cleanToId) return false;
            return true;
          });
          if (!matched) {
            return {
              ok: false,
              error: `Scene cut not found for ${JSON.stringify({
                fromSceneId: cleanFromId,
                toSceneId: cleanToId,
                cutIndex: options.cutIndex,
              })}. Available cuts: ${cuts.map((c) => `${c.cutId} (${c.fromSceneId}->${c.toSceneId} @ ${c.cutTime}s)`).join(", ")}.`,
              cutId: null,
              saveStatus: "rejected",
              manifestPath: MANIFEST_PATH,
              conflict: null,
              manifest: deps.getManifest(),
            };
          }
          targetCuts = [matched];
        } else {
          targetCuts = [cuts[0]!];
        }
      }

      const dur = options.duration ?? preset.defaultDuration;
      for (const cut of targetCuts) {
        const maxSceneDur = Math.min(cut.fromDuration, cut.toDuration);
        if (dur > maxSceneDur) {
          return {
            ok: false,
            error: `Invalid transition duration ${dur}s for ${cut.cutId}: exceeds adjacent scene duration (${maxSceneDur}s).`,
            cutId: cut.cutId,
            saveStatus: "rejected",
            manifestPath: MANIFEST_PATH,
            conflict: null,
            manifest: deps.getManifest(),
          };
        }
      }

      const stylePreset = options.stylePreset ?? deps.getActiveStylePreset();
      const transitionType = (preset.id.replace("transition-", "") || "crossfade") as NonNullable<
        StudioGsapMotion["transition"]
      >["type"];

      let nextManifest = deps.getManifest();
      const addedTransitions: StudioGsapMotion[] = [];
      const replacedTransitions: StudioGsapMotion[] = [];

      for (const cut of targetCuts) {
        const existingOnCut = nextManifest.motions.filter(
          (m) =>
            m.category === "transition" &&
            (m.target.id === cut.toSceneId ||
              m.transition?.toSceneId === cut.toSceneId ||
              (m.transition?.fromSceneId === cut.fromSceneId &&
                m.transition?.toSceneId === cut.toSceneId) ||
              Math.abs((m.transition?.cutTime ?? m.start + m.duration / 2) - cut.cutTime) < 0.5),
        );
        for (const existing of existingOnCut) {
          replacedTransitions.push(existing);
          if (existing.id) {
            nextManifest = removeStudioGsapMotionById(nextManifest, existing.id);
          }
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

      const primaryCut = targetCuts[0]!;
      const primaryTransition = addedTransitions[0];
      const lastAdded = addedTransitions.at(-1);
      if (lastAdded?.id) deps.setSelectedMotionId(lastAdded.id);
      if (primaryCut) deps.requestSeek(primaryCut.cutTime);

      let saveStatus: "saved" | "failed" = "saved";
      try {
        await deps.commitManifest(
          nextManifest,
          `Agent: Apply ${preset.name} transition (${dur}s) on ${primaryCut.cutId}`,
        );
      } catch {
        saveStatus = "failed";
      }

      const fps = resolveFps();
      const startTime =
        primaryTransition?.start ?? Math.max(0, Number((primaryCut.cutTime - dur / 2).toFixed(2)));
      const cutTime = primaryCut.cutTime;
      const endTime = Number((startTime + dur).toFixed(2));
      const startFrame = Math.round(startTime * fps);
      const cutFrame = Math.round(cutTime * fps);
      const endFrame = Math.round(endTime * fps);

      const conflict: HyperFramesAgentTransitionConflict | null =
        replacedTransitions.length > 0
          ? {
              hadExistingTransition: true,
              resolution: "replaced",
              replacedTransitionIds: replacedTransitions
                .map((m) => m.id)
                .filter((id): id is string => Boolean(id)),
              replacedTransitionNames: replacedTransitions.map(
                (m) => m.name || m.presetId || "Transition",
              ),
            }
          : null;

      return {
        ok: saveStatus === "saved",
        cutId: primaryCut.cutId,
        fromSceneId: primaryCut.fromSceneId,
        toSceneId: primaryCut.toSceneId,
        fps,
        startTime,
        cutTime,
        endTime,
        duration: dur,
        startFrame,
        cutFrame,
        endFrame,
        saveStatus,
        manifestPath: MANIFEST_PATH,
        conflict,
        transition: primaryTransition,
        transitions: addedTransitions,
        manifest: nextManifest,
      };
    },

    updateMotion: async (motionId, patch) => {
      const current = deps.getManifest();
      const existing = current.motions.find((m) => m.id === motionId);
      if (!existing) {
        return {
          ok: false,
          error: `Motion '${motionId}' not found`,
          saveStatus: "rejected",
          manifest: current,
        };
      }
      if (patch.duration !== undefined) {
        if (
          typeof patch.duration !== "number" ||
          !Number.isFinite(patch.duration) ||
          patch.duration <= 0 ||
          patch.duration > 5.0
        ) {
          return {
            ok: false,
            error: `Invalid duration '${String(patch.duration)}'. Duration must be a finite number between 0.05s and 5.0s.`,
            saveStatus: "rejected",
            manifest: current,
          };
        }
      }

      const effectivePatch: Partial<StudioElementMotionPayload> = { ...patch };
      if (
        existing.category === "transition" &&
        effectivePatch.duration !== undefined &&
        effectivePatch.start === undefined
      ) {
        const cutTime = existing.transition?.cutTime ?? existing.start + existing.duration / 2;
        effectivePatch.start = Math.max(
          0,
          Number((cutTime - effectivePatch.duration / 2).toFixed(2)),
        );
      }

      const nextManifest = updateStudioGsapMotionById(current, motionId, effectivePatch);
      const updated = nextManifest.motions.find((m) => m.id === motionId);
      let saveStatus: "saved" | "failed" = "saved";
      try {
        await deps.commitManifest(nextManifest, `Agent: Update motion ${motionId}`);
      } catch {
        saveStatus = "failed";
      }

      if (updated?.category === "transition") {
        const fps = resolveFps();
        const fromSceneId = updated.transition?.fromSceneId || "s01";
        const toSceneId = updated.transition?.toSceneId || updated.target.id || "s02";
        const cutId = `cut-${fromSceneId}-${toSceneId}`;
        const startTime = updated.start;
        const duration = updated.duration;
        const cutTime =
          updated.transition?.cutTime ?? Number((startTime + duration / 2).toFixed(2));
        const endTime = Number((startTime + duration).toFixed(2));
        return {
          ok: saveStatus === "saved",
          cutId,
          startTime,
          cutTime,
          endTime,
          duration,
          startFrame: Math.round(startTime * fps),
          cutFrame: Math.round(cutTime * fps),
          endFrame: Math.round(endTime * fps),
          saveStatus,
          motion: updated,
          manifest: nextManifest,
        };
      }

      return { ok: saveStatus === "saved", saveStatus, motion: updated, manifest: nextManifest };
    },

    removeMotion: async (motionId) => {
      const nextManifest = removeStudioGsapMotionById(deps.getManifest(), motionId);
      await deps.commitManifest(nextManifest, `Agent: Remove motion ${motionId}`);
      return { ok: true, manifest: nextManifest };
    },

    removeSceneTransition: async (options) => {
      const current = deps.getManifest();
      const cuts = discoverSceneCuts();
      const cleanFromId = options?.fromSceneId?.replace(/^#/, "").trim() || undefined;
      const cleanToId = options?.toSceneId?.replace(/^#/, "").trim() || undefined;
      const targetCut = options
        ? cuts.find(
            (c) =>
              (typeof options.cutIndex === "number" && c.index === options.cutIndex) ||
              (cleanToId && c.toSceneId === cleanToId) ||
              (cleanFromId && c.fromSceneId === cleanFromId),
          )
        : undefined;

      const toRemove = current.motions.filter((m) => {
        if (m.category !== "transition") return false;
        if (!cleanToId && !cleanFromId && typeof options?.cutIndex !== "number") return true;
        if (
          targetCut &&
          (m.target.id === targetCut.toSceneId || m.transition?.toSceneId === targetCut.toSceneId)
        )
          return true;
        if (cleanToId && (m.target.id === cleanToId || m.transition?.toSceneId === cleanToId))
          return true;
        if (cleanFromId && m.transition?.fromSceneId === cleanFromId) return true;
        return false;
      });

      let nextManifest = current;
      for (const item of toRemove) {
        if (item.id) nextManifest = removeStudioGsapMotionById(nextManifest, item.id);
      }
      let saveStatus: "saved" | "failed" = "saved";
      if (toRemove.length > 0) {
        try {
          await deps.commitManifest(
            nextManifest,
            `Agent: Remove ${toRemove.length} scene transition(s)`,
          );
        } catch {
          saveStatus = "failed";
        }
      }
      return {
        ok: saveStatus === "saved",
        removedCount: toRemove.length,
        saveStatus,
        manifest: nextManifest,
      };
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
