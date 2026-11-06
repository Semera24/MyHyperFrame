import { useCallback, useEffect, useState } from "react";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { useFileManagerContext } from "../../contexts/FileManagerContext";
import { useDomEditSelectionContext } from "../../contexts/DomEditContext";
import { usePreviewOverlayContext } from "./PreviewOverlayProvider";
import { useDockLayoutStore } from "../dock/dockLayoutStore";
import { usePlayerStore } from "../../player";
import {
  STUDIO_MOTION_DRAG_MIME,
  compileMotionPreset,
  type StudioMotionDragPayload,
} from "./motionPresetCatalog";
import {
  addStudioGsapMotion,
  applyStudioMotionManifest,
  selectionTarget,
  updateStudioGsapMotionById,
  type StudioMotionPathConfig,
  type StudioMotionTarget,
} from "./studioMotion";
import { detectStudioMotionConflict, useStudioMotionStore } from "./useStudioMotionStore";
import { getActiveDraggedMotionPayload } from "../panels/MotionLibraryPanel";

function resolveCanvasDropElement(
  iframe: HTMLIFrameElement | null,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  if (!iframe || !iframe.contentDocument) return null;
  const iframeRect = iframe.getBoundingClientRect();
  const doc = iframe.contentDocument;
  const docWidth = doc.documentElement.clientWidth || 1920;
  const docHeight = doc.documentElement.clientHeight || 1080;
  if (iframeRect.width <= 0 || iframeRect.height <= 0) return null;

  const relX = ((clientX - iframeRect.left) / iframeRect.width) * docWidth;
  const relY = ((clientY - iframeRect.top) / iframeRect.height) * docHeight;

  const hit = doc.elementFromPoint(relX, relY) as HTMLElement | null;
  if (!hit) return null;

  const editable = hit.closest<HTMLElement>("[id], [data-hf-id]");
  if (
    editable &&
    editable.id !== "root" &&
    !editable.hasAttribute("data-composition-id") &&
    editable.tagName !== "BODY" &&
    editable.tagName !== "HTML"
  ) {
    return editable;
  }
  return null;
}

export function StudioMotionCanvasOverlay() {
  const { activeCompPath, previewIframeRef, showToast } = useStudioShellContext();
  const { writeProjectFile } = useFileManagerContext();
  const { domEditSelection } = useDomEditSelectionContext();
  const { state: overlayState } = usePreviewOverlayContext();
  const currentTime = usePlayerStore((s) => s.currentTime);

  const {
    manifest,
    selectedMotionId,
    activeStylePreset,
    setManifestLive,
    commitManifest,
    setSelectedMotionId,
    setPendingConflict,
  } = useStudioMotionStore();

  const [isDraggingOverCanvas, setIsDraggingOverCanvas] = useState(false);
  const [hoveredTargetLabel, setHoveredTargetLabel] = useState<string | null>(null);
  const [presetDragActive, setPresetDragActive] = useState(false);

  useEffect(() => {
    const onDragStart = () => {
      if (getActiveDraggedMotionPayload() !== null) {
        setPresetDragActive(true);
      }
    };
    const onDragEnd = () => {
      setPresetDragActive(false);
      setIsDraggingOverCanvas(false);
      setHoveredTargetLabel(null);
    };
    window.addEventListener("dragstart", onDragStart);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("dragend", onDragEnd);
    };
  }, []);

  const handleCanvasDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOverCanvas(false);
      setHoveredTargetLabel(null);
      setPresetDragActive(false);

      let payload: StudioMotionDragPayload | null = null;
      try {
        const raw =
          e.dataTransfer.getData(STUDIO_MOTION_DRAG_MIME) || e.dataTransfer.getData("text/plain");
        if (raw) {
          const parsed = JSON.parse(raw) as StudioMotionDragPayload;
          if (parsed && typeof parsed.presetId === "string") {
            payload = parsed;
          }
        }
      } catch {
        // fallback
      }
      if (!payload) {
        payload = getActiveDraggedMotionPayload();
      }
      if (!payload) return;

      const iframe = previewIframeRef.current;
      const iframeDoc = iframe?.contentDocument ?? null;
      const hitEl = resolveCanvasDropElement(iframe, e.clientX, e.clientY);

      const hitId = hitEl?.id || hitEl?.getAttribute("data-hf-id") || undefined;
      const target: StudioMotionTarget | null = hitId
        ? {
            sourceFile: activeCompPath || "index.html",
            id: hitId,
            selector: `#${hitId}`,
          }
        : domEditSelection
          ? selectionTarget(domEditSelection)
          : null;

      if (!target) {
        showToast("Drop onto a specific image, text, card, or map element on the canvas.", "info");
        return;
      }

      useDockLayoutStore.getState().activatePanel("motion");

      const dropTime = Number(currentTime.toFixed(2));
      const compiled = compileMotionPreset(payload.presetId, {
        start: dropTime,
        stylePreset: payload.stylePreset ?? activeStylePreset,
      });

      const conflict = detectStudioMotionConflict(manifest, target, compiled, iframeDoc);
      if (conflict) {
        setPendingConflict(conflict);
        return;
      }

      const nextManifest = addStudioGsapMotion(manifest, target, compiled);
      const added = nextManifest.motions.at(-1);
      if (added?.id) setSelectedMotionId(added.id);

      await commitManifest(
        nextManifest,
        `Drop ${compiled.name || compiled.presetId} onto #${target.id || target.selector}`,
        {
          writeProjectFile,
          iframeDoc,
          activeCompPath,
          currentTime,
        },
      );
      showToast(
        `Applied ${compiled.name || compiled.presetId} to #${target.id || target.selector} @ ${dropTime.toFixed(2)}s`,
        "info",
      );
    },
    [
      previewIframeRef,
      activeCompPath,
      domEditSelection,
      currentTime,
      activeStylePreset,
      manifest,
      setPendingConflict,
      setSelectedMotionId,
      commitManifest,
      writeProjectFile,
      showToast,
    ],
  );

  // Find active path motion if one is selected
  let activePathContext: {
    target: StudioMotionTarget;
    motionId: string;
    presetId: string;
    start: number;
    duration: number;
    delay?: number;
    motionPath: StudioMotionPathConfig;
  } | null = null;

  for (const m of manifest.motions) {
    if (
      m.id &&
      m.category === "path" &&
      m.motionPath &&
      m.motionPath.points.length >= 2 &&
      (m.id === selectedMotionId || (domEditSelection?.id && m.target.id === domEditSelection.id))
    ) {
      activePathContext = {
        target: m.target,
        motionId: m.id,
        presetId: m.presetId ?? "path-custom",
        start: m.start,
        duration: m.duration,
        delay: m.delay,
        motionPath: m.motionPath,
      };
    }
  }

  const {
    left: compLeft,
    top: compTop,
    width: compWidth,
    height: compHeight,
    scaleX,
    scaleY,
  } = overlayState.compositionRect;

  const anchorX = compLeft + (compWidth > 0 ? compWidth * 0.5 : 480);
  const anchorY = compTop + (compHeight > 0 ? compHeight * 0.5 : 270);

  return (
    <>
      <div
        data-testid="canvas-motion-dropzone"
        onDragOver={(e) => {
          if (
            e.dataTransfer.types.includes(STUDIO_MOTION_DRAG_MIME) ||
            getActiveDraggedMotionPayload() !== null
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setIsDraggingOverCanvas(true);
            const hit = resolveCanvasDropElement(previewIframeRef.current, e.clientX, e.clientY);
            const label =
              hit?.id || hit?.getAttribute("data-hf-id") || domEditSelection?.id || null;
            setHoveredTargetLabel(label);

            const payload = getActiveDraggedMotionPayload();
            const doc = previewIframeRef.current?.contentDocument;
            if (payload && doc && label) {
              const tempTarget: StudioMotionTarget = {
                sourceFile: activeCompPath || "index.html",
                id: label,
                selector: `#${label}`,
              };
              const previewCompiled = compileMotionPreset(payload.presetId, {
                start: Math.max(0, currentTime - 0.35),
                stylePreset: payload.stylePreset ?? activeStylePreset,
              });
              const tempManifest = addStudioGsapMotion(manifest, tempTarget, previewCompiled);
              applyStudioMotionManifest(doc, tempManifest, activeCompPath, currentTime);
            }
          }
        }}
        onDragLeave={() => {
          setIsDraggingOverCanvas(false);
          setHoveredTargetLabel(null);
          const doc = previewIframeRef.current?.contentDocument;
          if (doc) {
            applyStudioMotionManifest(doc, manifest, activeCompPath, currentTime);
          }
        }}
        onDrop={(e) => void handleCanvasDrop(e)}
        className={`absolute inset-0 z-40 transition-colors ${
          isDraggingOverCanvas ? "border-2 border-dashed border-amber-400 bg-amber-500/5" : ""
        }`}
        style={{
          pointerEvents: presetDragActive || isDraggingOverCanvas ? "auto" : "none",
        }}
      >
        {isDraggingOverCanvas && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-amber-400/80 bg-black/85 px-3 py-1 font-mono text-xs text-amber-200 shadow-lg">
            {hoveredTargetLabel
              ? `Drop Motion onto #${hoveredTargetLabel} @ ${currentTime.toFixed(2)}s`
              : `Drop Motion @ ${currentTime.toFixed(2)}s`}
          </div>
        )}
      </div>

      {activePathContext && (
        <svg
          data-testid="canvas-motion-path-overlay"
          className="pointer-events-none absolute inset-0 z-45 h-full w-full overflow-visible"
        >
          <polyline
            fill="none"
            stroke="#22d3ee"
            strokeWidth="2.5"
            strokeDasharray="6 4"
            points={activePathContext.motionPath.points
              .map(
                (pt) => `${anchorX + pt.x * (scaleX || 0.5)},${anchorY + pt.y * (scaleY || 0.5)}`,
              )
              .join(" ")}
          />
          {activePathContext.motionPath.points.map((pt, idx) => {
            const cx = anchorX + pt.x * (scaleX || 0.5);
            const cy = anchorY + pt.y * (scaleY || 0.5);
            return (
              <g key={idx}>
                <circle
                  data-testid={`canvas-path-point-${idx}`}
                  cx={cx}
                  cy={cy}
                  r={7}
                  fill={idx === 0 ? "#10b981" : "#22d3ee"}
                  stroke="#0f172a"
                  strokeWidth={2}
                  className="pointer-events-auto cursor-move"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (!activePathContext) return;
                    const ctx = activePathContext;
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const origPt = { ...pt };
                    let latestPoints = [...ctx.motionPath.points];
                    const iframeDoc = previewIframeRef.current?.contentDocument ?? null;

                    const onMove = (moveEv: PointerEvent) => {
                      const dx = (moveEv.clientX - startX) / (scaleX || 0.5);
                      const dy = (moveEv.clientY - startY) / (scaleY || 0.5);
                      latestPoints = ctx.motionPath.points.map((p, i) =>
                        i === idx
                          ? { x: Math.round(origPt.x + dx), y: Math.round(origPt.y + dy) }
                          : p,
                      );
                      const recompiled = compileMotionPreset(ctx.presetId, {
                        id: ctx.motionId,
                        start: ctx.start,
                        duration: ctx.duration,
                        delay: ctx.delay,
                        stylePreset: activeStylePreset,
                        motionPath: {
                          type: ctx.motionPath.type,
                          points: latestPoints,
                          reverse: ctx.motionPath.reverse,
                        },
                      });
                      const updated = updateStudioGsapMotionById(
                        manifest,
                        ctx.motionId,
                        recompiled,
                      );
                      setManifestLive(
                        updated,
                        iframeDoc,
                        activeCompPath,
                        ctx.start + ctx.duration * 0.5,
                      );
                    };

                    const onUp = () => {
                      window.removeEventListener("pointermove", onMove);
                      window.removeEventListener("pointerup", onUp);
                      const recompiled = compileMotionPreset(ctx.presetId, {
                        id: ctx.motionId,
                        start: ctx.start,
                        duration: ctx.duration,
                        delay: ctx.delay,
                        stylePreset: activeStylePreset,
                        motionPath: {
                          type: ctx.motionPath.type,
                          points: latestPoints,
                          reverse: ctx.motionPath.reverse,
                        },
                      });
                      const updated = updateStudioGsapMotionById(
                        manifest,
                        ctx.motionId,
                        recompiled,
                      );
                      void commitManifest(updated, `Drag motion path waypoint P${idx + 1}`, {
                        writeProjectFile,
                        iframeDoc,
                        activeCompPath,
                        currentTime,
                      });
                    };

                    window.addEventListener("pointermove", onMove);
                    window.addEventListener("pointerup", onUp);
                  }}
                />
                <text
                  x={cx + 10}
                  y={cy + 4}
                  fill="#a5f3fc"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  P{idx + 1} ({pt.x},{pt.y})
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </>
  );
}
