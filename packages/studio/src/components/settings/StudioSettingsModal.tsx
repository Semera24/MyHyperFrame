import { memo, useCallback, useEffect, useState } from "react";
import {
  Gear,
  Sliders,
  FilmStrip,
  Cpu,
  Keyboard,
  CheckCircle,
  XCircle,
  ArrowClockwise,
  Lightning,
  Sparkle,
} from "@phosphor-icons/react";
import { usePlayerStore } from "../../player";
import { useShownStudioTheme, setStudioTheme } from "../../utils/studioTheme";
import { useAudioMetersVisible } from "../../utils/audioMeterVisibility";
import { useLinkedClipPreferences } from "../../utils/linkedClipPreferences";
import { useDocumentaryQcOverlayStore } from "../../utils/studioLayerActions";
import {
  readStudioUiPreferences,
  writeStudioUiPreferences,
} from "../../utils/studioUiPreferences";
import {
  useAgentAssistantStore,
  DEFAULT_MODELS_BY_ENGINE,
  type AssistantEngineId,
} from "../panels/AgentAssistantPanel";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { studioApiFetch } from "../../utils/studioApiFetch";

export interface StudioSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string | null;
  activeCompPath?: string | null;
}

type SettingsTab = "general" | "project" | "agent" | "shortcuts";

export const StudioSettingsModal = memo(function StudioSettingsModal({
  isOpen,
  onClose,
  projectId,
  activeCompPath: _activeCompPath,
}: StudioSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  // General tab states
  const theme = useShownStudioTheme();
  const timelineSnapEnabled = usePlayerStore((s) => s.timelineSnapEnabled);
  const setTimelineSnapEnabled = usePlayerStore((s) => s.setTimelineSnapEnabled);
  const rippleEditEnabled = usePlayerStore((s) => s.rippleEditEnabled);
  const setRippleEditEnabled = usePlayerStore((s) => s.setRippleEditEnabled);
  const audioMetersVisible = useAudioMetersVisible((s) => s.visible);
  const setAudioMetersVisible = useAudioMetersVisible((s) => s.setVisible);
  const linkedSelection = useLinkedClipPreferences((s) => s.linkedSelection);
  const setLinkedSelection = useLinkedClipPreferences((s) => s.setLinkedSelection);
  const safeZoneVisible = useDocumentaryQcOverlayStore((s) => s.safeZoneVisible);
  const toggleSafeZone = useDocumentaryQcOverlayStore((s) => s.toggleSafeZone);
  const backdropMode = useDocumentaryQcOverlayStore((s) => s.backdropMode);
  const cycleBackdropMode = useDocumentaryQcOverlayStore((s) => s.cycleBackdropMode);
  const [webMcpEnabled, setWebMcpEnabled] = useState(
    () => readStudioUiPreferences().agentToolsEnabled ?? true,
  );

  // Project tab states
  const duration = usePlayerStore((s) => s.duration);
  const totalFrames = Math.round(duration * 30);
  const [handoffData, setHandoffData] = useState<{
    audio?: {
      fileName?: string;
      durationSeconds?: number;
      sampleRate?: number;
      channels?: number;
      codec?: string;
      frameEndpoint?: {
        frameAlignedSeconds: number;
        ceilingFrames: number;
        fps: number;
      };
      isDurationInSync?: boolean;
    };
    authoritativeDir?: string;
    channel?: string;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // AI Agent states
  const engine = useAgentAssistantStore((s) => s.engine);
  const setEngine = useAgentAssistantStore((s) => s.setEngine);
  const model = useAgentAssistantStore((s) => s.model);
  const setModel = useAgentAssistantStore((s) => s.setModel);
  const effort = useAgentAssistantStore((s) => s.effort);
  const setEffort = useAgentAssistantStore((s) => s.setEffort);
  const [cliAuthStatus, setCliAuthStatus] = useState<{
    installed: boolean;
    authenticated: boolean;
    ready: boolean;
    loginCommand?: string;
  }>({ installed: true, authenticated: false, ready: false });
  const [checkingAuth, setCheckingAuth] = useState(false);

  const fetchHandoff = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await studioApiFetch(buildProjectApiPath(projectId, "/handoff"));
      if (res && res.ok) {
        const json = (await res.json()) as { handoff?: typeof handoffData };
        if (json?.handoff) setHandoffData(json.handoff);
      }
    } catch {
      /* ignore */
    }
  }, [projectId]);

  const checkCliAuth = useCallback(async () => {
    setCheckingAuth(true);
    try {
      const res = await studioApiFetch("/api/agents/auth-status");
      if (res && res.ok) {
        const json = (await res.json()) as {
          installed?: boolean;
          authenticated?: boolean;
          ready?: boolean;
          loginCommand?: string;
        };
        setCliAuthStatus({
          installed: Boolean(json.installed),
          authenticated: Boolean(json.authenticated),
          ready: Boolean(json.ready),
          loginCommand: json.loginCommand || "claude login",
        });
      }
    } catch {
      setCliAuthStatus({
        installed: true,
        authenticated: false,
        ready: false,
        loginCommand: "claude login",
      });
    } finally {
      setCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void fetchHandoff();
      void checkCliAuth();
    }
  }, [isOpen, fetchHandoff, checkCliAuth]);

  const handleSyncDuration = async () => {
    if (!projectId) return;
    setSyncing(true);
    setSyncMessage("Syncing timeline duration to narration audio...");
    try {
      const res = await studioApiFetch(buildProjectApiPath(projectId, "/handoff/sync-duration"), {
        method: "POST",
      });
      if (res && res.ok) {
        const json = (await res.json()) as {
          ok: boolean;
          durationSynced?: number;
          ceilingFrames?: number;
          error?: string;
        };
        if (json.ok && json.durationSynced) {
          usePlayerStore.setState({ duration: json.durationSynced });
          setSyncMessage(`✓ Timeline synced to ${json.durationSynced}s (${json.ceilingFrames}f)`);
          await fetchHandoff();
          const iframe = document.querySelector<HTMLIFrameElement>(
            "iframe[data-testid='preview-iframe'], iframe",
          );
          iframe?.contentWindow?.location.reload();
        } else {
          setSyncMessage(`Sync failed: ${json.error || "Unknown error"}`);
        }
      } else {
        setSyncMessage("Sync failed: server error");
      }
    } catch (err) {
      setSyncMessage(`Error: ${String(err)}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  const handleToggleWebMcp = (enabled: boolean) => {
    setWebMcpEnabled(enabled);
    writeStudioUiPreferences({ agentToolsEnabled: enabled });
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="studio-settings-modal"
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in"
    >
      <div className="flex h-[560px] w-[780px] max-w-[95vw] flex-col rounded-xl border border-neutral-700 bg-neutral-950 text-neutral-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3.5 bg-neutral-900/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <Gear size={20} weight="bold" className="text-amber-400" />
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">
                Studio Preferences & Settings
              </h2>
              <p className="text-[11px] text-neutral-400">
                Workspace configuration, narration audio sync, AI agent models, and shortcuts
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="close-settings-modal"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer font-mono text-sm"
          >
            ✕
          </button>
        </div>

        {/* Modal Body with Sidebar Tabs */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Navigation Sidebar */}
          <div className="w-48 border-r border-neutral-800 bg-neutral-900/30 p-2 space-y-1 shrink-0">
            <button
              type="button"
              data-testid="tab-settings-general"
              onClick={() => setActiveTab("general")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "general"
                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50 border border-transparent"
              }`}
            >
              <Sliders size={15} weight="bold" />
              <span>General & Canvas</span>
            </button>

            <button
              type="button"
              data-testid="tab-settings-project"
              onClick={() => setActiveTab("project")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "project"
                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50 border border-transparent"
              }`}
            >
              <FilmStrip size={15} weight="bold" />
              <span>Project & Audio</span>
            </button>

            <button
              type="button"
              data-testid="tab-settings-agent"
              onClick={() => setActiveTab("agent")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "agent"
                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50 border border-transparent"
              }`}
            >
              <Cpu size={15} weight="bold" />
              <span>AI & Integrations</span>
            </button>

            <button
              type="button"
              data-testid="tab-settings-shortcuts"
              onClick={() => setActiveTab("shortcuts")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "shortcuts"
                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50 border border-transparent"
              }`}
            >
              <Keyboard size={15} weight="bold" />
              <span>Shortcuts Reference</span>
            </button>
          </div>

          {/* Tab Content Panel */}
          <div className="flex-1 p-5 overflow-y-auto min-h-0 text-xs">
            {/* 1. GENERAL TAB */}
            {activeTab === "general" && (
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800 pb-1.5">
                  Appearance & Workspace Controls
                </h3>

                {/* Theme Selection */}
                <div className="flex items-center justify-between py-1">
                  <div>
                    <span className="font-semibold text-neutral-200">Studio Theme</span>
                    <p className="text-[11px] text-neutral-400">
                      Toggle dark production interface or light paper canvas
                    </p>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-0.5">
                    <button
                      type="button"
                      onClick={() => setStudioTheme("dark")}
                      className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                        theme === "dark"
                          ? "bg-amber-500/20 text-amber-300"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      Dark
                    </button>
                    <button
                      type="button"
                      onClick={() => setStudioTheme("light")}
                      className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                        theme === "light"
                          ? "bg-amber-500/20 text-amber-300"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      Light
                    </button>
                  </div>
                </div>

                {/* Magnetic Snapping */}
                <div className="flex items-center justify-between py-1 border-t border-neutral-900">
                  <div>
                    <span className="font-semibold text-neutral-200">Magnetic Snapping (Magnet)</span>
                    <p className="text-[11px] text-neutral-400">
                      Snap playhead and keyframe diamonds to scene cuts, clip boundaries, and cues
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={timelineSnapEnabled}
                    onChange={(e) => setTimelineSnapEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-amber-500 focus:ring-0 cursor-pointer"
                  />
                </div>

                {/* Ripple Edit */}
                <div className="flex items-center justify-between py-1 border-t border-neutral-900">
                  <div>
                    <span className="font-semibold text-neutral-200">Gapless Ripple Edit</span>
                    <p className="text-[11px] text-neutral-400">
                      Automatically shift trailing clips when deleting or trimming scenes
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={rippleEditEnabled}
                    onChange={(e) => setRippleEditEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-amber-500 focus:ring-0 cursor-pointer"
                  />
                </div>

                {/* Audio Meters */}
                <div className="flex items-center justify-between py-1 border-t border-neutral-900">
                  <div>
                    <span className="font-semibold text-neutral-200">Timeline Audio dB Meters</span>
                    <p className="text-[11px] text-neutral-400">
                      Display visual volume peaks and level meters on the right edge of timeline
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={audioMetersVisible}
                    onChange={(e) => setAudioMetersVisible(e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-amber-500 focus:ring-0 cursor-pointer"
                  />
                </div>

                {/* Safe Margins */}
                <div className="flex items-center justify-between py-1 border-t border-neutral-900">
                  <div>
                    <span className="font-semibold text-neutral-200">Safe Margin Overlays</span>
                    <p className="text-[11px] text-neutral-400">
                      Render SMPTE 90% Action-Safe and 80% Title-Safe guidelines over preview canvas
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={safeZoneVisible}
                    onChange={() => toggleSafeZone()}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-amber-500 focus:ring-0 cursor-pointer"
                  />
                </div>

                {/* Backdrop Mode */}
                <div className="flex items-center justify-between py-1 border-t border-neutral-900">
                  <div>
                    <span className="font-semibold text-neutral-200">Canvas Backdrop Check</span>
                    <p className="text-[11px] text-neutral-400">
                      Preview contrast mode for transparent character and prop graphics
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => cycleBackdropMode()}
                    className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition-colors cursor-pointer capitalize font-mono"
                  >
                    Mode: {backdropMode}
                  </button>
                </div>

                {/* Linked Selection */}
                <div className="flex items-center justify-between py-1 border-t border-neutral-900">
                  <div>
                    <span className="font-semibold text-neutral-200">Linked Selection</span>
                    <p className="text-[11px] text-neutral-400">
                      Move and trim linked video and audio partners in unison
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={linkedSelection}
                    onChange={(e) => setLinkedSelection(e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-amber-500 focus:ring-0 cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* 2. PROJECT TAB */}
            {activeTab === "project" && (
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800 pb-1.5">
                  Active Production Episode & Audio Alignment
                </h3>

                <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Project / Episode:</span>
                    <span className="font-mono font-bold text-amber-300">
                      {projectId || "Default"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Authoritative Directory:</span>
                    <span
                      className="font-mono text-neutral-300 truncate max-w-[320px]"
                      title={handoffData?.authoritativeDir}
                    >
                      {handoffData?.authoritativeDir || "Sources/"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Canvas Resolution:</span>
                    <span className="font-mono text-neutral-200">1920 × 1080 (16:9 Full HD)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Project Frame Rate:</span>
                    <span className="font-mono text-neutral-200">30.00 fps</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Current Timeline Duration:</span>
                    <span className="font-mono font-semibold text-neutral-100">
                      {duration > 0 ? `${duration.toFixed(3)}s (${totalFrames} frames)` : "—"}
                    </span>
                  </div>
                </div>

                {/* Narration Audio Details */}
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-neutral-200 flex items-center gap-1.5">
                      <span>Narration Audio Probe</span>
                      {handoffData?.audio?.fileName && (
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[10px] font-mono text-emerald-300">
                          {handoffData.audio.fileName}
                        </span>
                      )}
                    </span>
                    {handoffData?.audio?.frameEndpoint && (
                      <span className="font-mono text-[11px] text-neutral-400">
                        {handoffData.audio.codec} • {handoffData.audio.sampleRate}Hz •{" "}
                        {handoffData.audio.channels === 2 ? "Stereo" : "Mono"}
                      </span>
                    )}
                  </div>

                  {handoffData?.audio?.frameEndpoint ? (
                    <div className="space-y-1.5 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-400">Raw Audio Length:</span>
                        <span className="font-mono text-neutral-200">
                          {handoffData.audio.durationSeconds?.toFixed(3)}s
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-400">Frame-Aligned Ceiling (30fps):</span>
                        <span className="font-mono font-semibold text-emerald-300">
                          {handoffData.audio.frameEndpoint.frameAlignedSeconds.toFixed(3)}s (
                          {handoffData.audio.frameEndpoint.ceilingFrames}f)
                        </span>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-neutral-400">Timeline Sync Status:</span>
                        <span className="flex items-center gap-1 font-semibold">
                          {Math.abs(
                            duration - handoffData.audio.frameEndpoint.frameAlignedSeconds,
                          ) <= 0.05 ? (
                            <span className="text-emerald-400 flex items-center gap-1">
                              <CheckCircle size={14} weight="fill" />
                              <span>Timeline is frame-aligned with narration</span>
                            </span>
                          ) : (
                            <span className="text-amber-400 flex items-center gap-1">
                              <XCircle size={14} weight="fill" />
                              <span>
                                Difference:{" "}
                                {(
                                  duration - handoffData.audio.frameEndpoint.frameAlignedSeconds
                                ).toFixed(3)}
                                s
                              </span>
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-neutral-500 italic">
                      No narration audio file detected in Audio/ folder. Place a master .mp3 or .wav
                      file to automatically lock timeline length.
                    </p>
                  )}

                  {/* Sync Duration Action Button */}
                  <div className="pt-2 border-t border-neutral-800 flex items-center justify-between">
                    <button
                      type="button"
                      data-testid="settings-sync-duration-button"
                      onClick={() => void handleSyncDuration()}
                      disabled={syncing || !handoffData?.audio?.frameEndpoint}
                      className="flex items-center gap-1.5 rounded-md bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Lightning size={14} weight="fill" />
                      <span>
                        {syncing ? "Syncing..." : "⚡ Sync Project Duration to Narration"}
                      </span>
                    </button>
                    {syncMessage && (
                      <span className="text-[10px] font-mono text-emerald-400">{syncMessage}</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 3. AI AGENT TAB */}
            {activeTab === "agent" && (
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800 pb-1.5">
                  AI Studio Assistant & Local CLI Configuration
                </h3>

                {/* CLI Detection Banner */}
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-neutral-200">Local CLI Session Status</span>
                    <button
                      type="button"
                      onClick={() => void checkCliAuth()}
                      disabled={checkingAuth}
                      className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-[11px] font-medium text-neutral-300 hover:bg-neutral-700 transition-colors cursor-pointer"
                    >
                      <ArrowClockwise size={12} className={checkingAuth ? "animate-spin" : ""} />
                      <span>{checkingAuth ? "Checking..." : "Re-check"}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center pt-1">
                    <div className="rounded bg-neutral-950 p-2 border border-neutral-800">
                      <div className="text-[10px] text-neutral-400 uppercase font-semibold">CLI Binary</div>
                      <div className="text-xs font-bold text-emerald-400 mt-0.5">
                        {cliAuthStatus.installed ? "✓ Installed" : "✗ Missing"}
                      </div>
                    </div>
                    <div className="rounded bg-neutral-950 p-2 border border-neutral-800">
                      <div className="text-[10px] text-neutral-400 uppercase font-semibold">Authentication</div>
                      <div className="text-xs font-bold text-emerald-400 mt-0.5">
                        {cliAuthStatus.authenticated ? "✓ Signed In" : "Local Session"}
                      </div>
                    </div>
                    <div className="rounded bg-neutral-950 p-2 border border-neutral-800">
                      <div className="text-[10px] text-neutral-400 uppercase font-semibold">Subscription Tier</div>
                      <div className="text-xs font-bold text-neutral-300 mt-0.5">Unknown Tier</div>
                    </div>
                  </div>

                  <p className="text-[10px] text-neutral-400">
                    Run <code className="rounded bg-neutral-950 px-1 py-0.5 font-mono text-amber-300">{cliAuthStatus.loginCommand}</code> in terminal to sign in with your active subscription or API token.
                  </p>
                </div>

                {/* Engine Picker */}
                <div className="space-y-1.5">
                  <label className="block font-semibold text-neutral-300">Target Agent Provider</label>
                  <select
                    value={engine}
                    onChange={(e) => setEngine(e.target.value as AssistantEngineId)}
                    className="w-full rounded border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200 outline-hidden font-medium"
                  >
                    <option value="codex">OpenAI Codex (gpt-5.6-luna / o3-mini)</option>
                    <option value="agy">Google Gemini AGY (gemini-4-argon-medium)</option>
                    <option value="claude">Anthropic Claude Code (claude-opus-5-5 / 3.7 sonnet)</option>
                    <option value="grok">xAI Grok (grok-4)</option>
                    <option value="opencode">OpenCode Multi-Agent</option>
                  </select>
                </div>

                {/* Model Picker */}
                <div className="space-y-1.5">
                  <label className="block font-semibold text-neutral-300">Model</label>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={DEFAULT_MODELS_BY_ENGINE[engine]}
                    className="w-full rounded border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200 outline-hidden font-mono"
                  />
                </div>

                {/* Reasoning Effort */}
                <div className="space-y-1.5">
                  <label className="block font-semibold text-neutral-300">Reasoning Effort</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["low", "medium", "high"] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setEffort(lvl)}
                        className={`rounded-lg py-1.5 text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                          effort === lvl
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            : "bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800"
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* WebMCP Tool Exposure */}
                <div className="flex items-center justify-between py-1 border-t border-neutral-900 pt-2">
                  <div>
                    <span className="font-semibold text-neutral-200">Expose WebMCP Browser Tools</span>
                    <p className="text-[11px] text-neutral-400">
                      Allows connected agents to inspect project elements, layers, and layout safely
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={webMcpEnabled}
                    onChange={(e) => handleToggleWebMcp(e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-amber-500 focus:ring-0 cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* 4. SHORTCUTS TAB */}
            {activeTab === "shortcuts" && (
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800 pb-1.5">
                  Keyboard Shortcuts & Editing Cheat Sheet
                </h3>

                <div className="divide-y divide-neutral-900 text-[11px]">
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-neutral-300">Play / Pause Timeline</span>
                    <kbd className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[10px] text-neutral-200">
                      Space
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-neutral-300">Split Clip at Playhead</span>
                    <kbd className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[10px] text-neutral-200">
                      S
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-neutral-300">Toggle Magnetic Snapping</span>
                    <kbd className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[10px] text-neutral-200">
                      N
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-neutral-300">Add / Remove Keyframe Diamond</span>
                    <kbd className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[10px] text-neutral-200">
                      K
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-neutral-300">Reverse Shuttle / Pause / Forward</span>
                    <div className="flex items-center gap-1 font-mono text-[10px]">
                      <kbd className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200">J</kbd>
                      <kbd className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200">K</kbd>
                      <kbd className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200">L</kbd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-neutral-300">Zoom to Fit Entire Timeline</span>
                    <kbd className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[10px] text-neutral-200">
                      Shift + Z
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-neutral-300">Undo / Redo Edit</span>
                    <div className="flex items-center gap-1 font-mono text-[10px]">
                      <kbd className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200">⌘Z</kbd>
                      <span className="text-neutral-500">/</span>
                      <kbd className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-neutral-200">⌘⇧Z</kbd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-neutral-300">Exact Canvas Rotation</span>
                    <span className="text-neutral-400 font-mono text-[10px]">
                      Type 0, 90, 180 + Enter
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-neutral-300">Open Studio Preferences</span>
                    <kbd className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[10px] text-neutral-200">
                      ⌘,
                    </kbd>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-neutral-800 bg-neutral-900/60 px-5 py-2.5 shrink-0">
          <span className="text-[11px] text-neutral-500 flex items-center gap-1">
            <Sparkle size={13} className="text-amber-400" />
            <span>HyperFrames Custom Studio 2.0</span>
          </span>
          <button
            type="button"
            data-testid="btn-done-settings"
            onClick={onClose}
            className="rounded-lg bg-neutral-800 hover:bg-neutral-700 px-4 py-1.5 text-xs font-semibold text-neutral-200 transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
});
