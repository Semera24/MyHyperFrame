import { memo, useEffect, useRef, useState } from "react";
import { EyeSlash, SlidersHorizontal, Trash } from "@phosphor-icons/react";
import {
  useDomEditActionsContextOptional,
  useDomEditSelectionContextOptional,
} from "../../contexts/DomEditContext";
import { usePlayerStore, type TimelineElement } from "../../player";
import { useDocumentaryQcOverlayStore } from "../../utils/studioLayerActions";
import { useCanvasCommentsStore } from "../editor/canvasCommentsStore";
import { useCropPresetBarStore } from "../editor/cropPresetStore";
import {
  classifyLayerDeletionSafety,
  isUserAddedStudioLayer,
} from "../editor/InspectorLayerActions";
import { Tooltip } from "../ui";

export interface TimelineQuickToolsMenuProps {
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
}

export const TimelineQuickToolsMenu = memo(function TimelineQuickToolsMenu({
  onDeleteElement,
}: TimelineQuickToolsMenuProps) {
  const selectionCtx = useDomEditSelectionContextOptional();
  const actionsCtx = useDomEditActionsContextOptional();
  const selection = selectionCtx?.domEditSelection ?? null;
  const elements = usePlayerStore((s) => s.elements);
  const selectedIds = usePlayerStore((s) => s.selectedElementIds);

  const safeZoneVisible = useDocumentaryQcOverlayStore((s) => s.safeZoneVisible);
  const toggleSafeZone = useDocumentaryQcOverlayStore((s) => s.toggleSafeZone);
  const backdropMode = useDocumentaryQcOverlayStore((s) => s.backdropMode);
  const cycleBackdropMode = useDocumentaryQcOverlayStore((s) => s.cycleBackdropMode);
  const commentModeActive = useCanvasCommentsStore((s) => s.commentModeActive);
  const toggleCommentMode = useCanvasCommentsStore((s) => s.toggleCommentMode);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const selectedTimelineEl =
    elements.find((el) => {
      const key = el.key ?? el.id;
      return selectedIds instanceof Set
        ? selectedIds.has(key) || selectedIds.has(el.id)
        : Array.isArray(selectedIds)
          ? (selectedIds as string[]).includes(key) || (selectedIds as string[]).includes(el.id)
          : false;
    }) ??
    (selection
      ? elements.find(
          (el) => el.id === selection.hfId || el.id === selection.id || el.domId === selection.id,
        )
      : undefined);

  const hasLayerSelection = Boolean(selection || selectedTimelineEl);
  const totalSceneCount = elements.filter(
    (el) => el.type === "composition" || Boolean(el.compositionSrc),
  ).length;
  const safety = classifyLayerDeletionSafety(
    selection,
    undefined,
    selectedTimelineEl,
    Math.max(1, totalSceneCount),
  );
  const isSceneComp = safety.isSceneComposition;
  const isUserAdded = isUserAddedStudioLayer(selection?.element ?? null, selectedTimelineEl);

  const triggerDeleteSelection = () => {
    if (selection && actionsCtx) {
      void actionsCtx.handleDomEditElementDelete(selection, { expandGroup: true });
    } else if (selectedTimelineEl && onDeleteElement) {
      void onDeleteElement(selectedTimelineEl);
    } else if (selectedTimelineEl) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    }
  };

  return (
    <div className="flex items-center gap-1 mr-1">
      {hasLayerSelection && isSceneComp && !safety.isProtectedScene && (
        <Tooltip label="Delete selected scene clip (Delete / Backspace)">
          <button
            type="button"
            data-testid="timeline-delete-scene-button"
            aria-label="Delete Scene"
            onClick={triggerDeleteSelection}
            className="h-7 px-2.5 rounded-md text-[11px] font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-neutral-100 border border-rose-500/50 flex items-center gap-1.5 transition-colors shrink-0 whitespace-nowrap cursor-pointer shadow-xs"
          >
            <Trash size={13} weight="bold" aria-hidden="true" />
            <span>Delete Scene</span>
          </button>
        </Tooltip>
      )}
      {hasLayerSelection && !isSceneComp && isUserAdded && (
        <Tooltip label="Delete selected layer (Delete / Backspace)">
          <button
            type="button"
            data-testid="timeline-delete-layer-button"
            aria-label="Delete Layer"
            onClick={triggerDeleteSelection}
            className="h-7 px-2.5 rounded-md text-[11px] font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-neutral-100 border border-rose-500/50 flex items-center gap-1.5 transition-colors shrink-0 whitespace-nowrap cursor-pointer shadow-xs"
          >
            <Trash size={13} weight="bold" aria-hidden="true" />
            <span>Delete Layer</span>
          </button>
        </Tooltip>
      )}
      {hasLayerSelection && !isSceneComp && !isUserAdded && selectedTimelineEl && (
        <Tooltip label="Authored in source HTML — safely hide or show this layer in Studio without destroying code">
          <button
            type="button"
            data-testid="timeline-hide-layer-button"
            aria-label={selectedTimelineEl.hidden ? "Show in Studio" : "Hide in Studio"}
            onClick={() => {
              const doc = selection?.element.ownerDocument;
              if (selection?.element && doc) {
                if (selectedTimelineEl.hidden) {
                  selection.element.removeAttribute("data-hidden");
                  selection.element.style.removeProperty("display");
                } else {
                  selection.element.setAttribute("data-hidden", "true");
                  selection.element.style.setProperty("display", "none");
                }
              }
              usePlayerStore.setState((state) => ({
                elements: state.elements.map((el) =>
                  el.id === selectedTimelineEl.id ? { ...el, hidden: !el.hidden } : el,
                ),
              }));
            }}
            className="h-7 px-2.5 rounded-md text-[11px] font-semibold bg-amber-500/25 hover:bg-amber-500/35 text-neutral-100 border border-amber-400/50 flex items-center gap-1.5 transition-colors shrink-0 whitespace-nowrap cursor-pointer shadow-xs"
          >
            <EyeSlash size={13} weight="bold" aria-hidden="true" />
            <span>{selectedTimelineEl.hidden ? "Show in Studio" : "Hide in Studio"}</span>
          </button>
        </Tooltip>
      )}

      <div ref={menuRef} className="relative">
        <Tooltip label="Safe-area guides, cutout backdrop, canvas comments & crop tools">
          <button
            type="button"
            data-testid="timeline-guides-menu-button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
            className={`h-7 px-2 rounded-md text-[11px] font-medium flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap cursor-pointer ${
              menuOpen || safeZoneVisible || backdropMode !== "default" || commentModeActive
                ? "bg-amber-500/15 text-amber-300 border border-amber-500/35"
                : "text-neutral-400 hover:bg-hover hover:text-neutral-200"
            }`}
          >
            <SlidersHorizontal size={13} weight="bold" aria-hidden="true" />
            <span>Guides & Tools ▾</span>
          </button>
        </Tooltip>
        {menuOpen && (
          <div
            role="menu"
            data-testid="timeline-guides-menu"
            className="absolute right-0 top-full mt-1.5 z-200 w-56 rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 shadow-xl text-xs"
          >
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Canvas Guides & Tools
            </div>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={safeZoneVisible}
              onClick={toggleSafeZone}
              className="w-full text-left px-2 py-1.5 rounded text-neutral-200 hover:bg-neutral-800 flex items-center justify-between cursor-pointer"
            >
              <span>Safe Area 90×70 Guide</span>
              <span className="text-[10px] font-mono text-amber-300">
                {safeZoneVisible ? "ON" : "OFF"}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={cycleBackdropMode}
              className="w-full text-left px-2 py-1.5 rounded text-neutral-200 hover:bg-neutral-800 flex items-center justify-between cursor-pointer"
            >
              <span>Cutout Backdrop</span>
              <span className="text-[10px] font-mono text-amber-300">{backdropMode}</span>
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={commentModeActive}
              onClick={() => {
                toggleCommentMode();
                setMenuOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 rounded text-neutral-200 hover:bg-neutral-800 flex items-center justify-between cursor-pointer"
            >
              <span>Comment on Canvas</span>
              <span className="text-[10px] font-mono text-amber-300">
                {commentModeActive ? "ON" : "OFF"}
              </span>
            </button>
            <div className="my-1 border-t border-neutral-800" />
            <button
              type="button"
              role="menuitem"
              disabled={!selection}
              onClick={() => {
                if (!selection) return;
                useCropPresetBarStore.getState().open({
                  hfId: selection.hfId ?? undefined,
                  id: selection.id ?? undefined,
                });
                setMenuOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 rounded text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 flex items-center justify-between cursor-pointer"
            >
              <span>Crop Selected Layer</span>
              <span className="text-[10px] text-neutral-500">Canvas</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
