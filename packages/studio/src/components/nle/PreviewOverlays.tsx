import { useCallback, useEffect } from "react";
import { CaptionOverlay } from "../../captions/components/CaptionOverlay";
import { useCaptionStore } from "../../captions/store";
import { ConnectedDomEditOverlay } from "../editor/ConnectedDomEditOverlay";
import { TopologyLens } from "../editor/TopologyLens";
import { MotionPathOverlay } from "../editor/MotionPathOverlay";
import { StudioMotionCanvasOverlay } from "../editor/StudioMotionCanvasOverlay";
import { SnapToolbar } from "../editor/SnapToolbar";
import { GridOverlay } from "../editor/GridOverlay";
import { usePreviewOverlayContext } from "../editor/PreviewOverlayProvider";
import { usePreviewReadOnly } from "../editor/previewReadOnlyContext";
import { useCompositionDimensions } from "../../hooks/useCompositionDimensions";
import { useStudioPlaybackContext, useStudioShellContext } from "../../contexts/StudioContext";
import { useDomEditSelectionContext } from "../../contexts/DomEditContext";
import { useDocumentaryQcOverlayStore } from "../../utils/studioLayerActions";
import { CanvasCommentsOverlay } from "../editor/CanvasCommentsOverlay";
import type { BlockPreviewInfo } from "../sidebar/BlocksTab";
import type { GestureRecordingState } from "../editor/GestureRecordControl";
import type { ReactNode } from "react";

function DocumentaryQcOverlay({
  iframeRef,
}: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}) {
  const safeZoneVisible = useDocumentaryQcOverlayStore((s) => s.safeZoneVisible);
  const backdropMode = useDocumentaryQcOverlayStore((s) => s.backdropMode);
  const cycleBackdropMode = useDocumentaryQcOverlayStore((s) => s.cycleBackdropMode);
  const { state } = usePreviewOverlayContext();
  const {
    scaleX,
    scaleY,
    left: compositionLeft,
    top: compositionTop,
    width: compositionWidth,
    height: compositionHeight,
  } = state.compositionRect;

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const styleId = "hf-qc-backdrop-override";
    let styleEl = doc.getElementById(styleId) as HTMLStyleElement | null;
    if (backdropMode === "default") {
      styleEl?.remove();
      return;
    }
    if (!styleEl) {
      styleEl = doc.createElement("style");
      styleEl.id = styleId;
      doc.head.appendChild(styleEl);
    }
    const bgCss =
      backdropMode === "checkerboard"
        ? "repeating-conic-gradient(#cbd5e1 0% 25%, #f8fafc 0% 50%) 50% / 28px 28px !important"
        : backdropMode === "light"
          ? "#F5F0E6 !important"
          : "#142838 !important";
    styleEl.textContent = `
      html, body, #root, [data-composition-id] {
        background: ${bgCss};
      }
      [id$="-bg"], [class*="bg-plate"], .vignette, .grain {
        opacity: 0.08 !important;
      }
    `;
    return () => {
      styleEl?.remove();
    };
  }, [backdropMode, iframeRef]);

  if (!safeZoneVisible && backdropMode === "default") return null;

  const safeLeft = compositionLeft + 90 * scaleX;
  const safeTop = compositionTop + 70 * scaleY;
  const safeWidth = Math.max(0, compositionWidth - 180 * scaleX);
  const safeHeight = Math.max(0, compositionHeight - 140 * scaleY);

  return (
    <>
      {safeZoneVisible && compositionWidth > 0 && compositionHeight > 0 && (
        <div
          aria-label="Safe margin 90x70 guide"
          className="pointer-events-none absolute z-40 border border-dashed border-amber-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]"
          style={{
            left: safeLeft,
            top: safeTop,
            width: safeWidth,
            height: safeHeight,
          }}
        >
          <span className="absolute -top-4 left-1 rounded bg-amber-500/90 px-1.5 py-0.2 font-mono text-[9px] font-bold tracking-wider text-black uppercase">
            SAFE 90×70 (1740×940)
          </span>
        </div>
      )}
      {backdropMode !== "default" && (
        <button
          type="button"
          onClick={cycleBackdropMode}
          className="pointer-events-auto absolute top-2 right-2 z-50 flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-black/80 px-2.5 py-1 font-mono text-[10px] text-amber-200 hover:bg-black"
          title="Click to cycle cutout halo inspection backdrop"
        >
          <span>Backdrop QC: {backdropMode.toUpperCase()}</span>
        </button>
      )}
    </>
  );
}

export interface PreviewOverlaysProps {
  shouldShowMotionPath: boolean;
  shouldShowSelectedDomBounds: boolean;
  blockPreview?: BlockPreviewInfo | null;
  isGestureRecording?: boolean;
  recordingState?: GestureRecordingState;
  onToggleRecording?: () => void;
  gestureOverlay?: ReactNode;
}

// fallow-ignore-next-line complexity
export function PreviewOverlays({
  shouldShowMotionPath,
  shouldShowSelectedDomBounds,
  blockPreview,
  isGestureRecording,
  gestureOverlay,
}: PreviewOverlaysProps) {
  const { projectId, activeCompPath, previewIframeRef } = useStudioShellContext();
  const { captionEditMode, compositionLoading, isPlaying } = useStudioPlaybackContext();
  const compositionDimensions = useCompositionDimensions(previewIframeRef);
  const readOnly = usePreviewReadOnly();
  const previewCaptionEditMode = captionEditMode && !readOnly;

  // Caption edit mode is entered automatically when captions are detected;
  // these give the author an explicit way OUT (and back in). Without them the
  // caption overlay permanently replaces normal element editing.
  const captionModelPresent = useCaptionStore((state) => state.model !== null);
  const captionDismissed = useCaptionStore((state) => state.dismissed);
  const captionSyncError = useCaptionStore((state) => state.syncError);
  const exitCaptionMode = useCallback(() => {
    const store = useCaptionStore.getState();
    store.clearSelection();
    store.setDismissed(true);
    store.setEditMode(false);
  }, []);
  const enterCaptionMode = useCallback(() => {
    const store = useCaptionStore.getState();
    store.setDismissed(false);
    store.setEditMode(true);
  }, []);

  const { domEditSelection } = useDomEditSelectionContext();

  if (blockPreview) {
    return (
      <>
        <TopologyLens iframeRef={previewIframeRef} activeCompositionPath={activeCompPath} />
        <div className="absolute inset-0 z-30 bg-black pointer-events-none">
          {blockPreview.videoUrl ? (
            <video
              src={blockPreview.videoUrl}
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-full object-contain"
            />
          ) : blockPreview.posterUrl ? (
            <img
              src={blockPreview.posterUrl}
              alt={blockPreview.title}
              className="w-full h-full object-contain"
            />
          ) : null}
        </div>
      </>
    );
  }

  if (previewCaptionEditMode) {
    return (
      <>
        <TopologyLens iframeRef={previewIframeRef} activeCompositionPath={activeCompPath} />
        <CaptionOverlay iframeRef={previewIframeRef} />
        {/* Mode indicator + explicit exit */}
        <div className="pointer-events-auto absolute top-2 left-1/2 -translate-x-1/2 z-60 flex items-center gap-2 rounded-full border border-studio-accent/40 bg-black/70 px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-studio-accent" aria-hidden="true" />
          <span className="text-2xs text-neutral-200">Editing captions</span>
          <button
            type="button"
            onClick={exitCaptionMode}
            className="rounded-sm text-2xs text-neutral-400 underline underline-offset-2 hover:text-neutral-100 focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-studio-accent"
          >
            Exit
          </button>
        </div>
        {captionSyncError && (
          <div
            role="alert"
            className="pointer-events-auto absolute top-10 left-1/2 -translate-x-1/2 z-60 flex items-center gap-2 rounded-full border border-red-500/50 bg-red-950/90 px-2.5 py-1"
          >
            <span className="text-2xs text-red-200">{captionSyncError}</span>
            <button
              type="button"
              onClick={() => useCaptionStore.getState().retrySave?.()}
              className="rounded-sm text-2xs text-red-100 underline underline-offset-2 hover:text-white"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => useCaptionStore.getState().setSyncError(null)}
              aria-label="Dismiss"
              className="rounded-sm px-0.5 text-2xs text-red-300/70 hover:text-red-100"
            >
              ✕
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <TopologyLens iframeRef={previewIframeRef} activeCompositionPath={activeCompPath} />
      <GridOverlay />
      <DocumentaryQcOverlay iframeRef={previewIframeRef} />
      <CanvasCommentsOverlay
        projectId={projectId}
        activeCompPath={activeCompPath}
        iframeRef={previewIframeRef}
      />
      <ConnectedDomEditOverlay
        activeCompositionPath={activeCompPath}
        showHoverSelection={!previewCaptionEditMode && !compositionLoading && !isPlaying}
        shouldShowSelectedDomBounds={shouldShowSelectedDomBounds}
        isGestureRecording={isGestureRecording}
      />
      <SnapToolbar />
      {!readOnly && (
        <>
          <StudioMotionCanvasOverlay />
          <MotionPathOverlay
            iframeRef={previewIframeRef}
            selection={shouldShowMotionPath ? domEditSelection : null}
            compositionSize={compositionDimensions}
            isPlaying={isPlaying}
          />
        </>
      )}
      {gestureOverlay}
      {captionModelPresent && captionDismissed && (
        <button
          type="button"
          onClick={enterCaptionMode}
          className="pointer-events-auto absolute top-2 left-1/2 -translate-x-1/2 z-60 rounded-full border border-neutral-700 bg-black/60 px-2.5 py-1 text-2xs text-neutral-300 transition-colors hover:border-studio-accent/50 hover:text-accent-ink focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-studio-accent"
        >
          Edit captions
        </button>
      )}
    </>
  );
}
