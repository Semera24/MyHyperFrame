import { useCallback, useEffect, useMemo, useState } from "react";
import { useStudioPlaybackContext, useStudioShellContext } from "../../contexts/StudioContext";
import { useFileManagerContext } from "../../contexts/FileManagerContext";
import { useDomEditContext } from "../../contexts/DomEditContext";
import { usePlayerStore } from "../../player";
import {
  MOTION_PRESET_CATALOG,
  MOTION_STYLE_PROFILES,
  STUDIO_MOTION_DRAG_MIME,
  compileMotionPreset,
  getMotionPresetById,
  reversePathWaypoints,
  type MotionPresetDefinition,
  type StudioMotionDragPayload,
} from "../editor/motionPresetCatalog";
import {
  STUDIO_GSAP_EASE_OPTIONS,
  STUDIO_MOTION_PATH,
  addStudioGsapMotion,
  applyStudioMotionManifest,
  duplicateStudioGsapMotionById,
  removeStudioGsapMotionById,
  reorderStudioGsapMotionById,
  selectionTarget,
  updateStudioGsapMotionById,
  type StudioElementMotionPayload,
  type StudioGsapMotion,
  type StudioGsapMotionDirection,
  type StudioMotionCategory,
  type StudioMotionPathPoint,
  type StudioMotionStylePreset,
  type StudioMotionTarget,
} from "../editor/studioMotion";
import {
  detectStudioMotionConflict,
  getMotionsForTarget,
  useStudioMotionStore,
} from "../editor/useStudioMotionStore";
import { computeSmartMotionStart, type MotionPlacementMode } from "../editor/studioMotionAgent";

// Global fallback for drag payload so synthetic DragEvents in automated tests or restricted webviews work reliably
let activeDraggedMotionPayload: StudioMotionDragPayload | null = null;
export function getActiveDraggedMotionPayload(): StudioMotionDragPayload | null {
  return activeDraggedMotionPayload;
}
export function setActiveDraggedMotionPayload(payload: StudioMotionDragPayload | null): void {
  activeDraggedMotionPayload = payload;
}

const CATEGORY_TABS: ReadonlyArray<{ id: "all" | StudioMotionCategory; label: string }> = [
  { id: "all", label: "All (48)" },
  { id: "entrance", label: "Entrance" },
  { id: "emphasis", label: "Emphasis" },
  { id: "exit", label: "Exit" },
  { id: "path", label: "Paths" },
  { id: "transition", label: "Transitions" },
];

const DIRECTION_OPTIONS: ReadonlyArray<{ value: StudioGsapMotionDirection; label: string }> = [
  { value: "up", label: "Up ↑" },
  { value: "down", label: "Down ↓" },
  { value: "left", label: "Left ←" },
  { value: "right", label: "Right →" },
  { value: "in", label: "In ⊕" },
  { value: "out", label: "Out ⊖" },
  { value: "cw", label: "Clockwise ↻" },
  { value: "ccw", label: "Counter-CW ↺" },
];

const CATEGORY_BADGE_COLORS: Record<StudioMotionCategory, string> = {
  entrance: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  emphasis: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  exit: "border-rose-500/40 bg-rose-500/15 text-rose-300",
  path: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  transition: "border-purple-500/40 bg-purple-500/15 text-purple-300",
};

function AnimatedPresetPreview({ preset }: { preset: MotionPresetDefinition }) {
  const cat = preset.category;
  return (
    <div className="relative flex h-11 w-full items-center justify-center overflow-hidden rounded bg-neutral-950/90 border border-neutral-800/80">
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(to right, #334155 1px, transparent 1px), linear-gradient(to bottom, #334155 1px, transparent 1px)",
          backgroundSize: "12px 12px",
        }}
      />
      {cat === "path" ? (
        <svg viewBox="0 0 80 36" className="h-full w-full">
          <path
            d={
              preset.id === "path-arc"
                ? "M 12 28 Q 40 4 68 26"
                : preset.id === "path-curve"
                  ? "M 12 24 C 30 4, 50 34, 68 12"
                  : preset.id === "path-turn"
                    ? "M 14 28 L 46 28 L 46 8"
                    : "M 12 24 L 68 12"
            }
            fill="none"
            stroke="#22d3ee"
            strokeWidth="1.5"
            strokeDasharray="3 2"
          />
          <circle cx="12" cy="24" r="2.5" fill="#64748b" />
          <circle cx="68" cy="14" r="3.5" fill="#22d3ee">
            <animate attributeName="r" values="2.5;4;2.5" dur="1.8s" repeatCount="indefinite" />
          </circle>
        </svg>
      ) : cat === "transition" ? (
        <div className="relative flex h-7 w-16 items-center justify-center overflow-hidden rounded border border-purple-500/40 bg-neutral-900">
          <div className="absolute inset-y-0 left-0 w-1/2 bg-purple-900/40 text-[8px] font-mono text-purple-300 flex items-center justify-center">
            S1
          </div>
          <div className="absolute inset-y-0 right-0 w-1/2 bg-indigo-500/30 text-[8px] font-mono text-indigo-200 flex items-center justify-center">
            S2
          </div>
          <div className="z-10 h-full w-0.5 bg-purple-400 shadow-[0_0_6px_#c084fc] animate-pulse" />
        </div>
      ) : (
        <div
          className={`flex h-6 w-14 items-center justify-center rounded border px-1 text-[9px] font-mono font-semibold shadow-sm transition-transform duration-500 group-hover:scale-110 ${
            cat === "entrance"
              ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-200 group-hover:-translate-y-0.5"
              : cat === "emphasis"
                ? "border-amber-500/50 bg-amber-500/20 text-amber-200 group-hover:rotate-3"
                : "border-rose-500/50 bg-rose-500/20 text-rose-200 group-hover:opacity-60"
          }`}
        >
          <span className="truncate">{preset.name}</span>
        </div>
      )}
      {preset.family === "core-batch-1" && (
        <span className="absolute top-1 right-1 rounded bg-amber-500/20 px-1 py-0.2 text-[8px] font-mono text-amber-300 border border-amber-500/30">
          CORE
        </span>
      )}
    </div>
  );
}

export interface MotionLibraryPanelProps {
  recordEdit?: (entry: {
    label: string;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
}

export function MotionLibraryPanel({ recordEdit }: MotionLibraryPanelProps) {
  const {
    projectId,
    activeCompPath,
    previewIframeRef,
    showToast,
    editHistory,
    handleUndo,
    handleRedo,
  } = useStudioShellContext();
  const { timelineElements } = useStudioPlaybackContext();
  const { readOptionalProjectFile, writeProjectFile } = useFileManagerContext();
  const { domEditSelection } = useDomEditContext();

  const currentTime = usePlayerStore((s) => s.currentTime);
  const requestSeek = usePlayerStore((s) => s.requestSeek);

  const {
    manifest,
    selectedMotionId,
    activeStylePreset,
    pendingConflict,
    undoStack,
    redoStack,
    setProjectManifest,
    commitManifest,
    undoMotion,
    redoMotion,
    setSelectedMotionId,
    setActiveStylePreset,
    setPendingConflict,
    setRecordEditRef,
  } = useStudioMotionStore();

  useEffect(() => {
    setRecordEditRef(recordEdit);
  }, [recordEdit, setRecordEditRef]);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<"all" | StudioMotionCategory>("all");
  const [manualTargetId, setManualTargetId] = useState<string>("");
  const [placementMode, setPlacementMode] = useState<MotionPlacementMode>("playhead");

  const selectedTimelineClip = usePlayerStore((s) =>
    s.elements.find((el) => {
      const key = el.key ?? el.id;
      return s.selectedElementIds instanceof Set
        ? s.selectedElementIds.has(key) || s.selectedElementIds.has(el.id)
        : Array.isArray(s.selectedElementIds) &&
            ((s.selectedElementIds as string[]).includes(key) ||
              (s.selectedElementIds as string[]).includes(el.id));
    }),
  );

  const addressableTargets = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{
      id: string;
      label: string;
      sourceFile: string;
      start: number;
      duration: number;
    }> = [];
    for (const el of timelineElements) {
      const rawId = el.domId || el.id.split("/").pop() || el.id;
      if (!rawId || seen.has(rawId)) continue;
      seen.add(rawId);
      list.push({
        id: rawId,
        label: el.label || rawId,
        sourceFile: el.sourceFile || el.compositionSrc || activeCompPath || "index.html",
        start: el.start,
        duration: el.duration,
      });
    }
    return list;
  }, [timelineElements, activeCompPath]);

  // Load studio-motion.json on mount / project switch & listen for Undo/Redo updates
  useEffect(() => {
    let cancelled = false;
    void readOptionalProjectFile(STUDIO_MOTION_PATH)
      .then((content) => {
        if (!cancelled) {
          const currentStore = useStudioMotionStore.getState();
          if (
            currentStore.projectId === projectId &&
            currentStore.manifest.motions.length > 0 &&
            !(content ?? "").trim()
          ) {
            return;
          }
          setProjectManifest(projectId, content ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          const currentStore = useStudioMotionStore.getState();
          if (currentStore.projectId === projectId && currentStore.manifest.motions.length > 0) {
            return;
          }
          setProjectManifest(projectId, "");
        }
      });

    const onMotionUpdated = (e: Event) => {
      const custom = e as CustomEvent<{ content?: string }>;
      const nextRaw = custom.detail?.content ?? "";
      setProjectManifest(projectId, nextRaw);
    };
    window.addEventListener("hf:studio-motion-updated", onMotionUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("hf:studio-motion-updated", onMotionUpdated);
    };
  }, [projectId, readOptionalProjectFile, setProjectManifest]);

  const filteredPresets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return MOTION_PRESET_CATALOG.filter((preset) => {
      if (selectedCategory !== "all" && preset.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        preset.name.toLowerCase().includes(q) ||
        preset.summary.toLowerCase().includes(q) ||
        preset.category.toLowerCase().includes(q) ||
        preset.id.toLowerCase().includes(q)
      );
    });
  }, [searchQuery, selectedCategory]);

  // Determine active target from explicit dropdown, DOM selection, timeline selection, or active motion entry
  const selectedTarget = useMemo<StudioMotionTarget | null>(() => {
    if (manualTargetId) {
      const match = addressableTargets.find((t) => t.id === manualTargetId);
      return {
        sourceFile: match?.sourceFile || activeCompPath || "index.html",
        id: manualTargetId,
        selector: `#${manualTargetId}`,
      };
    }
    if (domEditSelection) {
      return selectionTarget(domEditSelection);
    }
    if (selectedTimelineClip) {
      const rawId =
        selectedTimelineClip.domId ||
        selectedTimelineClip.id.split("/").pop() ||
        selectedTimelineClip.id;
      if (rawId) {
        return {
          sourceFile:
            selectedTimelineClip.sourceFile ||
            selectedTimelineClip.compositionSrc ||
            activeCompPath ||
            "index.html",
          id: rawId,
          selector: `#${rawId}`,
        };
      }
    }
    if (selectedMotionId) {
      const found = manifest.motions.find((m) => m.id === selectedMotionId);
      if (found) return found.target;
    }
    return null;
  }, [
    manualTargetId,
    addressableTargets,
    activeCompPath,
    domEditSelection,
    selectedTimelineClip,
    selectedMotionId,
    manifest.motions,
  ]);

  const selectedTargetMotions = useMemo<StudioGsapMotion[]>(() => {
    return getMotionsForTarget(manifest, selectedTarget);
  }, [manifest, selectedTarget]);

  const activeMotion = useMemo<StudioGsapMotion | null>(() => {
    if (selectedMotionId) {
      const found = manifest.motions.find((m) => m.id === selectedMotionId);
      if (found) return found;
    }
    if (selectedTargetMotions.length > 0) {
      return selectedTargetMotions[selectedTargetMotions.length - 1]!;
    }
    if (manifest.motions.length > 0) {
      return manifest.motions[manifest.motions.length - 1]!;
    }
    return null;
  }, [selectedMotionId, manifest.motions, selectedTargetMotions]);

  const applyMotionToTarget = useCallback(
    async (
      target: StudioMotionTarget,
      payload: StudioElementMotionPayload,
      mode: "check" | "replace" | "combine" = "check",
    ) => {
      const iframeDoc = previewIframeRef.current?.contentDocument ?? null;

      if (mode === "check") {
        const conflict = detectStudioMotionConflict(manifest, target, payload, iframeDoc);
        if (conflict) {
          setPendingConflict(conflict);
          return;
        }
      }

      let workingManifest = manifest;
      let finalPayload: StudioElementMotionPayload = { ...payload };

      if (mode === "replace") {
        const conflict = detectStudioMotionConflict(manifest, target, payload, iframeDoc);
        if (conflict) {
          for (const cid of conflict.conflictingMotionIds) {
            workingManifest = removeStudioGsapMotionById(workingManifest, cid);
          }
        }
      } else if (mode === "combine") {
        const existing = getMotionsForTarget(workingManifest, target);
        if (existing.length > 0) {
          const maxEnd = Math.max(...existing.map((m) => m.start + (m.delay ?? 0) + m.duration));
          if (finalPayload.start < maxEnd) {
            finalPayload = {
              ...finalPayload,
              start: Number(maxEnd.toFixed(2)),
            };
          }
        }
      }

      const nextManifest = addStudioGsapMotion(workingManifest, target, finalPayload);
      const newest = nextManifest.motions[nextManifest.motions.length - 1];
      if (newest?.id) {
        setSelectedMotionId(newest.id);
      }

      const targetName = target.id || target.selector || "element";
      const label = `Apply ${finalPayload.name || finalPayload.presetId} to #${targetName}`;

      await commitManifest(nextManifest, label, {
        writeProjectFile,
        recordEdit,
        iframeDoc,
        activeCompPath,
        currentTime,
      });
      showToast(label, "info");
    },
    [
      previewIframeRef,
      manifest,
      setPendingConflict,
      setSelectedMotionId,
      commitManifest,
      writeProjectFile,
      recordEdit,
      activeCompPath,
      currentTime,
      showToast,
    ],
  );

  // Determine nearest scene boundary for scene transitions
  const findSceneTransitionTarget = useCallback((): {
    target: StudioMotionTarget;
    cutTime: number;
    fromSceneId: string;
    toSceneId: string;
  } | null => {
    const iframeDoc = previewIframeRef.current?.contentDocument;
    const sceneEls = timelineElements.filter(
      (el) => el.duration > 0 && (el.id.startsWith("s0") || el.tag === "div"),
    );

    if (iframeDoc) {
      const subComps = Array.from(
        iframeDoc.querySelectorAll<HTMLElement>("[data-composition-id][data-start]"),
      ).filter((el) => el.getAttribute("data-composition-id") !== "master");

      if (subComps.length >= 2) {
        let bestPair = {
          first: subComps[0]!,
          second: subComps[1]!,
          cutTime: Number(subComps[1]!.getAttribute("data-start") || 12),
        };
        let minDiff = Math.abs(currentTime - bestPair.cutTime);
        for (let i = 0; i < subComps.length - 1; i++) {
          const a = subComps[i]!;
          const b = subComps[i + 1]!;
          const cut = Number(b.getAttribute("data-start") || 12);
          const diff = Math.abs(currentTime - cut);
          if (diff < minDiff) {
            minDiff = diff;
            bestPair = { first: a, second: b, cutTime: cut };
          }
        }
        const toId = bestPair.second.id || bestPair.second.getAttribute("data-hf-id") || "s02";
        const fromId = bestPair.first.id || bestPair.first.getAttribute("data-hf-id") || "s01";
        return {
          target: {
            sourceFile: activeCompPath || "index.html",
            id: toId,
            selector: `#${toId}`,
          },
          cutTime: bestPair.cutTime,
          fromSceneId: fromId,
          toSceneId: toId,
        };
      }
    }

    if (sceneEls.length >= 2) {
      const sorted = [...sceneEls].sort((a, b) => a.start - b.start);
      const second = sorted[1]!;
      const toId = second.domId || second.id;
      return {
        target: {
          sourceFile: activeCompPath || "index.html",
          id: toId,
          selector: `#${toId}`,
        },
        cutTime: second.start,
        fromSceneId: sorted[0]!.domId || sorted[0]!.id,
        toSceneId: toId,
      };
    }

    return null;
  }, [previewIframeRef, timelineElements, currentTime, activeCompPath]);

  const handleApplyPresetCard = useCallback(
    async (preset: MotionPresetDefinition) => {
      if (preset.category === "transition") {
        const seam = findSceneTransitionTarget();
        if (!seam) {
          showToast("Select a multi-scene timeline or drop onto a scene cut.", "error");
          return;
        }
        const dur = preset.defaultDuration;
        const start = Math.max(0, Number((seam.cutTime - dur / 2).toFixed(2)));
        const transitionType = (preset.id.replace("transition-", "") || "crossfade") as
          | "cut"
          | "crossfade"
          | "push"
          | "wipe"
          | "reveal"
          | "split"
          | "zoom"
          | "morph";
        const compiled = compileMotionPreset(preset.id, {
          start,
          duration: dur,
          stylePreset: activeStylePreset,
          transition: {
            fromSceneId: seam.fromSceneId,
            toSceneId: seam.toSceneId,
            cutTime: seam.cutTime,
            type: transitionType,
          },
        });
        await applyMotionToTarget(seam.target, compiled, "replace");
        requestSeek(seam.cutTime);
        return;
      }

      if (!selectedTarget) {
        showToast(
          "Select an image, text, card, or map element first, or drag onto a timeline track.",
          "info",
        );
        return;
      }

      const targetMeta = addressableTargets.find((t) => t.id === selectedTarget.id);
      const start = computeSmartMotionStart({
        category: preset.category,
        duration: preset.defaultDuration,
        clipStart: targetMeta?.start ?? 0,
        clipDuration: targetMeta?.duration ?? 3.0,
        placement: placementMode,
        playheadTime: currentTime,
      });

      const compiled = compileMotionPreset(preset.id, {
        start,
        stylePreset: activeStylePreset,
      });
      await applyMotionToTarget(selectedTarget, compiled, "check");
    },
    [
      findSceneTransitionTarget,
      selectedTarget,
      addressableTargets,
      placementMode,
      activeStylePreset,
      currentTime,
      applyMotionToTarget,
      requestSeek,
      showToast,
    ],
  );

  const handleHoverPreset = useCallback(
    (preset: MotionPresetDefinition | null) => {
      const iframeDoc = previewIframeRef.current?.contentDocument;
      if (!iframeDoc || !selectedTarget) return;
      if (!preset || preset.category === "transition") {
        applyStudioMotionManifest(iframeDoc, manifest, activeCompPath, currentTime);
        return;
      }
      const previewPayload = compileMotionPreset(preset.id, {
        start: Math.max(0, currentTime - preset.defaultDuration * 0.45),
        stylePreset: activeStylePreset,
      });
      const tempManifest = addStudioGsapMotion(manifest, selectedTarget, previewPayload);
      applyStudioMotionManifest(iframeDoc, tempManifest, activeCompPath, currentTime);
    },
    [previewIframeRef, selectedTarget, manifest, activeCompPath, currentTime, activeStylePreset],
  );

  const handleUpdateActiveMotion = useCallback(
    async (patch: Partial<StudioElementMotionPayload>, label = "Adjust motion parameters") => {
      if (!activeMotion?.id) return;
      const nextManifest = updateStudioGsapMotionById(manifest, activeMotion.id, patch);
      await commitManifest(nextManifest, label, {
        writeProjectFile,
        recordEdit,
        iframeDoc: previewIframeRef.current?.contentDocument ?? null,
        activeCompPath,
        currentTime,
      });
    },
    [
      activeMotion,
      manifest,
      commitManifest,
      writeProjectFile,
      recordEdit,
      previewIframeRef,
      activeCompPath,
      currentTime,
    ],
  );

  const handleStylePresetChangeForActiveMotion = useCallback(
    async (stylePreset: StudioMotionStylePreset) => {
      setActiveStylePreset(stylePreset);
      if (!activeMotion?.id) return;
      const catalogEntry = activeMotion.presetId
        ? getMotionPresetById(activeMotion.presetId)
        : undefined;
      if (!catalogEntry) {
        await handleUpdateActiveMotion({ stylePreset }, `Set style preset to ${stylePreset}`);
        return;
      }
      const recompiled = compileMotionPreset(catalogEntry.id, {
        id: activeMotion.id,
        start: activeMotion.start,
        delay: activeMotion.delay,
        holdDuration: activeMotion.holdDuration,
        direction: activeMotion.direction,
        stylePreset,
      });
      await handleUpdateActiveMotion(
        {
          ...recompiled,
          start: activeMotion.start,
        },
        `Apply ${MOTION_STYLE_PROFILES[stylePreset].label} style to ${catalogEntry.name}`,
      );
    },
    [setActiveStylePreset, activeMotion, handleUpdateActiveMotion],
  );

  const handleDirectionChangeForActiveMotion = useCallback(
    async (direction: StudioGsapMotionDirection) => {
      if (!activeMotion?.id) return;
      const catalogEntry = activeMotion.presetId
        ? getMotionPresetById(activeMotion.presetId)
        : undefined;
      if (catalogEntry) {
        const recompiled = compileMotionPreset(catalogEntry.id, {
          id: activeMotion.id,
          start: activeMotion.start,
          duration: activeMotion.duration,
          delay: activeMotion.delay,
          holdDuration: activeMotion.holdDuration,
          direction,
          distance: activeMotion.distance,
          stylePreset: activeMotion.stylePreset ?? activeStylePreset,
          ease: activeMotion.ease,
        });
        await handleUpdateActiveMotion(recompiled, `Set motion direction to ${direction}`);
      } else {
        await handleUpdateActiveMotion({ direction }, `Set motion direction to ${direction}`);
      }
    },
    [activeMotion, activeStylePreset, handleUpdateActiveMotion],
  );

  const handleDistanceChangeForActiveMotion = useCallback(
    async (distance: number) => {
      if (!activeMotion?.id) return;
      const catalogEntry = activeMotion.presetId
        ? getMotionPresetById(activeMotion.presetId)
        : undefined;
      if (catalogEntry) {
        const recompiled = compileMotionPreset(catalogEntry.id, {
          id: activeMotion.id,
          start: activeMotion.start,
          duration: activeMotion.duration,
          delay: activeMotion.delay,
          holdDuration: activeMotion.holdDuration,
          direction: activeMotion.direction,
          distance,
          stylePreset: activeMotion.stylePreset ?? activeStylePreset,
          ease: activeMotion.ease,
        });
        await handleUpdateActiveMotion(recompiled, `Set motion distance to ${distance}px`);
      } else {
        await handleUpdateActiveMotion({ distance }, `Set motion distance to ${distance}px`);
      }
    },
    [activeMotion, activeStylePreset, handleUpdateActiveMotion],
  );

  const handleDuplicateMotion = useCallback(
    async (motionId: string) => {
      const { manifest: nextManifest, duplicatedId } = duplicateStudioGsapMotionById(
        manifest,
        motionId,
      );
      if (duplicatedId) setSelectedMotionId(duplicatedId);
      await commitManifest(nextManifest, "Duplicate motion effect", {
        writeProjectFile,
        recordEdit,
        iframeDoc: previewIframeRef.current?.contentDocument ?? null,
        activeCompPath,
        currentTime,
      });
      showToast("Duplicated motion effect", "info");
    },
    [
      manifest,
      setSelectedMotionId,
      commitManifest,
      writeProjectFile,
      recordEdit,
      previewIframeRef,
      activeCompPath,
      currentTime,
      showToast,
    ],
  );

  const handleRemoveMotion = useCallback(
    async (motionId: string) => {
      const nextManifest = removeStudioGsapMotionById(manifest, motionId);
      if (selectedMotionId === motionId) {
        setSelectedMotionId(null);
      }
      await commitManifest(nextManifest, "Remove motion effect", {
        writeProjectFile,
        recordEdit,
        iframeDoc: previewIframeRef.current?.contentDocument ?? null,
        activeCompPath,
        currentTime,
      });
      showToast("Removed motion effect", "info");
    },
    [
      manifest,
      selectedMotionId,
      setSelectedMotionId,
      commitManifest,
      writeProjectFile,
      recordEdit,
      previewIframeRef,
      activeCompPath,
      currentTime,
      showToast,
    ],
  );

  const handleReorderMotion = useCallback(
    async (motionId: string, dir: "up" | "down") => {
      const nextManifest = reorderStudioGsapMotionById(manifest, motionId, dir);
      await commitManifest(nextManifest, `Reorder motion ${dir}`, {
        writeProjectFile,
        recordEdit,
        iframeDoc: previewIframeRef.current?.contentDocument ?? null,
        activeCompPath,
        currentTime,
      });
    },
    [
      manifest,
      commitManifest,
      writeProjectFile,
      recordEdit,
      previewIframeRef,
      activeCompPath,
      currentTime,
    ],
  );

  const activeMotionCatalog = activeMotion?.presetId
    ? getMotionPresetById(activeMotion.presetId)
    : undefined;

  const displayedMotions =
    selectedTargetMotions.length > 0 ? selectedTargetMotions : manifest.motions;

  return (
    <div
      data-testid="motion-library-panel"
      className="flex h-full min-h-0 flex-col bg-neutral-950 text-neutral-100 select-none overflow-hidden"
    >
      {/* Top Header + Undo/Redo Bar */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 bg-neutral-900/60">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold tracking-wide text-amber-300">
              ✨ MOTION LIBRARY
            </span>
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
              {MOTION_PRESET_CATALOG.length} Presets
            </span>
          </div>
          <p className="text-[10px] text-neutral-400">
            Drag onto a timeline track, scene cut, or canvas object
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="motion-undo-btn"
            disabled={undoStack.length === 0 && !editHistory.canUndo}
            onClick={() => {
              if (undoStack.length > 0) {
                void undoMotion({
                  writeProjectFile,
                  recordEdit,
                  iframeDoc: previewIframeRef.current?.contentDocument ?? null,
                  activeCompPath,
                  currentTime,
                }).then((label) => {
                  if (label) showToast(`Undid: ${label}`, "info");
                });
              } else {
                void handleUndo();
              }
            }}
            title={
              undoStack.length > 0
                ? `Undo: ${undoStack[undoStack.length - 1]!.label}`
                : editHistory.undoLabel
                  ? `Undo: ${editHistory.undoLabel}`
                  : "Undo"
            }
            className="rounded border border-neutral-700 bg-neutral-800/80 px-2 py-1 text-[10px] font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
          >
            ↶ Undo
          </button>
          <button
            type="button"
            data-testid="motion-redo-btn"
            disabled={redoStack.length === 0 && !editHistory.canRedo}
            onClick={() => {
              if (redoStack.length > 0) {
                void redoMotion({
                  writeProjectFile,
                  recordEdit,
                  iframeDoc: previewIframeRef.current?.contentDocument ?? null,
                  activeCompPath,
                  currentTime,
                }).then((label) => {
                  if (label) showToast(`Redid: ${label}`, "info");
                });
              } else {
                void handleRedo();
              }
            }}
            title={
              redoStack.length > 0
                ? `Redo: ${redoStack[redoStack.length - 1]!.label}`
                : editHistory.redoLabel
                  ? `Redo: ${editHistory.redoLabel}`
                  : "Redo"
            }
            className="rounded border border-neutral-700 bg-neutral-800/80 px-2 py-1 text-[10px] font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
          >
            ↷ Redo
          </button>
        </div>
      </div>

      {/* Style Profile Bar (Subtle / Documentary / Energetic) */}
      <div className="border-b border-neutral-800 bg-neutral-900/30 px-3 py-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
            Pacing Profile (Turning Point Stories)
          </span>
          <span className="text-[10px] text-amber-300/90 font-medium">
            {MOTION_STYLE_PROFILES[activeStylePreset].label}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {(["subtle", "documentary", "energetic"] as const).map((styleId) => {
            const prof = MOTION_STYLE_PROFILES[styleId];
            const isActive = activeStylePreset === styleId;
            return (
              <button
                key={styleId}
                type="button"
                data-testid={`motion-style-preset-${styleId}`}
                onClick={() => void handleStylePresetChangeForActiveMotion(styleId)}
                className={`rounded border px-2 py-1 text-left transition-colors ${
                  isActive
                    ? "border-amber-400/70 bg-amber-500/15 text-amber-200"
                    : "border-neutral-800 bg-neutral-900/70 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                }`}
              >
                <div className="text-[10px] font-semibold">{prof.label}</div>
                <div className="truncate text-[9px] opacity-75">
                  {styleId === "subtle"
                    ? "Gentle · 65% dist"
                    : styleId === "documentary"
                      ? "Default · Measured"
                      : "Brisk · 140% dist"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search + Category Tabs */}
      <div className="border-b border-neutral-800 px-3 py-2 space-y-2">
        <div className="relative">
          <input
            type="text"
            data-testid="motion-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="Search Entrance, Emphasis, Exit, Paths, Wipe, Morph..."
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-100 placeholder-neutral-500 focus:border-amber-400 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {CATEGORY_TABS.map((tab) => {
            const active = selectedCategory === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`motion-category-tab-${tab.id}`}
                onClick={() => setSelectedCategory(tab.id)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  active
                    ? "bg-amber-400 text-neutral-950 font-semibold"
                    : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Scrollable Split Area: Preset Gallery + Inspector */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-neutral-800">
        {/* Preset Gallery Grid */}
        <div className="p-3 flex-1 min-h-[300px] overflow-y-auto">
          <div className="mb-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                Preset Gallery ({filteredPresets.length})
              </span>
              <span className="text-[10px] font-mono text-amber-300/90">
                {selectedTarget
                  ? `Target: #${selectedTarget.id || selectedTarget.selector}`
                  : "No element selected"}
              </span>
            </div>
            {/* AI Agent & Quick Target / Placement Selector Bar */}
            <div className="grid grid-cols-2 gap-1.5 rounded border border-neutral-800 bg-neutral-900/60 p-1.5">
              <label className="flex flex-col gap-0.5 text-[9px] text-neutral-400">
                <span>Target Layer</span>
                <select
                  data-testid="motion-target-select"
                  value={manualTargetId || selectedTarget?.id || ""}
                  onChange={(e) => setManualTargetId(e.currentTarget.value)}
                  className="rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-[10px] text-neutral-100 focus:border-amber-400 focus:outline-none"
                >
                  <option value="">
                    {selectedTarget?.id
                      ? `Selected (#${selectedTarget.id})`
                      : "Select target layer..."}
                  </option>
                  {addressableTargets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} (#{t.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-[9px] text-neutral-400">
                <span>Click Placement</span>
                <select
                  data-testid="motion-placement-select"
                  value={placementMode}
                  onChange={(e) => setPlacementMode(e.currentTarget.value as MotionPlacementMode)}
                  className="rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-[10px] text-neutral-100 focus:border-amber-400 focus:outline-none"
                >
                  <option value="playhead">At Playhead ({currentTime.toFixed(1)}s)</option>
                  <option value="auto">Smart Auto (In/Mid/Out)</option>
                  <option value="start">Layer Start</option>
                  <option value="end">Layer End</option>
                </select>
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 pr-1">
            {filteredPresets.map((preset) => (
              <div
                key={preset.id}
                data-testid={`motion-preset-card-${preset.id}`}
                draggable
                onDragStart={(e) => {
                  const payload: StudioMotionDragPayload = {
                    presetId: preset.id,
                    category: preset.category,
                    stylePreset: activeStylePreset,
                  };
                  setActiveDraggedMotionPayload(payload);
                  e.dataTransfer.setData(STUDIO_MOTION_DRAG_MIME, JSON.stringify(payload));
                  e.dataTransfer.setData("text/plain", JSON.stringify(payload));
                  e.dataTransfer.effectAllowed = "copyMove";
                }}
                onDragEnd={() => {
                  setActiveDraggedMotionPayload(null);
                }}
                onMouseEnter={() => handleHoverPreset(preset)}
                onMouseLeave={() => handleHoverPreset(null)}
                onClick={() => void handleApplyPresetCard(preset)}
                className="group cursor-grab active:cursor-grabbing rounded-md border border-neutral-800 bg-neutral-900/70 p-2 transition-all hover:border-amber-400/60 hover:bg-neutral-900"
              >
                <AnimatedPresetPreview preset={preset} />
                <div className="mt-1.5 flex items-center justify-between gap-1">
                  <span className="truncate text-[11px] font-semibold text-neutral-100">
                    {preset.name}
                  </span>
                  <span
                    className={`shrink-0 rounded border px-1 py-0.2 text-[8px] font-mono uppercase ${
                      CATEGORY_BADGE_COLORS[preset.category]
                    }`}
                  >
                    {preset.category}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-1 text-[9px] text-neutral-400">{preset.summary}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Applied Motions Stack + Parameter Inspector */}
        <div data-testid="motion-inspector" className="p-3 space-y-3 bg-neutral-950">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-amber-300">
              Applied Motions & Inspector
            </span>
            <span className="text-[10px] font-mono text-neutral-400">
              {manifest.motions.length} active in project
            </span>
          </div>

          {displayedMotions.length === 0 ? (
            <div className="rounded border border-dashed border-neutral-800 p-3 text-center text-[11px] text-neutral-400">
              Drag any preset onto a timeline track, scene boundary, or canvas element to create an
              editable motion block.
            </div>
          ) : (
            <div className="space-y-1.5" data-testid="applied-motions-list">
              {displayedMotions.map((motion, idx, arr) => {
                const motionId = motion.id ?? `m-${idx}`;
                const isSelected = activeMotion?.id === motion.id;
                const cat = motion.category ?? "entrance";
                return (
                  <div
                    key={motionId}
                    data-testid={`applied-motion-item-${motionId}`}
                    onClick={() => {
                      if (motion.id) setSelectedMotionId(motion.id);
                      requestSeek(
                        Number(
                          (motion.start + (motion.delay ?? 0) + motion.duration * 0.5).toFixed(2),
                        ),
                      );
                    }}
                    className={`flex items-center justify-between rounded border px-2 py-1.5 cursor-pointer transition-colors ${
                      isSelected
                        ? "border-amber-400 bg-amber-500/10"
                        : "border-neutral-800 bg-neutral-900/70 hover:border-neutral-700"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[9px] text-neutral-400">#{idx + 1}</span>
                        <span
                          className={`rounded border px-1 py-0.2 text-[8px] font-mono uppercase ${
                            CATEGORY_BADGE_COLORS[cat]
                          }`}
                        >
                          {cat}
                        </span>
                        <span className="truncate text-xs font-semibold text-neutral-100">
                          {motion.name || motion.presetId || "Motion"}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-neutral-400">
                        #{motion.target.id || motion.target.selector} · {motion.start.toFixed(2)}s →{" "}
                        {(motion.start + (motion.delay ?? 0) + motion.duration).toFixed(2)}s (
                        {motion.duration.toFixed(2)}s)
                      </div>
                    </div>

                    {motion.id && (
                      <div
                        className="flex items-center gap-1 ml-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          data-testid={`motion-order-up-${motion.id}`}
                          disabled={idx === 0}
                          onClick={() => void handleReorderMotion(motion.id!, "up")}
                          title="Move earlier in sequence"
                          className="rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-[10px] hover:bg-neutral-700 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          data-testid={`motion-order-down-${motion.id}`}
                          disabled={idx === arr.length - 1}
                          onClick={() => void handleReorderMotion(motion.id!, "down")}
                          title="Move later in sequence"
                          className="rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-[10px] hover:bg-neutral-700 disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          data-testid={`motion-duplicate-${motion.id}`}
                          onClick={() => void handleDuplicateMotion(motion.id!)}
                          title="Duplicate motion"
                          className="rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-neutral-700"
                        >
                          ⧉
                        </button>
                        <button
                          type="button"
                          data-testid={`motion-remove-${motion.id}`}
                          onClick={() => void handleRemoveMotion(motion.id!)}
                          title="Remove motion"
                          className="rounded border border-rose-800/60 bg-rose-950/50 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-900/60"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Parameter Controls for Active Motion */}
          {activeMotion && (
            <div
              data-testid="active-motion-controls"
              className="rounded-md border border-neutral-800 bg-neutral-900/60 p-2.5 space-y-2.5"
            >
              <div className="flex items-center justify-between border-b border-neutral-800 pb-1.5">
                <div>
                  <span className="text-xs font-semibold text-amber-300">
                    {activeMotion.name || activeMotion.presetId}
                  </span>
                  <span className="ml-2 font-mono text-[10px] text-neutral-400">
                    on #{activeMotion.target.id || activeMotion.target.selector}
                  </span>
                </div>
                <span className="font-mono text-[9px] text-neutral-400">ID: {activeMotion.id}</span>
              </div>

              {/* Timing Grid: Start, Duration, Delay, Hold */}
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] font-mono text-neutral-400">Start Time (s)</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    data-testid="motion-input-start"
                    value={activeMotion.start}
                    onChange={(e) => {
                      const val = Math.max(0, Number(e.currentTarget.value) || 0);
                      void handleUpdateActiveMotion({ start: val }, `Set motion start to ${val}s`);
                    }}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100"
                  />
                </label>

                <label className="block">
                  <span className="text-[10px] font-mono text-neutral-400">Duration (s)</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0.05"
                    data-testid="motion-input-duration"
                    value={activeMotion.duration}
                    onChange={(e) => {
                      const val = Math.max(0.05, Number(e.currentTarget.value) || 0.05);
                      void handleUpdateActiveMotion(
                        { duration: val },
                        `Set motion duration to ${val}s`,
                      );
                    }}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100"
                  />
                </label>

                <label className="block">
                  <span className="text-[10px] font-mono text-neutral-400">Delay (s)</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    data-testid="motion-input-delay"
                    value={activeMotion.delay ?? 0}
                    onChange={(e) => {
                      const val = Math.max(0, Number(e.currentTarget.value) || 0);
                      void handleUpdateActiveMotion({ delay: val }, `Set motion delay to ${val}s`);
                    }}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100"
                  />
                </label>

                <label className="block">
                  <span className="text-[10px] font-mono text-neutral-400">Hold Time (s)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    data-testid="motion-input-hold"
                    value={activeMotion.holdDuration ?? 0}
                    onChange={(e) => {
                      const val = Math.max(0, Number(e.currentTarget.value) || 0);
                      void handleUpdateActiveMotion(
                        { holdDuration: val },
                        `Set motion hold time to ${val}s`,
                      );
                    }}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100"
                  />
                </label>
              </div>

              {/* Easing + Direction */}
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] font-mono text-neutral-400">Easing</span>
                  <select
                    data-testid="motion-select-ease"
                    value={activeMotion.ease}
                    onChange={(e) =>
                      void handleUpdateActiveMotion(
                        { ease: e.currentTarget.value },
                        `Set motion ease to ${e.currentTarget.value}`,
                      )
                    }
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100"
                  >
                    {STUDIO_GSAP_EASE_OPTIONS.map((ease) => (
                      <option key={ease} value={ease}>
                        {ease}
                      </option>
                    ))}
                  </select>
                </label>

                {(activeMotionCatalog?.supportsDirection || activeMotion.direction) && (
                  <label className="block">
                    <span className="text-[10px] font-mono text-neutral-400">Direction</span>
                    <select
                      data-testid="motion-select-direction"
                      value={activeMotion.direction ?? "up"}
                      onChange={(e) =>
                        void handleDirectionChangeForActiveMotion(
                          e.currentTarget.value as StudioGsapMotionDirection,
                        )
                      }
                      className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100"
                    >
                      {DIRECTION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {/* Distance, Scale, Rotation, Opacity */}
              <div className="grid grid-cols-2 gap-2">
                {(activeMotionCatalog?.supportsDistance || activeMotion.distance !== undefined) && (
                  <label className="block">
                    <span className="text-[10px] font-mono text-neutral-400">Distance (px)</span>
                    <input
                      type="number"
                      step="4"
                      min="0"
                      data-testid="motion-input-distance"
                      value={activeMotion.distance ?? 48}
                      onChange={(e) => {
                        const val = Math.max(0, Number(e.currentTarget.value) || 0);
                        void handleDistanceChangeForActiveMotion(val);
                      }}
                      className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100"
                    />
                  </label>
                )}

                <label className="block">
                  <span className="text-[10px] font-mono text-neutral-400">Start Scale</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="4"
                    data-testid="motion-input-scale"
                    value={activeMotion.from.scale ?? 1}
                    onChange={(e) => {
                      const val = Number(e.currentTarget.value) || 1;
                      void handleUpdateActiveMotion(
                        {
                          from: { ...activeMotion.from, scale: val },
                        },
                        `Set motion start scale to ${val}`,
                      );
                    }}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100"
                  />
                </label>

                <label className="block">
                  <span className="text-[10px] font-mono text-neutral-400">Rotation (°)</span>
                  <input
                    type="number"
                    step="1"
                    data-testid="motion-input-rotation"
                    value={activeMotion.from.rotation ?? activeMotion.to.rotation ?? 0}
                    onChange={(e) => {
                      const val = Number(e.currentTarget.value) || 0;
                      if (activeMotion.category === "exit") {
                        void handleUpdateActiveMotion(
                          { to: { ...activeMotion.to, rotation: val } },
                          `Set motion exit rotation to ${val}deg`,
                        );
                      } else {
                        void handleUpdateActiveMotion(
                          { from: { ...activeMotion.from, rotation: val } },
                          `Set motion start rotation to ${val}deg`,
                        );
                      }
                    }}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100"
                  />
                </label>

                <label className="block">
                  <span className="text-[10px] font-mono text-neutral-400">
                    {activeMotion.category === "exit" ? "End Opacity" : "Start Opacity"}
                  </span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    data-testid="motion-input-opacity"
                    value={
                      activeMotion.category === "exit"
                        ? (activeMotion.to.opacity ?? activeMotion.to.autoAlpha ?? 0)
                        : (activeMotion.from.opacity ?? activeMotion.from.autoAlpha ?? 1)
                    }
                    onChange={(e) => {
                      const val = Math.min(1, Math.max(0, Number(e.currentTarget.value) || 0));
                      if (activeMotion.category === "exit") {
                        void handleUpdateActiveMotion(
                          { to: { ...activeMotion.to, opacity: val, autoAlpha: val } },
                          `Set motion end opacity to ${val}`,
                        );
                      } else {
                        void handleUpdateActiveMotion(
                          { from: { ...activeMotion.from, opacity: val, autoAlpha: val } },
                          `Set motion start opacity to ${val}`,
                        );
                      }
                    }}
                    className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-100"
                  />
                </label>
              </div>

              {/* Motion Path Waypoint Editor & Reverse Toggle */}
              {activeMotion.category === "path" && activeMotion.motionPath && (
                <div
                  data-testid="motion-path-controls"
                  className="rounded border border-cyan-500/30 bg-cyan-950/20 p-2 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase text-cyan-300">
                      Motion Path ({activeMotion.motionPath.type})
                    </span>
                    <button
                      type="button"
                      data-testid="motion-path-reverse-btn"
                      onClick={() => {
                        const reversed = reversePathWaypoints(activeMotion.motionPath!.points);
                        const recompiled = compileMotionPreset(
                          activeMotion.presetId ?? "path-custom",
                          {
                            id: activeMotion.id,
                            start: activeMotion.start,
                            duration: activeMotion.duration,
                            delay: activeMotion.delay,
                            stylePreset: activeMotion.stylePreset,
                            motionPath: {
                              type: activeMotion.motionPath!.type,
                              points: reversed,
                              reverse: !activeMotion.motionPath!.reverse,
                            },
                          },
                        );
                        void handleUpdateActiveMotion(recompiled, "Reverse motion path direction");
                      }}
                      className="rounded border border-cyan-500/50 bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/30"
                    >
                      ⇄ Reverse Path
                    </button>
                  </div>
                  <div className="space-y-1">
                    {activeMotion.motionPath.points.map(
                      (pt: StudioMotionPathPoint, ptIdx: number) => (
                        <div
                          key={ptIdx}
                          className="flex items-center gap-1.5 text-[10px] font-mono"
                        >
                          <span className="w-8 text-cyan-300">P{ptIdx + 1}:</span>
                          <label className="flex items-center gap-1">
                            <span className="text-neutral-400">X</span>
                            <input
                              type="number"
                              step="5"
                              data-testid={`motion-path-pt-x-${ptIdx}`}
                              value={pt.x}
                              onChange={(e) => {
                                const nextPts = activeMotion.motionPath!.points.map((p, i) =>
                                  i === ptIdx ? { ...p, x: Number(e.currentTarget.value) || 0 } : p,
                                );
                                const recompiled = compileMotionPreset(
                                  activeMotion.presetId ?? "path-custom",
                                  {
                                    id: activeMotion.id,
                                    start: activeMotion.start,
                                    duration: activeMotion.duration,
                                    delay: activeMotion.delay,
                                    stylePreset: activeMotion.stylePreset,
                                    motionPath: {
                                      type: activeMotion.motionPath!.type,
                                      points: nextPts,
                                      reverse: activeMotion.motionPath!.reverse,
                                    },
                                  },
                                );
                                void handleUpdateActiveMotion(
                                  recompiled,
                                  `Update path waypoint P${ptIdx + 1}`,
                                );
                              }}
                              className="w-16 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-neutral-100"
                            />
                          </label>
                          <label className="flex items-center gap-1">
                            <span className="text-neutral-400">Y</span>
                            <input
                              type="number"
                              step="5"
                              data-testid={`motion-path-pt-y-${ptIdx}`}
                              value={pt.y}
                              onChange={(e) => {
                                const nextPts = activeMotion.motionPath!.points.map((p, i) =>
                                  i === ptIdx ? { ...p, y: Number(e.currentTarget.value) || 0 } : p,
                                );
                                const recompiled = compileMotionPreset(
                                  activeMotion.presetId ?? "path-custom",
                                  {
                                    id: activeMotion.id,
                                    start: activeMotion.start,
                                    duration: activeMotion.duration,
                                    delay: activeMotion.delay,
                                    stylePreset: activeMotion.stylePreset,
                                    motionPath: {
                                      type: activeMotion.motionPath!.type,
                                      points: nextPts,
                                      reverse: activeMotion.motionPath!.reverse,
                                    },
                                  },
                                );
                                void handleUpdateActiveMotion(
                                  recompiled,
                                  `Update path waypoint P${ptIdx + 1}`,
                                );
                              }}
                              className="w-16 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-neutral-100"
                            />
                          </label>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Conflict Choice Modal (Replace / Combine / Cancel) */}
      {pendingConflict && (
        <div
          data-testid="motion-conflict-modal"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-amber-500/50 bg-neutral-900 p-4 shadow-2xl space-y-3">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                ⚠️ Existing Animation Detected
              </span>
              <button
                type="button"
                onClick={() => setPendingConflict(null)}
                className="text-xs text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-neutral-200 leading-relaxed">
              Target{" "}
              <span className="font-mono font-semibold text-amber-300">
                #{pendingConflict.targetLabel}
              </span>{" "}
              already has an animation:
            </p>
            <div className="rounded border border-neutral-800 bg-neutral-950 p-2 font-mono text-[11px] text-amber-200">
              {pendingConflict.reason}
            </div>
            <p className="text-[11px] text-neutral-400">
              How should Studio apply{" "}
              <strong className="text-neutral-200">
                {pendingConflict.incomingMotion.name || pendingConflict.incomingMotion.presetId}
              </strong>
              ? Source files and hand-authored code are never deleted without your choice.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                data-testid="motion-conflict-cancel"
                onClick={() => setPendingConflict(null)}
                className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="motion-conflict-combine"
                onClick={() => {
                  const c = pendingConflict;
                  setPendingConflict(null);
                  void applyMotionToTarget(c.target, c.incomingMotion, "combine");
                }}
                className="rounded border border-cyan-500/50 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30"
              >
                Combine (Queue After)
              </button>
              <button
                type="button"
                data-testid="motion-conflict-replace"
                onClick={() => {
                  const c = pendingConflict;
                  setPendingConflict(null);
                  void applyMotionToTarget(c.target, c.incomingMotion, "replace");
                }}
                className="rounded border border-amber-500/60 bg-amber-500/25 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/35"
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
