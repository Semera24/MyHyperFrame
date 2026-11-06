import { memo, useCallback, useState, useEffect, useRef } from "react";
import {
  useAgentAssistantStore,
  type AssistantEngineId,
  type StudioSkillItem,
  type AgentCliStatus,
  type AgentModelInfo,
  targetAgentToEngine,
} from "../panels/AgentAssistantPanel";
import { studioApiFetch } from "../../utils/studioApiFetch";
import { liveTime, usePlayerStore } from "../../player";
import { resolveActiveSceneTargetAtPlayhead } from "../../utils/studioLayerActions";

export const DesktopFrameyChatCard = memo(function DesktopFrameyChatCard({
  projectId,
  activeCompPath,
  selectedElementId,
  onClose,
}: {
  projectId: string | null;
  activeCompPath: string | null;
  selectedElementId?: string | null;
  onClose?: () => void;
}) {
  const {
    engine,
    model,
    effort,
    prompt,
    selectedSkills,
    isRunning,
    currentStepText,
    progressPercent,
    terminalLogs,
    lastRunStatus,
    setEngine,
    setModel,
    setEffort,
    setPrompt,
    toggleSkill,
    runAgent,
    cancelRun,
  } = useAgentAssistantStore();

  const [agents, setAgents] = useState<AgentCliStatus[]>([]);
  const [models, setModels] = useState<AgentModelInfo[]>([]);
  const [allSkills, setAllSkills] = useState<StudioSkillItem[]>([]);
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (showLogs && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [showLogs, terminalLogs]);

  // Load agents & skills
  useEffect(() => {
    try {
      studioApiFetch("/api/agents")
        .then((res) => (res && res.ok ? res.json() : null))
        .then((data: { agents?: AgentCliStatus[] } | null) => {
          if (data && Array.isArray(data.agents)) setAgents(data.agents);
        })
        .catch(() => {});

      studioApiFetch("/api/agent/skills")
        .then((res) => (res && res.ok ? res.json() : null))
        .then((data: { skills?: StudioSkillItem[] } | null) => {
          if (data && Array.isArray(data.skills)) setAllSkills(data.skills);
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
  }, []);

  // Fetch models for engine
  useEffect(() => {
    try {
      studioApiFetch(`/api/agents/${engine}/models`)
        .then((res) => (res && res.ok ? res.json() : null))
        .then((data: { models?: AgentModelInfo[]; defaultModel?: string } | null) => {
          if (!data || !Array.isArray(data.models)) return;
          setModels(data.models);
          const currentValid = data.models.some((m) => m.id === model);
          if (!currentValid) {
            const defModel =
              data.models.find((m) => m.isDefault)?.id ||
              data.defaultModel ||
              data.models[0]?.id ||
              "";
            if (defModel) setModel(defModel);
          }
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
  }, [engine, model, setModel]);

  const activeAgentInfo = agents.find((a) => a.id === engine);
  const activeModelInfo = models.find((m) => m.id === model) || models[0];
  const effortOptions = activeModelInfo?.effortOptions || ["low", "medium", "high", "max"];

  const handleSend = useCallback(async () => {
    if (!prompt.trim() || isRunning || !projectId) return;

    const playhead = liveTime.get() || usePlayerStore.getState().currentTime || 0;
    const activeScene = resolveActiveSceneTargetAtPlayhead(activeCompPath);
    const sceneFile = activeScene.targetFile || activeCompPath || "index.html";
    const elementId = selectedElementId || "scene";

    await runAgent({
      projectId,
      engine,
      model,
      effort,
      prompt: prompt.trim(),
      sceneFile,
      elementId,
      timestampSeconds: playhead,
      skills: selectedSkills,
    });
  }, [
    prompt,
    isRunning,
    projectId,
    activeCompPath,
    selectedElementId,
    runAgent,
    engine,
    model,
    effort,
    selectedSkills,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div
      data-testid="desktop-framey-chat-card"
      className="pointer-events-auto flex flex-col rounded-2xl border border-neutral-700/80 bg-neutral-950/95 shadow-2xl backdrop-blur-xl text-neutral-100 overflow-hidden w-[420px] max-w-full"
    >
      {/* Top Header Bar: Codex ▾ | 10% | GPT-5.6-Luna ▾ | Medium ▾ | Skills ▾ */}
      <div className="flex items-center justify-between gap-1.5 px-3 py-2 border-b border-neutral-800 bg-neutral-900/60 text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          {/* Engine Selector */}
          <div className="relative flex items-center gap-1">
            <span
              className={`h-2 w-2 rounded-full ${
                activeAgentInfo?.installed ? "bg-emerald-400" : "bg-neutral-500"
              }`}
            />
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value as AssistantEngineId)}
              className="bg-transparent font-semibold text-white outline-none cursor-pointer pr-1"
            >
              <option value="codex" className="bg-neutral-900">
                Codex
              </option>
              <option value="claude" className="bg-neutral-900">
                Claude Code
              </option>
              <option value="agy" className="bg-neutral-900">
                Antigravity
              </option>
              <option value="grok" className="bg-neutral-900">
                Grok
              </option>
              <option value="opencode" className="bg-neutral-900">
                OpenCode
              </option>
            </select>
          </div>

          <span className="text-neutral-500">|</span>

          {/* Context Tokens Indicator */}
          <span className="text-[10px] font-mono text-neutral-400">10%</span>

          <span className="text-neutral-500">|</span>

          {/* Model Selector */}
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="bg-transparent font-medium text-neutral-200 outline-none cursor-pointer max-w-[110px] truncate"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id} className="bg-neutral-900">
                {m.name}
              </option>
            ))}
          </select>

          <span className="text-neutral-500">|</span>

          {/* Effort Selector */}
          <select
            value={effort}
            onChange={(e) => setEffort(e.target.value)}
            className="bg-transparent text-[10px] uppercase font-medium text-neutral-300 outline-none cursor-pointer"
          >
            {effortOptions.map((ef) => (
              <option key={ef} value={ef} className="bg-neutral-900">
                {ef}
              </option>
            ))}
          </select>

          <span className="text-neutral-500">|</span>

          {/* Skills Button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSkillsMenuOpen((p) => !p)}
              className="flex items-center gap-1 text-[10.5px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              <span>||| Skills</span>
              <span className="rounded-full bg-emerald-500/20 px-1 text-[9px] font-mono text-emerald-300">
                {selectedSkills.length}
              </span>
            </button>

            {skillsMenuOpen && (
              <div className="absolute top-full left-0 mt-2 w-64 max-h-56 overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-2 shadow-2xl z-50">
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-neutral-800 text-[10px] text-neutral-400">
                  <span className="font-semibold text-white">Active Skills</span>
                  <button
                    type="button"
                    onClick={() => setSkillsMenuOpen(false)}
                    className="hover:text-white"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  {allSkills.map((sk) => {
                    const isSelected = selectedSkills.includes(sk.id);
                    return (
                      <button
                        key={sk.id}
                        type="button"
                        onClick={() => toggleSkill(sk.id)}
                        className={`flex items-center justify-between px-2 py-1 rounded text-[10px] text-left transition-colors ${
                          isSelected
                            ? "bg-emerald-500/20 text-emerald-300 font-medium"
                            : "text-neutral-300 hover:bg-neutral-900"
                        }`}
                      >
                        <span className="truncate">{sk.name}</span>
                        <span>{isSelected ? "✓" : "+"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white text-xs px-1"
          >
            ✕
          </button>
        )}
      </div>

      {/* Main Chat Input Body */}
      <div className="p-3 flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Text to Framey. Type @ for files, # for tools"
          className="w-full bg-transparent text-[12px] leading-relaxed text-white placeholder-neutral-500 resize-none outline-none font-sans"
        />

        {/* Quick action suggestion chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <button
            type="button"
            onClick={() =>
              setPrompt("Change the color of the selected text/element to gold (#C49A44)")
            }
            className="px-2 py-0.5 rounded-full border border-neutral-800 bg-neutral-900/80 text-[10px] text-neutral-300 hover:border-amber-400 hover:text-amber-300 transition-colors"
          >
            ⚡ Change color to gold
          </button>
          <button
            type="button"
            onClick={() =>
              setPrompt("Move the title card 40px left and increase font-weight to 900")
            }
            className="px-2 py-0.5 rounded-full border border-neutral-800 bg-neutral-900/80 text-[10px] text-neutral-300 hover:border-emerald-400 hover:text-emerald-300 transition-colors"
          >
            📐 Adjust position & font
          </button>
          <button
            type="button"
            onClick={() =>
              setPrompt(
                "Make the subtitle animation start 0.5s earlier with smooth power2.out ease",
              )
            }
            className="px-2 py-0.5 rounded-full border border-neutral-800 bg-neutral-900/80 text-[10px] text-neutral-300 hover:border-cyan-400 hover:text-cyan-300 transition-colors"
          >
            ⏱ Timing & ease
          </button>
        </div>

        {/* Live Running Progress Area */}
        {isRunning && (
          <div className="mt-1 flex flex-col gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-2.5">
            <div className="flex items-center justify-between text-[10.5px]">
              <span className="flex items-center gap-1.5 font-medium text-emerald-300">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {currentStepText || `Running ${engine}...`}
              </span>
              <span className="font-mono text-[10px] text-emerald-400 font-bold">
                {progressPercent}%
              </span>
            </div>
            <div className="w-full bg-neutral-900 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300 rounded-full"
                style={{ width: `${Math.max(5, progressPercent)}%` }}
              />
            </div>
          </div>
        )}

        {/* Terminal Logs Drawer */}
        {showLogs && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-black/90 p-2 border border-neutral-800 font-mono text-[9px] leading-relaxed">
            {terminalLogs.map((log, i) => (
              <pre
                key={i}
                className={`whitespace-pre-wrap ${
                  log.stream === "stderr"
                    ? "text-amber-300"
                    : log.stream === "system"
                      ? "text-emerald-300 font-semibold"
                      : "text-neutral-200"
                }`}
              >
                {log.text}
              </pre>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {/* Bottom Action Bar */}
        <div className="flex items-center justify-between pt-2 border-t border-neutral-800/80 mt-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-md border border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-white"
              title="Add attachment"
            >
              +
            </button>
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-neutral-800 bg-neutral-900/60 text-[10px] text-neutral-400 hover:text-neutral-200"
            >
              <span>📁</span>
              <span>No brand kit</span>
            </button>
            {terminalLogs.length > 0 && (
              <button
                type="button"
                onClick={() => setShowLogs((p) => !p)}
                className="px-1.5 py-1 text-[10px] font-mono text-neutral-400 hover:text-emerald-300"
              >
                {showLogs ? "Hide Logs" : "Terminal"}
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {isRunning ? (
              <button
                type="button"
                onClick={() => void cancelRun()}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-semibold text-[11px] transition-colors shadow-lg"
              >
                ⏹ Stop
              </button>
            ) : (
              <button
                type="button"
                disabled={!prompt.trim()}
                onClick={() => void handleSend()}
                className="flex items-center justify-center h-7 w-7 rounded-lg bg-white disabled:bg-neutral-700 text-black disabled:text-neutral-500 transition-colors shadow-lg hover:bg-emerald-400 hover:text-black"
                title="Send instruction to Framey (Cmd+Enter)"
              >
                <span className="text-sm font-bold">↑</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
