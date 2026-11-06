import type React from "react";
import { HiddenToggleIcon } from "../../player/components/hiddenToggle";
import {
  detectUnbundleCandidate,
  toggleDomLayerHidden,
  unbundleElementContainer,
} from "../../utils/studioLayerActions";
import { isLayerDraggable, type LayerReorderEvent } from "./useLayerDrag";
import type { DomEditLayerItem } from "./domEditingTypes";

export function LayerRowQuickActions({
  layer,
  allLayers,
  projectId,
  activeCompPath,
  onReorder,
  onRefreshLayers,
  onReloadPreview,
}: {
  layer: DomEditLayerItem;
  allLayers: readonly DomEditLayerItem[];
  projectId?: string | null;
  activeCompPath: string | null;
  onReorder: (event: LayerReorderEvent) => void;
  onRefreshLayers: () => void;
  onReloadPreview?: () => void;
}) {
  const isHidden = layer.element.hasAttribute("data-hidden");
  const draggable = isLayerDraggable(layer);
  const siblings = draggable
    ? allLayers.filter(
        (candidate) =>
          candidate.element.parentElement === layer.element.parentElement &&
          isLayerDraggable(candidate),
      )
    : [];
  const siblingIdx = siblings.findIndex((candidate) => candidate.key === layer.key);
  const canMoveUp = draggable && siblingIdx > 0;
  const canMoveDown = draggable && siblingIdx >= 0 && siblingIdx < siblings.length - 1;
  const canUnbundle = layer.childCount > 0 && Boolean(detectUnbundleCandidate(layer.element));

  return (
    <div
      className="ml-auto flex shrink-0 items-center gap-0.5 opacity-80 group-hover:opacity-100"
      onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
    >
      {canUnbundle && projectId && onReloadPreview && (
        <button
          type="button"
          title="Unbundle Grid/Flex container into freely movable absolute layers"
          aria-label={`Unbundle ${layer.label}`}
          onClick={() => {
            void unbundleElementContainer({
              element: layer.element,
              projectId,
              activeCompPath,
              reloadPreview: onReloadPreview,
            });
          }}
          className="mr-0.5 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-semibold text-amber-300 hover:bg-amber-500/30"
        >
          Unbundle
        </button>
      )}
      {draggable && siblings.length > 1 && (
        <>
          <button
            type="button"
            disabled={!canMoveUp}
            aria-label={`Bring ${layer.label} forward`}
            title="Move layer up / Bring Forward (higher z-index)"
            onClick={() => {
              if (canMoveUp) {
                onReorder({
                  siblingLayers: siblings,
                  fromIndex: siblingIdx,
                  toIndex: siblingIdx - 1,
                });
              }
            }}
            className="flex h-4 w-4 items-center justify-center rounded text-[10px] leading-none text-panel-text-4 hover:bg-panel-hover hover:text-panel-text-1 disabled:pointer-events-none disabled:opacity-25"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={!canMoveDown}
            aria-label={`Send ${layer.label} backward`}
            title="Move layer down / Send Backward (lower z-index)"
            onClick={() => {
              if (canMoveDown) {
                onReorder({
                  siblingLayers: siblings,
                  fromIndex: siblingIdx,
                  toIndex: siblingIdx + 1,
                });
              }
            }}
            className="flex h-4 w-4 items-center justify-center rounded text-[10px] leading-none text-panel-text-4 hover:bg-panel-hover hover:text-panel-text-1 disabled:pointer-events-none disabled:opacity-25"
          >
            ↓
          </button>
        </>
      )}
      <button
        type="button"
        aria-label={isHidden ? `Show ${layer.label}` : `Hide ${layer.label}`}
        title={isHidden ? "Show layer (remove data-hidden)" : "Hide layer (set data-hidden)"}
        onClick={() => {
          void toggleDomLayerHidden({
            element: layer.element,
            projectId,
            activeCompPath,
          }).then(() => {
            onRefreshLayers();
          });
        }}
        className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
          isHidden
            ? "text-amber-400 hover:bg-panel-hover hover:text-amber-300"
            : "text-panel-text-4 hover:bg-panel-hover hover:text-panel-text-1"
        }`}
      >
        <HiddenToggleIcon asMute={false} hidden={isHidden} size={12} />
      </button>
    </div>
  );
}
