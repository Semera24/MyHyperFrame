import { memo, useState, useEffect, useCallback } from "react";
import { studioApiFetch } from "../../utils/studioApiFetch";

export interface AssetPreflightItem {
  fileName: string;
  category: "character" | "background" | "prop" | "map" | "other";
  width: number;
  height: number;
  hasAlpha: boolean;
  colorType?: number;
  sizeBytes: number;
  status: "ok" | "warning";
  warning?: string;
}

export interface AudioFrameEndpoint {
  fps: number;
  rawDurationSeconds: number;
  ceilingFrames: number;
  frameAlignedSeconds: number;
  deltaFrames: number;
  deltaSeconds: number;
}

export interface RevisionEntry {
  status: "open" | "implemented" | "checked" | "owner-approved";
  title: string;
  rawSummary?: string;
  timeSeconds?: number;
  frame?: number;
  scene?: string;
  target?: string;
  note?: string;
}

export interface EpisodeHandoffData {
  episodeId: string;
  channel: string;
  authoritativeDir: string;
  stage: string;
  script: {
    fileName?: string;
    exists: boolean;
    wordCount?: number;
    title?: string;
    firstLines?: string;
    scenes?: Array<{ id: string; title: string }>;
  };
  audio: {
    fileName?: string;
    exists: boolean;
    sizeBytes?: number;
    durationSeconds?: number;
    sampleRate?: number;
    channels?: number;
    codec?: string;
    timelineDurationSeconds?: number;
    isDurationInSync?: boolean;
    durationDiffSeconds?: number;
    frameEndpoint?: AudioFrameEndpoint;
  };
  timing: {
    fileName?: string;
    exists: boolean;
    provenance?: string;
    fps?: number;
    targetFrames?: number;
    cueCount?: number;
    sceneCount?: number;
  };
  assets: {
    totalImages: number;
    characters: number;
    backgrounds: number;
    maps: number;
    props: number;
    preflightIssues: number;
    items: AssetPreflightItem[];
  };
  revisions: {
    revisionNotesFile?: string;
    recentRevisions: RevisionEntry[];
  };
  delivery: {
    hasDraftRender: boolean;
    draftRenderPath?: string;
    hasFinalMaster: boolean;
    finalMasterPath?: string;
    hasPublishingPackage: boolean;
    publishingPackagePath?: string;
  };
}

export const EpisodeHandoffPanel = memo(function EpisodeHandoffPanel({
  projectId,
}: {
  projectId: string | null;
}) {
  const [data, setData] = useState<EpisodeHandoffData | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkerTheme, setCheckerTheme] = useState<"dark" | "light" | "black">("dark");
  const [selectedAsset, setSelectedAsset] = useState<AssetPreflightItem | null>(null);
  const [showEndpointModal, setShowEndpointModal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const fetchHandoff = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await studioApiFetch(`/api/projects/${encodeURIComponent(projectId)}/handoff`);
      if (res && res.ok) {
        const json = (await res.json()) as { ok: boolean; handoff: EpisodeHandoffData };
        if (json.ok) {
          setData(json.handoff);
          if (json.handoff.assets.items.length > 0 && !selectedAsset) {
            setSelectedAsset(json.handoff.assets.items[0]);
          }
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedAsset]);

  useEffect(() => {
    fetchHandoff();
  }, [fetchHandoff]);

  const handleSyncDuration = async () => {
    if (!projectId) return;
    setSyncing(true);
    try {
      const res = await studioApiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/handoff/sync-duration`,
        { method: "POST" },
      );
      if (res && res.ok) {
        const json = (await res.json()) as {
          ok: boolean;
          durationSynced?: number;
          ceilingFrames?: number;
          fps?: number;
          error?: string;
        };
        if (json.ok) {
          setActionStatus(
            `✓ Synced timeline to ${json.durationSynced}s (${json.ceilingFrames}f @ ${json.fps}fps)`,
          );
          setShowEndpointModal(false);
          await fetchHandoff();
        } else {
          setActionStatus(`Failed: ${json.error || "Unknown error"}`);
        }
      } else {
        const err = await res?.text().catch(() => "Server error");
        setActionStatus(`Failed to sync duration: ${err}`);
      }
    } catch (err) {
      setActionStatus(`Error: ${String(err)}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setActionStatus(null), 5000);
    }
  };

  const handleSimulateSyncDuration = () => {
    setShowEndpointModal(true);
  };

  if (!projectId) {
    return (
      <div className="p-4 text-xs text-neutral-400">
        No active episode loaded. Open a project to inspect handoff state.
      </div>
    );
  }

  const ep = data?.audio.frameEndpoint;

  return (
    <div className="p-3 text-neutral-200 space-y-3.5 h-full overflow-y-auto font-sans select-text">
      {/* Header & Stage Badge */}
      <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
        <div>
          <div className="text-xs font-bold text-white flex items-center gap-1.5">
            <span className="text-amber-400">📋</span>
            <span>Episode Handoff & Stages</span>
          </div>
          <div className="text-[10px] text-neutral-400 font-mono">
            {data?.channel || "Turning_Point_Stories"} · {data?.episodeId || projectId}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void fetchHandoff()}
          disabled={loading}
          className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-[10px] text-neutral-300 transition-colors cursor-pointer"
        >
          {loading ? "Checking..." : "↻ Refresh"}
        </button>
      </div>

      {actionStatus && (
        <div className="p-2 rounded bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs font-medium animate-fadeIn">
          {actionStatus}
        </div>
      )}

      {/* 1. Script & Research (Brief/) */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
            1. Script & Research (Brief/)
          </span>
          <span
            className={`px-1.5 py-0.2 rounded text-[9.5px] font-mono font-semibold ${
              data?.script.exists
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
            }`}
          >
            {data?.script.exists ? "Available" : "Missing"}
          </span>
        </div>
        {data?.script.exists ? (
          <div className="text-xs space-y-1">
            <div className="font-semibold text-white">{data.script.title || data.script.fileName}</div>
            <div className="text-[11px] text-neutral-400 flex items-center gap-3">
              <span>Word count: <strong className="text-neutral-200 font-mono">{data.script.wordCount}</strong></span>
              {data.script.scenes && (
                <span>Scenes: <strong className="text-neutral-200 font-mono">{data.script.scenes.length}</strong></span>
              )}
            </div>
            {data.script.firstLines && (
              <p className="text-[10.5px] text-neutral-400 italic line-clamp-2 bg-neutral-950/80 p-1.5 rounded border border-neutral-800">
                "{data.script.firstLines}..."
              </p>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-neutral-400 italic">
            Place narrative script in <code>Brief/{projectId}_Script.md</code>
          </p>
        )}
      </div>

      {/* 2. Audio Duration vs Frame-Aligned Endpoint */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
            2. Audio vs Frame Endpoint
          </span>
          <span
            className={`px-1.5 py-0.2 rounded text-[9.5px] font-mono font-semibold ${
              data?.audio.exists
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
            }`}
          >
            {data?.audio.exists ? "Audio Supplied" : "Missing Recording"}
          </span>
        </div>

        {data?.audio.exists ? (
          <div className="text-xs space-y-2">
            <div className="text-neutral-200 truncate font-mono text-[11px]">{data.audio.fileName}</div>
            
            <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono bg-neutral-950/90 p-2 rounded border border-neutral-800">
              <div>
                <span className="text-neutral-400 block text-[9px]">RAW AUDIO DURATION</span>
                <span className="text-amber-300 font-bold text-xs">{data.audio.durationSeconds?.toFixed(3)}s</span>
              </div>
              <div>
                <span className="text-neutral-400 block text-[9px]">PROPOSED FRAME CEILING</span>
                <span className="text-emerald-300 font-bold text-xs">
                  {ep?.ceilingFrames || "—"}f @ {ep?.fps || 30}fps
                </span>
              </div>
              <div className="pt-1 border-t border-neutral-800/80">
                <span className="text-neutral-400 block text-[9px]">FRAME-ALIGNED ENDPOINT</span>
                <span className="text-neutral-200">{ep?.frameAlignedSeconds?.toFixed(3) || "—"}s</span>
              </div>
              <div className="pt-1 border-t border-neutral-800/80">
                <span className="text-neutral-400 block text-[9px]">TIMELINE DURATION (Sources)</span>
                <span className="text-neutral-200">{data.audio.timelineDurationSeconds?.toFixed(3) || "—"}s</span>
              </div>
            </div>

            {ep && ep.deltaFrames !== 0 ? (
              <div className="flex items-center justify-between p-2 rounded bg-amber-500/10 border border-amber-500/30 gap-2">
                <div className="text-[10px] text-amber-300 min-w-0">
                  Timeline delta: <strong>{ep.deltaFrames > 0 ? `+${ep.deltaFrames}` : ep.deltaFrames} frames</strong> ({ep.deltaSeconds > 0 ? `+${ep.deltaSeconds}` : ep.deltaSeconds}s)
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleSimulateSyncDuration}
                    className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-[9.5px] font-medium text-neutral-300 transition-colors cursor-pointer"
                  >
                    Inspect
                  </button>
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={() => void handleSyncDuration()}
                    className="px-2.5 py-0.5 rounded bg-amber-500/25 hover:bg-amber-500/40 border border-amber-500/50 text-[9.5px] font-bold text-amber-200 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1"
                  >
                    <span>{syncing ? "Syncing..." : "⚡ Sync Duration"}</span>
                  </button>
                </div>
              </div>
            ) : ep ? (
              <div className="flex items-center justify-between p-1.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-[10px] text-emerald-300 font-mono">
                <span>✓ In sync with narration ({ep.frameAlignedSeconds}s / {ep.ceilingFrames}f)</span>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void handleSyncDuration()}
                  className="px-1.5 py-0.2 rounded hover:bg-emerald-500/20 text-[9px] text-emerald-400 cursor-pointer"
                >
                  Re-sync
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] text-neutral-400 italic">
            Supplied via ElevenLabs into <code>Audio/</code>
          </p>
        )}
      </div>

      {/* 3. Asset Intake Inspector (Light/Dark Checkerboard Inspection) */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
            3. Asset Intake Inspector (Images/)
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[9.5px] text-neutral-400">Backdrop:</span>
            <div className="flex rounded border border-neutral-700 overflow-hidden text-[9px] font-mono">
              <button
                type="button"
                onClick={() => setCheckerTheme("dark")}
                className={`px-1.5 py-0.5 ${checkerTheme === "dark" ? "bg-neutral-700 text-white font-bold" : "bg-neutral-900 text-neutral-400"}`}
                title="Dark Checkerboard"
              >
                Dark
              </button>
              <button
                type="button"
                onClick={() => setCheckerTheme("light")}
                className={`px-1.5 py-0.5 ${checkerTheme === "light" ? "bg-neutral-300 text-neutral-950 font-bold" : "bg-neutral-900 text-neutral-400"}`}
                title="Light Checkerboard"
              >
                Light
              </button>
              <button
                type="button"
                onClick={() => setCheckerTheme("black")}
                className={`px-1.5 py-0.5 ${checkerTheme === "black" ? "bg-black text-white font-bold" : "bg-neutral-900 text-neutral-400"}`}
                title="Pure Black"
              >
                Black
              </button>
            </div>
          </div>
        </div>

        {/* Selected Asset Visual Cutout Preview */}
        {selectedAsset && (
          <div className="space-y-1.5 bg-neutral-950/80 p-2 rounded border border-neutral-800">
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-white font-semibold truncate max-w-[180px]">{selectedAsset.fileName}</span>
              <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-bold ${
                selectedAsset.hasAlpha
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : selectedAsset.category === "background"
                    ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                    : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              }`}>
                {selectedAsset.hasAlpha
                  ? "ALPHA TRANSPARENT"
                  : selectedAsset.category === "background"
                    ? "OPAQUE BACKGROUND"
                    : "OPAQUE WARNING"}
              </span>
            </div>

            <div
              className={`w-full h-32 rounded flex items-center justify-center overflow-hidden border border-neutral-800 relative ${
                checkerTheme === "dark"
                  ? "bg-[linear-gradient(45deg,#1f1f1f_25%,transparent_25%),linear-gradient(-45deg,#1f1f1f_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1f1f1f_75%),linear-gradient(-45deg,transparent_75%,#1f1f1f_75%)] bg-[size:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px] bg-neutral-950"
                  : checkerTheme === "light"
                    ? "bg-[linear-gradient(45deg,#e5e5e5_25%,transparent_25%),linear-gradient(-45deg,#e5e5e5_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e5e5e5_75%),linear-gradient(-45deg,transparent_75%,#e5e5e5_75%)] bg-[size:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px] bg-white"
                    : "bg-black"
              }`}
            >
              <img
                src={`/api/projects/${encodeURIComponent(projectId)}/asset-file/${encodeURIComponent(selectedAsset.fileName)}`}
                alt={selectedAsset.fileName}
                className="max-h-full max-w-full object-contain p-1"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
            </div>

            <div className="flex items-center justify-between text-[9.5px] font-mono text-neutral-400 pt-1">
              <span>{selectedAsset.width}×{selectedAsset.height} px</span>
              <span>{(selectedAsset.sizeBytes / 1024 / 1024).toFixed(2)} MB</span>
              <span className="capitalize">{selectedAsset.category}</span>
            </div>

            {selectedAsset.warning && (
              <div className="p-1 rounded bg-amber-500/10 border border-amber-500/30 text-[9px] text-amber-300 font-mono">
                ⚠ {selectedAsset.warning}
              </div>
            )}
          </div>
        )}

        {/* Thumbnail Selector Strip */}
        <div className="space-y-1">
          <div className="text-[9.5px] text-neutral-400 font-mono flex items-center justify-between">
            <span>Episode Assets ({data?.assets.totalImages || 0})</span>
            <span className="text-[9px] text-neutral-500">Click to inspect edges</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5 max-h-36 overflow-y-auto pr-1">
            {data?.assets.items.map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelectedAsset(item)}
                className={`p-1 rounded text-left border transition-all cursor-pointer ${
                  selectedAsset?.fileName === item.fileName
                    ? "bg-neutral-800 border-amber-400"
                    : "bg-neutral-950 border-neutral-800 hover:border-neutral-700"
                }`}
              >
                <div className="w-full h-10 bg-neutral-900 rounded overflow-hidden flex items-center justify-center relative">
                  <img
                    src={`/api/projects/${encodeURIComponent(projectId)}/asset-file/${encodeURIComponent(item.fileName)}`}
                    alt={item.fileName}
                    className="max-h-full max-w-full object-contain"
                  />
                  {!item.hasAlpha && item.category !== "background" && (
                    <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-amber-400" title="Opaque warning" />
                  )}
                </div>
                <div className="text-[8.5px] font-mono truncate text-neutral-300 mt-1">{item.fileName}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Revision Statuses (Distinguishing Implemented, Checked, Owner-Approved) */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
            4. Revision Lifecycle (QC/)
          </span>
          <span className="text-[10px] text-neutral-400 font-mono">
            {data?.revisions.recentRevisions.length || 0} Entries
          </span>
        </div>

        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {data?.revisions.recentRevisions.length ? (
            data.revisions.recentRevisions.map((rev, i) => {
              const statusColor =
                rev.status === "owner-approved"
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                  : rev.status === "checked"
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                    : rev.status === "implemented"
                      ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
                      : "bg-neutral-800 text-neutral-300 border-neutral-700";

              return (
                <div key={i} className="bg-neutral-950/80 p-2 rounded border border-neutral-800 text-[10.5px] space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-mono font-bold uppercase border ${statusColor}`}>
                      {rev.status}
                    </span>
                    {rev.timeSeconds !== undefined && (
                      <span className="text-[9.5px] font-mono text-neutral-400">
                        {rev.timeSeconds.toFixed(2)}s ({rev.frame}f)
                      </span>
                    )}
                  </div>
                  <div className="font-semibold text-neutral-200 truncate">{rev.title}</div>
                  {rev.scene && (
                    <div className="text-[9px] font-mono text-neutral-400 truncate">
                      Scene: <span className="text-neutral-300">{rev.scene}</span> {rev.target ? `· Target: ${rev.target}` : ""}
                    </div>
                  )}
                  {rev.note && <p className="text-neutral-300 text-[10px] italic">"{rev.note}"</p>}
                </div>
              );
            })
          ) : (
            <p className="text-[11px] text-neutral-400 italic">No revision notes recorded yet.</p>
          )}
        </div>
      </div>

      {/* 5. Review Render & Delivery Status */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
            5. Review Render (Previews/)
          </span>
          <span className={`px-1.5 py-0.2 rounded text-[9.5px] font-mono font-semibold ${
            data?.delivery.hasDraftRender
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              : "bg-neutral-800 text-neutral-400"
          }`}>
            {data?.delivery.hasDraftRender ? "Review Render Ready" : "No Render in Previews/"}
          </span>
        </div>
        {data?.delivery.draftRenderPath && (
          <div className="p-1.5 rounded bg-neutral-950 border border-neutral-800 font-mono text-[9.5px] text-neutral-300 truncate">
            {data.delivery.draftRenderPath}
          </div>
        )}
      </div>

      {/* Confirmation Modal for Endpoint Inspection */}
      {showEndpointModal && ep && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-neutral-900 border border-neutral-700 rounded-lg max-w-sm w-full p-4 space-y-3 font-sans text-xs">
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <span className="text-amber-400">⚡</span>
              <span>Audio Frame Endpoint Inspection</span>
            </div>
            <p className="text-neutral-300 text-[11px]">
              Calculates the exact integer frame boundary to guarantee decoded audio playback tail is not clipped:
            </p>
            <div className="space-y-1 bg-neutral-950 p-2.5 rounded border border-neutral-800 font-mono text-[10.5px]">
              <div>Decoded Audio: <strong className="text-amber-300">{ep.rawDurationSeconds}s</strong></div>
              <div>Project FPS: <strong className="text-white">{ep.fps} fps</strong></div>
              <div>Ceiling Frames: <strong className="text-emerald-300">{ep.ceilingFrames} frames</strong></div>
              <div>Frame-Aligned Time: <strong className="text-emerald-300">{ep.frameAlignedSeconds}s</strong></div>
              <div>Current Timeline: <strong className="text-neutral-400">{data?.audio.timelineDurationSeconds}s</strong></div>
              <div className="pt-1 border-t border-neutral-800 text-amber-200">
                Delta: {ep.deltaFrames} frames ({ep.deltaSeconds}s)
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowEndpointModal(false)}
                className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={() => void handleSyncDuration()}
                className="px-3 py-1 rounded bg-gradient-to-r from-amber-500 to-emerald-400 text-slate-950 hover:from-amber-400 hover:to-emerald-300 text-xs font-bold shadow-md cursor-pointer disabled:opacity-50"
              >
                {syncing ? "Applying..." : "⚡ Apply Frame-Aligned Duration to Sources"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
