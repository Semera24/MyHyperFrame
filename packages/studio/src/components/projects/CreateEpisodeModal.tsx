import { useState } from "react";
import { studioApiFetch } from "../../utils/studioApiFetch";

interface CreateEpisodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (episodeId: string) => void;
}

export function CreateEpisodeModal({
  isOpen,
  onClose,
  onCreated,
}: CreateEpisodeModalProps) {
  const [episodeId, setEpisodeId] = useState("EP06_");
  const [title, setTitle] = useState("");
  const [centralQuestion, setCentralQuestion] = useState(
    "Which moment turned crisis into a turning point in world power?",
  );
  const [channel, setChannel] = useState("Turning_Point_Stories");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCreate = async () => {
    const cleanId = episodeId.trim();
    if (!cleanId || cleanId === "EP06_") {
      setErrorMsg("Please provide a valid Episode ID (e.g. EP06_Fall_Of_Rome)");
      return;
    }
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await studioApiFetch("/api/projects/create-episode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          episodeId: cleanId,
          title: title.trim() || cleanId.replace(/_/g, " "),
          centralQuestion: centralQuestion.trim(),
        }),
      });

      if (res && res.ok) {
        const data = (await res.json()) as { ok?: boolean; episodeId?: string; error?: string };
        if (data.ok && data.episodeId) {
          onCreated?.(data.episodeId);
          onClose();
          // Redirect immediately to the newly scaffolded authoritative episode
          window.location.assign(`/?project=${encodeURIComponent(data.episodeId)}`);
        } else {
          setErrorMsg(data.error || "Failed to scaffold episode");
        }
      } else {
        const err = await res?.text().catch(() => "Server error");
        setErrorMsg(err || "Failed to create episode folder");
      }
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[350] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="w-[520px] max-w-[95vw] rounded-xl border border-neutral-700 bg-neutral-950 p-5 text-neutral-100 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎬</span>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">
                Create New Episode from Channel Template
              </h2>
              <p className="text-[11px] text-neutral-400">
                Scaffolds valid Sources/index.html, Audio/, Brief/, Timing/, and QC/
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white font-mono text-sm px-2 py-0.5 rounded hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>

        {/* Form fields */}
        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-neutral-300 mb-1">
              Channel
            </label>
            <input
              type="text"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1.5 text-neutral-200 outline-hidden font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-neutral-300 mb-1">
              Episode ID (Folder Slug)
            </label>
            <input
              type="text"
              autoFocus
              value={episodeId}
              onChange={(e) => setEpisodeId(e.target.value)}
              placeholder="e.g. EP06_Bretton_Woods_Conference"
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2.5 py-1.5 text-white font-mono focus:border-amber-400 outline-hidden"
            />
            <span className="text-[10px] text-neutral-500 mt-0.5 block">
              Will be created at <code className="text-amber-400 font-mono">ProductionStudio/channels/{channel}/episodes/{episodeId}</code>
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-neutral-300 mb-1">
              Episode Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The Bretton Woods Dollar Shock"
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2.5 py-1.5 text-white focus:border-amber-400 outline-hidden"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-neutral-300 mb-1">
              The Central Question (Hook)
            </label>
            <textarea
              rows={2}
              value={centralQuestion}
              onChange={(e) => setCentralQuestion(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2.5 py-1.5 text-white focus:border-amber-400 outline-hidden"
            />
          </div>

          {errorMsg && (
            <div className="p-2 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px]">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-neutral-800 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 rounded font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || !episodeId.trim()}
            onClick={() => void handleCreate()}
            className="px-4 py-1.5 text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-400 text-slate-950 hover:from-emerald-400 hover:to-teal-300 rounded shadow-md disabled:opacity-50 transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span>{loading ? "Scaffolding..." : "＋ Scaffold Episode & Open"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
