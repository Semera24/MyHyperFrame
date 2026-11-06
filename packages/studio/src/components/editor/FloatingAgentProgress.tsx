import { memo, useState, useEffect, useRef } from "react";
import { useAgentAssistantStore } from "../panels/AgentAssistantPanel";

export const FloatingAgentProgress = memo(function FloatingAgentProgress() {
  const {
    isRunning,
    engine,
    model,
    currentStepText,
    progressPercent,
    terminalLogs,
    lastRunStatus,
    lastRunSummary,
    cancelRun,
  } = useAgentAssistantStore();

  const [expandedLogs, setExpandedLogs] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [translucent, setTranslucent] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const draggingRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: dragOffset.x,
      initialY: dragOffset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    const dx = e.clientX - draggingRef.current.startX;
    const dy = e.clientY - draggingRef.current.startY;
    setDragOffset({
      x: draggingRef.current.initialX + dx,
      y: draggingRef.current.initialY + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    draggingRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  // Auto-scroll logs when expanded
  useEffect(() => {
    if (expandedLogs && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [expandedLogs, terminalLogs]);

  // Reset dismissed state when a new run starts
  useEffect(() => {
    if (isRunning) {
      setDismissed(false);
    }
  }, [isRunning]);

  // Auto-hide 15s after completion so user can review edit summary
  useEffect(() => {
    if (!isRunning && lastRunStatus === "completed") {
      const timer = setTimeout(() => setDismissed(true), 15000);
      return () => clearTimeout(timer);
    }
  }, [isRunning, lastRunStatus]);

  // Auto-expand logs if a run fails so user can immediately see the error
  useEffect(() => {
    if (!isRunning && (lastRunStatus === "failed" || lastRunStatus === "cancelled")) {
      setExpandedLogs(true);
    }
  }, [isRunning, lastRunStatus]);

  if (dismissed || (!isRunning && lastRunStatus === "idle")) {
    return null;
  }

  const isCompleted = !isRunning && lastRunStatus === "completed";
  const isFailed = !isRunning && (lastRunStatus === "failed" || lastRunStatus === "cancelled");

  if (minimized) {
    return (
      <div
        data-testid="floating-agent-progress-minimized"
        style={{
          transform: `translate(calc(-50% + ${dragOffset.x}px), ${dragOffset.y}px)`,
        }}
        className={`pointer-events-auto absolute top-3 left-1/2 z-50 flex items-center gap-2 rounded-full border border-neutral-700/80 px-3 py-1 text-[11px] shadow-2xl backdrop-blur-md transition-all ${
          translucent
            ? "bg-neutral-950/40 opacity-70 hover:opacity-100"
            : "bg-neutral-950/95 opacity-100"
        }`}
      >
        <span
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="cursor-grab active:cursor-grabbing text-neutral-500 font-mono text-xs select-none hover:text-white"
          title="Drag to move HUD anywhere"
        >
          ⠿
        </span>
        <span className="relative flex h-2.5 w-2.5">
          {isRunning ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </>
          ) : isCompleted ? (
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
          ) : (
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
          )}
        </span>
        <span className="font-semibold text-white capitalize">{engine}</span>
        <span className="font-mono text-emerald-300 text-[10px]">{progressPercent}%</span>
        <button
          type="button"
          onClick={() => setTranslucent((prev) => !prev)}
          className={`px-1 text-[9.5px] rounded ${translucent ? "text-amber-300 font-bold" : "text-neutral-400 hover:text-white"}`}
          title="Toggle see-through translucent background"
        >
          👁
        </button>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="text-neutral-400 hover:text-white text-[10px] font-mono px-1"
          title="Expand HUD"
        >
          ▢
        </button>
        {isRunning && (
          <button
            type="button"
            onClick={() => void cancelRun()}
            className="text-rose-400 hover:text-rose-300 text-[10px] font-semibold px-1"
            title="Stop agent run"
          >
            ⏹
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-neutral-400 hover:text-white text-[10px] px-1"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="floating-agent-progress"
      style={{
        transform: `translate(calc(-50% + ${dragOffset.x}px), ${dragOffset.y}px)`,
      }}
      className={`pointer-events-auto absolute top-3 left-1/2 z-50 w-[92%] max-w-[540px] min-w-[300px] resize overflow-auto rounded-xl border border-neutral-700/80 p-3 text-neutral-100 shadow-2xl transition-all duration-200 animate-in fade-in slide-in-from-top-2 ${
        translucent
          ? "bg-neutral-950/40 backdrop-blur-xs opacity-75 hover:opacity-100"
          : "bg-neutral-950/95 backdrop-blur-md opacity-100"
      }`}
    >
      {/* Top Header Row with Drag Handle */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="flex items-center justify-between gap-2 mb-2 cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-neutral-500 font-mono text-xs hover:text-white"
            title="Drag to move HUD anywhere"
          >
            ⠿
          </span>
          <span className="relative flex h-3 w-3">
            {isRunning ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
              </>
            ) : isCompleted ? (
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400" />
            ) : (
              <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
            )}
          </span>
          <div className="flex items-center gap-1.5 min-w-0 text-[11px] font-semibold">
            <span className="text-white capitalize">{engine}</span>
            <span className="text-neutral-400 font-mono text-[10px]">({model})</span>
            <span
              className={`px-1.5 py-0.2 rounded text-[9px] uppercase tracking-wide font-mono ${
                isRunning
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse"
                  : isCompleted
                    ? "bg-emerald-500/25 text-emerald-200 border border-emerald-500/40"
                    : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
              }`}
            >
              {isRunning ? "Running" : isCompleted ? "Complete" : lastRunStatus}
            </span>
          </div>
        </div>

        <div
          className="flex items-center gap-1.5 shrink-0"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setTranslucent((prev) => !prev)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors border ${
              translucent
                ? "bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold"
                : "bg-neutral-900 hover:bg-neutral-800 border-neutral-700/70 text-neutral-300"
            }`}
            title="Toggle see-through translucent background to see the video behind"
          >
            👁 {translucent ? "Opaque" : "Glass"}
          </button>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-neutral-900 hover:bg-neutral-800 border border-neutral-700/70 text-neutral-300 transition-colors"
            title="Minimize HUD to small pill"
          >
            —
          </button>
          <button
            type="button"
            onClick={() => setExpandedLogs((prev) => !prev)}
            className="px-2 py-0.5 rounded text-[10px] font-mono bg-neutral-900 hover:bg-neutral-800 border border-neutral-700/70 text-neutral-300 transition-colors"
          >
            {expandedLogs ? "▲ Logs" : "▼ Terminal"}
          </button>
          {isRunning ? (
            <button
              type="button"
              onClick={() => void cancelRun()}
              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 transition-colors"
            >
              ⏹ Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="px-1.5 py-0.5 rounded text-[10px] text-neutral-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-neutral-900 rounded-full h-2 overflow-hidden border border-neutral-800 relative mb-2">
        <div
          className={`h-full transition-all duration-300 rounded-full ${
            isRunning
              ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400 animate-pulse"
              : isCompleted
                ? "bg-emerald-400"
                : "bg-rose-500"
          }`}
          style={{ width: `${Math.max(5, Math.min(100, progressPercent))}%` }}
        />
      </div>

      {/* Current Step Description */}
      <div className="flex items-center justify-between text-[10.5px]">
        <span className="truncate text-neutral-300 font-mono">
          {currentStepText || (isRunning ? "Executing agent steps in project..." : "Done")}
        </span>
        <span className="font-mono text-neutral-400 text-[10px] shrink-0 ml-2">
          {progressPercent}%
        </span>
      </div>

      {/* Summary of finished AI edit */}
      {!isRunning && lastRunSummary && (
        <div className="mt-2.5 flex flex-col gap-1 rounded-lg bg-neutral-900/90 border border-neutral-800 p-2.5 text-[11px]">
          <div className="flex items-center justify-between font-mono">
            <span
              className={
                isCompleted
                  ? "text-emerald-300 font-bold flex items-center gap-1.5"
                  : "text-rose-400 font-bold flex items-center gap-1.5"
              }
            >
              <span>{isCompleted ? "✓ Finished" : "✕ Failed"} at:</span>
              <span className="text-white underline">{lastRunSummary.finishedAtTime}</span>
            </span>
            <span className="text-neutral-400 text-[10px]">
              {(lastRunSummary.durationMs / 1000).toFixed(1)}s (exit={lastRunSummary.exitCode})
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-neutral-300 font-mono text-[10.5px] truncate">
            <span className="text-emerald-400 font-semibold">
              Sources/{lastRunSummary.sceneFile}
            </span>
            {lastRunSummary.elementId && lastRunSummary.elementId !== "scene" && (
              <span className="text-amber-300 font-semibold">#{lastRunSummary.elementId}</span>
            )}
          </div>
          <div className="text-neutral-200 truncate bg-neutral-950/80 px-2 py-1 rounded border border-neutral-800/80 italic text-[10.5px]">
            "{lastRunSummary.prompt}"
          </div>
        </div>
      )}

      {/* Expandable Live Terminal Drawer */}
      {expandedLogs && (
        <div className="mt-2.5 max-h-48 overflow-y-auto rounded-lg bg-black/90 p-2 border border-neutral-800 font-mono text-[9.5px] leading-relaxed">
          {terminalLogs.length === 0 ? (
            <div className="text-neutral-500 italic">Waiting for terminal output...</div>
          ) : (
            terminalLogs.map((entry, i) => (
              <pre
                key={i}
                className={`whitespace-pre-wrap break-words ${
                  entry.stream === "stderr"
                    ? "text-amber-300"
                    : entry.stream === "system"
                      ? "text-emerald-300 font-semibold"
                      : "text-neutral-200"
                }`}
              >
                {entry.text}
              </pre>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
});
