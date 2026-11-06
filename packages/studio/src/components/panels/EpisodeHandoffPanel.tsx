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
    recentRevisions: Array<{
      date?: string;
      title?: string;
      rawSummary?: string;
    }>;
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
  const [approvalNote, setApprovalNote] = useState("");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [showAssetsTable, setShowAssetsTable] = useState(false);
  const [publishingPackageText, setPublishingPackageText] = useState<string | null>(null);
  const [copiedNotice, setCopiedNotice] = useState(false);

  const fetchHandoff = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await studioApiFetch(`/api/projects/${encodeURIComponent(projectId)}/handoff`);
      if (res && res.ok) {
        const json = (await res.json()) as { ok: boolean; handoff: EpisodeHandoffData };
        if (json.ok) {
          setData(json.handoff);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchHandoff();
  }, [fetchHandoff]);

  const handleApprove = async (type: "script" | "audio" | "revisions" | "master") => {
    if (!projectId) return;
    setActionStatus(`Recording ${type} sign-off...`);
    try {
      const res = await studioApiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/handoff/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, note: approvalNote || `Approved ${type} stage.` }),
        },
      );
      if (res && res.ok) {
        setActionStatus(`✓ ${type.toUpperCase()} approved & recorded in QC notes.`);
        setApprovalNote("");
        fetchHandoff();
      } else {
        setActionStatus(`Failed to record approval.`);
      }
    } catch (e) {
      setActionStatus(`Error: ${String(e)}`);
    }
    setTimeout(() => setActionStatus(null), 4000);
  };

  const handleSyncDuration = async () => {
    if (!projectId) return;
    setActionStatus("Syncing timeline duration to narration audio...");
    try {
      const res = await studioApiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/handoff/sync-duration`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (res && res.ok) {
        const json = (await res.json()) as { durationSynced: number };
        setActionStatus(`✓ Master timeline locked to ${json.durationSynced}s!`);
        fetchHandoff();
      } else {
        setActionStatus("Failed to sync duration.");
      }
    } catch (e) {
      setActionStatus(`Error: ${String(e)}`);
    }
    setTimeout(() => setActionStatus(null), 4000);
  };

  const handleGeneratePublishingPackage = async () => {
    if (!projectId) return;
    setActionStatus("Generating YouTube Publishing Package...");
    try {
      const res = await studioApiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/handoff/publish-package`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (res && res.ok) {
        const json = (await res.json()) as { package: string; filePath: string };
        setPublishingPackageText(json.package);
        setActionStatus("✓ Publishing Package created in Brief/!");
        fetchHandoff();
      } else {
        setActionStatus("Failed to generate publishing package.");
      }
    } catch (e) {
      setActionStatus(`Error: ${String(e)}`);
    }
    setTimeout(() => setActionStatus(null), 4000);
  };

  const handleDeliverMaster = async () => {
    if (!projectId) return;
    setActionStatus("Packaging Master Deliverable to exports/...");
    try {
      const res = await studioApiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/handoff/deliver-master`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (res && res.ok) {
        const json = (await res.json()) as { masterPath: string; sizeMb: string };
        setActionStatus(`★ Master delivered to exports/ (${json.sizeMb} MB)!`);
        fetchHandoff();
      } else {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setActionStatus(`Export Error: ${json.error || "No render found"}`);
      }
    } catch (e) {
      setActionStatus(`Error: ${String(e)}`);
    }
    setTimeout(() => setActionStatus(null), 5000);
  };

  const handleCopyPackage = () => {
    if (!publishingPackageText) return;
    navigator.clipboard.writeText(publishingPackageText);
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 3000);
  };

  if (!projectId) {
    return (
      <div className="p-4 text-xs text-neutral-400">
        No active episode loaded. Open a project to inspect handoff state.
      </div>
    );
  }

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
          className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-[10px] text-neutral-300 transition-colors"
        >
          {loading ? "Checking..." : "↻ Refresh"}
        </button>
      </div>

      {actionStatus && (
        <div className="p-2 rounded bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs font-medium animate-fadeIn">
          {actionStatus}
        </div>
      )}

      {/* 1. Research & Script Health */}
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

      {/* 2. Narration Audio Health & Duration Sync */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
            2. Audio Narration (Audio/)
          </span>
          <span
            className={`px-1.5 py-0.2 rounded text-[9.5px] font-mono font-semibold ${
              data?.audio.exists
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
            }`}
          >
            {data?.audio.exists ? "Supplied" : "Missing Recording"}
          </span>
        </div>
        {data?.audio.exists ? (
          <div className="text-xs space-y-1.5">
            <div className="text-neutral-200 truncate font-mono text-[11px]">{data.audio.fileName}</div>
            <div className="text-[10.5px] text-neutral-400 font-mono grid grid-cols-2 gap-1 bg-neutral-950/80 p-1.5 rounded border border-neutral-800">
              <div>Audio Duration: <span className="text-amber-300 font-bold">{data.audio.durationSeconds?.toFixed(2)}s</span></div>
              <div>Timeline Duration: <span className="text-neutral-200">{data.audio.timelineDurationSeconds?.toFixed(2)}s</span></div>
              <div>Sample Rate: <span className="text-neutral-300">{data.audio.sampleRate} Hz</span></div>
              <div>Channels: <span className="text-neutral-300">{data.audio.channels === 1 ? "Mono" : "Stereo"}</span></div>
            </div>

            {data.audio.isDurationInSync === false && (
              <div className="flex items-center justify-between p-1.5 rounded bg-amber-500/10 border border-amber-500/30">
                <span className="text-[10.5px] text-amber-300">
                  Timeline differs by {data.audio.durationDiffSeconds?.toFixed(2)}s
                </span>
                <button
                  type="button"
                  onClick={() => void handleSyncDuration()}
                  className="px-2 py-0.5 rounded bg-amber-500/30 hover:bg-amber-500/40 border border-amber-500/50 text-[10px] font-bold text-amber-200 transition-colors cursor-pointer"
                >
                  ⚡ Sync Duration
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-neutral-400 italic">
            Supplied via ElevenLabs into <code>Audio/</code>
          </p>
        )}
      </div>

      {/* 3. Audio Timing Map & Alignment */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
            3. Timing Map & Cues (Timing/)
          </span>
          <span
            className={`px-1.5 py-0.2 rounded text-[9.5px] font-mono font-semibold ${
              data?.timing.exists
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
            }`}
          >
            {data?.timing.exists ? "Aligned" : "Pending"}
          </span>
        </div>
        {data?.timing.exists ? (
          <div className="text-xs space-y-1 font-mono">
            <div className="text-[11px] text-neutral-300">
              Provenance: <span className="text-amber-300">{data.timing.provenance}</span>
            </div>
            <div className="text-[11px] text-neutral-400 flex items-center gap-3">
              <span>Target: {data.timing.targetFrames}f @ {data.timing.fps}fps</span>
              <span>Visual Cues: {data.timing.cueCount}</span>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-neutral-400 italic">
            Run audio transcription into <code>Timing/{projectId}_Timing_Map.json</code>
          </p>
        )}
      </div>

      {/* 4. Production Visuals & Preflight Validator */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
            4. Visual Coverage & Preflight (Images/)
          </span>
          <div className="flex items-center gap-2">
            {data?.assets.preflightIssues ? (
              <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9.5px] font-mono font-bold">
                ⚠ {data.assets.preflightIssues} Issues
              </span>
            ) : (
              <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9.5px] font-mono font-bold">
                ✓ Preflight Clean
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowAssetsTable((prev) => !prev)}
              className="text-[10px] text-neutral-400 hover:text-white underline cursor-pointer"
            >
              {showAssetsTable ? "Hide Checklist" : "Inspect All"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5 text-center text-xs font-mono">
          <div className="bg-neutral-950/70 p-1.5 rounded border border-neutral-800">
            <div className="text-white font-bold text-sm">{data?.assets.characters || 0}</div>
            <div className="text-[9px] text-neutral-400">Characters</div>
          </div>
          <div className="bg-neutral-950/70 p-1.5 rounded border border-neutral-800">
            <div className="text-white font-bold text-sm">{data?.assets.backgrounds || 0}</div>
            <div className="text-[9px] text-neutral-400">Backdrops</div>
          </div>
          <div className="bg-neutral-950/70 p-1.5 rounded border border-neutral-800">
            <div className="text-white font-bold text-sm">{data?.assets.props || 0}</div>
            <div className="text-[9px] text-neutral-400">Props</div>
          </div>
          <div className="bg-neutral-950/70 p-1.5 rounded border border-neutral-800">
            <div className="text-white font-bold text-sm">{data?.assets.totalImages || 0}</div>
            <div className="text-[9px] text-neutral-400">Total</div>
          </div>
        </div>

        {/* Expandable Asset Preflight Checklist */}
        {showAssetsTable && (
          <div className="mt-2 max-h-48 overflow-y-auto border border-neutral-800 rounded bg-neutral-950/90 p-1.5 space-y-1">
            {data?.assets.items.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-1 text-[10px] font-mono p-1 rounded hover:bg-neutral-900 border border-transparent hover:border-neutral-800"
              >
                <div className="truncate flex items-center gap-1.5 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      item.status === "ok" ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                  />
                  <span className="truncate text-neutral-200">{item.fileName}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-neutral-400">
                  <span>{item.width}×{item.height}</span>
                  <span
                    className={`px-1 py-0.2 rounded text-[8.5px] font-bold ${
                      item.hasAlpha
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-neutral-800 text-neutral-400"
                    }`}
                  >
                    {item.hasAlpha ? "ALPHA" : "OPAQUE"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. Publishing Package (YouTube Description & Chapters) */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
            5. Publishing Package (Brief/)
          </span>
          <button
            type="button"
            onClick={() => void handleGeneratePublishingPackage()}
            className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold cursor-pointer transition-colors"
          >
            {data?.delivery.hasPublishingPackage ? "↻ Re-generate" : "＋ Generate Package"}
          </button>
        </div>

        {publishingPackageText ? (
          <div className="space-y-1.5">
            <textarea
              readOnly
              value={publishingPackageText}
              rows={5}
              className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-[10px] font-mono text-neutral-300 resize-none outline-hidden"
            />
            <button
              type="button"
              onClick={handleCopyPackage}
              className="w-full py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-white text-[10.5px] font-semibold transition-colors cursor-pointer"
            >
              {copiedNotice ? "✓ Copied to Clipboard!" : "📋 Copy YouTube Description & Chapters"}
            </button>
          </div>
        ) : (
          <p className="text-[10.5px] text-neutral-400 italic">
            Generates YouTube video title, clickable chapter timestamps, tags, and pinned comment from script and timeline.
          </p>
        )}
      </div>

      {/* 6. Master Delivery & Export Actions */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/90 p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold text-white uppercase tracking-wide">
            6. Master Delivery (exports/)
          </div>
          {data?.delivery.hasFinalMaster ? (
            <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9.5px] font-mono font-bold">
              ★ Master Delivered
            </span>
          ) : (
            <span className="px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-400 text-[9.5px] font-mono">
              Pending Authorization
            </span>
          )}
        </div>

        {data?.delivery.finalMasterPath && (
          <div className="p-1.5 rounded bg-neutral-950 border border-neutral-800 font-mono text-[10px] text-emerald-400 truncate">
            {data.delivery.finalMasterPath}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleDeliverMaster()}
            className="flex-1 py-1.5 bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-200 border border-emerald-500/50 text-[11px] font-bold rounded transition-colors cursor-pointer text-center"
          >
            ★ Deliver Master to exports/
          </button>
        </div>

        <input
          type="text"
          value={approvalNote}
          onChange={(e) => setApprovalNote(e.target.value)}
          placeholder="Owner approval note (e.g. 'Script approved for voice recording')..."
          className="w-full bg-neutral-950 border border-neutral-700 rounded px-2.5 py-1.5 text-xs text-white outline-hidden focus:border-amber-400"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleApprove("script")}
            className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[10px] font-semibold rounded transition-colors cursor-pointer"
          >
            ✓ Approve Script
          </button>
          <button
            type="button"
            onClick={() => void handleApprove("audio")}
            className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[10px] font-semibold rounded transition-colors cursor-pointer"
          >
            ✓ Approve VO
          </button>
          <button
            type="button"
            onClick={() => void handleApprove("revisions")}
            className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[10px] font-semibold rounded transition-colors cursor-pointer"
          >
            ✓ Approve Revisions
          </button>
        </div>
      </div>
    </div>
  );
});
