import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { liveTime, usePlayerStore } from "../../player";
import { studioApiFetch } from "../../utils/studioApiFetch";
import { resolveActiveSceneTargetAtPlayhead } from "../../utils/studioLayerActions";
import {
  formatAllOpenPinsPromptForAgent,
  formatPinBadgeNumber,
  formatSinglePinPromptForAgent,
  useCanvasCommentsStore,
  type CanvasCommentPin,
  type TargetAiAgent,
} from "../editor/canvasCommentsStore";
import { useDockLayoutStore } from "../dock/dockLayoutStore";

export type AssistantEngineId = "claude" | "codex" | "agy" | "grok" | "opencode";

export function engineToTargetAgent(engine: AssistantEngineId): TargetAiAgent {
  if (engine === "codex") return "Codex";
  if (engine === "agy") return "Antigravity";
  return "Claude Code";
}

export function targetAgentToEngine(agent: TargetAiAgent): AssistantEngineId {
  if (agent === "Codex" || agent === "ChatGPT") return "codex";
  if (agent === "Antigravity") return "agy";
  return "claude";
}

export interface AgentCliStatus {
  id: AssistantEngineId;
  label: string;
  binary: string;
  binaryPath: string | null;
  installed: boolean;
  version: string | null;
  defaultModel: string;
  efforts: string[];
  defaultEffort: string;
}

export interface AgentModelInfo {
  id: string;
  name: string;
  note?: string;
  isDefault?: boolean;
  effortOptions: string[];
  defaultEffort: string;
}

export interface StudioSkillItem {
  id: string;
  name: string;
  title: string;
  description: string;
  category:
    | "Studio"
    | "Documentary/Moments"
    | "Planning"
    | "Viral Clone"
    | "Podcast"
    | "Talking Head";
  relativePath: string;
  references: string[];
}

export interface TerminalLogEntry {
  stream: "stdout" | "stderr" | "system";
  text: string;
}

export interface AgentRunParams {
  projectId: string;
  prompt: string;
  sceneFile?: string;
  elementId?: string;
  timestampSeconds?: number;
  skills?: string[];
  pinId?: string;
  engine?: AssistantEngineId;
  model?: string;
  effort?: string;
}

export interface LastRunSummary {
  engine: AssistantEngineId;
  model: string;
  sceneFile: string;
  elementId: string;
  prompt: string;
  finishedAtTime: string;
  durationMs: number;
  status: "completed" | "failed" | "cancelled";
  exitCode: number;
}

interface AgentAssistantStoreState {
  engine: AssistantEngineId;
  model: string;
  effort: string;
  prompt: string;
  selectedSkills: string[];
  anthropicApiKey: string;
  openaiApiKey: string;
  geminiApiKey: string;
  targetSceneFile: string | null;
  targetElementId: string | null;
  targetTimestamp: number | null;

  // Global Execution State
  isRunning: boolean;
  activeRunId: string | null;
  activePinIdRunning: string | null;
  currentStepText: string;
  progressPercent: number;
  terminalLogs: TerminalLogEntry[];
  lastRunStatus: "idle" | "running" | "completed" | "failed" | "cancelled";
  lastRunSummary: LastRunSummary | null;
  chatDrawerOpen: boolean;

  setEngine: (engine: AssistantEngineId) => void;
  setModel: (model: string) => void;
  setEffort: (effort: string) => void;
  setPrompt: (prompt: string) => void;
  toggleSkill: (skillId: string) => void;
  setSelectedSkills: (skills: string[]) => void;
  setAnthropicApiKey: (key: string) => void;
  setOpenaiApiKey: (key: string) => void;
  setGeminiApiKey: (key: string) => void;
  setChatDrawerOpen: (open: boolean) => void;
  clearTerminalLogs: () => void;
  injectCanvasPinIntoAssistant: (pin: CanvasCommentPin, projectId: string) => void;
  injectAllPinsIntoAssistant: (pins: CanvasCommentPin[], projectId: string) => void;
  runAgent: (params: AgentRunParams) => Promise<boolean>;
  cancelRun: () => Promise<void>;
}

export const DEFAULT_MODELS_BY_ENGINE: Record<AssistantEngineId, string> = {
  codex: "gpt-5.6-luna",
  agy: "gemini-4-argon-medium",
  claude: "claude-opus-5-5",
  grok: "grok-4",
  opencode: "anthropic/claude-sonnet-4-5",
};

let activeAbortController: AbortController | null = null;

export const useAgentAssistantStore = create<AgentAssistantStoreState>()(
  persist(
    (set, get) => ({
      engine: "codex",
      model: "gpt-5.6-luna",
      effort: "medium",
      prompt: "",
      selectedSkills: ["hyperframes", "moment-film", "media-use", "motion-graphics"],
      anthropicApiKey: "",
      openaiApiKey: "",
      geminiApiKey: "",
      targetSceneFile: null,
      targetElementId: null,
      targetTimestamp: null,

      // Global Execution State defaults
      isRunning: false,
      activeRunId: null,
      activePinIdRunning: null,
      currentStepText: "",
      progressPercent: 0,
      terminalLogs: [],
      lastRunStatus: "idle",
      lastRunSummary: null,
      chatDrawerOpen: false,

      setEngine: (engine) => {
        const nextModel = DEFAULT_MODELS_BY_ENGINE[engine] || get().model;
        set({ engine, model: nextModel });
        const mappedAgent = engineToTargetAgent(engine);
        if (useCanvasCommentsStore.getState().selectedAgent !== mappedAgent) {
          useCanvasCommentsStore.getState().setSelectedAgent(mappedAgent);
        }
      },
      setModel: (model) => set({ model }),
      setEffort: (effort) => set({ effort }),
      setPrompt: (prompt) => set({ prompt }),
      toggleSkill: (skillId) =>
        set((state) => ({
          selectedSkills: state.selectedSkills.includes(skillId)
            ? state.selectedSkills.filter((id) => id !== skillId)
            : [...state.selectedSkills, skillId],
        })),
      setSelectedSkills: (selectedSkills) => set({ selectedSkills }),
      setAnthropicApiKey: (anthropicApiKey) => set({ anthropicApiKey }),
      setOpenaiApiKey: (openaiApiKey) => set({ openaiApiKey }),
      setGeminiApiKey: (geminiApiKey) => set({ geminiApiKey }),
      setChatDrawerOpen: (chatDrawerOpen) => set({ chatDrawerOpen }),
      clearTerminalLogs: () => set({ terminalLogs: [] }),

      injectCanvasPinIntoAssistant: (pin, projectId) => {
        const mappedEngine = targetAgentToEngine(pin.targetAgent);
        const formatted = formatSinglePinPromptForAgent(pin, pin.targetAgent, projectId);
        set({
          engine: mappedEngine,
          prompt: formatted,
          targetSceneFile: pin.sceneFile,
          targetElementId: pin.elementId,
          targetTimestamp: pin.timestampSeconds,
        });
        useDockLayoutStore.getState().activatePanel("assistant");
      },

      injectAllPinsIntoAssistant: (pins, projectId) => {
        const openPins = pins.filter((p) => p.status === "OPEN");
        if (openPins.length === 0) return;
        const first = openPins[0]!;
        const formatted = formatAllOpenPinsPromptForAgent(openPins, first.targetAgent, projectId);
        set({
          prompt: formatted,
          targetSceneFile: first.sceneFile,
          targetElementId: first.elementId,
          targetTimestamp: first.timestampSeconds,
        });
        useDockLayoutStore.getState().activatePanel("assistant");
      },

      runAgent: async (params: AgentRunParams) => {
        const state = get();
        if (state.isRunning) return false;

        const effectiveEngine = params.engine || state.engine;
        let effectiveModel = params.model;
        if (!effectiveModel) {
          if (params.engine && params.engine !== state.engine) {
            effectiveModel = DEFAULT_MODELS_BY_ENGINE[params.engine] || state.model;
          } else {
            effectiveModel = state.model;
          }
        }
        if (
          effectiveEngine === "agy" &&
          (!effectiveModel ||
            effectiveModel === "gemini-3.1-pro" ||
            (!effectiveModel.includes("gemini") &&
              !effectiveModel.includes("claude") &&
              !effectiveModel.includes("gpt")))
        ) {
          effectiveModel = "gemini-4-argon-medium";
        }
        if (effectiveEngine === "codex" && (!effectiveModel || effectiveModel.includes("gemini"))) {
          effectiveModel = "gpt-5.6-luna";
        }
        const effectiveEffort = params.effort || state.effort;
        const effectiveSkills = params.skills || state.selectedSkills;
        const effectivePrompt = params.prompt.trim();

        if (!effectivePrompt) return false;

        let apiKey = "";
        if (effectiveEngine === "claude") apiKey = state.anthropicApiKey.trim();
        else if (effectiveEngine === "codex") apiKey = state.openaiApiKey.trim();
        else if (effectiveEngine === "agy") apiKey = state.geminiApiKey.trim();
        else if (effectiveEngine === "opencode") {
          apiKey = state.anthropicApiKey.trim() || state.openaiApiKey.trim();
        }

        const abortController = new AbortController();
        activeAbortController = abortController;

        // 1. Try Instant Fast-Path Engine (< 50ms) for targeted element edits
        if (params.elementId && params.elementId !== "scene") {
          try {
            const fastRes = await studioApiFetch("/api/agents/fast-patch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId: params.projectId,
                sceneFile: params.sceneFile,
                elementId: params.elementId,
                prompt: effectivePrompt,
                apiKey,
              }),
            });
            if (fastRes?.ok) {
              const fastData = (await fastRes.json().catch(() => null)) as {
                ok: boolean;
                patched: boolean;
                diffSummary?: string;
                durationMs?: number;
                elementId?: string;
              } | null;

              if (fastData?.ok && fastData.patched) {
                const finishedAtTime = new Date().toLocaleTimeString();
                const durationMs = fastData.durationMs || 15;
                set({
                  isRunning: false,
                  activePinIdRunning: null,
                  lastRunStatus: "completed",
                  currentStepText: `Fast-Patch: ${fastData.diffSummary}`,
                  progressPercent: 100,
                  lastRunSummary: {
                    finishedAtTime,
                    durationMs,
                    sceneFile: params.sceneFile || "index.html",
                    elementId: fastData.elementId || params.elementId,
                    prompt: effectivePrompt,
                    exitCode: 0,
                    status: "completed",
                    engine: "Instant Fast-Patch",
                  },
                  terminalLogs: [
                    {
                      stream: "system",
                      text: `✓ [Instant Fast-Patch Applied in ${durationMs}ms]\n  Element: #${fastData.elementId}\n  Diff: ${fastData.diffSummary}\n`,
                    },
                  ],
                });
                return true;
              }
            }
          } catch {
            /* proceed to full CLI agent runner */
          }
        }

        // 2. Launch Tier 2 Deep Autonomous Agent CLI
        set({
          isRunning: true,
          activePinIdRunning: params.pinId || null,
          lastRunStatus: "running",
          currentStepText: `Launching ${effectiveEngine.toUpperCase()} (${effectiveModel})...`,
          progressPercent: 15,
          terminalLogs: [
            {
              stream: "system",
              text: `▶ Launching ${effectiveEngine.toUpperCase()} (${effectiveModel} · effort=${effectiveEffort})\n  Scene: ${params.sceneFile || "index.html"} · Element: #${params.elementId || "scene"} · Skills: [${effectiveSkills.join(", ")}]\n  Prompt: "${effectivePrompt}"\n`,
            },
          ],
        });

        // Periodic progress tick while agent is processing
        const progressTimer = setInterval(() => {
          set((s) => {
            if (!s.isRunning || s.progressPercent >= 90) return s;
            return { progressPercent: Math.min(88, s.progressPercent + 3) };
          });
        }, 1200);

        try {
          const res = await studioApiFetch("/api/agents/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: params.projectId,
              engine: effectiveEngine,
              model: effectiveModel,
              effort: effectiveEffort,
              prompt: effectivePrompt,
              sceneFile: params.sceneFile,
              elementId: params.elementId,
              timestampSeconds: params.timestampSeconds,
              skills: effectiveSkills,
              ...(apiKey ? { apiKey } : {}),
            }),
            signal: abortController.signal,
          });

          if (!res || !res.ok || !res.body) {
            clearInterval(progressTimer);
            const errText = res ? await res.text().catch(() => "Request failed") : "No response";
            set((s) => ({
              isRunning: false,
              activePinIdRunning: null,
              lastRunStatus: "failed",
              currentStepText: `Error: ${errText.slice(0, 100)}`,
              progressPercent: 0,
              terminalLogs: [
                ...s.terminalLogs,
                { stream: "stderr", text: `\n[Agent Error] ${errText}\n` },
              ],
            }));
            return false;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() ?? "";

            for (const block of blocks) {
              const lines = block.split("\n");
              let eventName = "message";
              let dataStr = "";
              for (const line of lines) {
                if (line.startsWith("event:")) {
                  eventName = line.slice(6).trim();
                } else if (line.startsWith("data:")) {
                  dataStr += line.slice(5).trim();
                }
              }
              if (!dataStr) continue;

              try {
                const payload = JSON.parse(dataStr) as {
                  runId?: string;
                  stream?: "stdout" | "stderr";
                  text?: string;
                  status?: "completed" | "failed" | "cancelled";
                  exitCode?: number;
                  durationMs?: number;
                };

                if (eventName === "start" && payload.runId) {
                  set({ activeRunId: payload.runId, progressPercent: 25 });
                } else if (eventName === "output" && payload.text) {
                  const text = payload.text;
                  let stepMsg = "";
                  if (text.includes("exec") || text.includes("/bin/zsh")) {
                    stepMsg = "Running file inspection & edits in project...";
                  } else if (text.includes("tokens used")) {
                    stepMsg = "Finalizing revisions and saving changes...";
                  } else if (text.includes("error") || text.includes("ERROR")) {
                    stepMsg = text.slice(0, 80);
                  }

                  set((s) => ({
                    currentStepText: stepMsg || s.currentStepText,
                    progressPercent: stepMsg ? Math.max(s.progressPercent, 65) : s.progressPercent,
                    terminalLogs: [...s.terminalLogs, { stream: payload.stream || "stdout", text }],
                  }));
                } else if (eventName === "done") {
                  clearInterval(progressTimer);
                  const isSuccess = payload.status === "completed" || payload.exitCode === 0;
                  const finalStatus = isSuccess ? "completed" : payload.status || "failed";
                  const now = new Date();
                  const finishedAtTime = now.toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  });

                  const summary: LastRunSummary = {
                    engine: effectiveEngine,
                    model: effectiveModel,
                    sceneFile: params.sceneFile || state.targetSceneFile || "index.html",
                    elementId: params.elementId || state.targetElementId || "scene",
                    prompt: effectivePrompt,
                    finishedAtTime,
                    durationMs: payload.durationMs ?? 0,
                    status: finalStatus as any,
                    exitCode: payload.exitCode ?? 0,
                  };

                  set((s) => ({
                    isRunning: false,
                    activePinIdRunning: null,
                    lastRunStatus: finalStatus,
                    lastRunSummary: summary,
                    progressPercent: isSuccess ? 100 : 0,
                    currentStepText: isSuccess
                      ? `✓ Finished at ${finishedAtTime} (${((payload.durationMs ?? 0) / 1000).toFixed(1)}s) — Preview reloaded!`
                      : `Run failed (exit=${payload.exitCode ?? -1}) at ${finishedAtTime}`,
                    terminalLogs: [
                      ...s.terminalLogs,
                      {
                        stream: "system",
                        text: `\n■ Agent run ${finalStatus.toUpperCase()} (exit=${payload.exitCode ?? 0}, ${((payload.durationMs ?? 0) / 1000).toFixed(1)}s) at ${finishedAtTime}.\n`,
                      },
                    ],
                  }));

                  // If a pin was targeted and execution succeeded, resolve the pin!
                  if (params.pinId && isSuccess) {
                    void useCanvasCommentsStore
                      .getState()
                      .togglePinStatus(params.projectId, params.pinId);
                  }

                  // Dispatch global preview reload & file tree refresh
                  window.dispatchEvent(new CustomEvent("hf:reload-preview"));
                  window.dispatchEvent(new CustomEvent("hf:refresh-file-tree"));
                  return isSuccess;
                }
              } catch {
                /* ignore malformed SSE frame */
              }
            }
          }

          clearInterval(progressTimer);
          return true;
        } catch (err) {
          clearInterval(progressTimer);
          if ((err as Error)?.name !== "AbortError") {
            set((s) => ({
              isRunning: false,
              activePinIdRunning: null,
              lastRunStatus: "failed",
              progressPercent: 0,
              currentStepText: "Connection error",
              terminalLogs: [
                ...s.terminalLogs,
                {
                  stream: "stderr",
                  text: `\n[Connection Error] ${err instanceof Error ? err.message : String(err)}\n`,
                },
              ],
            }));
          }
          return false;
        } finally {
          clearInterval(progressTimer);
          activeAbortController = null;
        }
      },

      cancelRun: async () => {
        const state = get();
        try {
          await studioApiFetch("/api/agents/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId: state.activeRunId ?? undefined }),
          });
        } catch {
          /* ignore */
        }
        activeAbortController?.abort();
        activeAbortController = null;
        set({
          isRunning: false,
          activePinIdRunning: null,
          lastRunStatus: "cancelled",
          progressPercent: 0,
          currentStepText: "Run cancelled by user",
        });
      },
    }),
    {
      name: "hf-agent-assistant-settings",
      partialize: (state) => ({
        engine: state.engine,
        model: state.model,
        effort: state.effort,
        selectedSkills: state.selectedSkills,
        anthropicApiKey: state.anthropicApiKey,
        openaiApiKey: state.openaiApiKey,
        geminiApiKey: state.geminiApiKey,
      }),
    },
  ),
);

const CLI_AUTH_COMMANDS: Record<AssistantEngineId, { loginCmd: string; installHint: string }> = {
  claude: {
    loginCmd: "claude auth login",
    installHint: "npm install -g @anthropic-ai/claude-code && claude auth login",
  },
  codex: {
    loginCmd: "codex login",
    installHint: "npm install -g @openai/codex && codex login",
  },
  agy: {
    loginCmd: "agy auth login",
    installHint: "agy auth login",
  },
  grok: {
    loginCmd: "grok login",
    installHint: "grok login",
  },
  opencode: {
    loginCmd: "opencode auth login",
    installHint: "opencode auth login",
  },
};

const SKILL_CATEGORIES = [
  "All",
  "Studio",
  "Documentary/Moments",
  "Planning",
  "Viral Clone",
  "Podcast",
  "Talking Head",
] as const;

export interface AgentAssistantPanelProps {
  projectId: string;
  activeCompPath: string | null;
  selectedElementId?: string | null;
  reloadPreview: () => void;
  refreshFileTree: () => Promise<unknown>;
}

export const AgentAssistantPanel = memo(function AgentAssistantPanel({
  projectId,
  activeCompPath,
  selectedElementId,
  reloadPreview,
  refreshFileTree,
}: AgentAssistantPanelProps) {
  const {
    engine,
    model,
    effort,
    prompt,
    selectedSkills,
    anthropicApiKey,
    openaiApiKey,
    geminiApiKey,
    targetSceneFile,
    targetElementId,
    targetTimestamp,
    isRunning,
    activeRunId,
    terminalLogs,
    lastRunStatus,
    setEngine,
    setModel,
    setEffort,
    setPrompt,
    toggleSkill,
    setSelectedSkills,
    setAnthropicApiKey,
    setOpenaiApiKey,
    setGeminiApiKey,
    injectCanvasPinIntoAssistant,
    injectAllPinsIntoAssistant,
    runAgent,
    cancelRun,
    clearTerminalLogs,
    lastRunSummary,
  } = useAgentAssistantStore();

  const pins = useCanvasCommentsStore((s) => s.pins);
  const openPins = useMemo(() => pins.filter((p) => p.status === "OPEN"), [pins]);

  const [agents, setAgents] = useState<AgentCliStatus[]>([]);
  const [models, setModels] = useState<AgentModelInfo[]>([]);
  const [allSkills, setAllSkills] = useState<StudioSkillItem[]>([]);
  const [authExpanded, setAuthExpanded] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [copiedAuthCmd, setCopiedAuthCmd] = useState(false);
  const [skillsExpanded, setSkillsExpanded] = useState(true);
  const [skillCategoryFilter, setSkillCategoryFilter] =
    useState<(typeof SKILL_CATEGORIES)[number]>("All");
  const [previewSkill, setPreviewSkill] = useState<{
    title: string;
    content: string;
  } | null>(null);

  const [terminalExpanded, setTerminalExpanded] = useState(true);
  const [copiedPromptFeedback, setCopiedPromptFeedback] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Load installed CLI agents and 22+ skills catalog
  const fetchAgentsAndSkills = useCallback(() => {
    try {
      studioApiFetch("/api/agents")
        .then((res) => (res && res.ok ? res.json() : null))
        .then((data: { agents?: AgentCliStatus[] } | null) => {
          if (data && Array.isArray(data.agents)) {
            setAgents(data.agents);
          }
        })
        .catch(() => {});

      studioApiFetch("/api/agent/skills")
        .then((res) => (res && res.ok ? res.json() : null))
        .then((data: { skills?: StudioSkillItem[] } | null) => {
          if (data && Array.isArray(data.skills)) {
            setAllSkills(data.skills);
          }
        })
        .catch(() => {});
    } catch {
      /* ignore in test environment */
    }
  }, []);

  useEffect(() => {
    fetchAgentsAndSkills();
  }, [fetchAgentsAndSkills]);

  // Fetch models when engine changes
  useEffect(() => {
    let cancelled = false;
    try {
      studioApiFetch(`/api/agents/${engine}/models`)
        .then((res) => (res && res.ok ? res.json() : null))
        .then(
          (
            data: {
              models?: AgentModelInfo[];
              defaultModel?: string;
              defaultEffort?: string;
            } | null,
          ) => {
            if (cancelled || !data || !Array.isArray(data.models)) return;
            setModels(data.models);
            const currentValid = data.models.some((m) => m.id === model);
            if (!currentValid) {
              const defModel =
                data.models.find((m) => m.isDefault)?.id ||
                data.defaultModel ||
                data.models[0]?.id ||
                "";
              setModel(defModel);
            }
            if (data.defaultEffort && !effort) {
              setEffort(data.defaultEffort);
            }
          },
        )
        .catch(() => {});
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
    };
  }, [engine]);

  useEffect(() => {
    if (terminalEndRef.current && terminalExpanded) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [terminalLogs, terminalExpanded]);

  const activeAgentInfo = useMemo(
    () => agents.find((a) => a.id === engine) ?? null,
    [agents, engine],
  );
  const activeModelInfo = useMemo(
    () => models.find((m) => m.id === model) ?? models[0] ?? null,
    [models, model],
  );
  const effortOptions = useMemo(
    () =>
      activeModelInfo?.effortOptions?.length
        ? activeModelInfo.effortOptions
        : (activeAgentInfo?.efforts ?? ["low", "medium", "high", "max"]),
    [activeModelInfo, activeAgentInfo],
  );

  const filteredSkills = useMemo(() => {
    if (skillCategoryFilter === "All") return allSkills;
    return allSkills.filter((s) => s.category === skillCategoryFilter);
  }, [allSkills, skillCategoryFilter]);

  const resolvedContext = useMemo(() => {
    const playhead =
      targetTimestamp ??
      (Number.isFinite(liveTime.get()) && liveTime.get() > 0
        ? liveTime.get()
        : usePlayerStore.getState().currentTime);
    const activeScene = resolveActiveSceneTargetAtPlayhead(activeCompPath);
    const sceneFile = targetSceneFile || activeScene.targetFile || activeCompPath || "index.html";
    const elementId = targetElementId || selectedElementId || "scene";
    return {
      sceneFile,
      elementId,
      playhead,
      frame: Math.round(playhead * 30),
    };
  }, [activeCompPath, selectedElementId, targetSceneFile, targetElementId, targetTimestamp]);

  const handleInspectSkill = useCallback(async (skillId: string) => {
    try {
      const res = await studioApiFetch(`/api/agent/skills/${encodeURIComponent(skillId)}`);
      if (res && res.ok) {
        const data = (await res.json()) as {
          skill?: { title?: string; name?: string };
          content?: string;
        };
        setPreviewSkill({
          title: data.skill?.title || data.skill?.name || skillId,
          content: data.content || "",
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const handleCopyCompiledPrompt = useCallback(async () => {
    const skillNames = selectedSkills.join(", ");
    const text = [
      `# HyperFrames Studio Agent Task (${projectId})`,
      `- Engine: ${activeAgentInfo?.label || engine} · Model: ${model} (${effort})`,
      `- Target Scene File: \`Sources/${resolvedContext.sceneFile}\``,
      `- Target Element: \`#${resolvedContext.elementId}\``,
      `- Playhead: \`${resolvedContext.playhead.toFixed(2)}s\` (Frame \`${resolvedContext.frame}\` @ 30fps)`,
      `- Active Skills: ${skillNames || "none"}`,
      "",
      "## Instruction",
      prompt.trim() || "(Describe the visual or timing change to perform in Sources/)",
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopiedPromptFeedback(true);
      setTimeout(() => setCopiedPromptFeedback(false), 2500);
    } catch {
      /* ignore */
    }
  }, [selectedSkills, projectId, activeAgentInfo, engine, model, effort, resolvedContext, prompt]);

  const activeEngineApiKey = useMemo(() => {
    if (engine === "claude") return anthropicApiKey.trim();
    if (engine === "codex") return openaiApiKey.trim();
    if (engine === "agy") return geminiApiKey.trim();
    if (engine === "opencode") return anthropicApiKey.trim() || openaiApiKey.trim();
    return "";
  }, [engine, anthropicApiKey, openaiApiKey, geminiApiKey]);

  const handleCopyAuthCmd = useCallback(async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedAuthCmd(true);
      setTimeout(() => setCopiedAuthCmd(false), 2000);
    } catch {
      /* ignore */
    }
  }, []);

  const handleRunAgent = useCallback(async () => {
    if (!prompt.trim() || isRunning) return;
    setTerminalExpanded(true);
    await runAgent({
      projectId,
      engine,
      model,
      effort,
      prompt: prompt.trim(),
      sceneFile: resolvedContext.sceneFile,
      elementId: resolvedContext.elementId,
      timestampSeconds: resolvedContext.playhead,
      skills: selectedSkills,
    });
    void refreshFileTree();
    reloadPreview();
  }, [
    prompt,
    isRunning,
    runAgent,
    projectId,
    engine,
    model,
    effort,
    resolvedContext,
    selectedSkills,
    refreshFileTree,
    reloadPreview,
  ]);

  const handleCancelRun = useCallback(async () => {
    await cancelRun();
  }, [cancelRun]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface text-text-1 overflow-y-auto p-3 gap-3">
      {/* Header Banner */}
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">🤖</span>
          <div>
            <h3 className="text-xs font-semibold text-text-1">
              HyperFrames AI Agent & Skills Runner
            </h3>
            <p className="text-[10px] text-text-4">
              Desktop Agent Architecture · {allSkills.length || 22} Built-in Documentary & Motion
              Skills
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={fetchAgentsAndSkills}
          className="px-2 py-0.5 rounded bg-bg-2 hover:bg-bg-3 border border-border text-[10px] text-text-3"
          title="Re-probe installed CLI agents and skills"
        >
          ↻ Probe CLIs
        </button>
      </div>

      {/* 1. Agent CLI Selector with Live Installed Status Dots */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
            1. Agent CLI Engine
          </label>
          {activeAgentInfo && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded ${
                activeAgentInfo.installed
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  : "bg-zinc-500/15 text-zinc-400 border border-zinc-500/30"
              }`}
              title={activeAgentInfo.binaryPath || "CLI binary not detected on PATH"}
            >
              <span>{activeAgentInfo.installed ? "●" : "○"}</span>
              <span>
                {activeAgentInfo.installed
                  ? `Installed (${activeAgentInfo.version || activeAgentInfo.binary})`
                  : `${activeAgentInfo.binary} not on PATH`}
              </span>
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1">
          {(agents.length > 0
            ? agents
            : ([
                {
                  id: "claude",
                  label: "Claude Code",
                  binary: "claude",
                  binaryPath: null,
                  installed: true,
                  version: null,
                  defaultModel: "claude-opus-5-5",
                  efforts: ["low", "medium", "high", "max"],
                  defaultEffort: "high",
                },
                {
                  id: "codex",
                  label: "Codex",
                  binary: "codex",
                  binaryPath: null,
                  installed: true,
                  version: null,
                  defaultModel: "gpt-5.6-luna",
                  efforts: ["low", "medium", "high", "xhigh", "max"],
                  defaultEffort: "medium",
                },
                {
                  id: "agy",
                  label: "Antigravity",
                  binary: "agy",
                  binaryPath: null,
                  installed: true,
                  version: null,
                  defaultModel: "gemini-4-argon-medium",
                  efforts: ["low", "medium", "high", "max"],
                  defaultEffort: "medium",
                },
              ] as AgentCliStatus[])
          ).map((ag) => {
            const active = ag.id === engine;
            return (
              <button
                key={ag.id}
                type="button"
                data-testid={`agent-engine-${ag.id}`}
                onClick={() => setEngine(ag.id)}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded border text-left text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-200"
                    : "bg-bg-2 border-border hover:bg-bg-3 text-text-2"
                }`}
              >
                <span
                  className={
                    ag.installed ? "text-emerald-400 text-[10px]" : "text-zinc-500 text-[10px]"
                  }
                  title={ag.installed ? `Installed: ${ag.binaryPath}` : "Not installed"}
                >
                  ●
                </span>
                <span className="truncate">{ag.label}</span>
              </button>
            );
          })}
        </div>

        {/* Collapsible ⚙️ Auth & API Keys Section */}
        <div
          data-testid="agent-auth-drawer"
          className="flex flex-col gap-2 rounded-md border border-border bg-bg-2/70 p-2 mt-0.5"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setAuthExpanded((prev) => !prev)}
              className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-2 hover:text-text-1"
            >
              <span>{authExpanded ? "▾" : "▸"}</span>
              <span>⚙️ Auth &amp; API Keys</span>
            </button>
            <button
              type="button"
              data-testid="agent-toggle-custom-api-key"
              onClick={() => setAuthExpanded((prev) => !prev)}
              className="px-2 py-0.5 rounded bg-surface hover:bg-bg-3 border border-border-strong text-[10px] font-medium text-emerald-300 transition-colors"
            >
              🔑 Enter Custom API Key (Optional)
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 text-[10px]">
            {activeAgentInfo && !activeAgentInfo.installed ? (
              <span className="inline-flex items-center gap-1 text-amber-300 font-medium">
                <span>○</span>
                <span>
                  {activeAgentInfo.label} CLI not installed — run terminal login below or use Copy
                  Prompt
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-emerald-300 font-medium">
                <span>●</span>
                <span>
                  Authenticated via local CLI session
                  {activeEngineApiKey ? " + Custom API Key active" : ""}
                </span>
              </span>
            )}
          </div>

          {activeAgentInfo && !activeAgentInfo.installed && (
            <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-zinc-950 border border-amber-500/30 font-mono text-[10px] text-amber-200">
              <code className="truncate">
                {CLI_AUTH_COMMANDS[engine]?.loginCmd || `${activeAgentInfo.binary} login`}
              </code>
              <button
                type="button"
                onClick={() =>
                  void handleCopyAuthCmd(
                    CLI_AUTH_COMMANDS[engine]?.loginCmd || `${activeAgentInfo.binary} login`,
                  )
                }
                className="px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 text-[9.5px] shrink-0"
              >
                {copiedAuthCmd ? "✓ Copied" : "Copy"}
              </button>
            </div>
          )}

          {authExpanded && (
            <div className="flex flex-col gap-2 pt-1.5 border-t border-border/70">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-4">
                  Optional overrides injected into spawned CLI subprocesses (persisted in
                  localStorage):
                </span>
                <button
                  type="button"
                  onClick={() => setShowApiKeys((prev) => !prev)}
                  className="text-[10px] text-emerald-400 hover:underline shrink-0"
                >
                  {showApiKeys ? "Hide Keys" : "Show Keys"}
                </button>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-text-3 flex items-center justify-between">
                  <span>Anthropic API Key (Claude · ANTHROPIC_API_KEY)</span>
                  {anthropicApiKey.trim() && (
                    <span className="text-[9px] text-emerald-400 font-mono">✓ Set</span>
                  )}
                </label>
                <input
                  type={showApiKeys ? "text" : "password"}
                  data-testid="agent-api-key-anthropic"
                  value={anthropicApiKey}
                  onChange={(e) => setAnthropicApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  autoComplete="off"
                  className="w-full h-7 px-2 rounded bg-surface border border-border-strong text-[11px] font-mono text-text-1 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-text-3 flex items-center justify-between">
                  <span>OpenAI API Key (Codex · OPENAI_API_KEY)</span>
                  {openaiApiKey.trim() && (
                    <span className="text-[9px] text-emerald-400 font-mono">✓ Set</span>
                  )}
                </label>
                <input
                  type={showApiKeys ? "text" : "password"}
                  data-testid="agent-api-key-openai"
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                  placeholder="sk-..."
                  autoComplete="off"
                  className="w-full h-7 px-2 rounded bg-surface border border-border-strong text-[11px] font-mono text-text-1 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-text-3 flex items-center justify-between">
                  <span>Gemini API Key (Antigravity · GEMINI_API_KEY)</span>
                  {geminiApiKey.trim() && (
                    <span className="text-[9px] text-emerald-400 font-mono">✓ Set</span>
                  )}
                </label>
                <input
                  type={showApiKeys ? "text" : "password"}
                  data-testid="agent-api-key-gemini"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder="AIza..."
                  autoComplete="off"
                  className="w-full h-7 px-2 rounded bg-surface border border-border-strong text-[11px] font-mono text-text-1 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50 text-[10px]">
                <div className="flex items-center gap-1.5 min-w-0 font-mono text-text-3">
                  <span className="text-text-4 shrink-0">Terminal Auth:</span>
                  <code className="px-1.5 py-0.5 rounded bg-zinc-950 border border-border text-emerald-300 truncate">
                    {CLI_AUTH_COMMANDS[engine]?.loginCmd || "claude auth login"}
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopyAuthCmd(
                        CLI_AUTH_COMMANDS[engine]?.loginCmd || "claude auth login",
                      )
                    }
                    className="px-1.5 py-0.5 rounded bg-surface hover:bg-bg-3 border border-border text-[9.5px] text-text-2 shrink-0"
                  >
                    {copiedAuthCmd ? "✓ Copied" : "Copy"}
                  </button>
                </div>
                {(anthropicApiKey || openaiApiKey || geminiApiKey) && (
                  <button
                    type="button"
                    onClick={() => {
                      setAnthropicApiKey("");
                      setOpenaiApiKey("");
                      setGeminiApiKey("");
                    }}
                    className="text-[10px] text-rose-400 hover:underline shrink-0"
                  >
                    Clear Keys
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Model & Reasoning Effort Selector */}
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
            2. Model
          </label>
          <select
            data-testid="agent-model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full h-7 px-2 rounded bg-bg-2 border border-border-strong text-[11px] text-text-1 focus:outline-none focus:border-emerald-500"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.note ? `(${m.note})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
            Effort
          </label>
          <select
            data-testid="agent-effort-select"
            value={effort}
            onChange={(e) => setEffort(e.target.value)}
            className="w-full h-7 px-2 rounded bg-bg-2 border border-border-strong text-[11px] text-text-1 uppercase focus:outline-none focus:border-emerald-500"
          >
            {effortOptions.map((ef) => (
              <option key={ef} value={ef}>
                {ef.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 3. Active Skills Picker (22+ Skills organized by category) */}
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-bg-2/60 p-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSkillsExpanded((prev) => !prev)}
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-2"
          >
            <span>{skillsExpanded ? "▾" : "▸"}</span>
            <span>3. Active Skills ({selectedSkills.length} selected)</span>
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setSelectedSkills(["hyperframes", "moment-film", "media-use", "motion-graphics"])
              }
              className="text-[10px] text-emerald-400 hover:underline"
              title="Select core documentary + motion skills"
            >
              Doc Defaults
            </button>
            <span className="text-text-5">·</span>
            <button
              type="button"
              onClick={() => setSelectedSkills([])}
              className="text-[10px] text-text-4 hover:text-text-2"
            >
              Clear
            </button>
          </div>
        </div>

        {skillsExpanded && (
          <>
            {/* Category filter pills */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {SKILL_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSkillCategoryFilter(cat)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium shrink-0 transition-colors ${
                    skillCategoryFilter === cat
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-bg-3 text-text-4 hover:text-text-2"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Multi-select skill tags */}
            <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto pt-0.5">
              {filteredSkills.map((sk) => {
                const isSelected = selectedSkills.includes(sk.id);
                return (
                  <div
                    key={sk.id}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors ${
                      isSelected
                        ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-200 font-semibold"
                        : "bg-surface border-border text-text-3 hover:text-text-1"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSkill(sk.id)}
                      className="flex items-center gap-1"
                      title={`${sk.category}: ${sk.description}`}
                    >
                      <span>{isSelected ? "✓" : "+"}</span>
                      <span>{sk.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleInspectSkill(sk.id)}
                      className="text-text-4 hover:text-emerald-300 ml-0.5"
                      title={`Read ${sk.name} SKILL.md`}
                    >
                      ⓘ
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {previewSkill && (
          <div className="mt-1 p-2 rounded bg-surface border border-border-strong max-h-40 overflow-y-auto text-[10px] font-mono text-text-3">
            <div className="flex items-center justify-between pb-1 mb-1 border-b border-border">
              <span className="font-bold text-emerald-300">{previewSkill.title}</span>
              <button
                type="button"
                onClick={() => setPreviewSkill(null)}
                className="text-text-4 hover:text-text-1"
              >
                ✕
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words text-[9.5px] leading-relaxed">
              {previewSkill.content}
            </pre>
          </div>
        )}
      </div>

      {/* 4. Scene / Element Context & Canvas Pin Injection */}
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-bg-2/60 p-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
            4. Target Context & Canvas Pins ({openPins.length} open)
          </span>
          {openPins.length > 0 && (
            <button
              type="button"
              onClick={() => injectAllPinsIntoAssistant(openPins, projectId)}
              className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-medium hover:bg-emerald-500/30"
            >
              📍 Load All {openPins.length} Pins
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-text-2">
          <span className="px-1.5 py-0.5 rounded bg-surface border border-border">
            Scene: {resolvedContext.sceneFile}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-surface border border-border">
            Element: #{resolvedContext.elementId}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-surface border border-border">
            Time: {resolvedContext.playhead.toFixed(2)}s ({resolvedContext.frame}f)
          </span>
        </div>

        {openPins.length > 0 && (
          <div className="flex flex-col gap-1 max-h-28 overflow-y-auto pt-1 border-t border-border/60">
            {openPins.map((pin) => (
              <div
                key={pin.id}
                className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-surface border border-border text-[10px]"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="px-1 py-0.2 rounded bg-emerald-500 text-slate-950 font-bold font-mono text-[9px] shrink-0">
                    #{formatPinBadgeNumber(pin.pinNumber)}
                  </span>
                  <span className="font-mono text-emerald-300 shrink-0">#{pin.elementId}</span>
                  <span className="truncate text-text-3">{pin.note}</span>
                </div>
                <button
                  type="button"
                  onClick={() => injectCanvasPinIntoAssistant(pin, projectId)}
                  className="px-1.5 py-0.5 rounded bg-bg-2 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9.5px] shrink-0"
                >
                  Use Pin
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent AI Edit Finished Summary Card */}
      {lastRunSummary && (
        <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              <span>Last AI Edit Finished:</span>
              <span className="font-mono text-white font-bold">
                {lastRunSummary.finishedAtTime}
              </span>
            </span>
            <span className="font-mono text-[10px] text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/30">
              {(lastRunSummary.durationMs / 1000).toFixed(1)}s · {lastRunSummary.engine} (
              {lastRunSummary.model})
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-neutral-300">
            <span className="text-neutral-400">Target:</span>
            <span className="text-emerald-300 font-semibold">
              Sources/{lastRunSummary.sceneFile}
            </span>
            {lastRunSummary.elementId && lastRunSummary.elementId !== "scene" && (
              <span className="text-amber-300 font-semibold">#{lastRunSummary.elementId}</span>
            )}
          </div>
          <div className="text-[10px] text-neutral-200 bg-black/40 rounded px-2 py-1 border border-neutral-800 italic truncate">
            "{lastRunSummary.prompt}"
          </div>
        </div>
      )}

      {/* 5. Prompt Input & Action Buttons */}
      <div className="flex flex-col gap-2">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
          5. Agent Instruction / Prompt
        </label>
        <textarea
          data-testid="agent-prompt-textarea"
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what the AI agent should edit in this scene (or click 'Use Pin' on any 📍 Canvas Comment above to populate automatically)..."
          className="w-full rounded-md bg-bg-2 border border-border-strong p-2 text-[11px] text-text-1 font-mono leading-relaxed focus:outline-none focus:border-emerald-500 resize-y"
        />

        <div className="flex items-center gap-2">
          {isRunning ? (
            <button
              type="button"
              data-testid="agent-cancel-button"
              onClick={() => void handleCancelRun()}
              className="flex-1 py-1.5 px-3 rounded-md bg-rose-500 hover:bg-rose-400 text-white font-semibold text-xs transition-colors"
            >
              ⏹ Stop Agent Run
            </button>
          ) : (
            <button
              type="button"
              data-testid="agent-run-button"
              disabled={!prompt.trim()}
              onClick={() => void handleRunAgent()}
              className="flex-1 py-1.5 px-3 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-semibold text-xs transition-colors"
            >
              ▶ Run {activeAgentInfo?.label || engine}
            </button>
          )}
          <button
            type="button"
            data-testid="agent-copy-prompt-button"
            onClick={() => void handleCopyCompiledPrompt()}
            className="py-1.5 px-3 rounded-md bg-bg-2 hover:bg-bg-3 border border-border-strong text-text-1 font-medium text-xs transition-colors"
          >
            {copiedPromptFeedback ? "✓ Copied!" : "📋 Copy Prompt"}
          </button>
        </div>
      </div>

      {/* 6. Live Collapsible Terminal Log */}
      {(terminalLogs.length > 0 || isRunning) && (
        <div className="flex flex-col rounded-md border border-border-strong bg-zinc-950 overflow-hidden">
          <div className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-900 border-b border-zinc-800">
            <button
              type="button"
              onClick={() => setTerminalExpanded((prev) => !prev)}
              className="flex items-center gap-1.5 text-[10px] font-mono font-semibold text-zinc-200"
            >
              <span>{terminalExpanded ? "▾" : "▸"}</span>
              <span>Agent Live Terminal Output</span>
              {isRunning && (
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
              {!isRunning && lastRunStatus !== "idle" && (
                <span
                  className={`px-1.5 py-0.2 rounded text-[9px] uppercase ${
                    lastRunStatus === "completed"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : lastRunStatus === "cancelled"
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-rose-500/20 text-rose-300"
                  }`}
                >
                  {lastRunStatus}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => clearTerminalLogs()}
              className="text-[10px] text-zinc-400 hover:text-zinc-200"
            >
              Clear
            </button>
          </div>
          {terminalExpanded && (
            <div className="p-2.5 max-h-60 overflow-y-auto font-mono text-[10px] leading-relaxed">
              {terminalLogs.map((entry, idx) => (
                <pre
                  key={idx}
                  className={`whitespace-pre-wrap break-words ${
                    entry.stream === "stderr"
                      ? "text-amber-300"
                      : entry.stream === "system"
                        ? "text-emerald-300 font-semibold"
                        : "text-zinc-200"
                  }`}
                >
                  {entry.text}
                </pre>
              ))}
              <div ref={terminalEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
