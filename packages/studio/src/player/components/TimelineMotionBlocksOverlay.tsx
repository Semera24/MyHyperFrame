import { useCallback, useState } from "react";
import type { TimelineElement } from "../store/playerStore";
import { useStudioShellContextOptional } from "../../contexts/StudioContext";
import { useFileManagerContextOptional } from "../../contexts/FileManagerContext";
import { useDockLayoutStore } from "../../components/dock/dockLayoutStore";
import {
  STUDIO_MOTION_DRAG_MIME,
  compileMotionPreset,
  type StudioMotionDragPayload,
} from "../../components/editor/motionPresetCatalog";
import {
  addStudioGsapMotion,
  removeStudioGsapMotionById,
  updateStudioGsapMotionById,
  type StudioGsapMotion,
  type StudioMotionCategory,
  type StudioMotionTarget,
} from "../../components/editor/studioMotion";
import {
  detectStudioMotionConflict,
  getMotionsForTarget,
  useStudioMotionStore,
} from "../../components/editor/useStudioMotionStore";
import { getActiveDraggedMotionPayload } from "../../components/panels/MotionLibraryPanel";
import { getTimelineElementIdentity } from "../lib/timelineElementHelpers";

export interface TimelineMotionBlocksOverlayProps {
  trackNum: number;
  trackElements: TimelineElement[];
  allTracks: ReadonlyArray<readonly [number, TimelineElement[]]>;
  pps: number;
  activeCompPath: string | null;
  currentTime: number;
  onSelectElement?: (element: TimelineElement | null) => void;
  onSeek?: (time: number) => void;
}

const BLOCK_STYLES: Record<StudioMotionCategory, string> = {
  entrance:
    "border-emerald-400/90 bg-emerald-600/85 text-white shadow-[0_1px_6px_rgba(16,185,129,0.45)]",
  emphasis:
    "border-amber-400/90 bg-amber-600/85 text-white shadow-[0_1px_6px_rgba(245,158,11,0.45)]",
  exit: "border-rose-400/90 bg-rose-600/85 text-white shadow-[0_1px_6px_rgba(244,63,94,0.45)]",
  path: "border-cyan-400/90 bg-cyan-600/85 text-white shadow-[0_1px_6px_rgba(6,182,212,0.45)]",
  transition:
    "border-purple-400/95 bg-purple-600/90 text-white shadow-[0_1px_8px_rgba(168,85,247,0.55)]",
};

function readDropPayload(e: React.DragEvent): StudioMotionDragPayload | null {
  try {
    const raw =
      e.dataTransfer.getData(STUDIO_MOTION_DRAG_MIME) || e.dataTransfer.getData("text/plain");
    if (raw) {
      const parsed = JSON.parse(raw) as StudioMotionDragPayload;
      if (parsed && typeof parsed.presetId === "string") {
        return parsed;
      }
    }
  } catch {
    // ignore parse error and fall back
  }
  return getActiveDraggedMotionPayload();
}

export function TimelineMotionBlocksOverlay({
  trackNum,
  trackElements,
  allTracks,
  pps,
  activeCompPath,
  currentTime,
  onSelectElement,
  onSeek,
}: TimelineMotionBlocksOverlayProps) {
  const shell = useStudioShellContextOptional();
  const fileManager = useFileManagerContextOptional();
  const {
    manifest,
    selectedMotionId,
    activeStylePreset,
    setManifestLive,
    commitManifest,
    setSelectedMotionId,
    setPendingConflict,
  } = useStudioMotionStore();

  const [dragHoverTime, setDragHoverTime] = useState<number | null>(null);

  const primaryEl = trackElements[0];
  const primaryId = primaryEl ? primaryEl.domId || primaryEl.id : "";
  const primaryTarget: StudioMotionTarget | null = primaryEl
    ? {
        sourceFile: primaryEl.sourceFile || activeCompPath || "index.html",
        id: primaryId,
        selector: `#${primaryId}`,
      }
    : null;

  // Gather all motions belonging to any element on this track row
  const rowMotions: Array<{
    target: StudioMotionTarget;
    el: TimelineElement;
    motion: StudioGsapMotion;
    orderIndex: number;
  }> = [];

  const seenMotionIds = new Set<string>();
  for (const el of trackElements) {
    const domId = el.domId || el.id;
    const target: StudioMotionTarget = {
      sourceFile: el.sourceFile || activeCompPath || "index.html",
      id: domId,
      selector: `#${domId}`,
    };
    const list = getMotionsForTarget(manifest, target);
    list.forEach((motion, idx) => {
      const mId = motion.id ?? `${domId}-${idx}`;
      if (!seenMotionIds.has(mId)) {
        seenMotionIds.add(mId);
        rowMotions.push({
          target: motion.target,
          el,
          motion,
          orderIndex: idx,
        });
      }
    });
  }

  const handleTrackDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragHoverTime(null);

      const payload = readDropPayload(e);
      if (!payload || !primaryEl || !primaryTarget || !fileManager) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const rawDropTime = Math.max(0, (e.clientX - rect.left) / pps);
      const dropTime = Number(rawDropTime.toFixed(2));
      const iframeDoc = shell?.previewIframeRef.current?.contentDocument ?? null;

      useDockLayoutStore.getState().activatePanel("motion");

      if (payload.category === "transition") {
        const allSceneClips = allTracks
          .flatMap(([, els]) => els)
          .filter((el) => el.duration > 0)
          .sort((a, b) => a.start - b.start);

        let cutTime = primaryEl.start > 0 ? primaryEl.start : primaryEl.start + primaryEl.duration;
        let toTarget: StudioMotionTarget = primaryTarget;
        let fromSceneId = primaryId;
        let toSceneId = primaryId;

        if (iframeDoc) {
          const subComps = Array.from(
            iframeDoc.querySelectorAll<HTMLElement>("[data-composition-id][data-start]"),
          ).filter((el) => el.getAttribute("data-composition-id") !== "master");
          if (subComps.length >= 2) {
            let bestDist = Infinity;
            for (let i = 0; i < subComps.length - 1; i++) {
              const a = subComps[i]!;
              const b = subComps[i + 1]!;
              const cut = Number(b.getAttribute("data-start") || 0);
              const dist = Math.abs(dropTime - cut);
              if (dist < bestDist) {
                bestDist = dist;
                cutTime = cut;
                fromSceneId = a.id || a.getAttribute("data-hf-id") || `s0${i + 1}`;
                toSceneId = b.id || b.getAttribute("data-hf-id") || `s0${i + 2}`;
              }
            }
            toTarget = {
              sourceFile: activeCompPath || "index.html",
              id: toSceneId,
              selector: `#${toSceneId}`,
            };
          }
        } else if (allSceneClips.length >= 2) {
          let bestDist = Infinity;
          for (let i = 0; i < allSceneClips.length - 1; i++) {
            const a = allSceneClips[i]!;
            const b = allSceneClips[i + 1]!;
            const cut = b.start;
            const dist = Math.abs(dropTime - cut);
            if (dist < bestDist) {
              bestDist = dist;
              cutTime = cut;
              fromSceneId = a.domId || a.id;
              toSceneId = b.domId || b.id;
            }
          }
          toTarget = {
            sourceFile: activeCompPath || "index.html",
            id: toSceneId,
            selector: `#${toSceneId}`,
          };
        }

        const transitionType = (payload.presetId.replace("transition-", "") || "crossfade") as
          | "cut"
          | "crossfade"
          | "push"
          | "wipe"
          | "reveal"
          | "split"
          | "zoom"
          | "morph";

        const compiled = compileMotionPreset(payload.presetId, {
          start: Math.max(0, Number((cutTime - 0.45).toFixed(2))),
          stylePreset: payload.stylePreset ?? activeStylePreset,
          transition: {
            fromSceneId,
            toSceneId,
            cutTime,
            type: transitionType,
          },
        });

        let nextManifest = manifest;
        const existingTrans = nextManifest.motions.find(
          (m) =>
            m.category === "transition" &&
            m.target.id === toTarget.id &&
            Math.abs((m.transition?.cutTime ?? m.start) - cutTime) < 1.0,
        );
        if (existingTrans?.id) {
          nextManifest = removeStudioGsapMotionById(nextManifest, existingTrans.id);
        }
        nextManifest = addStudioGsapMotion(nextManifest, toTarget, compiled);
        const added = nextManifest.motions.at(-1);
        if (added?.id) setSelectedMotionId(added.id);

        await commitManifest(
          nextManifest,
          `Drop ${compiled.name || compiled.presetId} transition at ${cutTime}s`,
          {
            writeProjectFile: fileManager.writeProjectFile,
            iframeDoc,
            activeCompPath,
            currentTime: cutTime,
          },
        );
        onSeek?.(cutTime);
        shell?.showToast(
          `Applied ${compiled.name || compiled.presetId} transition at ${cutTime.toFixed(2)}s`,
          "info",
        );
        return;
      }

      const compiled = compileMotionPreset(payload.presetId, {
        start: dropTime,
        stylePreset: payload.stylePreset ?? activeStylePreset,
      });

      const conflict = detectStudioMotionConflict(manifest, primaryTarget, compiled, iframeDoc);
      if (conflict) {
        setPendingConflict(conflict);
        return;
      }

      const nextManifest = addStudioGsapMotion(manifest, primaryTarget, compiled);
      const added = nextManifest.motions.at(-1);
      if (added?.id) setSelectedMotionId(added.id);
      onSelectElement?.(primaryEl);
      useDockLayoutStore.getState().activatePanel("motion");

      await commitManifest(
        nextManifest,
        `Drop ${compiled.name || compiled.presetId} on #${primaryTarget.id} at ${dropTime}s`,
        {
          writeProjectFile: fileManager.writeProjectFile,
          iframeDoc,
          activeCompPath,
          currentTime,
        },
      );
      shell?.showToast(
        `Added ${compiled.name || compiled.presetId} at ${dropTime.toFixed(2)}s`,
        "info",
      );
    },
    [
      primaryEl,
      primaryTarget,
      primaryId,
      fileManager,
      pps,
      shell,
      allTracks,
      activeStylePreset,
      manifest,
      setSelectedMotionId,
      commitManifest,
      activeCompPath,
      onSeek,
      setPendingConflict,
      onSelectElement,
      currentTime,
    ],
  );

  const handleStartDragBlock = useCallback(
    (
      e: React.PointerEvent,
      target: StudioMotionTarget,
      el: TimelineElement,
      motion: StudioGsapMotion,
      mode: "move" | "resize-left" | "resize-right",
    ) => {
      e.stopPropagation();
      e.preventDefault();
      if (!fileManager || !motion.id) return;

      const motionId = motion.id;
      setSelectedMotionId(motionId);
      onSelectElement?.(el);
      useDockLayoutStore.getState().activatePanel("motion");

      const startX = e.clientX;
      const origStart = motion.start;
      const origDuration = motion.duration;
      let latestStart = origStart;
      let latestDuration = origDuration;
      let latestTarget: StudioMotionTarget = target;
      const iframeDoc = shell?.previewIframeRef.current?.contentDocument ?? null;

      const onPointerMove = (moveEv: PointerEvent) => {
        const dx = moveEv.clientX - startX;
        const dt = dx / pps;

        if (mode === "move") {
          latestStart = Math.max(0, Number((origStart + dt).toFixed(2)));
          const hoveredEl = document.elementFromPoint(moveEv.clientX, moveEv.clientY);
          const trackNode = hoveredEl?.closest<HTMLElement>("[data-motion-track-target-id]");
          if (trackNode) {
            const targetDomId = trackNode.getAttribute("data-motion-track-target-id");
            if (targetDomId) {
              latestTarget = {
                sourceFile: activeCompPath || "index.html",
                id: targetDomId,
                selector: `#${targetDomId}`,
              };
            }
          }
        } else if (mode === "resize-right") {
          latestDuration = Math.max(0.1, Number((origDuration + dt).toFixed(2)));
        } else if (mode === "resize-left") {
          const nextStart = Math.max(0, Number((origStart + dt).toFixed(2)));
          const delta = nextStart - origStart;
          if (origDuration - delta >= 0.1) {
            latestStart = nextStart;
            latestDuration = Number((origDuration - delta).toFixed(2));
          }
        }

        const updatedManifest = updateStudioGsapMotionById(manifest, motionId, {
          target: latestTarget,
          start: latestStart,
          duration: latestDuration,
        });
        setManifestLive(
          updatedManifest,
          iframeDoc,
          activeCompPath,
          latestStart + latestDuration * 0.5,
        );
      };

      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);

        const movedTarget = (latestTarget.id ?? "") !== (target.id ?? "");
        const nextManifest = updateStudioGsapMotionById(manifest, motionId, {
          target: latestTarget,
          start: latestStart,
          duration: latestDuration,
        });

        const actionLabel = movedTarget
          ? `Move ${motion.name || motion.presetId} to #${latestTarget.id}`
          : mode === "move"
            ? `Move ${motion.name || motion.presetId} to ${latestStart.toFixed(2)}s`
            : `Resize ${motion.name || motion.presetId} to ${latestDuration.toFixed(2)}s`;

        void commitManifest(nextManifest, actionLabel, {
          writeProjectFile: fileManager.writeProjectFile,
          iframeDoc,
          activeCompPath,
          currentTime,
        });
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [
      fileManager,
      setSelectedMotionId,
      onSelectElement,
      shell,
      pps,
      activeCompPath,
      manifest,
      setManifestLive,
      commitManifest,
      currentTime,
    ],
  );

  return (
    <div
      data-testid={`timeline-motion-lane-${trackNum}`}
      data-motion-track-target-id={primaryTarget?.id ?? ""}
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes(STUDIO_MOTION_DRAG_MIME) ||
          getActiveDraggedMotionPayload() !== null
        ) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          const rect = e.currentTarget.getBoundingClientRect();
          const t = Math.max(0, Number(((e.clientX - rect.left) / pps).toFixed(2)));
          setDragHoverTime(t);
        }
      }}
      onDragLeave={() => setDragHoverTime(null)}
      onDrop={(e) => void handleTrackDrop(e)}
      className="pointer-events-none absolute inset-0 z-30"
    >
      {/* Top 14px drop strip is always pointer-events-auto (expands to full track during active preset drag) */}
      <div
        data-testid={`timeline-motion-dropzone-${primaryTarget?.id || trackNum}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          const rect = e.currentTarget.getBoundingClientRect();
          const t = Math.max(0, Number(((e.clientX - rect.left) / pps).toFixed(2)));
          setDragHoverTime(t);
        }}
        onDragLeave={() => setDragHoverTime(null)}
        onDrop={(e) => void handleTrackDrop(e)}
        className={`pointer-events-auto absolute inset-x-0 top-0 ${
          dragHoverTime !== null || getActiveDraggedMotionPayload() !== null ? "h-full" : "h-3.5"
        }`}
      />

      {/* Drop time ghost indicator while dragging from Motion Library */}
      {dragHoverTime !== null && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-40 flex items-center"
          style={{ left: dragHoverTime * pps }}
        >
          <div className="h-full w-0.5 bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
          <span className="ml-1 rounded bg-amber-400 px-1.5 py-0.5 font-mono text-[9px] font-bold text-black shadow">
            + Drop @ {dragHoverTime.toFixed(2)}s
          </span>
        </div>
      )}

      {/* Rendered Motion Blocks on this Track Row */}
      {rowMotions.map(({ target, el, motion, orderIndex }) => {
        const motionId = motion.id ?? `m-${orderIndex}`;
        const effStart = motion.start + (motion.delay ?? 0);
        const leftPx = effStart * pps;
        const widthPx = Math.max(38, motion.duration * pps);
        const cat = motion.category ?? "entrance";
        const isSelected = selectedMotionId === motion.id;
        const topOffsetPx = 3 + (orderIndex % 2) * 14;

        return (
          <div
            key={motionId}
            data-testid={`timeline-motion-block-${motionId}`}
            data-motion-preset={motion.presetId}
            data-motion-target={target.id || ""}
            onClick={(e) => {
              e.stopPropagation();
              if (motion.id) setSelectedMotionId(motion.id);
              onSelectElement?.(el);
              useDockLayoutStore.getState().activatePanel("motion");
              onSeek?.(Number((effStart + motion.duration * 0.5).toFixed(2)));
            }}
            style={{
              left: leftPx,
              width: widthPx,
              top: topOffsetPx,
              height: 17,
            }}
            className={`pointer-events-auto absolute z-40 flex items-center justify-between rounded border px-1.5 font-mono text-[9px] select-none transition-shadow ${
              BLOCK_STYLES[cat]
            } ${isSelected ? "ring-2 ring-amber-300 z-50" : "hover:brightness-110"}`}
          >
            {/* Left edge resize handle */}
            <div
              data-testid={`timeline-motion-resize-left-${motionId}`}
              onPointerDown={(e) => handleStartDragBlock(e, target, el, motion, "resize-left")}
              title="Drag left edge to adjust start & duration"
              className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-white/30 rounded-l"
            />

            {/* Main draggable body */}
            <div
              data-testid={`timeline-motion-drag-${motionId}`}
              onPointerDown={(e) => handleStartDragBlock(e, target, el, motion, "move")}
              title={`${motion.name || motion.presetId} (${effStart.toFixed(2)}s – ${(effStart + motion.duration).toFixed(2)}s) · Drag to move or drop onto another track`}
              className="flex min-w-0 flex-1 items-center gap-1 px-1 cursor-grab active:cursor-grabbing overflow-hidden"
            >
              <span className="opacity-80 text-[8px]">#{orderIndex + 1}</span>
              <span className="truncate font-semibold">{motion.name || motion.presetId}</span>
            </div>

            {/* Right edge resize handle */}
            <div
              data-testid={`timeline-motion-resize-right-${motionId}`}
              onPointerDown={(e) => handleStartDragBlock(e, target, el, motion, "resize-right")}
              title="Drag right edge to change duration"
              className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-white/30 rounded-r"
            />
          </div>
        );
      })}
    </div>
  );
}
