import { memo, useState, useEffect, useCallback } from "react";
import { studioApiFetch } from "../../utils/studioApiFetch";

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
  };
  audio: {
    fileName?: string;
    exists: boolean;
    sizeBytes?: number;
    durationSeconds?: number;
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
  };
  revisions: {
    revisionNotesFile?: string;
    recentRevisions: Array<{
      title?: string;
      rawSummary?: string;
    }>;
  };
  delivery: {
    hasDraftRender: boolean;
    draftRenderPath?: string;
    hasFinalMaster: boolean;
    finalMasterPath?: string;
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

  const fetchHandoff = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await studioApiFetch(`/api/projects/${encodeURIComponent(projectId)}/handoff`);
      if (res && res.ok) {
        const json = (await res.json()) as { ok?: boolean; handoff?: EpisodeHandoffData };
        if (json.ok && json.handoff) {
          setData(json.handoff);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchHandoff();
  }, [fetchHandoff]);

  const handleApprove = async (type: "script" | "audio" | "revisions" | "master") => {
    if (!projectId) return;
    try {
      const res = await studioApiFetch(`/api/projects/${encodeURIComponent(projectId)}/handoff/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, note: approvalNote }),
      });
      if (res && res.ok) {
        setActionStatus(`✓ Recorded ${type} approval in Revision Notes!`);
        setApprovalNote("");
        setTimeout(() => setActionStatus(null), 3000);
        void fetchHandoff();
      }
    } catch {
      setActionStatus("Failed to record approval");
    }
  };

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-neutral-400">
        No active episode selected.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-neutral-950 p-4 text-neutral-100 space-y-4">
      {/* Top Header */}
      <div className="border-b border-neutral-800 pb-3 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <h2 className="text-sm font-bold text-white tracking-wide">
              Episode Handoff & Production State
            </h2>
          </div>
          <p className="text-[10.5px] font-mono text-neutral-400 mt-0.5">
            {data?.channel} · <span className="text-amber-300 font-semibold">{projectId}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchHandoff()}
          className="text-[10px] text-accent hover:underline flex items-center gap-1 font-mono"
        >
          {loading ? "Refreshing..." : "↻ Sync Handoff"}
        </button>
      </div>

      {actionStatus && (
        <div className="rounded bg-emerald-500/20 border border-emerald-500/40 p-2 text-[11px] font-semibold text-emerald-300 font-mono">
          {actionStatus}
        </div>
      )}

      {/* 1. Script & Research Health */}
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
            <div className="text-[11px] text-neutral-400">
              Word count: <span className="text-neutral-200 font-mono">{data.script.wordCount} words</span>
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

      {/* 2. Lawrence Narration Audio Health */}
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
          <div className="text-xs space-y-1 font-mono">
            <div className="text-neutral-200 truncate">{data.audio.fileName}</div>
            <div className="text-[11px] text-neutral-400 flex items-center gap-3">
              <span>Size: {((data.audio.sizeBytes || 0) / 1024 / 1024).toFixed(2)} MB</span>
              {data.audio.durationSeconds && (
                <span>Duration: {data.audio.durationSeconds.toFixed(1)}s</span>
              )}
            </div>
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
          <div className="text-xs space-y-1">
            <div className="text-[11px] text-neutral-300 font-mono">
              Provenance: <span className="text-amber-300">{data.timing.provenance}</span>
            </div>
            <div className="text-[11px] text-neutral-400 font-mono flex items-center gap-3">
              <span>Target Frames: {data.timing.targetFrames}f @ {data.timing.fps}fps</span>
              <span>Visual Cues: {data.timing.cueCount}</span>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-neutral-400 italic">
            Run audio transcription into <code>Timing/{projectId}_Timing_Map.json</code>
          </p>
        )}
      </div>

      {/* 4. Production Artwork Manifest */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
            4. Production Visuals (Images/)
          </span>
          <span className="text-[10px] text-neutral-400 font-mono">
            {data?.assets.totalImages || 0} Total Assets
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
          <div className="bg-neutral-950/70 p-2 rounded border border-neutral-800">
            <div className="text-white font-bold text-sm">{data?.assets.characters || 0}</div>
            <div className="text-[9.5px] text-neutral-400">Characters</div>
          </div>
          <div className="bg-neutral-950/70 p-2 rounded border border-neutral-800">
            <div className="text-white font-bold text-sm">{data?.assets.backgrounds || 0}</div>
            <div className="text-[9.5px] text-neutral-400">Backdrops</div>
          </div>
          <div className="bg-neutral-950/70 p-2 rounded border border-neutral-800">
            <div className="text-white font-bold text-sm">{data?.assets.maps || 0}</div>
            <div className="text-[9.5px] text-neutral-400">Maps & Routes</div>
          </div>
        </div>
      </div>

      {/* 5. Recent Owner Revisions & QC Notes */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
            5. Revision Notes & Approvals (QC/)
          </span>
          <span className="text-[10px] text-neutral-400 font-mono">
            {data?.revisions.recentRevisions.length || 0} Recent Notes
          </span>
        </div>
        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
          {data?.revisions.recentRevisions.length ? (
            data.revisions.recentRevisions.map((rev, i) => (
              <div key={i} className="bg-neutral-950/80 p-2 rounded border border-neutral-800 text-[10.5px]">
                <div className="font-semibold text-emerald-300 truncate">{rev.title}</div>
                <p className="text-neutral-300 line-clamp-2 mt-0.5">{rev.rawSummary}</p>
              </div>
            ))
          ) : (
            <p className="text-[11px] text-neutral-400 italic">No revision notes recorded yet.</p>
          )}
        </div>
      </div>

      {/* 6. Owner Approval Actions */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/90 p-3 space-y-2.5">
        <div className="text-[11px] font-bold text-white uppercase tracking-wide">
          Owner Decision & Sign-off Actions
        </div>
        <input
          type="text"
          value={approvalNote}
          onChange={(e) => setApprovalNote(e.target.value)}
          placeholder="Optional sign-off note (e.g. 'Script approved for ElevenLabs recording')..."
          className="w-full bg-neutral-950 border border-neutral-700 rounded px-2.5 py-1.5 text-xs text-white outline-hidden focus:border-amber-400"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleApprove("script")}
            className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[10.5px] font-semibold rounded transition-colors"
          >
            ✓ Approve Script
          </button>
          <button
            type="button"
            onClick={() => void handleApprove("audio")}
            className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[10.5px] font-semibold rounded transition-colors"
          >
            ✓ Approve Voiceover
          </button>
          <button
            type="button"
            onClick={() => void handleApprove("revisions")}
            className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[10.5px] font-semibold rounded transition-colors"
          >
            ✓ Approve Revisions
          </button>
          <button
            type="button"
            onClick={() => void handleApprove("master")}
            className="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[10.5px] font-bold rounded transition-colors"
          >
            ★ Authorize Master Export
          </button>
        </div>
      </div>
    </div>
  );
});
