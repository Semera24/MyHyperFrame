import { useCallback, useMemo } from "react";
import { useStudioPlaybackContext, useStudioShellContext } from "../../contexts/StudioContext";
import { useFileManagerContext } from "../../contexts/FileManagerContext";
import { usePlayerStore } from "../../player";
import {
  MOTION_PRESET_CATALOG,
  MOTION_STYLE_PROFILES,
  compileMotionPreset,
  getMotionPresetById,
  type MotionPresetDefinition,
} from "../editor/motionPresetCatalog";
import {
  STUDIO_GSAP_EASE_OPTIONS,
  duplicateStudioGsapMotionById,
  removeStudioGsapMotionById,
  updateStudioGsapMotionById,
  type StudioGsapMotion,
  type StudioGsapMotionDirection,
  type StudioMotionCategory,
  type StudioMotionStylePreset,
} from "../editor/studioMotion";
import { useStudioMotionStore } from "../editor/useStudioMotionStore";

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

const CATEGORY_COLORS: Record<StudioMotionCategory, { badge: string; text: string; bg: string }> = {
  entrance: {
    badge: "border-emerald-500/50 bg-emerald-500/20 text-emerald-300",
    text: "text-emerald-400",
    bg: "bg-emerald-950/30",
  },
  emphasis: {
    badge: "border-amber-500/50 bg-amber-500/20 text-amber-300",
    text: "text-amber-400",
    bg: "bg-amber-950/30",
  },
  exit: {
    badge: "border-rose-500/50 bg-rose-500/20 text-rose-300",
    text: "text-rose-400",
    bg: "bg-rose-950/30",
  },
  path: {
    badge: "border-cyan-500/50 bg-cyan-500/20 text-cyan-300",
    text: "text-cyan-400",
    bg: "bg-cyan-950/30",
  },
  transition: {
    badge: "border-purple-500/50 bg-purple-500/20 text-purple-300",
    text: "text-purple-400",
    bg: "bg-purple-950/30",
  },
};

export interface MotionInspectorProps {
  selectedMotion?: StudioGsapMotion | null;
  onClose?: () => void;
}

export function MotionInspector({ selectedMotion: propMotion, onClose }: MotionInspectorProps) {
  const { projectId, activeCompPath, previewIframeRef, showToast } = useStudioShellContext();
  const { readOptionalProjectFile, writeProjectFile } = useFileManagerContext();

  const currentTime = usePlayerStore((s) => s.currentTime);
  const requestSeek = usePlayerStore((s) => s.requestSeek);

  const { manifest, selectedMotionId, activeStylePreset, commitManifest, setSelectedMotionId } =
    useStudioMotionStore();

  const activeMotion = useMemo(() => {
    if (propMotion) return propMotion;
    if (selectedMotionId) {
      return manifest.motions.find((m) => m.id === selectedMotionId) ?? null;
    }
    return null;
  }, [propMotion, selectedMotionId, manifest.motions]);

  const catalogEntry = useMemo(
    () => (activeMotion?.presetId ? getMotionPresetById(activeMotion.presetId) : undefined),
    [activeMotion],
  );

  const handleUpdate = useCallback(
    async (patch: Partial<StudioGsapMotion>, label: string) => {
      if (!activeMotion?.id) return;
      const updated = { ...activeMotion, ...patch } as StudioGsapMotion;
      const nextManifest = updateStudioGsapMotionById(manifest, updated);
      await commitManifest(nextManifest, label, {
        writeProjectFile,
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
      previewIframeRef,
      activeCompPath,
      currentTime,
    ],
  );

  const handleStyleChange = useCallback(
    async (stylePreset: StudioMotionStylePreset) => {
      if (!activeMotion?.id || !catalogEntry) return;
      const recompiled = compileMotionPreset(catalogEntry.id, {
        id: activeMotion.id,
        start: activeMotion.start,
        duration: activeMotion.duration,
        delay: activeMotion.delay,
        holdDuration: activeMotion.holdDuration,
        direction: activeMotion.direction,
        distance: activeMotion.distance,
        stylePreset,
        ease: activeMotion.ease,
      });
      const nextManifest = updateStudioGsapMotionById(manifest, recompiled);
      await commitManifest(nextManifest, `Set ${stylePreset} style on ${catalogEntry.name}`, {
        writeProjectFile,
        iframeDoc: previewIframeRef.current?.contentDocument ?? null,
        activeCompPath,
        currentTime,
      });
    },
    [
      activeMotion,
      catalogEntry,
      manifest,
      commitManifest,
      writeProjectFile,
      previewIframeRef,
      activeCompPath,
      currentTime,
    ],
  );

  const handleDuplicate = useCallback(async () => {
    if (!activeMotion?.id) return;
    const { manifest: nextManifest, duplicatedId } = duplicateStudioGsapMotionById(
      manifest,
      activeMotion.id,
    );
    if (duplicatedId) setSelectedMotionId(duplicatedId);
    await commitManifest(nextManifest, `Duplicate ${activeMotion.name || "motion"}`, {
      writeProjectFile,
      iframeDoc: previewIframeRef.current?.contentDocument ?? null,
      activeCompPath,
      currentTime,
    });
    showToast("Duplicated motion block", "info");
  }, [
    activeMotion,
    manifest,
    setSelectedMotionId,
    commitManifest,
    writeProjectFile,
    previewIframeRef,
    activeCompPath,
    currentTime,
    showToast,
  ]);

  const handleRemove = useCallback(async () => {
    if (!activeMotion?.id) return;
    const nextManifest = removeStudioGsapMotionById(manifest, activeMotion.id);
    setSelectedMotionId(null);
    await commitManifest(nextManifest, `Remove ${activeMotion.name || "motion"}`, {
      writeProjectFile,
      iframeDoc: previewIframeRef.current?.contentDocument ?? null,
      activeCompPath,
      currentTime,
    });
    showToast("Removed motion block", "info");
    onClose?.();
  }, [
    activeMotion,
    manifest,
    setSelectedMotionId,
    commitManifest,
    writeProjectFile,
    previewIframeRef,
    activeCompPath,
    currentTime,
    showToast,
    onClose,
  ]);

  if (!activeMotion) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-neutral-500">
        <span className="text-2xl mb-2">✨</span>
        <p className="text-xs font-semibold text-neutral-300">No Motion Selected</p>
        <p className="mt-1 text-[11px] text-neutral-500 max-w-[200px]">
          Select an element or click any motion block on the timeline to inspect and edit its
          parameters.
        </p>
      </div>
    );
  }

  const cat = activeMotion.category ?? "entrance";
  const colors = CATEGORY_COLORS[cat];
  const isTransition = cat === "transition";

  return (
    <div
      data-testid="motion-inspector-panel"
      className="flex h-full flex-col bg-neutral-950 text-neutral-100 select-none overflow-y-auto"
    >
      {/* Header */}
      <div className={`border-b border-neutral-800 p-3 ${colors.bg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase ${colors.badge}`}
            >
              {cat}
            </span>
            <span className="font-semibold text-sm text-neutral-100 truncate">
              {activeMotion.name || catalogEntry?.name || "Motion Effect"}
            </span>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-neutral-400 hover:text-white text-xs px-1"
            >
              ✕
            </button>
          )}
        </div>
        <p className="mt-1 font-mono text-[10px] text-neutral-400 truncate">
          Target: #{activeMotion.target.id || activeMotion.target.selector}
        </p>
      </div>

      {/* Style Profile Pills */}
      <div className="border-b border-neutral-800 p-3 space-y-1.5">
        <label className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
          Pacing Style
        </label>
        <div className="grid grid-cols-3 gap-1">
          {(["subtle", "documentary", "energetic"] as const).map((styleId) => {
            const prof = MOTION_STYLE_PROFILES[styleId];
            const isActive = (activeMotion.stylePreset ?? activeStylePreset) === styleId;
            return (
              <button
                key={styleId}
                type="button"
                onClick={() => void handleStyleChange(styleId)}
                className={`rounded border px-2 py-1 text-center transition-colors ${
                  isActive
                    ? "border-amber-400 bg-amber-500/15 text-amber-200 font-semibold"
                    : "border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200 text-[10px]"
                }`}
              >
                <div className="text-[10px]">{prof.label}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Timing Controls (Start, Duration, Delay, Hold) */}
      <div className="border-b border-neutral-800 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
            Timing & Duration
          </span>
          <button
            type="button"
            onClick={() => requestSeek(activeMotion.start)}
            className="text-[9px] font-mono text-amber-300 hover:underline"
          >
            Seek to Start ➔
          </button>
        </div>

        {/* Start */}
        <div className="flex items-center gap-2">
          <span className="w-16 text-[10px] font-mono text-neutral-400">Start Time:</span>
          <input
            type="range"
            min="0"
            max="60"
            step="0.05"
            value={activeMotion.start}
            onChange={(e) =>
              void handleUpdate({ start: Number(e.currentTarget.value) }, "Change start time")
            }
            className="flex-1 accent-amber-400 h-1"
          />
          <span className="w-12 text-right font-mono text-xs text-neutral-200">
            {activeMotion.start.toFixed(2)}s
          </span>
        </div>

        {/* Duration */}
        <div className="flex items-center gap-2">
          <span className="w-16 text-[10px] font-mono text-neutral-400">Duration:</span>
          <input
            type="range"
            min="0.1"
            max="5.0"
            step="0.05"
            value={activeMotion.duration}
            onChange={(e) =>
              void handleUpdate({ duration: Number(e.currentTarget.value) }, "Change duration")
            }
            className="flex-1 accent-amber-400 h-1"
          />
          <span className="w-12 text-right font-mono text-xs text-neutral-200">
            {activeMotion.duration.toFixed(2)}s
          </span>
        </div>

        {/* Delay */}
        <div className="flex items-center gap-2">
          <span className="w-16 text-[10px] font-mono text-neutral-400">Delay:</span>
          <input
            type="range"
            min="0"
            max="3.0"
            step="0.05"
            value={activeMotion.delay ?? 0}
            onChange={(e) =>
              void handleUpdate({ delay: Number(e.currentTarget.value) }, "Change delay")
            }
            className="flex-1 accent-neutral-500 h-1"
          />
          <span className="w-12 text-right font-mono text-xs text-neutral-400">
            {(activeMotion.delay ?? 0).toFixed(2)}s
          </span>
        </div>

        {/* Hold Duration */}
        {activeMotion.holdDuration != null && (
          <div className="flex items-center gap-2">
            <span className="w-16 text-[10px] font-mono text-neutral-400">Hold:</span>
            <input
              type="range"
              min="0"
              max="4.0"
              step="0.05"
              value={activeMotion.holdDuration}
              onChange={(e) =>
                void handleUpdate(
                  { holdDuration: Number(e.currentTarget.value) },
                  "Change hold time",
                )
              }
              className="flex-1 accent-amber-400 h-1"
            />
            <span className="w-12 text-right font-mono text-xs text-neutral-200">
              {activeMotion.holdDuration.toFixed(2)}s
            </span>
          </div>
        )}
      </div>

      {/* Direction & Distance (if applicable) */}
      {!isTransition && (
        <div className="border-b border-neutral-800 p-3 space-y-3">
          <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
            Spatial Transform
          </span>

          {/* Direction */}
          <div className="flex items-center gap-2">
            <span className="w-16 text-[10px] font-mono text-neutral-400">Direction:</span>
            <select
              value={activeMotion.direction ?? "up"}
              onChange={(e) =>
                void handleUpdate(
                  { direction: e.currentTarget.value as StudioGsapMotionDirection },
                  "Change direction",
                )
              }
              className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
            >
              {DIRECTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Distance */}
          <div className="flex items-center gap-2">
            <span className="w-16 text-[10px] font-mono text-neutral-400">Distance:</span>
            <input
              type="range"
              min="10"
              max="500"
              step="5"
              value={activeMotion.distance ?? 60}
              onChange={(e) =>
                void handleUpdate({ distance: Number(e.currentTarget.value) }, "Change distance")
              }
              className="flex-1 accent-amber-400 h-1"
            />
            <span className="w-12 text-right font-mono text-xs text-neutral-200">
              {activeMotion.distance ?? 60}px
            </span>
          </div>
        </div>
      )}

      {/* Easing Curve */}
      <div className="border-b border-neutral-800 p-3 space-y-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
          Easing Curve
        </span>
        <select
          value={activeMotion.ease ?? "power2.out"}
          onChange={(e) => void handleUpdate({ ease: e.currentTarget.value }, "Change ease")}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs font-mono text-neutral-100"
        >
          {STUDIO_GSAP_EASE_OPTIONS.map((opt, i) => (
            <option key={`${opt.value}-${i}`} value={opt.value}>
              {opt.label} ({opt.value})
            </option>
          ))}
        </select>
      </div>

      {/* Action Buttons: Duplicate / Remove */}
      <div className="p-3 flex items-center justify-between gap-2 mt-auto">
        <button
          type="button"
          onClick={() => void handleDuplicate()}
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 py-1.5 text-xs font-semibold text-neutral-200 hover:border-neutral-600 hover:bg-neutral-800"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => void handleRemove()}
          className="flex-1 rounded border border-rose-500/40 bg-rose-500/10 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
