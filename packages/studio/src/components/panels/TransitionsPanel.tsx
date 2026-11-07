import { useCallback, useEffect, useMemo, useState } from "react";
import { useStudioPlaybackContext, useStudioShellContext } from "../../contexts/StudioContext";
import { useFileManagerContext } from "../../contexts/FileManagerContext";
import { usePlayerStore } from "../../player";
import {
  MOTION_PRESET_CATALOG,
  STUDIO_MOTION_DRAG_MIME,
  compileMotionPreset,
  getMotionPresetById,
  type MotionPresetDefinition,
  type StudioMotionDragPayload,
} from "../editor/motionPresetCatalog";
import {
  addStudioGsapMotion,
  removeStudioGsapMotionById,
  updateStudioGsapMotionById,
  type StudioGsapMotion,
  type StudioMotionTarget,
} from "../editor/studioMotion";
import { useStudioMotionStore } from "../editor/useStudioMotionStore";
import { setActiveDraggedMotionPayload } from "./MotionLibraryPanel";

export interface SceneCutInfo {
  index: number;
  cutTime: number;
  fromSceneId: string;
  toSceneId: string;
  target: StudioMotionTarget;
  appliedTransition?: StudioGsapMotion | null;
}

const TRANSITION_PRESETS = MOTION_PRESET_CATALOG.filter((p) => p.category === "transition");

function AnimatedTransitionPreview({ preset }: { preset: MotionPresetDefinition }) {
  const type = preset.id.replace("transition-", "");
  return (
    <div className="relative flex h-14 w-full items-center justify-center overflow-hidden rounded-md bg-neutral-950 border border-neutral-800/80 group-hover:border-purple-400/50 transition-colors">
      <div
        className="pointer-events-none absolute inset-0 opacity-15"
        style={{
          backgroundImage:
            "linear-gradient(to right, #334155 1px, transparent 1px), linear-gradient(to bottom, #334155 1px, transparent 1px)",
          backgroundSize: "10px 10px",
        }}
      />
      {/* S1 Frame */}
      <div className="relative flex h-9 w-24 items-center justify-between overflow-hidden rounded border border-purple-500/40 bg-neutral-900 shadow-sm">
        <div className="flex h-full w-1/2 items-center justify-center bg-purple-950/60 font-mono text-[9px] font-bold text-purple-300">
          S1
        </div>
        <div className="flex h-full w-1/2 items-center justify-center bg-indigo-950/60 font-mono text-[9px] font-bold text-indigo-300">
          S2
        </div>
        {/* Animated transition indicator */}
        <div
          className={`absolute inset-y-0 w-1 bg-purple-400 shadow-[0_0_8px_#c084fc] ${
            type === "crossfade"
              ? "left-1/2 -translate-x-1/2 animate-pulse"
              : type === "push" || type === "wipe"
                ? "left-0 animate-[moveSeam_1.6s_ease-in-out_infinite]"
                : "left-1/2 -translate-x-1/2"
          }`}
        />
      </div>
      <span className="absolute bottom-1 right-1.5 rounded bg-purple-500/20 px-1 py-0.2 font-mono text-[8px] text-purple-300 border border-purple-500/30">
        {preset.defaultDuration}s
      </span>
    </div>
  );
}

export interface TransitionsPanelProps {
  recordEdit?: (entry: {
    label: string;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
}

export function TransitionsPanel({ recordEdit }: TransitionsPanelProps) {
  const { activeCompPath, previewIframeRef, showToast } = useStudioShellContext();
  const { timelineElements } = useStudioPlaybackContext();
  const { writeProjectFile } = useFileManagerContext();

  const currentTime = usePlayerStore((s) => s.currentTime);
  const requestSeek = usePlayerStore((s) => s.requestSeek);

  const {
    manifest,
    selectedMotionId,
    activeStylePreset,
    commitManifest,
    setSelectedMotionId,
    setRecordEditRef,
  } = useStudioMotionStore();

  useEffect(() => {
    setRecordEditRef(recordEdit);
  }, [recordEdit, setRecordEditRef]);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCutIndex, setSelectedCutIndex] = useState<number>(0);

  // Discover all scene cuts in this episode
  const sceneCuts = useMemo<SceneCutInfo[]>(() => {
    const cuts: SceneCutInfo[] = [];
    const iframeDoc = previewIframeRef.current?.contentDocument;

    if (iframeDoc) {
      const subComps = Array.from(
        iframeDoc.querySelectorAll<HTMLElement>("[data-composition-id][data-start]"),
      ).filter((el) => el.getAttribute("data-composition-id") !== "master");

      if (subComps.length >= 2) {
        const sorted = [...subComps].sort(
          (a, b) =>
            Number(a.getAttribute("data-start") || 0) - Number(b.getAttribute("data-start") || 0),
        );
        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i]!;
          const b = sorted[i + 1]!;
          const cutTime = Number(b.getAttribute("data-start") || 0);
          const fromId = a.id || a.getAttribute("data-hf-id") || `s0${i + 1}`;
          const toId = b.id || b.getAttribute("data-hf-id") || `s0${i + 2}`;
          const target: StudioMotionTarget = {
            sourceFile: activeCompPath || "index.html",
            id: toId,
            selector: `#${toId}`,
          };
          const applied = manifest.motions.find(
            (m) =>
              m.kind === "gsap-motion" &&
              m.category === "transition" &&
              m.target.id === toId &&
              Math.abs((m.transition?.cutTime ?? m.start) - cutTime) < 1.0,
          );
          cuts.push({
            index: i,
            cutTime,
            fromSceneId: fromId,
            toSceneId: toId,
            target,
            appliedTransition: applied ?? null,
          });
        }
      }
    }

    if (cuts.length === 0) {
      // Fallback to timeline elements
      const sceneEls = timelineElements
        .filter((el) => el.duration > 0 && (el.id.startsWith("s0") || el.tag === "div"))
        .sort((a, b) => a.start - b.start);

      for (let i = 0; i < sceneEls.length - 1; i++) {
        const a = sceneEls[i]!;
        const b = sceneEls[i + 1]!;
        const cutTime = b.start;
        const fromId = a.domId || a.id;
        const toId = b.domId || b.id;
        const target: StudioMotionTarget = {
          sourceFile: activeCompPath || "index.html",
          id: toId,
          selector: `#${toId}`,
        };
        const applied = manifest.motions.find(
          (m) =>
            m.kind === "gsap-motion" &&
            m.category === "transition" &&
            m.target.id === toId &&
            Math.abs((m.transition?.cutTime ?? m.start) - cutTime) < 1.0,
        );
        cuts.push({
          index: i,
          cutTime,
          fromSceneId: fromId,
          toSceneId: toId,
          target,
          appliedTransition: applied ?? null,
        });
      }
    }

    return cuts;
  }, [previewIframeRef, timelineElements, activeCompPath, manifest.motions]);

  // Determine active cut based on playhead or selected cut index
  const activeCut = useMemo(() => {
    if (sceneCuts.length === 0) return null;
    let nearest = sceneCuts[0]!;
    let minDist = Math.abs(currentTime - nearest.cutTime);
    for (const cut of sceneCuts) {
      const dist = Math.abs(currentTime - cut.cutTime);
      if (dist < minDist) {
        minDist = dist;
        nearest = cut;
      }
    }
    return minDist < 2.0 ? nearest : (sceneCuts[selectedCutIndex] ?? sceneCuts[0]);
  }, [sceneCuts, currentTime, selectedCutIndex]);

  // Selected or active transition
  const activeTransition = useMemo(() => {
    if (selectedMotionId) {
      const m = manifest.motions.find((item) => item.id === selectedMotionId);
      if (m && m.category === "transition") return m;
    }
    return activeCut?.appliedTransition ?? null;
  }, [selectedMotionId, manifest.motions, activeCut]);

  const filteredPresets = useMemo(() => {
    if (!searchQuery.trim()) return TRANSITION_PRESETS;
    const q = searchQuery.toLowerCase();
    return TRANSITION_PRESETS.filter(
      (p) => p.name.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const handleApplyTransition = useCallback(
    async (preset: MotionPresetDefinition, cutOverride?: SceneCutInfo) => {
      const cut = cutOverride ?? activeCut;
      if (!cut) {
        showToast("No scene cut detected in episode. Select a multi-scene timeline.", "error");
        return;
      }
      const dur = preset.defaultDuration;
      const start = Math.max(0, Number((cut.cutTime - dur / 2).toFixed(2)));
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
          fromSceneId: cut.fromSceneId,
          toSceneId: cut.toSceneId,
          cutTime: cut.cutTime,
          type: transitionType,
        },
      });

      // Replace any existing transition on this cut
      let nextManifest = manifest;
      if (cut.appliedTransition?.id) {
        nextManifest = removeStudioGsapMotionById(nextManifest, cut.appliedTransition.id);
      }
      nextManifest = addStudioGsapMotion(nextManifest, cut.target, compiled);
      const added = nextManifest.motions.at(-1);
      if (added?.id) setSelectedMotionId(added.id);

      await commitManifest(
        nextManifest,
        `Apply ${compiled.name || preset.name} transition at ${cut.cutTime}s`,
        {
          writeProjectFile,
          recordEdit,
          iframeDoc: previewIframeRef.current?.contentDocument ?? null,
          activeCompPath,
          currentTime: cut.cutTime,
        },
      );
      requestSeek(cut.cutTime);
      showToast(`Applied ${preset.name} transition at ${cut.cutTime.toFixed(2)}s`, "info");
    },
    [
      activeCut,
      activeStylePreset,
      manifest,
      setSelectedMotionId,
      commitManifest,
      writeProjectFile,
      recordEdit,
      previewIframeRef,
      activeCompPath,
      requestSeek,
      showToast,
    ],
  );

  const handleRemoveTransition = useCallback(
    async (transitionId: string) => {
      const nextManifest = removeStudioGsapMotionById(manifest, transitionId);
      if (selectedMotionId === transitionId) setSelectedMotionId(null);
      await commitManifest(nextManifest, "Remove scene transition", {
        writeProjectFile,
        recordEdit,
        iframeDoc: previewIframeRef.current?.contentDocument ?? null,
        activeCompPath,
        currentTime,
      });
      showToast("Removed scene transition", "info");
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

  const handleUpdateDuration = useCallback(
    async (duration: number) => {
      if (!activeTransition?.id) return;
      const catalogEntry = activeTransition.presetId
        ? getMotionPresetById(activeTransition.presetId)
        : undefined;
      const cutTime = activeTransition.transition?.cutTime ?? activeTransition.start;
      const start = Math.max(0, Number((cutTime - duration / 2).toFixed(2)));

      if (catalogEntry) {
        const recompiled = compileMotionPreset(catalogEntry.id, {
          id: activeTransition.id,
          start,
          duration,
          stylePreset: activeTransition.stylePreset ?? activeStylePreset,
          transition: activeTransition.transition,
        });
        const nextManifest = updateStudioGsapMotionById(manifest, recompiled);
        await commitManifest(nextManifest, `Update transition duration to ${duration}s`, {
          writeProjectFile,
          recordEdit,
          iframeDoc: previewIframeRef.current?.contentDocument ?? null,
          activeCompPath,
          currentTime: cutTime,
        });
      }
    },
    [
      activeTransition,
      activeStylePreset,
      manifest,
      commitManifest,
      writeProjectFile,
      recordEdit,
      previewIframeRef,
      activeCompPath,
    ],
  );

  return (
    <div
      data-testid="transitions-panel"
      className="flex h-full min-h-0 flex-col bg-neutral-950 text-neutral-100 select-none overflow-hidden"
    >
      {/* Top Header */}
      <div className="border-b border-neutral-800 bg-neutral-900/70 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold tracking-wide text-purple-300">
              🔀 SCENE TRANSITIONS
            </span>
            <span className="rounded bg-purple-950/80 px-1.5 py-0.5 font-mono text-[10px] text-purple-200 border border-purple-800/60">
              {TRANSITION_PRESETS.length} Types
            </span>
          </div>
          <span className="text-[10px] text-neutral-400">
            {sceneCuts.length} Cut{sceneCuts.length === 1 ? "" : "s"} Detected
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-neutral-400">
          Drag onto a timeline scene cut boundary, or select a cut and click to apply
        </p>
      </div>

      {/* Episode Scene Cuts Navigator */}
      {sceneCuts.length > 0 && (
        <div className="border-b border-neutral-800 bg-neutral-900/30 px-3 py-2">
          <div className="flex items-center justify-between gap-1.5 mb-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
              Episode Scene Cuts
            </span>
            <div className="flex items-center gap-1.5">
              {activeCut && (
                <span className="text-[10px] text-purple-300 font-semibold font-mono">
                  {activeCut.fromSceneId} ➔ {activeCut.toSceneId} ({activeCut.cutTime.toFixed(2)}s)
                </span>
              )}
              <button
                type="button"
                data-testid="transition-apply-all-cuts"
                onClick={async () => {
                  const activePreset =
                    (activeTransition?.presetId &&
                      getMotionPresetById(activeTransition.presetId)) ||
                    getMotionPresetById("transition-crossfade") ||
                    TRANSITION_PRESETS[0];
                  if (!activePreset) return;
                  let nextManifest = manifest;
                  for (const cut of sceneCuts) {
                    if (cut.appliedTransition?.id) {
                      nextManifest = removeStudioGsapMotionById(
                        nextManifest,
                        cut.appliedTransition.id,
                      );
                    }
                    const dur = activeTransition?.duration ?? activePreset.defaultDuration;
                    const start = Math.max(0, Number((cut.cutTime - dur / 2).toFixed(2)));
                    const transitionType = (activePreset.id.replace("transition-", "") ||
                      "crossfade") as
                      | "cut"
                      | "crossfade"
                      | "push"
                      | "wipe"
                      | "reveal"
                      | "split"
                      | "zoom"
                      | "morph";
                    const compiled = compileMotionPreset(activePreset.id, {
                      start,
                      duration: dur,
                      stylePreset: activeStylePreset,
                      transition: {
                        fromSceneId: cut.fromSceneId,
                        toSceneId: cut.toSceneId,
                        cutTime: cut.cutTime,
                        type: transitionType,
                      },
                    });
                    nextManifest = addStudioGsapMotion(nextManifest, cut.target, compiled);
                  }
                  await commitManifest(
                    nextManifest,
                    `Apply ${activePreset.name} to all ${sceneCuts.length} scene cuts`,
                    {
                      writeProjectFile,
                      recordEdit,
                      iframeDoc: previewIframeRef.current?.contentDocument ?? null,
                      activeCompPath,
                      currentTime,
                    },
                  );
                  showToast(
                    `Applied ${activePreset.name} across ${sceneCuts.length} scene cut(s)`,
                    "info",
                  );
                }}
                title="Apply active transition (or Crossfade) to all scene cuts in this episode"
                className="rounded border border-purple-500/40 bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-purple-200 hover:bg-purple-500/30 transition-colors cursor-pointer"
              >
                Apply to All
              </button>
            </div>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
            {sceneCuts.map((cut, idx) => {
              const isActive = activeCut?.cutTime === cut.cutTime;
              const hasApplied = Boolean(cut.appliedTransition);
              return (
                <button
                  key={cut.cutTime}
                  type="button"
                  data-testid={`scene-cut-btn-${cut.toSceneId}`}
                  onClick={() => {
                    setSelectedCutIndex(idx);
                    requestSeek(cut.cutTime);
                    if (cut.appliedTransition?.id) {
                      setSelectedMotionId(cut.appliedTransition.id);
                    }
                  }}
                  className={`shrink-0 flex items-center gap-1.5 rounded border px-2 py-1 text-left transition-colors ${
                    isActive
                      ? "border-purple-400 bg-purple-950/50 text-purple-200 shadow-sm"
                      : "border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                  }`}
                >
                  <span className="font-mono text-[10px] font-bold">
                    {cut.fromSceneId} → {cut.toSceneId}
                  </span>
                  <span className="font-mono text-[9px] text-neutral-500">
                    {cut.cutTime.toFixed(1)}s
                  </span>
                  {hasApplied ? (
                    <span className="rounded-full bg-purple-500/30 px-1 py-0.2 text-[8px] font-bold text-purple-300">
                      {cut.appliedTransition?.name?.replace(" Transition", "") || "Wipe"}
                    </span>
                  ) : (
                    <span className="text-[9px] text-neutral-600">Cut</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search Input */}
      <div className="border-b border-neutral-800 px-3 py-2">
        <div className="relative">
          <input
            type="text"
            data-testid="transition-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="Search transitions (Crossfade, Wipe, Push, Zoom...)"
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-100 placeholder-neutral-500 focus:border-purple-400 focus:outline-none"
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
      </div>

      {/* Transitions Visual Gallery Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
            Transition Gallery ({filteredPresets.length})
          </span>
          <span className="text-[9px] text-purple-300/80">Click to apply · Drag to timeline</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {filteredPresets.map((preset) => {
            const isCurrentApplied = activeCut?.appliedTransition?.presetId === preset.id;
            return (
              <div
                key={preset.id}
                data-testid={`transition-card-${preset.id}`}
                draggable
                onDragStart={(e) => {
                  const payload: StudioMotionDragPayload = {
                    presetId: preset.id,
                    category: "transition",
                    stylePreset: activeStylePreset,
                  };
                  setActiveDraggedMotionPayload(payload);
                  e.dataTransfer.setData(STUDIO_MOTION_DRAG_MIME, JSON.stringify(payload));
                  e.dataTransfer.setData("text/plain", JSON.stringify(payload));
                  e.dataTransfer.effectAllowed = "copyMove";
                }}
                onDragEnd={() => setActiveDraggedMotionPayload(null)}
                onClick={() => void handleApplyTransition(preset)}
                className={`group cursor-grab active:cursor-grabbing rounded-lg border p-2 transition-all ${
                  isCurrentApplied
                    ? "border-purple-400 bg-purple-950/40 shadow-[0_0_10px_rgba(168,85,247,0.3)]"
                    : "border-neutral-800 bg-neutral-900/70 hover:border-purple-400/60 hover:bg-neutral-900"
                }`}
              >
                <AnimatedTransitionPreview preset={preset} />
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-semibold text-xs text-neutral-100 truncate">
                    {preset.name}
                  </span>
                  {isCurrentApplied && (
                    <span className="rounded bg-purple-400 px-1 py-0.2 text-[8px] font-bold text-neutral-950 uppercase">
                      Active
                    </span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-1 text-[9px] text-neutral-400">{preset.summary}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Transition Inspector Bar */}
      {activeTransition && (
        <div className="border-t border-neutral-800 bg-neutral-900/90 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-purple-400 animate-ping" />
              <span className="font-semibold text-xs text-purple-200">
                {activeTransition.name || "Scene Transition"}
              </span>
              <span className="font-mono text-[10px] text-neutral-400">
                at {(activeTransition.transition?.cutTime ?? activeTransition.start).toFixed(2)}s
              </span>
            </div>
            <button
              type="button"
              data-testid="remove-transition-btn"
              onClick={() => void handleRemoveTransition(activeTransition.id)}
              className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-300 hover:bg-rose-500/20"
            >
              ✕ Remove
            </button>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-[10px] font-mono text-neutral-400">Duration:</label>
            <input
              type="range"
              min="0.2"
              max="2.0"
              step="0.05"
              value={activeTransition.duration}
              onChange={(e) => void handleUpdateDuration(Number(e.currentTarget.value))}
              className="flex-1 accent-purple-400 h-1"
            />
            <span className="font-mono text-xs text-purple-300 w-10 text-right">
              {activeTransition.duration.toFixed(2)}s
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
