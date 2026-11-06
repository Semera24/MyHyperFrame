import { useState, useEffect } from "react";
import { studioApiFetch } from "../../utils/studioApiFetch";

export interface MasterTemplateMetadata {
  id: string;
  name: string;
  archetype: string;
  description: string;
  bestFor: string;
  templateFile: string;
  defaultParams: Record<string, string>;
}

interface TemplatesModalProps {
  projectId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSceneCreated?: (sceneFile: string) => void;
}

export function TemplatesModal({
  projectId,
  isOpen,
  onClose,
  onSceneCreated,
}: TemplatesModalProps) {
  const [templates, setTemplates] = useState<MasterTemplateMetadata[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("hero-split");
  const [sceneId, setSceneId] = useState<string>("s09");
  const [params, setParams] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStatusMsg(null);
    void studioApiFetch("/api/templates")
      .then((res) => (res && res.ok ? res.json() : null))
      .then((data: { ok?: boolean; templates?: MasterTemplateMetadata[] } | null) => {
        if (data?.ok && Array.isArray(data.templates)) {
          setTemplates(data.templates);
          if (data.templates.length > 0) {
            const first = data.templates[0]!;
            setSelectedTemplateId(first.id);
            setParams(first.defaultParams);
          }
        }
      })
      .catch(() => {});
  }, [isOpen]);

  const activeTemplate = templates.find((t) => t.id === selectedTemplateId) || templates[0];

  const handleSelectTemplate = (t: MasterTemplateMetadata) => {
    setSelectedTemplateId(t.id);
    setParams(t.defaultParams);
    setStatusMsg(null);
  };

  const handleParamChange = (key: string, val: string) => {
    setParams((prev) => ({ ...prev, [key]: val }));
  };

  const handleInstantiate = async () => {
    if (!sceneId.trim()) return;
    setLoading(true);
    setStatusMsg(null);

    try {
      const res = await studioApiFetch("/api/templates/instantiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          templateId: selectedTemplateId,
          sceneId: sceneId.trim(),
          params,
        }),
      });

      if (res && res.ok) {
        const data = (await res.json()) as {
          ok?: boolean;
          scenePath?: string;
          templateUsed?: string;
        };
        if (data.ok) {
          setStatusMsg(`✓ Instantiated ${data.scenePath}!`);
          setTimeout(() => {
            onSceneCreated?.(data.scenePath || `compositions/${sceneId}.html`);
            onClose();
          }, 800);
        } else {
          setStatusMsg("Error instantiating template");
        }
      } else {
        setStatusMsg("Failed to write template scene");
      }
    } catch (err) {
      setStatusMsg(`Error: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="flex flex-col w-[860px] max-w-[95vw] max-h-[90vh] rounded-xl border border-neutral-700 bg-neutral-950 text-neutral-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3.5 bg-neutral-900/60">
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">
                Master Documentary Scene Templates (Archetypes 1–3)
              </h2>
              <p className="text-[11px] text-neutral-400">
                1-Click clone & asset bind: never code HTML/CSS or GSAP from scratch again
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white font-mono text-base px-2 py-0.5 rounded hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>

        {/* Body: Left = Template Picker, Right = Parameter Customizer */}
        <div className="flex flex-1 min-h-0 divide-x divide-neutral-800 overflow-hidden">
          {/* Left Column: 3 Master Archetypes */}
          <div className="w-[340px] shrink-0 p-4 space-y-3 overflow-y-auto bg-neutral-950/50">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Select Scene Archetype
            </div>

            {templates.map((tpl) => {
              const isSelected = tpl.id === selectedTemplateId;
              return (
                <div
                  key={tpl.id}
                  onClick={() => handleSelectTemplate(tpl)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    isSelected
                      ? "border-amber-500/80 bg-amber-500/10 shadow-md ring-1 ring-amber-500/30"
                      : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-700 hover:bg-neutral-900/70"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-white">{tpl.name}</span>
                    {isSelected && (
                      <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-mono font-semibold">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[10.5px] font-medium text-amber-300/90">
                    {tpl.archetype}
                  </div>
                  <p className="mt-1.5 text-[10.5px] text-neutral-300 leading-relaxed">
                    {tpl.description}
                  </p>
                  <div className="mt-2 text-[10px] text-neutral-400 font-mono italic">
                    Best for: {tpl.bestFor}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right Column: Customizer & Asset Binder */}
          <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-neutral-950">
            {activeTemplate && (
              <>
                <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
                  <div>
                    <h3 className="font-bold text-sm text-amber-300">
                      Configure & Bind Assets: {activeTemplate.name}
                    </h3>
                    <p className="text-[11px] text-neutral-400">
                      Timings and GSAP animations are pre-wired. Fill in your episode's assets
                      below.
                    </p>
                  </div>
                </div>

                {/* Target Scene & Duration */}
                <div className="grid grid-cols-2 gap-3 bg-neutral-900/60 p-3 rounded-lg border border-neutral-800">
                  <div>
                    <label className="block text-[10.5px] font-semibold text-neutral-300 mb-1">
                      Scene File ID
                    </label>
                    <input
                      type="text"
                      value={sceneId}
                      onChange={(e) => setSceneId(e.target.value)}
                      placeholder="e.g. s09 or s10"
                      className="w-full bg-neutral-950 border border-neutral-700 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-400 outline-hidden"
                    />
                    <span className="text-[9.5px] text-neutral-400 mt-0.5 block">
                      Will create{" "}
                      <code className="text-amber-300 font-mono">
                        compositions/{sceneId || "sXX"}.html
                      </code>
                    </span>
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-semibold text-neutral-300 mb-1">
                      Audio Duration (Seconds)
                    </label>
                    <input
                      type="text"
                      value={params["DURATION_SECONDS"] || "24.0"}
                      onChange={(e) => handleParamChange("DURATION_SECONDS", e.target.value)}
                      placeholder="e.g. 24.5"
                      className="w-full bg-neutral-950 border border-neutral-700 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-400 outline-hidden"
                    />
                    <span className="text-[9.5px] text-neutral-400 mt-0.5 block">
                      Matches narration duration from Timing_Map.json
                    </span>
                  </div>
                </div>

                {/* Editable Parameters */}
                <div className="space-y-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    Template Asset & Content Placeholders
                  </div>

                  {Object.entries(params)
                    .filter(([k]) => k !== "DURATION_SECONDS")
                    .map(([key, val]) => (
                      <div key={key} className="space-y-1">
                        <label className="block text-[10.5px] font-mono text-neutral-300">
                          {key}
                        </label>
                        <input
                          type="text"
                          value={val}
                          onChange={(e) => handleParamChange(key, e.target.value)}
                          className="w-full bg-neutral-900 border border-neutral-700/80 rounded px-2.5 py-1.5 text-xs text-white focus:border-amber-400 outline-hidden"
                        />
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-800 px-5 py-3 bg-neutral-900/80">
          <div>
            {statusMsg && (
              <span className="text-xs font-semibold text-emerald-300 font-mono">{statusMsg}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 rounded font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loading || !sceneId.trim()}
              onClick={() => void handleInstantiate()}
              className="px-4 py-1.5 text-xs font-bold bg-gradient-to-r from-amber-500 to-amber-400 text-slate-950 hover:from-amber-400 hover:to-amber-300 rounded shadow-md disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>{loading ? "Generating..." : "▶ 1-Click Instantiate Scene"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
