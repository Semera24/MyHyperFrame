import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowsOutLineHorizontal,
  Crop,
  FrameCorners,
  Image,
  Magnet,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  SquaresFour,
  TextT,
} from "@phosphor-icons/react";
import { useOptionalNLEContext } from "./nle/NLEContext";
import { useStudioShellContextOptional } from "../contexts/StudioContext";
import { useCropPresetBarStore } from "./editor/cropPresetStore";
import {
  AI_AGENTS,
  formatAllOpenPinsPromptForAgent,
  useCanvasCommentsStore,
  type TargetAiAgent,
} from "./editor/canvasCommentsStore";
import { targetAgentToEngine, useAgentAssistantStore } from "./panels/AgentAssistantPanel";
import {
  detectUnbundleCandidate,
  groupSelectedElementsIntoLayer,
  insertFreeLayerInActiveScene,
  pinRevisionNoteToQc,
  resolveActiveSceneTargetAtPlayhead,
  unbundleElementContainer,
  uploadAndInsertImageInActiveScene,
  useDocumentaryQcOverlayStore,
  type DocumentaryPresetId,
} from "../utils/studioLayerActions";
import { buildProjectApiPath } from "../utils/projectRouting";
import { studioApiFetch } from "../utils/studioApiFetch";
import {
  useEnableKeyframes,
  isPlayheadWithinTween,
  type EnableKeyframesSession,
} from "../hooks/useEnableKeyframes";
import { computeElementPercentage, playsNear } from "../hooks/gsapShared";
import { useKeyframeKeyboard } from "../hooks/useKeyframeKeyboard";
import {
  timelineZoomPercentToSlider,
  timelineSliderToZoomPercent,
} from "../player/components/timelineZoom";
import { useTimelineZoom } from "../player/components/useTimelineZoom";
import {
  canZoomToSelectedClips,
  useShownTimelineZoomPercent,
  zoomTimelineStep,
  zoomTimelineToSelectedClips,
} from "../player/components/timelineZoomInput";
import { liveTime, usePlayerStore, type TimelineElement } from "../player";
import { Tooltip } from "./ui";
import { AudioMetersIcon } from "./icons/AudioMetersIcon";
import { RippleEditIcon } from "./icons/RippleEditIcon";
import { flatActive, flatBtn, flatDisabled, flatIdle } from "./timelineToolbarStyles";
import { TimelineHistoryButtons, type TimelineHistoryButtonsProps } from "./TimelineHistoryButtons";
import { TimelineToolPicker } from "./TimelineToolPicker";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "./editor/domEditingTypes";
import { canSplitElement } from "../utils/timelineElementSplit";
import { useAudioMetersVisible } from "../utils/audioMeterVisibility";
import { LinkedSelectionToggle } from "./LinkedSelectionToggle";
import { useProjectHasAudio } from "../utils/audioMeterMath";
import { canAddBeatAt, addBeatAtCompositionTime } from "../utils/beatEditActions";
import { isTypingTarget } from "../utils/typingTarget";
import { keyHint, matchesKey, useStudioKeys } from "../player/components/studioShortcuts";
import type { TimelineProps } from "../player/components/TimelineTypes";

interface DomEditSessionSlice extends EnableKeyframesSession {
  domEditSelection: DomEditSelection | null;
  selectedGsapAnimations: GsapAnimation[];
}

export interface TimelineToolbarProps {
  domEditSession?: DomEditSessionSlice;
  onSplitElement?: (element: TimelineElement, splitTime: number) => void;
  splitShortcut?: TimelineProps["splitShortcut"];
  history?: TimelineHistoryButtonsProps;
  showHistory?: boolean;
  showSelectAroundPlayhead?: boolean;
  showAddBeat?: boolean;
  /** Hides Add keyframe and auto-record, and turns off auto-record and the K shortcut with them. */
  showKeyframes?: boolean;
  rightActions?: ReactNode;
}

interface KeyframeToggleState {
  state: "active" | "inactive" | "none";
  isMotionPath: boolean;
  pathEndpoint: boolean;
  willExtend: boolean;
}

const NO_KEYFRAME_TOGGLE: KeyframeToggleState = {
  state: "none",
  isMotionPath: false,
  pathEndpoint: false,
  willExtend: false,
};

function isMotionPathEndpoint(animation: GsapAnimation | undefined, percentage: number): boolean {
  if (!animation?.keyframes) return false;
  const keyframes = animation.keyframes.keyframes;
  return [keyframes[0], keyframes.at(-1)].some(
    (keyframe) => keyframe && playsNear(animation, keyframe.percentage, percentage),
  );
}

function resolveKeyframeToggleState(
  session: DomEditSessionSlice | undefined,
  currentTime: number,
): KeyframeToggleState {
  if (!session?.domEditSelection) return NO_KEYFRAME_TOGGLE;
  const arcAnimation = session.selectedGsapAnimations.find(
    (animation) => animation.arcPath && animation.keyframes,
  );
  const animation =
    arcAnimation ??
    session.selectedGsapAnimations.find((candidate) => candidate.keyframes && !candidate.arcPath);
  if (!animation?.keyframes) return NO_KEYFRAME_TOGGLE;

  const isMotionPath = Boolean(arcAnimation);
  if (!isPlayheadWithinTween(animation, currentTime)) {
    return { state: "inactive", isMotionPath, pathEndpoint: false, willExtend: true };
  }

  const percentage = computeElementPercentage(currentTime, session.domEditSelection, animation);
  const pathEndpoint = isMotionPathEndpoint(arcAnimation, percentage);
  const active = animation.keyframes.keyframes.some((keyframe) =>
    playsNear(animation, keyframe.percentage, percentage),
  );
  return {
    state: pathEndpoint ? "none" : active ? "active" : "inactive",
    isMotionPath,
    pathEndpoint,
    willExtend: false,
  };
}

/**
 * Can this element be keyframed at all?
 *
 * An audio clip cannot. It has no box on the canvas, so there is nothing to move,
 * scale or fade — and "add a keyframe" on one seeds a tween from the position
 * properties, which produced a position lane on a track that has no position. Audio
 * is automated instead: volume and effect parameters, on their own lanes.
 */
function isKeyframeable(element: TimelineElement | undefined): boolean {
  return element?.tag !== "audio";
}

function useKeyframeToggle(session?: DomEditSessionSlice) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const elements = usePlayerStore((s) => s.elements);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const onToggle = useEnableKeyframes(
    sessionRef as React.RefObject<EnableKeyframesSession | undefined>,
  );

  const selected = elements.find((element) => (element.key ?? element.id) === selectedElementId);
  if (!isKeyframeable(selected)) return { ...NO_KEYFRAME_TOGGLE, onToggle: undefined };

  const toggleState = resolveKeyframeToggleState(session, currentTime);

  return {
    ...toggleState,
    onToggle: session?.domEditSelection && !toggleState.pathEndpoint ? onToggle : undefined,
  };
}

// fallow-ignore-next-line complexity
export const TimelineToolbar = memo(function TimelineToolbar({
  domEditSession,
  onSplitElement,
  splitShortcut,
  history,
  showHistory = true,
  showSelectAroundPlayhead = true,
  showAddBeat = true,
  showKeyframes = true,
  rightActions,
}: TimelineToolbarProps) {
  const keys = useStudioKeys();
  const kf = keyHint("addKeyframe", keys);
  const timelineSnapEnabled = usePlayerStore((s) => s.timelineSnapEnabled);
  const setTimelineSnapEnabled = usePlayerStore((s) => s.setTimelineSnapEnabled);
  const rippleEditEnabled = usePlayerStore((s) => s.rippleEditEnabled);
  const setRippleEditEnabled = usePlayerStore((s) => s.setRippleEditEnabled);
  const autoKeyframeEnabled = usePlayerStore((s) => s.autoKeyframeEnabled);
  const setAutoKeyframeEnabled = usePlayerStore((s) => s.setAutoKeyframeEnabled);
  const thumbnailMode = usePlayerStore((s) => s.thumbnailMode);
  const setThumbnailMode = usePlayerStore((s) => s.setThumbnailMode);
  const thumbnailsVisible = thumbnailMode === "adaptive";
  const audioMetersVisible = useAudioMetersVisible((s) => s.visible);
  const setAudioMetersVisible = useAudioMetersVisible((s) => s.setVisible);
  const projectHasAudio = useProjectHasAudio();
  // Subscribe so the add-beat button reacts to playhead movement and analysis load.
  const currentTime = usePlayerStore((s) => s.currentTime);
  const beatAnalysisReady = usePlayerStore((s) => s.beatAnalysis !== null);
  // Subscribed, so the split button follows the selection, not only playhead ticks.
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const selectedElementIds = usePlayerStore((s) => s.selectedElementIds);
  const elements = usePlayerStore((s) => s.elements);
  const canZoomSelection = canZoomToSelectedClips({
    elements,
    selectedElementId,
    selectedElementIds,
  });
  const timelineFitPps = usePlayerStore((s) => s.timelineFitPps);
  const { zoomMode, setZoomMode, setManualZoomPercent } = useTimelineZoom();
  const displayedTimelineZoomPercent = useShownTimelineZoomPercent();
  const showsFit = zoomMode === "fit" && displayedTimelineZoomPercent === 100;
  const {
    state: keyframeState,
    isMotionPath: keyframeIsMotionPath,
    pathEndpoint: keyframePathEndpoint,
    willExtend: keyframeWillExtend,
    onToggle: onToggleKeyframe,
  } = useKeyframeToggle(domEditSession);

  const nle = useOptionalNLEContext();
  const shell = useStudioShellContextOptional();
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [addLayerMenuOpen, setAddLayerMenuOpen] = useState(false);
  const [pinNoteOpen, setPinNoteOpen] = useState(false);
  const [pinNoteText, setPinNoteText] = useState("");
  const [pinNoteStatus, setPinNoteStatus] = useState<string | null>(null);
  const [projectImageAssets, setProjectImageAssets] = useState<string[]>([]);
  const fileUploadInputRef = useRef<HTMLInputElement | null>(null);
  const safeZoneVisible = useDocumentaryQcOverlayStore((s) => s.safeZoneVisible);
  const toggleSafeZone = useDocumentaryQcOverlayStore((s) => s.toggleSafeZone);
  const backdropMode = useDocumentaryQcOverlayStore((s) => s.backdropMode);
  const cycleBackdropMode = useDocumentaryQcOverlayStore((s) => s.cycleBackdropMode);
  const commentModeActive = useCanvasCommentsStore((s) => s.commentModeActive);
  const toggleCommentMode = useCanvasCommentsStore((s) => s.toggleCommentMode);
  const selectedAgent = useCanvasCommentsStore((s) => s.selectedAgent);
  const setSelectedAgent = useCanvasCommentsStore((s) => s.setSelectedAgent);
  const canvasPins = useCanvasCommentsStore((s) => s.pins);
  const topComp = nle?.compositionStack.at(-1);
  const activeCompPath =
    (topComp && topComp.id !== "master" ? topComp.id : null) ??
    (shell?.activeCompPath && shell.activeCompPath !== "index.html" ? shell.activeCompPath : null);
  const isDrilledIntoScene =
    Boolean(nle && nle.compositionStack.length > 1) || Boolean(activeCompPath);
  const activeSceneLabel = (topComp?.label || activeCompPath || "")
    .replace(/^compositions\//, "")
    .replace(/\.html$/, "")
    .toUpperCase();
  const activeSelection = domEditSession?.domEditSelection ?? null;
  const unbundleCandidate = detectUnbundleCandidate(activeSelection?.element ?? null);

  // Resolve all selected DOM elements for Group action (single selection or multi-selected timeline/canvas elements)
  const resolveSelectedDomElements = (): HTMLElement[] => {
    const doc = activeSelection?.element?.ownerDocument;
    if (doc && selectedElementIds.size > 1) {
      const found: HTMLElement[] = [];
      for (const id of selectedElementIds) {
        const el = doc.getElementById(id) ?? doc.querySelector<HTMLElement>(`[data-hf-id="${id}"]`);
        if (el && !found.includes(el)) found.push(el);
      }
      if (found.length > 0) return found;
    }
    return activeSelection?.element ? [activeSelection.element] : [];
  };

  useEffect(() => {
    if ((!imagePickerOpen && !addLayerMenuOpen) || !nle?.projectId) return;
    let cancelled = false;
    studioApiFetch(buildProjectApiPath(nle.projectId, ""))
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { files?: string[] } | null) => {
        if (cancelled || !data?.files) return;
        const imgs = data.files.filter((f) => /\.(png|svg|jpe?g|webp|gif)$/i.test(f));
        setProjectImageAssets(imgs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [imagePickerOpen, addLayerMenuOpen, nle?.projectId]);

  // Cmd+G / Ctrl+G shortcut to group selected layers on the canvas
  useEffect(() => {
    if (!nle) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "g") {
        if (isTypingTarget(e.target)) return;
        const els = resolveSelectedDomElements();
        if (els.length === 0) return;
        e.preventDefault();
        void groupSelectedElementsIntoLayer({
          elements: els,
          projectId: nle.projectId,
          activeCompPath,
          reloadPreview: nle.refreshPlayer,
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // Wire the Add keyframe shortcut the toolbar advertises. Active only when
  // there's a keyframeable selection; otherwise K stays JKL-pause in playback.
  useKeyframeKeyboard({
    enabled: showKeyframes && Boolean(onToggleKeyframe),
    onAddKeyframe: onToggleKeyframe,
  });

  useEffect(() => {
    if (!showKeyframes) setAutoKeyframeEnabled(false);
  }, [showKeyframes, setAutoKeyframeEnabled]);

  // "N" toggles timeline snapping (industry convention: Resolve/FCP).
  // Skip when typing in an input/contenteditable.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!matchesKey(e, "timelineSnap")) return;
      if (isTypingTarget(e.target)) return;
      const store = usePlayerStore.getState();
      store.setTimelineSnapEnabled(!store.timelineSnapEnabled);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="border-b border-neutral-800/60">
      <div className="flex items-center justify-between px-2 py-0.5">
        <div className="flex items-center gap-0.5">
          {isDrilledIntoScene && (
            <>
              <Tooltip label="Return to the Master Timeline showing all episode scenes (S01..S09) side-by-side">
                <button
                  type="button"
                  data-testid="back-to-master-button"
                  onClick={() => {
                    if (nle) {
                      nle.updateCompositionStack((prev) => (prev.length > 0 ? [prev[0]!] : prev));
                    }
                    shell?.setActiveCompPath(null);
                  }}
                  className="h-7 px-2.5 mr-1 rounded-md text-[11px] font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <span>← Back to Master (All Scenes)</span>
                  {activeSceneLabel && (
                    <span className="px-1.5 py-0.2 rounded bg-emerald-500/25 text-emerald-100 font-mono text-[10px] font-bold">
                      Viewing {activeSceneLabel}
                    </span>
                  )}
                </button>
              </Tooltip>
              <div aria-hidden="true" className="mx-1 h-4 w-px bg-neutral-800" />
            </>
          )}
          {showHistory && <TimelineHistoryButtons {...history} />}
          <TimelineToolPicker showSelectAroundPlayhead={showSelectAroundPlayhead} />
          {/* Divider: tool-mode | editing-actions */}
          <div aria-hidden="true" className="mx-1 h-4 w-px bg-neutral-800" />
          <LinkedSelectionToggle />
          <Tooltip
            label={
              timelineSnapEnabled
                ? `Snapping on (${keyHint("timelineSnap", keys)})`
                : `Snapping off (${keyHint("timelineSnap", keys)})`
            }
          >
            <button
              type="button"
              onClick={() => setTimelineSnapEnabled(!timelineSnapEnabled)}
              aria-label="Toggle timeline snapping"
              aria-pressed={timelineSnapEnabled}
              className={timelineSnapEnabled ? flatActive : flatIdle}
            >
              <Magnet size={16} weight="bold" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip
            label={
              rippleEditEnabled
                ? "Ripple on: keeps the main track gapless"
                : "Ripple off: deleting a main-track clip leaves a gap"
            }
          >
            <button
              type="button"
              onClick={() => setRippleEditEnabled(!rippleEditEnabled)}
              aria-label="Toggle ripple edit"
              aria-pressed={rippleEditEnabled}
              className={rippleEditEnabled ? flatActive : flatIdle}
            >
              <RippleEditIcon size={16} />
            </button>
          </Tooltip>
          {projectHasAudio && (
            <Tooltip label={audioMetersVisible ? "Hide audio meters" : "Show audio meters"}>
              <button
                type="button"
                onClick={() => setAudioMetersVisible(!audioMetersVisible)}
                aria-label="Toggle audio meters"
                aria-pressed={audioMetersVisible}
                className={audioMetersVisible ? flatActive : flatIdle}
              >
                <AudioMetersIcon size={16} />
              </button>
            </Tooltip>
          )}
          {showKeyframes && (
            <>
              {/* With no keyframeable selection the button fades to disabled instead of
              unmounting, so the toolbar layout never shifts (CapCut-style). */}
              <Tooltip
                label={
                  keyframePathEndpoint
                    ? "Motion path endpoints cannot be removed"
                    : !onToggleKeyframe
                      ? "Select an animated element to add keyframes"
                      : keyframeIsMotionPath
                        ? keyframeWillExtend
                          ? `Extend motion path to playhead (${kf})`
                          : keyframeState === "active"
                            ? `Remove waypoint from motion path (${kf})`
                            : `Add waypoint to motion path (${kf})`
                        : keyframeState === "active"
                          ? `Remove keyframe at playhead (${kf})`
                          : keyframeState === "inactive"
                            ? keyframeWillExtend
                              ? `Add keyframe at playhead, extends animation (${kf})`
                              : `Add keyframe at playhead (${kf})`
                            : `Add keyframe (${kf})`
                }
              >
                <button
                  type="button"
                  disabled={!onToggleKeyframe}
                  onClick={onToggleKeyframe}
                  aria-label={
                    keyframePathEndpoint
                      ? "Motion path endpoint"
                      : keyframeIsMotionPath
                        ? keyframeState === "active"
                          ? "Remove motion path waypoint"
                          : keyframeWillExtend
                            ? "Extend motion path to playhead"
                            : "Add motion path waypoint"
                        : keyframeState === "active"
                          ? "Remove keyframe at playhead"
                          : "Add keyframe at playhead"
                  }
                  className={
                    !onToggleKeyframe
                      ? flatDisabled
                      : `${flatBtn} active:scale-[0.98] hover:bg-hover ${
                          keyframeState === "active"
                            ? "text-accent-ink"
                            : keyframeState === "inactive"
                              ? "text-neutral-400 hover:text-accent-ink"
                              : "text-neutral-600 hover:text-neutral-400"
                        }`
                  }
                >
                  <svg width="16" height="16" viewBox="0 0 10 10" fill="currentColor">
                    {keyframeState === "active" ? (
                      <path d="M5 0.5L9.5 5L5 9.5L0.5 5Z" />
                    ) : (
                      <path
                        d="M5 1.2L8.8 5L5 8.8L1.2 5Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                    )}
                  </svg>
                </button>
              </Tooltip>
              <Tooltip
                label={
                  autoKeyframeEnabled
                    ? "Auto-record manual edits as keyframes (click to turn off)"
                    : "Manual edits will not be recorded as keyframes (click to turn on)"
                }
              >
                <button
                  type="button"
                  onClick={() => setAutoKeyframeEnabled(!autoKeyframeEnabled)}
                  aria-label="Auto-record manual edits as keyframes"
                  aria-pressed={autoKeyframeEnabled}
                  className={`${flatBtn} active:scale-[0.98] hover:bg-hover ${
                    autoKeyframeEnabled
                      ? "text-danger-ink"
                      : "text-neutral-600 hover:text-neutral-400"
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 10 10" fill="none">
                    {/* Same diamond outline as the Add-keyframe icon, with a
                      record-style dot inside: filled = auto-recording,
                      hollow = manual edits won't be keyframed. */}
                    <path d="M5 0.7L9.3 5L5 9.3L0.7 5Z" stroke="currentColor" strokeWidth="1" />
                    <circle
                      cx="5"
                      cy="5"
                      r="1.8"
                      fill={autoKeyframeEnabled ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="1"
                    />
                  </svg>
                </button>
              </Tooltip>
            </>
          )}
          {onSplitElement &&
            (() => {
              // Render the button unconditionally (disabled when unusable):
              // mounting/unmounting mid-task shifts the neighboring controls.
              // Mirrors the S-key gate: selected clip + playhead strictly inside it.
              const el = selectedElementId
                ? elements.find((e) => (e.key ?? e.id) === selectedElementId)
                : null;
              const splittable = el != null && canSplitElement(el);
              const canSplit =
                splittable && currentTime > el.start && currentTime < el.start + el.duration;
              return (
                <Tooltip
                  label={
                    canSplit
                      ? `Split at playhead (${splitShortcut ?? keyHint("split", keys)})`
                      : splittable
                        ? "Move the playhead inside the clip to split"
                        : "Select a clip to split"
                  }
                >
                  <button
                    type="button"
                    disabled={!canSplit}
                    aria-label="Split at playhead"
                    onClick={() => {
                      if (canSplit && el) onSplitElement(el, currentTime);
                    }}
                    className={canSplit ? flatIdle : flatDisabled}
                  >
                    {/* "][" split glyph: two outward-facing brackets with a center gap */}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {/* Right bracket of left half: ] */}
                      <path d="M5 3 L7 3 L7 13 L5 13" />
                      {/* Left bracket of right half: [ */}
                      <path d="M11 3 L9 3 L9 13 L11 13" />
                    </svg>
                  </button>
                </Tooltip>
              );
            })()}
          {(() => {
            if (!showAddBeat) return null;
            // Rendered whenever shown (CapCut-style): before beat analysis loads (or when
            // the project has no analyzed music) the button fades to a disabled
            // state instead of unmounting, so the toolbar layout never shifts.
            const canAdd = beatAnalysisReady && canAddBeatAt(currentTime);
            return (
              <Tooltip
                label={
                  !beatAnalysisReady
                    ? "Add a music track with beat analysis to place beats"
                    : canAdd
                      ? "Add beat at playhead"
                      : "A beat already exists at the playhead"
                }
              >
                <button
                  type="button"
                  disabled={!canAdd}
                  aria-label="Add beat at playhead"
                  onClick={() => {
                    if (canAdd) addBeatAtCompositionTime(currentTime);
                  }}
                  className={
                    canAdd
                      ? `${flatBtn} text-text-2 hover:bg-hover hover:text-accent-ink active:scale-[0.98]`
                      : flatDisabled
                  }
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M21 10C21 12.2091 16.9706 14 12 14M21 10C21 7.79086 16.9706 6 12 6C7.02944 6 3 7.79086 3 10M21 10V16C21 18.2091 16.9706 20 12 20M12 14C7.02944 14 3 12.2091 3 10M12 14V20M3 10V16C3 18.2091 7.02944 20 12 20M7 19.3264V13.3264M17 19.3264V13.3264M12 10L20 4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </Tooltip>
            );
          })()}
          {nle && (
            <>
              <div aria-hidden="true" className="mx-1 h-4 w-px bg-neutral-800" />
              <input
                ref={fileUploadInputRef}
                type="file"
                accept=".png,.svg,.jpg,.jpeg,.webp,.gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setAddLayerMenuOpen(false);
                  setImagePickerOpen(false);
                  void uploadAndInsertImageInActiveScene({
                    file,
                    projectId: nle.projectId,
                    activeCompPath,
                    selectedSourceFile: activeSelection?.sourceFile,
                    reloadPreview: nle.refreshPlayer,
                  });
                }}
              />
              {/* Unified + Add Layer ▾ menu */}
              <div className="relative">
                <Tooltip label="Add Text, Image/SVG, Empty Group, or Turning Point Stories Preset at playhead">
                  <button
                    type="button"
                    aria-label="Add layer menu"
                    onClick={() => {
                      setAddLayerMenuOpen((prev) => !prev);
                      setImagePickerOpen(false);
                      setPinNoteOpen(false);
                    }}
                    className="h-7 px-2 rounded-md text-[11px] font-semibold bg-studio-accent/15 text-accent-ink hover:bg-studio-accent/25 flex items-center gap-1 transition-colors"
                  >
                    <span>+ Add Layer ▾</span>
                  </button>
                </Tooltip>
                {addLayerMenuOpen && (
                  <div className="absolute top-full left-0 mt-1.5 z-200 w-72 rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 shadow-xl text-xs">
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                      Create Layer at Playhead
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAddLayerMenuOpen(false);
                        void insertFreeLayerInActiveScene({
                          kind: "text",
                          text: "New Text",
                          projectId: nle.projectId,
                          activeCompPath,
                          selectedSourceFile: activeSelection?.sourceFile,
                          reloadPreview: nle.refreshPlayer,
                        });
                      }}
                      className="w-full text-left px-2 py-1.5 rounded text-neutral-200 hover:bg-studio-accent/20 hover:text-white flex items-center justify-between"
                    >
                      <span>+ Text Layer</span>
                      <span className="text-[10px] text-neutral-500">Free text</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddLayerMenuOpen(false);
                        fileUploadInputRef.current?.click();
                      }}
                      className="w-full text-left px-2 py-1.5 rounded text-neutral-200 hover:bg-studio-accent/20 hover:text-white flex items-center justify-between"
                    >
                      <span>+ Upload Image / SVG from Mac…</span>
                      <span className="text-[10px] text-neutral-500">assets/</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddLayerMenuOpen(false);
                        setImagePickerOpen(true);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded text-neutral-200 hover:bg-studio-accent/20 hover:text-white flex items-center justify-between"
                    >
                      <span>+ Image / SVG from Project Assets ▸</span>
                      <span className="text-[10px] text-neutral-500">
                        {projectImageAssets.length}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddLayerMenuOpen(false);
                        void insertFreeLayerInActiveScene({
                          kind: "group",
                          text: "Group",
                          projectId: nle.projectId,
                          activeCompPath,
                          selectedSourceFile: activeSelection?.sourceFile,
                          reloadPreview: nle.refreshPlayer,
                        });
                      }}
                      className="w-full text-left px-2 py-1.5 rounded text-neutral-200 hover:bg-studio-accent/20 hover:text-white flex items-center justify-between"
                    >
                      <span>+ Empty Group Layer</span>
                      <span className="text-[10px] text-neutral-500">600×400</span>
                    </button>
                    <div className="my-1 border-t border-neutral-800" />
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400/90">
                      Turning Point Stories Presets
                    </div>
                    {(
                      [
                        {
                          id: "callout-card" as DocumentaryPresetId,
                          label: "Editorial Callout Card",
                          hint: "Navy + Ochre",
                        },
                        {
                          id: "map-badge" as DocumentaryPresetId,
                          label: "Map Label Badge",
                          hint: "Teal pill",
                        },
                        {
                          id: "stat-card" as DocumentaryPresetId,
                          label: "Historical Stat & Citation Card",
                          hint: "Metric + source",
                        },
                        {
                          id: "subscribe-cta" as DocumentaryPresetId,
                          label: "Subscribe CTA Block",
                          hint: "Closing card",
                        },
                      ] as const
                    ).map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setAddLayerMenuOpen(false);
                          void insertFreeLayerInActiveScene({
                            kind: "preset",
                            presetId: preset.id,
                            projectId: nle.projectId,
                            activeCompPath,
                            selectedSourceFile: activeSelection?.sourceFile,
                            reloadPreview: nle.refreshPlayer,
                          });
                        }}
                        className="w-full text-left px-2 py-1.5 rounded text-neutral-200 hover:bg-amber-500/20 hover:text-amber-200 flex items-center justify-between"
                      >
                        <span>{preset.label}</span>
                        <span className="text-[10px] text-neutral-500">{preset.hint}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Tooltip label="Add free Text layer at playhead">
                <button
                  type="button"
                  aria-label="Add text layer"
                  onClick={() => {
                    void insertFreeLayerInActiveScene({
                      kind: "text",
                      text: "New Text",
                      projectId: nle.projectId,
                      activeCompPath,
                      selectedSourceFile: activeSelection?.sourceFile,
                      reloadPreview: nle.refreshPlayer,
                    });
                  }}
                  className="h-7 px-2 rounded-md text-[11px] font-medium text-neutral-300 hover:bg-hover hover:text-white flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap"
                >
                  <TextT size={14} weight="bold" aria-hidden="true" />
                  <span>+ Text</span>
                </button>
              </Tooltip>
              <div className="relative shrink-0">
                <Tooltip label="Add free Image/SVG layer at playhead">
                  <button
                    type="button"
                    aria-label="Add image layer"
                    onClick={() => {
                      setImagePickerOpen((prev) => !prev);
                      setAddLayerMenuOpen(false);
                    }}
                    className="h-7 px-2 rounded-md text-[11px] font-medium text-neutral-300 hover:bg-hover hover:text-white flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap"
                  >
                    <Image size={14} weight="bold" aria-hidden="true" />
                    <span>+ Image</span>
                  </button>
                </Tooltip>
                {imagePickerOpen && (
                  <div className="absolute top-full left-0 mt-1.5 z-200 w-72 max-h-64 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setImagePickerOpen(false);
                        fileUploadInputRef.current?.click();
                      }}
                      className="w-full text-left px-2 py-1.5 mb-1 rounded text-xs font-medium text-accent-ink bg-studio-accent/15 hover:bg-studio-accent/25 block"
                    >
                      + Upload Image / SVG from Mac…
                    </button>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                      Insert Project Asset at Playhead
                    </div>
                    {projectImageAssets.length === 0 ? (
                      <div className="px-2 py-2 text-xs text-neutral-500">
                        No image/SVG assets found in project.
                      </div>
                    ) : (
                      projectImageAssets.map((assetPath) => (
                        <button
                          key={assetPath}
                          type="button"
                          onClick={() => {
                            setImagePickerOpen(false);
                            void insertFreeLayerInActiveScene({
                              kind: "image",
                              src: assetPath,
                              projectId: nle.projectId,
                              activeCompPath,
                              selectedSourceFile: activeSelection?.sourceFile,
                              reloadPreview: nle.refreshPlayer,
                            });
                          }}
                          className="w-full text-left px-2 py-1.5 rounded text-xs text-neutral-200 hover:bg-studio-accent/20 hover:text-white truncate block"
                          title={assetPath}
                        >
                          {assetPath.replace(/^assets\//, "")}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <Tooltip
                label={
                  activeSelection
                    ? "Open interactive on-canvas Crop tool for selected layer"
                    : "Select a layer on canvas to crop"
                }
              >
                <button
                  type="button"
                  disabled={!activeSelection}
                  aria-label="Crop selected layer"
                  onClick={() => {
                    if (!activeSelection) return;
                    useCropPresetBarStore.getState().open({
                      hfId: activeSelection.hfId ?? undefined,
                      id: activeSelection.id ?? undefined,
                    });
                  }}
                  className={
                    activeSelection
                      ? "h-7 px-2 rounded-md text-[11px] font-medium text-neutral-300 hover:bg-hover hover:text-white flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap"
                      : "h-7 px-2 rounded-md text-[11px] font-medium text-neutral-500 opacity-40 cursor-not-allowed flex items-center gap-1 shrink-0 whitespace-nowrap"
                  }
                >
                  <Crop size={14} weight="bold" aria-hidden="true" />
                  <span>Crop</span>
                </button>
              </Tooltip>
              <Tooltip
                label={
                  activeSelection
                    ? "Wrap selected layer(s) into a movable Group Layer (Cmd+G)"
                    : "Select one or more layers to group (Cmd+G)"
                }
              >
                <button
                  type="button"
                  disabled={!activeSelection}
                  aria-label="Group selected layers"
                  onClick={() => {
                    const els = resolveSelectedDomElements();
                    if (els.length === 0) return;
                    void groupSelectedElementsIntoLayer({
                      elements: els,
                      projectId: nle.projectId,
                      activeCompPath,
                      reloadPreview: nle.refreshPlayer,
                    });
                  }}
                  className={
                    activeSelection
                      ? "h-7 px-2 rounded-md text-[11px] font-medium text-neutral-300 hover:bg-hover hover:text-white flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap"
                      : "h-7 px-2 rounded-md text-[11px] font-medium text-neutral-500 opacity-40 cursor-not-allowed flex items-center gap-1 shrink-0 whitespace-nowrap"
                  }
                >
                  <span>Group</span>
                </button>
              </Tooltip>
              <Tooltip
                label={
                  unbundleCandidate
                    ? "Convert Grid/Flex container into freely movable absolute layers"
                    : "Select a Grid/Flex container or item to unbundle into free layers"
                }
              >
                <button
                  type="button"
                  disabled={!unbundleCandidate}
                  aria-label="Unbundle Grid/Flex into free layers"
                  onClick={() => {
                    if (!activeSelection?.element) return;
                    void unbundleElementContainer({
                      element: activeSelection.element,
                      projectId: nle.projectId,
                      activeCompPath,
                      reloadPreview: nle.refreshPlayer,
                    });
                  }}
                  className={
                    unbundleCandidate
                      ? "h-7 px-2 rounded-md text-[11px] font-medium text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap"
                      : "h-7 px-2 rounded-md text-[11px] font-medium text-neutral-500 opacity-40 cursor-not-allowed flex items-center gap-1 shrink-0 whitespace-nowrap"
                  }
                >
                  <SquaresFour size={14} weight="bold" aria-hidden="true" />
                  <span>Unbundle</span>
                </button>
              </Tooltip>
              <div aria-hidden="true" className="mx-1 h-4 w-px bg-neutral-800 shrink-0" />
              {/* D3: Safe 90x70 margin toggle & Cutout Halo Backdrop Switcher */}
              <Tooltip label="Toggle 90px × 70px Documentary Safe-Margin Guide (1740×940)">
                <button
                  type="button"
                  aria-label="Toggle 90x70 safe margin guide"
                  aria-pressed={safeZoneVisible}
                  onClick={toggleSafeZone}
                  className={
                    safeZoneVisible
                      ? "h-7 px-2 rounded-md text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0 whitespace-nowrap"
                      : "h-7 px-2 rounded-md text-[11px] font-medium text-neutral-400 hover:bg-hover hover:text-white shrink-0 whitespace-nowrap"
                  }
                >
                  Safe 90×70
                </button>
              </Tooltip>
              <Tooltip label="Cycle Cutout Halo Inspection Backdrop (Default → Checkerboard → Light #F5F0E6 → Dark #142838)">
                <button
                  type="button"
                  aria-label="Cycle cutout backdrop mode"
                  onClick={cycleBackdropMode}
                  className={
                    backdropMode !== "default"
                      ? "h-7 px-2 rounded-md text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0 whitespace-nowrap"
                      : "h-7 px-2 rounded-md text-[11px] font-medium text-neutral-400 hover:bg-hover hover:text-white shrink-0 whitespace-nowrap"
                  }
                >
                  Backdrop: {backdropMode === "default" ? "Off" : backdropMode}
                </button>
              </Tooltip>
              {/* D4: Spatial Point-and-Comment on Canvas + Quick Pin */}
              <Tooltip label="Toggle Spatial 'Comment on Canvas' Mode — Click anywhere on the preview canvas to drop a numbered revision pin">
                <button
                  type="button"
                  aria-label="Toggle Comment on Canvas mode"
                  aria-pressed={commentModeActive}
                  onClick={() => {
                    toggleCommentMode();
                    setPinNoteOpen(false);
                    setAddLayerMenuOpen(false);
                    setImagePickerOpen(false);
                  }}
                  className={
                    commentModeActive
                      ? "h-7 px-2.5 rounded-md text-[11px] font-semibold bg-amber-500 text-black shadow-sm flex items-center gap-1 shrink-0 whitespace-nowrap"
                      : "h-7 px-2.5 rounded-md text-[11px] font-medium text-neutral-200 hover:bg-hover hover:text-white flex items-center gap-1 shrink-0 whitespace-nowrap"
                  }
                >
                  <span>📍 Comment</span>
                  {canvasPins.filter((p) => p.status === "OPEN").length > 0 && (
                    <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-bold text-amber-300">
                      {canvasPins.filter((p) => p.status === "OPEN").length}
                    </span>
                  )}
                </button>
              </Tooltip>
              <div className="relative">
                <Tooltip label="Quick Pin Note at Playhead to ../QC/<EP_ID>_Revision_Notes.md">
                  <button
                    type="button"
                    aria-label="Pin revision note to QC"
                    onClick={() => {
                      setPinNoteOpen((prev) => !prev);
                      setPinNoteStatus(null);
                      setAddLayerMenuOpen(false);
                      setImagePickerOpen(false);
                    }}
                    className={
                      pinNoteOpen
                        ? "h-7 px-2 rounded-md text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                        : "h-7 px-2 rounded-md text-[11px] font-medium text-neutral-300 hover:bg-hover hover:text-white"
                    }
                  >
                    + Pin Note
                  </button>
                </Tooltip>
                {pinNoteOpen && (
                  <div className="absolute top-full left-0 mt-1.5 z-200 w-80 rounded-lg border border-neutral-700 bg-neutral-900 p-2.5 shadow-xl text-xs">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                        Pin Note to QC Revision Notes
                      </span>
                      <span className="font-mono text-[10px] text-neutral-400">
                        {(liveTime.get() || currentTime).toFixed(2)}s ·{" "}
                        {Math.round((liveTime.get() || currentTime) * 30)}f
                      </span>
                    </div>
                    <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-neutral-400">
                      <span className="truncate">
                        Scene:{" "}
                        {
                          resolveActiveSceneTargetAtPlayhead(
                            activeCompPath,
                            activeSelection?.sourceFile,
                          ).targetFile
                        }
                      </span>
                      <span>·</span>
                      <span className="truncate">
                        Target: #{activeSelection?.id || activeSelection?.hfId || "scene"}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={pinNoteText}
                      onChange={(e) => setPinNoteText(e.target.value)}
                      placeholder="Describe visual fix or note for QC…"
                      className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none mb-2"
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter" && pinNoteText.trim()) {
                          e.preventDefault();
                          const sceneFile = resolveActiveSceneTargetAtPlayhead(
                            activeCompPath,
                            activeSelection?.sourceFile,
                          ).targetFile;
                          void pinRevisionNoteToQc({
                            projectId: nle.projectId,
                            timestampSeconds: currentTime,
                            frame: Math.round(currentTime * 30),
                            sceneFile,
                            elementId: activeSelection?.id || activeSelection?.hfId || "scene",
                            note: pinNoteText.trim(),
                          }).then((res) => {
                            if (res.ok) {
                              setPinNoteText("");
                              setPinNoteStatus("Saved to QC Revision Notes");
                              setTimeout(() => setPinNoteOpen(false), 900);
                            } else {
                              setPinNoteStatus("Failed to save note");
                            }
                          });
                        }
                      }}
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-emerald-300">{pinNoteStatus ?? ""}</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPinNoteOpen(false)}
                          className="px-2 py-1 rounded text-[11px] text-neutral-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={!pinNoteText.trim()}
                          onClick={() => {
                            const sceneFile = resolveActiveSceneTargetAtPlayhead(
                              activeCompPath,
                              activeSelection?.sourceFile,
                            ).targetFile;
                            void pinRevisionNoteToQc({
                              projectId: nle.projectId,
                              timestampSeconds: currentTime,
                              frame: Math.round(currentTime * 30),
                              sceneFile,
                              elementId: activeSelection?.id || activeSelection?.hfId || "scene",
                              note: pinNoteText.trim(),
                            }).then((res) => {
                              if (res.ok) {
                                setPinNoteText("");
                                setPinNoteStatus("Saved to QC Revision Notes");
                                setTimeout(() => setPinNoteOpen(false), 900);
                              } else {
                                setPinNoteStatus("Failed to save note");
                              }
                            });
                          }}
                          className="px-2.5 py-1 rounded bg-emerald-600 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                        >
                          Save to QC
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {rightActions}
          <Tooltip
            label={
              thumbnailsVisible
                ? "Hide thumbnails: labels only"
                : "Show thumbnails: posters stay visible; richer previews appear on interaction"
            }
          >
            <button
              type="button"
              aria-label={
                thumbnailsVisible
                  ? "Hide thumbnails: labels only"
                  : "Show thumbnails: posters stay visible; richer previews appear on interaction"
              }
              aria-pressed={thumbnailsVisible}
              onClick={() => setThumbnailMode(thumbnailsVisible ? "hidden" : "adaptive")}
              className={`h-7 px-2 rounded-md text-[11px] font-medium transition-colors ${
                thumbnailsVisible
                  ? "bg-studio-accent/10 text-accent-ink"
                  : "text-neutral-400 hover:bg-hover hover:text-neutral-200"
              }`}
            >
              <Image size={16} aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip
            label={
              canZoomSelection
                ? `Zoom to selected clips (${keyHint("zoomSelection", keys)})`
                : "Select a clip to zoom the timeline"
            }
          >
            <button
              type="button"
              disabled={!canZoomSelection}
              aria-label={
                canZoomSelection ? "Zoom to selected clips" : "Select a clip to zoom the timeline"
              }
              onClick={() => zoomTimelineToSelectedClips()}
              className={canZoomSelection ? flatIdle : flatDisabled}
            >
              <FrameCorners size={16} aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label="Fit timeline to width">
            <button
              type="button"
              onClick={() => setZoomMode("fit")}
              aria-label="Fit timeline to width"
              aria-pressed={zoomMode === "fit"}
              className={`h-7 px-2 rounded-md text-[11px] font-medium transition-colors ${
                zoomMode === "fit"
                  ? "bg-studio-accent/10 text-accent-ink"
                  : "text-neutral-400 hover:bg-hover hover:text-neutral-200"
              }`}
            >
              <ArrowsOutLineHorizontal size={16} aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label="Zoom out">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => zoomTimelineStep("out")}
              className={flatIdle}
            >
              <MagnifyingGlassMinus size={16} aria-hidden="true" />
            </button>
          </Tooltip>
          <input
            type="range"
            min="0"
            max="100"
            value={timelineZoomPercentToSlider(displayedTimelineZoomPercent, timelineFitPps)}
            title={`${displayedTimelineZoomPercent}%`}
            aria-label="Timeline zoom"
            onChange={(e) =>
              setManualZoomPercent(
                timelineSliderToZoomPercent(Number(e.target.value), timelineFitPps),
              )
            }
            // h-6 on the input is the 24x24 WCAG 2.2 (2.5.8) target: the visible
            // track stays 2px and the thumb 10px, only the pointer box grows.
            className="mx-1 h-6 w-[96px] cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-[2px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-neutral-700 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[10px] [&::-webkit-slider-thumb]:h-[10px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-text-0 [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_#0a0a0a,0_1px_3px_rgba(0,0,0,0.5)] [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb:active]:cursor-grabbing"
          />
          <Tooltip label="Zoom in">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => zoomTimelineStep("in")}
              className={flatIdle}
            >
              <MagnifyingGlassPlus size={16} aria-hidden="true" />
            </button>
          </Tooltip>
          {/* Numeric zoom readout (main-parity): "Fit" in fit mode, N% in manual. */}
          <span
            className="ml-1 w-[38px] text-right font-mono text-[11px] tabular-nums text-neutral-500 select-none"
            aria-label="Timeline zoom level"
          >
            {showsFit ? "Fit" : `${displayedTimelineZoomPercent}%`}
          </span>
        </div>
      </div>
    </div>
  );
});
