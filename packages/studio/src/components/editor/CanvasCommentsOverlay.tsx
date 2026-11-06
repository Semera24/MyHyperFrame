import type React from "react";
import { useEffect, useState, useRef } from "react";
import { liveTime, usePlayerStore } from "../../player";
import { resolveActiveSceneTargetAtPlayhead } from "../../utils/studioLayerActions";
import { getSourceFileForElement } from "./domEditingDom";
import { usePreviewOverlayContext } from "./PreviewOverlayProvider";
import {
  AI_AGENTS,
  formatAllOpenPinsPromptForAgent,
  formatPinBadgeNumber,
  formatSinglePinPromptForAgent,
  useCanvasCommentsStore,
  type CanvasCommentPin,
  type TargetAiAgent,
} from "./canvasCommentsStore";
import { targetAgentToEngine, useAgentAssistantStore } from "../panels/AgentAssistantPanel";
import { FloatingAgentProgress } from "./FloatingAgentProgress";
import { DesktopFrameyChatCard } from "./DesktopFrameyChatCard";
import { useOptionalNLEContext } from "../nle/NLEContext";

function inspectElementAtStagePoint(
  iframe: HTMLIFrameElement | null,
  stageX: number,
  stageY: number,
  activeCompPath: string | null,
): {
  elementId: string;
  hfId?: string;
  tagName?: string;
  sceneFile: string;
  boundingBox?: { left: number; top: number; width: number; height: number };
} {
  const fallbackTarget = resolveActiveSceneTargetAtPlayhead(activeCompPath);
  const doc = iframe?.contentDocument;
  if (!doc) {
    return {
      elementId: "scene",
      sceneFile: fallbackTarget.targetFile,
    };
  }

  // Convert 1920x1080 stage coordinates to iframe viewport coordinates
  const root =
    doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.body ?? doc.documentElement;
  const rootRect = root.getBoundingClientRect();
  const clientX = rootRect.left + (stageX / 1920) * (rootRect.width || 1920);
  const clientY = rootRect.top + (stageY / 1080) * (rootRect.height || 1080);

  const rawHits = doc.elementsFromPoint(clientX, clientY);
  let chosen: HTMLElement | null = null;
  const htmlElementCtor =
    doc?.defaultView?.HTMLElement ?? (typeof HTMLElement !== "undefined" ? HTMLElement : null);
  for (const hit of rawHits) {
    if (!((htmlElementCtor && hit instanceof htmlElementCtor) || hit?.nodeType === 1)) continue;
    const el = hit as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "html" || tag === "body" || el.id === "root") continue;
    if (
      el.classList.contains("wash-dark") ||
      el.classList.contains("wash-vignette") ||
      el.classList.contains("scene-transition") ||
      el.classList.contains("scene-mount")
    ) {
      continue;
    }
    if (el.id || el.hasAttribute("data-hf-id") || tag === "img" || tag === "svg") {
      chosen = el;
      break;
    }
  }

  if (!chosen) {
    return {
      elementId: "scene",
      sceneFile: fallbackTarget.targetFile,
    };
  }

  const { sourceFile } = getSourceFileForElement(chosen, activeCompPath);
  const resolvedSceneFile =
    sourceFile && sourceFile !== "index.html" ? sourceFile : fallbackTarget.targetFile;
  const elRect = chosen.getBoundingClientRect();
  const scaleTo1920 = (rootRect.width || 1920) / 1920;
  const scaleTo1080 = (rootRect.height || 1080) / 1080;

  return {
    elementId: chosen.id || chosen.getAttribute("data-hf-id") || chosen.tagName.toLowerCase(),
    hfId: chosen.getAttribute("data-hf-id") || undefined,
    tagName: chosen.tagName.toLowerCase(),
    sceneFile: resolvedSceneFile,
    boundingBox: {
      left: Math.round((elRect.left - rootRect.left) / (scaleTo1920 || 1)),
      top: Math.round((elRect.top - rootRect.top) / (scaleTo1080 || 1)),
      width: Math.round(elRect.width / (scaleTo1920 || 1)),
      height: Math.round(elRect.height / (scaleTo1080 || 1)),
    },
  };
}

function getPinCardTransform(pctX: number, pctY: number): string {
  // If pin is in the lower half of the preview (pctY > 44), flip the card to render ABOVE the pin so it never gets hidden behind bottom controls or screen edge
  const yShift = pctY > 44 ? "calc(-100% - 16px)" : "16px";
  // If pin is near the right edge, shift card left; if near left edge, shift right; otherwise center
  const xShift = pctX > 65 ? "-85%" : pctX < 25 ? "0%" : "-50%";
  return `translate(${xShift}, ${yShift})`;
}

export function CanvasCommentsOverlay({
  projectId,
  activeCompPath,
  iframeRef,
}: {
  projectId: string | null;
  activeCompPath: string | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}) {
  const { state } = usePreviewOverlayContext();
  const {
    left: compositionLeft,
    top: compositionTop,
    width: compositionWidth,
    height: compositionHeight,
  } = state.compositionRect;

  const nle = useOptionalNLEContext();
  const currentTime = usePlayerStore((s) => s.currentTime);
  const [livePlayhead, setLivePlayhead] = useState(currentTime);

  const {
    commentModeActive,
    showAllPins,
    drawerOpen,
    selectedAgent,
    pins,
    activePinId,
    draftPin,
    setCommentModeActive,
    setShowAllPins,
    setDrawerOpen,
    setSelectedAgent,
    setActivePinId,
    setDraftPin,
    loadPins,
    saveDraftPin,
    togglePinStatus,
    deletePin,
  } = useCanvasCommentsStore();

  const {
    isRunning,
    activePinIdRunning,
    runAgent,
    chatDrawerOpen,
    setChatDrawerOpen,
    lastRunSummary,
  } = useAgentAssistantStore();

  const [draftText, setDraftText] = useState("");
  const [copyBanner, setCopyBanner] = useState<string | null>(null);
  const [pinCardDragOffset, setPinCardDragOffset] = useState({ x: 0, y: 0 });
  const [pinCardTranslucent, setPinCardTranslucent] = useState(false);
  const [pinCardMinimized, setPinCardMinimized] = useState(false);
  const pinCardDraggingRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  } | null>(null);

  // Reset drag offset & minimize when target pin changes
  useEffect(() => {
    setPinCardDragOffset({ x: 0, y: 0 });
    setPinCardMinimized(false);
  }, [activePinId, draftPin]);

  const handlePinCardPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    pinCardDraggingRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: pinCardDragOffset.x,
      initialY: pinCardDragOffset.y,
    };
  };

  const handlePinCardPointerMove = (e: React.PointerEvent) => {
    if (!pinCardDraggingRef.current) return;
    e.stopPropagation();
    const dx = e.clientX - pinCardDraggingRef.current.startX;
    const dy = e.clientY - pinCardDraggingRef.current.startY;
    setPinCardDragOffset({
      x: pinCardDraggingRef.current.initialX + dx,
      y: pinCardDraggingRef.current.initialY + dy,
    });
  };

  const handlePinCardPointerUp = (e: React.PointerEvent) => {
    if (!pinCardDraggingRef.current) return;
    e.stopPropagation();
    pinCardDraggingRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (projectId) void loadPins(projectId);
  }, [projectId, loadPins]);

  useEffect(() => {
    return liveTime.subscribe((t) => setLivePlayhead(t));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (commentModeActive || draftPin || activePinId)) {
        setDraftPin(null);
        setActivePinId(null);
        setCommentModeActive(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commentModeActive, draftPin, activePinId, setDraftPin, setActivePinId, setCommentModeActive]);

  const effectiveTime =
    Number.isFinite(livePlayhead) && livePlayhead > 0 ? livePlayhead : currentTime;

  const visiblePins = pins.filter((pin) => {
    if (commentModeActive || showAllPins || activePinId === pin.id) return true;
    return pin.status === "OPEN" && Math.abs(pin.timestampSeconds - effectiveTime) <= 2.5;
  });

  const activeSavedPin: CanvasCommentPin | null = pins.find((p) => p.id === activePinId) ?? null;

  const flashCopy = (msg: string) => {
    setCopyBanner(msg);
    setTimeout(() => setCopyBanner(null), 2200);
  };

  const handleRunDraftPin = async () => {
    if (!projectId || !draftPin || !draftText.trim()) return;
    const targetAgent = selectedAgent;
    const prompt = draftText.trim();
    const saved = await saveDraftPin(projectId, {
      ...draftPin,
      targetAgent,
      note: prompt,
    });
    if (!saved) return;
    flashCopy(`Running ${targetAgent}...`);
    setDraftPin(null);
    const ok = await runAgent({
      projectId,
      engine: targetAgentToEngine(targetAgent),
      prompt,
      sceneFile: saved.sceneFile,
      elementId: saved.elementId,
      timestampSeconds: saved.timestampSeconds,
      pinId: saved.id,
    });
    if (ok) {
      nle?.refreshPlayer?.();
      flashCopy("✓ Updated preview!");
    }
  };

  const handleRunSavedPin = async (pin: CanvasCommentPin) => {
    if (!projectId) return;
    flashCopy(`Running ${pin.targetAgent}...`);
    setActivePinId(null);
    const ok = await runAgent({
      projectId,
      engine: targetAgentToEngine(pin.targetAgent),
      prompt: pin.note,
      sceneFile: pin.sceneFile,
      elementId: pin.elementId,
      timestampSeconds: pin.timestampSeconds,
      pinId: pin.id,
    });
    if (ok) {
      nle?.refreshPlayer?.();
      flashCopy("✓ Updated preview!");
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!commentModeActive || compositionWidth <= 0 || compositionHeight <= 0) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const stageX = Math.round(relX * 1920);
    const stageY = Math.round(relY * 1080);
    const pctX = Number((relX * 100).toFixed(2));
    const pctY = Number((relY * 100).toFixed(2));
    const playhead = liveTime.get() || currentTime || 0;

    const hit = inspectElementAtStagePoint(iframeRef.current, stageX, stageY, activeCompPath);

    setActivePinId(null);
    setDraftText("");
    setDraftPin({
      stageX,
      stageY,
      pctX,
      pctY,
      timestampSeconds: Number(playhead.toFixed(2)),
      frame: Math.round(playhead * 30),
      sceneFile: hit.sceneFile,
      elementId: hit.elementId,
      hfId: hit.hfId,
      tagName: hit.tagName,
      boundingBox: hit.boundingBox,
      targetAgent: selectedAgent,
      note: "",
    });
  };

  const openPinsCount = pins.filter((p) => p.status === "OPEN").length;

  return (
    <>
      {/* Floating High-Tech Agent Progress Widget */}
      <FloatingAgentProgress />

      {/* Bottom Floating Stage Bar: ↖ Select | 📍 Comment | Pins (N) */}
      <div className="pointer-events-auto absolute bottom-3 left-3 z-50 flex items-center gap-1.5 rounded-lg border border-neutral-700/80 bg-neutral-950/90 px-2 py-1 shadow-xl backdrop-blur-md">
        <button
          type="button"
          onClick={() => {
            setCommentModeActive(false);
            setDraftPin(null);
          }}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            !commentModeActive
              ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40"
              : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
          }`}
        >
          <span>↖ Select</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setCommentModeActive(!commentModeActive);
          }}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            commentModeActive
              ? "bg-amber-500 text-black shadow-sm"
              : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
          }`}
          title="Point-and-Comment on Canvas: click any spot on the preview to drop a numbered revision pin"
        >
          <span>📍 Comment</span>
          {openPinsCount > 0 && (
            <span className="ml-0.5 rounded-full bg-black/30 px-1.5 py-0.2 text-[10px]">
              {openPinsCount}
            </span>
          )}
        </button>
        {pins.length > 0 && (
          <>
            <div className="h-3.5 w-px bg-neutral-800" />
            <button
              type="button"
              onClick={() => setDrawerOpen(!drawerOpen)}
              className="rounded px-2 py-1 text-[10px] font-medium text-neutral-300 hover:bg-neutral-800 hover:text-white"
              title="View all pinned canvas comments"
            >
              Pins ({pins.length})
            </button>
          </>
        )}
        {copyBanner && (
          <span className="ml-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
            {copyBanner}
          </span>
        )}
      </div>

      {/* Top Comment Mode Banner */}
      {commentModeActive && !draftPin && !activeSavedPin && !isRunning && (
        <div className="pointer-events-none absolute top-2 left-1/2 z-50 -translate-x-1/2 rounded-full border border-amber-400/60 bg-neutral-950/90 px-3.5 py-1 text-[11px] font-medium text-amber-200 shadow-lg">
          📍 Click anywhere on the canvas to drop a spatial comment pin · Press Esc to exit
        </div>
      )}

      {/* Stage-aligned Click Capture & Numbered Pins Layer */}
      {compositionWidth > 0 && compositionHeight > 0 && (
        <div
          style={{
            left: compositionLeft,
            top: compositionTop,
            width: compositionWidth,
            height: compositionHeight,
          }}
          onClick={handleCanvasClick}
          className={`absolute z-45 ${
            commentModeActive ? "pointer-events-auto cursor-crosshair" : "pointer-events-none"
          }`}
        >
          {/* Saved Pins */}
          {visiblePins.map((pin) => {
            const isSelected = activePinId === pin.id;
            const isPinRunning = activePinIdRunning === pin.id;
            return (
              <button
                key={pin.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDraftPin(null);
                  setActivePinId(isSelected ? null : pin.id);
                  usePlayerStore.getState().requestSeek(pin.timestampSeconds);
                  liveTime.notifySeek(pin.timestampSeconds);
                }}
                style={{
                  left: `${pin.pctX}%`,
                  top: `${pin.pctY}%`,
                }}
                title={`Pin #${pin.pinNumber} (${pin.sceneFile} · #${pin.elementId} @ ${pin.timestampSeconds.toFixed(1)}s): ${pin.note}${isPinRunning ? " [RUNNING...]" : ""}`}
                className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 flex h-6 min-w-6 items-center justify-center rounded-full border px-1.5 text-[11px] font-bold shadow-lg transition-transform hover:scale-110 ${
                  isPinRunning
                    ? "border-emerald-400 bg-emerald-500 text-black ring-4 ring-emerald-300 animate-pulse scale-110"
                    : pin.status === "RESOLVED"
                      ? "border-emerald-400 bg-emerald-600/90 text-white opacity-75"
                      : isSelected
                        ? "border-white bg-amber-400 text-black scale-110 ring-2 ring-amber-300"
                        : "border-amber-200 bg-amber-500 text-black"
                }`}
              >
                {isPinRunning ? (
                  <span className="flex items-center gap-0.5">
                    <span className="animate-spin text-[10px]">⟳</span>
                    <span>{formatPinBadgeNumber(pin.pinNumber)}</span>
                  </span>
                ) : (
                  formatPinBadgeNumber(pin.pinNumber)
                )}
              </button>
            );
          })}

          {/* Draft Pin Marker + Inline Card */}
          {draftPin && (
            <div
              style={{
                left: `${draftPin.pctX}%`,
                top: `${draftPin.pctY}%`,
              }}
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto absolute z-[60]"
            >
              <div className="-translate-x-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-amber-400 text-[11px] font-bold text-black shadow-lg">
                {formatPinBadgeNumber(pins.length + 1)}
              </div>
              <div
                className={`w-[320px] min-w-[270px] max-w-[540px] resize overflow-auto rounded-xl border border-neutral-700 p-3 text-neutral-100 shadow-2xl transition-all ${
                  pinCardTranslucent
                    ? "bg-neutral-950/45 backdrop-blur-xs opacity-75 hover:opacity-100"
                    : "bg-neutral-950/95 backdrop-blur-md opacity-100"
                }`}
                style={{
                  transform: `${getPinCardTransform(draftPin.pctX, draftPin.pctY)} translate(${pinCardDragOffset.x}px, ${pinCardDragOffset.y}px)`,
                }}
              >
                <div
                  onPointerDown={handlePinCardPointerDown}
                  onPointerMove={handlePinCardPointerMove}
                  onPointerUp={handlePinCardPointerUp}
                  className="mb-1.5 flex items-center justify-between text-[10px] text-neutral-400 cursor-grab active:cursor-grabbing select-none border-b border-neutral-800 pb-1"
                >
                  <div className="flex items-center gap-1 min-w-0">
                    <span
                      className="text-neutral-500 font-mono hover:text-white"
                      title="Drag card anywhere"
                    >
                      ⠿
                    </span>
                    <span className="truncate font-mono text-amber-300">
                      {draftPin.sceneFile} · #{draftPin.elementId}
                    </span>
                  </div>
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => setPinCardTranslucent((p) => !p)}
                      className={`px-1.5 py-0.5 rounded text-[9.5px] border ${
                        pinCardTranslucent
                          ? "bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold"
                          : "bg-neutral-900 border-neutral-700 text-neutral-400 hover:text-white"
                      }`}
                      title="Toggle see-through opacity (view video background behind card)"
                    >
                      👁 {pinCardTranslucent ? "Opaque" : "Glass"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftPin(null)}
                      className="px-1 text-neutral-400 hover:text-white text-[10px] font-mono"
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <textarea
                  rows={3}
                  autoFocus
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      void handleRunDraftPin();
                    }
                  }}
                  placeholder="Describe the fix at this spot (e.g. 'Make title gold and increase font size to 38px'). Press Cmd+Enter to Ask AI..."
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[11px] text-white outline-hidden focus:border-amber-400"
                />
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {AI_AGENTS.map((agent) => (
                    <button
                      key={agent}
                      type="button"
                      onClick={() => {
                        setSelectedAgent(agent);
                        useAgentAssistantStore.getState().setEngine(targetAgentToEngine(agent));
                      }}
                      className={`rounded px-1.5 py-0.5 text-[9px] font-semibold transition-colors ${
                        selectedAgent === agent
                          ? "bg-amber-500 text-black"
                          : "bg-neutral-800 text-neutral-400 hover:text-white"
                      }`}
                    >
                      {agent}
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 flex items-center justify-end gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setDraftPin(null)}
                    className="rounded px-2 py-1 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!draftText.trim()}
                    onClick={() => {
                      const prompt = formatSinglePinPromptForAgent(
                        {
                          ...draftPin,
                          pinNumber: pins.length + 1,
                          note: draftText.trim(),
                        },
                        selectedAgent,
                        projectId,
                      );
                      void navigator.clipboard?.writeText(prompt);
                      flashCopy(`Copied for ${selectedAgent}!`);
                    }}
                    className="rounded border border-indigo-400/40 bg-indigo-500/20 px-2 py-1 text-[10px] font-semibold text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-40"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    disabled={!draftText.trim() || !projectId}
                    onClick={() => {
                      if (!projectId || !draftText.trim()) return;
                      void saveDraftPin(projectId, {
                        ...draftPin,
                        targetAgent: selectedAgent,
                        note: draftText.trim(),
                      }).then((saved) => {
                        if (saved) flashCopy(`Saved Pin #${saved.pinNumber}`);
                        setDraftPin(null);
                      });
                    }}
                    className="rounded bg-neutral-800 px-2 py-1 text-[10px] font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
                  >
                    Save Only
                  </button>
                  <button
                    type="button"
                    data-testid="draft-pin-ask-ai-button"
                    disabled={!draftText.trim() || !projectId || isRunning}
                    onClick={() => void handleRunDraftPin()}
                    className="rounded bg-gradient-to-r from-emerald-500 to-teal-400 px-3 py-1 text-[10.5px] font-bold text-slate-950 hover:from-emerald-400 hover:to-teal-300 shadow-md flex items-center gap-1 disabled:opacity-40 transition-all cursor-pointer"
                    title="Save pin and immediately execute instruction with AI agent (Cmd+Enter)"
                  >
                    <span>▶ Ask {selectedAgent}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Active Saved Pin Popover Card */}
          {activeSavedPin && !draftPin && (
            <div
              style={{
                left: `${activeSavedPin.pctX}%`,
                top: `${activeSavedPin.pctY}%`,
              }}
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto absolute z-[60]"
            >
              {pinCardMinimized ? (
                <div
                  className={`flex items-center gap-1.5 rounded-full border border-neutral-700 px-3 py-1 text-[10px] shadow-2xl backdrop-blur-md select-none transition-all ${
                    pinCardTranslucent
                      ? "bg-neutral-950/45 opacity-75 hover:opacity-100"
                      : "bg-neutral-950/95 opacity-100"
                  }`}
                  style={{
                    transform: `${getPinCardTransform(activeSavedPin.pctX, activeSavedPin.pctY)} translate(${pinCardDragOffset.x}px, ${pinCardDragOffset.y}px)`,
                  }}
                >
                  <span
                    onPointerDown={handlePinCardPointerDown}
                    onPointerMove={handlePinCardPointerMove}
                    onPointerUp={handlePinCardPointerUp}
                    className="cursor-grab active:cursor-grabbing text-neutral-500 font-mono text-xs select-none hover:text-white"
                    title="Drag anywhere"
                  >
                    ⠿
                  </span>
                  <span className="font-bold text-amber-300">#{activeSavedPin.pinNumber}</span>
                  <span className="truncate text-neutral-300 max-w-[150px] font-mono">
                    #{activeSavedPin.elementId}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPinCardMinimized(false)}
                    className="text-neutral-400 hover:text-white font-mono px-1"
                    title="Expand pin details"
                  >
                    ▢
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePinId(null)}
                    className="text-neutral-400 hover:text-white font-mono px-1"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div
                  className={`w-[320px] min-w-[270px] max-w-[540px] resize overflow-auto rounded-xl border border-neutral-700 text-neutral-100 shadow-2xl p-3 transition-all ${
                    pinCardTranslucent
                      ? "bg-neutral-950/45 backdrop-blur-xs opacity-75 hover:opacity-100"
                      : "bg-neutral-950/95 backdrop-blur-md opacity-100"
                  }`}
                  style={{
                    transform: `${getPinCardTransform(activeSavedPin.pctX, activeSavedPin.pctY)} translate(${pinCardDragOffset.x}px, ${pinCardDragOffset.y}px)`,
                  }}
                >
                  <div
                    onPointerDown={handlePinCardPointerDown}
                    onPointerMove={handlePinCardPointerMove}
                    onPointerUp={handlePinCardPointerUp}
                    className="mb-1 flex items-center justify-between text-[10px] cursor-grab active:cursor-grabbing select-none border-b border-neutral-800 pb-1"
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      <span
                        className="text-neutral-500 font-mono text-xs hover:text-white"
                        title="Drag card anywhere"
                      >
                        ⠿
                      </span>
                      <span className="font-bold text-amber-300 truncate">
                        Pin #{activeSavedPin.pinNumber} · {activeSavedPin.sceneFile}
                      </span>
                    </div>
                    <div
                      className="flex items-center gap-1 shrink-0"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setPinCardTranslucent((p) => !p)}
                        className={`px-1.5 py-0.5 rounded text-[9.5px] border ${
                          pinCardTranslucent
                            ? "bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold"
                            : "bg-neutral-900 border-neutral-700 text-neutral-400 hover:text-white"
                        }`}
                        title="Toggle see-through opacity (view video background behind card)"
                      >
                        👁 {pinCardTranslucent ? "Opaque" : "Glass"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPinCardMinimized(true)}
                        className="px-1 text-neutral-400 hover:text-white font-mono text-[10px]"
                        title="Minimize to see background"
                      >
                        —
                      </button>
                      <button
                        type="button"
                        onClick={() => setActivePinId(null)}
                        className="px-1 text-neutral-400 hover:text-white font-mono text-[10px]"
                        title="Close"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-neutral-400 mb-1">
                    <span className="font-mono text-amber-400/90 truncate">
                      #{activeSavedPin.elementId}
                    </span>
                    <span className="font-mono shrink-0">
                      ({activeSavedPin.stageX}, {activeSavedPin.stageY}) ·{" "}
                      {activeSavedPin.timestampSeconds.toFixed(1)}s
                    </span>
                  </div>
                  <p className="rounded bg-neutral-900/90 p-2 text-[11px] text-neutral-100 border border-neutral-800/80">
                    {activeSavedPin.note}
                  </p>
                  {lastRunSummary && lastRunSummary.status === "completed" && (
                    <div className="mt-1.5 flex items-center justify-between text-[9.5px] text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded px-1.5 py-0.5 font-mono">
                      <span>✓ Last AI Edit: {lastRunSummary.engine}</span>
                      <span>
                        {lastRunSummary.finishedAtTime} (
                        {(lastRunSummary.durationMs / 1000).toFixed(1)}s)
                      </span>
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1">
                      {projectId && (
                        <>
                          <button
                            type="button"
                            onClick={() => void togglePinStatus(projectId, activeSavedPin.id)}
                            className="rounded bg-neutral-800 px-2 py-1 text-[10px] text-neutral-200 hover:bg-neutral-700"
                          >
                            {activeSavedPin.status === "OPEN" ? "✓ Resolve" : "Reopen"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deletePin(projectId, activeSavedPin.id)}
                            className="rounded bg-red-500/20 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/30"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {projectId && (
                        <button
                          type="button"
                          data-testid="saved-pin-ask-ai-button"
                          disabled={isRunning}
                          onClick={() => void handleRunSavedPin(activeSavedPin)}
                          className="rounded bg-gradient-to-r from-emerald-500 to-teal-400 px-2.5 py-1 text-[10px] font-bold text-slate-950 hover:from-emerald-400 hover:to-teal-300 shadow-md flex items-center gap-1 disabled:opacity-40 transition-all cursor-pointer"
                          title={`Execute revision with ${activeSavedPin.targetAgent}`}
                        >
                          ▶ Ask {activeSavedPin.targetAgent}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const prompt = formatSinglePinPromptForAgent(
                            activeSavedPin,
                            selectedAgent,
                            projectId,
                          );
                          void navigator.clipboard?.writeText(prompt);
                          flashCopy(
                            `Copied Pin #${activeSavedPin.pinNumber} for ${selectedAgent}!`,
                          );
                        }}
                        className="rounded bg-indigo-500/25 border border-indigo-400/40 px-2 py-1 text-[10px] font-semibold text-indigo-200 hover:bg-indigo-500/35"
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => setActivePinId(null)}
                        className="rounded px-1.5 py-1 text-[10px] text-neutral-400 hover:text-white"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Floating Desktop Framey Chat Card */}
      {chatDrawerOpen && (
        <div className="pointer-events-auto absolute top-12 left-4 z-50 animate-in fade-in slide-in-from-left-2">
          <DesktopFrameyChatCard
            projectId={projectId}
            activeCompPath={activeCompPath}
            onClose={() => setChatDrawerOpen(false)}
          />
        </div>
      )}

      {/* Collapsible Pinned Comments Drawer */}
      {drawerOpen && (
        <div className="pointer-events-auto absolute bottom-14 left-3 z-50 w-[340px] max-h-[280px] flex flex-col rounded-xl border border-neutral-700 bg-neutral-950/95 p-3 text-neutral-100 shadow-2xl backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between border-b border-neutral-800 pb-1.5">
            <span className="text-[11px] font-semibold text-amber-300">
              📍 Canvas Revision Pins ({pins.length})
            </span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[10px] text-neutral-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAllPins}
                  onChange={(e) => setShowAllPins(e.target.checked)}
                />
                Show all on canvas
              </label>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-[11px] text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
            {pins.map((pin) => (
              <div
                key={pin.id}
                onClick={() => {
                  setActivePinId(pin.id);
                  usePlayerStore.getState().requestSeek(pin.timestampSeconds);
                  liveTime.notifySeek(pin.timestampSeconds);
                }}
                className="cursor-pointer rounded-lg border border-neutral-800 bg-neutral-900/90 p-2 hover:border-amber-500/50"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-semibold text-amber-300">
                    {formatPinBadgeNumber(pin.pinNumber)} {pin.sceneFile} · #{pin.elementId}
                  </span>
                  <span className="font-mono text-neutral-400">
                    {pin.timestampSeconds.toFixed(1)}s · ({pin.stageX},{pin.stageY})
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-neutral-200">{pin.note}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
