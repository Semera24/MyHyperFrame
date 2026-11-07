import type { DomEditSelection } from "./domEditing";
import { usePlayerStore, type TimelineElement } from "../../player";
import { keyHint, useStudioKeys } from "../../player/components/studioShortcuts";

export interface LayerDeletionSafety {
  deletable: boolean;
  isSceneComposition: boolean;
  isProtectedScene?: boolean;
  handAuthored: boolean;
  reason?: string;
}

/**
 * Returns true if the DOM node or timeline element was created/added as a user layer
 * in Studio (e.g. via + Text, + Image, + Add Layer, Media/Audio drop, Template block, or Group).
 */
export function isUserAddedStudioLayer(
  element: HTMLElement | null | undefined,
  timelineEl?: TimelineElement | null,
): boolean {
  if (element) {
    if (
      element.hasAttribute("data-studio-free-layer") ||
      element.hasAttribute("data-hf-group") ||
      element.hasAttribute("data-hf-block") ||
      element.classList?.contains("clip")
    ) {
      return true;
    }
    const id = element.id || "";
    if (
      id.startsWith("free-layer-") ||
      id.startsWith("hf-group-") ||
      id.startsWith("clip-") ||
      id.startsWith("text-layer") ||
      id.startsWith("image-layer")
    ) {
      return true;
    }
  }
  if (timelineEl) {
    if (timelineEl.type === "audio" || timelineEl.type === "video") {
      return true;
    }
    const rawId = timelineEl.domId || timelineEl.id || "";
    if (
      rawId.startsWith("free-layer-") ||
      rawId.startsWith("hf-group-") ||
      rawId.startsWith("clip-") ||
      rawId.includes("text-layer") ||
      rawId.includes("image-layer")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Classifies whether a selected DOM element or timeline element can be deleted directly
 * ("Delete Layer" / "Delete Scene") or if it is authored directly in source HTML
 * and should instead offer a safe "Hide in Studio" action.
 */
export function classifyLayerDeletionSafety(
  selection: DomEditSelection | null | undefined,
  gsapAnimations?: readonly unknown[],
  timelineEl?: TimelineElement | null,
  totalSceneCount = 2,
): LayerDeletionSafety {
  if (!selection && !timelineEl) {
    return { deletable: false, isSceneComposition: false, handAuthored: false };
  }

  const el = selection?.element ?? null;

  // Scene composition wrapper on the master timeline
  const isSceneComp =
    Boolean(
      el &&
      (el.hasAttribute("data-composition") ||
        el.hasAttribute("data-composition-src") ||
        el.hasAttribute("data-src")) &&
      !el.hasAttribute("data-hf-block"),
    ) ||
    timelineEl?.type === "composition" ||
    Boolean(timelineEl?.compositionSrc);

  if (isSceneComp) {
    const isProtected = totalSceneCount <= 1 || Boolean(selection?.isInsideLockedComposition);
    return {
      deletable: !isProtected,
      isSceneComposition: true,
      isProtectedScene: isProtected,
      handAuthored: false,
      reason: isProtected
        ? "This is the only scene in the composition (or is locked) and is protected from deletion."
        : undefined,
    };
  }

  // Root stage container cannot be deleted
  if (el && el.id === "root" && el.hasAttribute("data-composition-id")) {
    return {
      deletable: false,
      isSceneComposition: false,
      handAuthored: true,
      reason: "Composition root is authored directly in source HTML and cannot be deleted.",
    };
  }

  // User-added layers created in Studio are always safely deletable.
  if (isUserAddedStudioLayer(el, timelineEl)) {
    return { deletable: true, isSceneComposition: false, handAuthored: false };
  }

  // Check if this element lives inside a live composition document and was authored in source HTML.
  const doc = el?.ownerDocument;
  const inLiveComposition = Boolean(doc?.querySelector("[data-composition-id]"));
  const hasGsapScript = Boolean(gsapAnimations && gsapAnimations.length > 0);
  const hasStyleSheetRule = Boolean(
    el?.id &&
    doc &&
    Array.from(doc.querySelectorAll("style")).some((s) => s.textContent?.includes(`#${el.id}`)),
  );

  if (
    !el ||
    selection?.isInsideLockedComposition ||
    !selection?.capabilities.canEditStyles ||
    hasGsapScript ||
    hasStyleSheetRule ||
    inLiveComposition
  ) {
    return {
      deletable: false,
      isSceneComposition: false,
      handAuthored: true,
      reason: hasGsapScript
        ? "Authored directly in source HTML with GSAP timeline code. Direct deletion is disabled so Studio never breaks hand-authored animations."
        : "Authored directly in source HTML. Direct deletion is disabled so Studio never silently rewrites hand-authored scene code.",
    };
  }

  return { deletable: true, isSceneComposition: false, handAuthored: false };
}

export interface InspectorLayerActionsProps {
  selection: DomEditSelection | null;
  timelineElement?: TimelineElement | null;
  gsapAnimations?: readonly unknown[];
  onDeleteLayer: () => void;
  onDeleteScene?: () => void;
  onToggleHidden: (nextHidden: boolean) => void;
}

export function InspectorLayerActions({
  selection,
  timelineElement,
  gsapAnimations,
  onDeleteLayer,
  onDeleteScene,
  onToggleHidden,
}: InspectorLayerActionsProps) {
  const keys = useStudioKeys();
  const deleteShortcut = keyHint("deleteSelected", keys);
  const elements = usePlayerStore((s) => s.elements);
  const totalSceneCount = elements.filter(
    (e) => e.type === "composition" || Boolean(e.compositionSrc),
  ).length;

  const safety = classifyLayerDeletionSafety(
    selection,
    gsapAnimations,
    timelineElement,
    totalSceneCount,
  );

  const displayLabel =
    timelineElement?.label ||
    selection?.label ||
    selection?.id ||
    timelineElement?.domId ||
    timelineElement?.id ||
    "Layer";

  const isHidden = Boolean(
    timelineElement?.hidden ||
    selection?.element.hasAttribute("data-hidden") ||
    selection?.element.style.visibility === "hidden" ||
    selection?.element.style.display === "none",
  );

  if (safety.isSceneComposition) {
    const sceneSrc =
      selection?.element.getAttribute("data-composition-src") ||
      selection?.element.getAttribute("data-src") ||
      timelineElement?.compositionSrc ||
      null;

    return (
      <div
        data-testid="inspector-scene-actions"
        className="flex flex-col gap-2 border-b border-neutral-800 bg-neutral-900/80 px-3.5 py-2.5 shrink-0"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              Selected Scene Clip
            </div>
            <div className="text-xs font-semibold text-neutral-100 truncate">{displayLabel}</div>
            {sceneSrc && (
              <div className="text-[10px] font-mono text-neutral-400 truncate">{sceneSrc}</div>
            )}
          </div>
          {safety.isProtectedScene || !onDeleteScene ? (
            <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
              Protected Scene
            </span>
          ) : (
            <button
              type="button"
              data-testid="inspector-delete-scene-button"
              onClick={onDeleteScene}
              title={`Delete Scene (${deleteShortcut})`}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/20 px-2.5 py-1.5 text-[11px] font-semibold text-rose-100 hover:bg-rose-500/30 transition-colors cursor-pointer"
            >
              <span>Delete Scene</span>
              <kbd className="rounded bg-rose-950/70 px-1 py-0.5 font-mono text-[10px] text-rose-200">
                {deleteShortcut}
              </kbd>
            </button>
          )}
        </div>
        {timelineElement && (
          <div
            data-testid="inspector-scene-timing-summary"
            className="grid grid-cols-3 gap-1.5 rounded border border-neutral-800 bg-neutral-950/70 px-2.5 py-1.5 text-[10px]"
          >
            <div>
              <span className="text-neutral-500 block">Start</span>
              <span className="font-mono font-semibold text-neutral-200">
                {timelineElement.start.toFixed(2)}s
              </span>
            </div>
            <div>
              <span className="text-neutral-500 block">Duration</span>
              <span className="font-mono font-semibold text-neutral-200">
                {timelineElement.duration.toFixed(2)}s
              </span>
            </div>
            <div>
              <span className="text-neutral-500 block">End</span>
              <span className="font-mono font-semibold text-neutral-200">
                {(timelineElement.start + timelineElement.duration).toFixed(2)}s
              </span>
            </div>
          </div>
        )}
        {safety.isProtectedScene && (
          <div className="text-[11px] leading-snug text-amber-200/90">
            {safety.reason ||
              "This scene is protected and cannot be deleted from the master composition."}
          </div>
        )}
      </div>
    );
  }

  if (safety.handAuthored) {
    return (
      <div
        data-testid="inspector-hand-authored-notice"
        className="flex flex-col gap-2 border-b border-neutral-800 bg-amber-500/10 px-3.5 py-2.5 shrink-0"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
              Source-Authored HTML Element
            </div>
            <div className="text-xs font-semibold text-neutral-100 truncate">{displayLabel}</div>
          </div>
          <button
            type="button"
            data-testid="inspector-hide-in-studio-button"
            onClick={() => onToggleHidden(!isHidden)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-amber-400/50 bg-amber-500/25 px-2.5 py-1.5 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/35 transition-colors cursor-pointer"
          >
            <span>{isHidden ? "Show in Studio" : "Hide in Studio"}</span>
          </button>
        </div>
        <div className="text-[11px] leading-snug text-amber-200/95">{safety.reason}</div>
        <div className="rounded bg-neutral-950/70 border border-amber-500/25 px-2.5 py-1.5 text-[10px] leading-relaxed text-neutral-300">
          <strong className="text-amber-300">Export behavior:</strong>{" "}
          {isHidden
            ? 'Currently hidden (`data-hidden="true"`). This element is hidden in both the Studio preview and rendered MP4 video exports while preserving your source code.'
            : 'Clicking Hide in Studio sets `data-hidden="true"` (`display: none`), hiding this element in both the Studio preview and rendered MP4 video exports without deleting your source code.'}
        </div>
      </div>
    );
  }

  // Studio-added layer: show Delete Layer prominently (no Hide in Studio button here)
  return (
    <div
      data-testid="inspector-layer-actions"
      className="flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/80 px-3.5 py-2.5 shrink-0"
    >
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
          Studio Layer Selected
        </div>
        <div className="text-xs font-semibold text-neutral-100 truncate">{displayLabel}</div>
      </div>
      <button
        type="button"
        data-testid="inspector-delete-layer-button"
        onClick={onDeleteLayer}
        title={`Delete Layer (${deleteShortcut})`}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-rose-500/50 bg-rose-500/20 px-3 py-1.5 text-[11px] font-semibold text-rose-100 hover:bg-rose-500/30 transition-colors cursor-pointer shadow-xs"
      >
        <span>Delete Layer</span>
        <kbd className="rounded bg-rose-950/70 px-1 py-0.5 font-mono text-[10px] text-rose-200">
          {deleteShortcut}
        </kbd>
      </button>
    </div>
  );
}
