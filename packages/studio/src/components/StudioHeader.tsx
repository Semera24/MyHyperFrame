import { memo, useCallback, useContext, useEffect, useRef, useState, type MouseEvent } from "react";
import { Camera, ChevronDown } from "../icons/SystemIcons";
import { useStudioShellContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { usePlayerStore } from "../player";
import { buildProjectApiPath } from "../utils/projectRouting";
import { studioApiFetch } from "../utils/studioApiFetch";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { Button, buttonBase, buttonSizes, buttonVariants, cn, Tooltip } from "./ui";
import { Dock } from "./dock/Dock";
import { InspectorIcon } from "./icons/InspectorIcon";
import { OpenInDesktopButton } from "./OpenInDesktopButton";
import { HyperframesLogo } from "./ui/HyperframesLogo";
import { ShowThemeToggle, ThemeToggle } from "./ThemeToggle";
import { TemplatesModal } from "./templates/TemplatesModal";
import { CreateEpisodeModal } from "./projects/CreateEpisodeModal";

interface StudioHeaderProps {
  captureFrameHref: string;
  captureFrameFilename: string;
  handleCaptureFrameClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  refreshCaptureFrameTime: () => void;
  capturing?: boolean;
  inspectorButtonActive: boolean;
  inspectorPanelActive: boolean;
  onExport?: () => void;
}

/**
 * Does the header's Inspector button open the panel, or close it?
 *
 * The dock has no separate "railed by window width" state (it shrinks panels,
 * never auto-hides the group), so `rightCollapsed` here is already the state
 * that decides whether the panel is actually showing.
 */
export function shouldOpenInspector(
  rightCollapsed: boolean,
  inspectorPanelActive: boolean,
): boolean {
  return rightCollapsed || !inspectorPanelActive;
}

// fallow-ignore-next-line complexity
export const StudioHeader = memo(function StudioHeader({
  captureFrameHref,
  captureFrameFilename,
  handleCaptureFrameClick,
  refreshCaptureFrameTime,
  capturing,
  inspectorButtonActive,
  inspectorPanelActive,
  onExport,
}: StudioHeaderProps) {
  const showThemeToggle = useContext(ShowThemeToggle);
  const shell = useStudioShellContext();
  const { projectId, renderQueue } = shell;
  const activeCompPath = shell.activeCompPath;
  const { rightCollapsed, setRightCollapsed, rightPanelTab, setRightPanelTab } =
    usePanelLayoutContext();
  const duration = usePlayerStore((s) => s.duration);
  const [projectMeta, setProjectMeta] = useState<{
    realDir?: string;
    isAuthoritative?: boolean;
  } | null>(null);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [episodesList, setEpisodesList] = useState<
    Array<{
      id: string;
      title?: string;
      realDir?: string;
      isAuthoritative?: boolean;
      channel?: string;
      sceneCount?: number;
      hasDraftRender?: boolean;
    }>
  >([]);
  const [exportingToEpisode, setExportingToEpisode] = useState(false);
  const [exportedDraftStatus, setExportedDraftStatus] = useState<string | null>(null);
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [createEpisodeModalOpen, setCreateEpisodeModalOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const isRendering = renderQueue.isRendering;
  const ffmpegMissing = renderQueue.ffmpegMissing;

  const fetchProjectsList = useCallback(() => {
    try {
      studioApiFetch("/api/projects")
        .then((res) => (res && res.ok ? res.json() : null))
        .then((data: { projects?: typeof episodesList } | null) => {
          if (data && Array.isArray(data.projects)) {
            setEpisodesList(data.projects);
          }
        })
        .catch(() => {});
    } catch {
      // Ignore in test environments without fetch
    }
  }, []);

  useEffect(() => {
    fetchProjectsList();
  }, [fetchProjectsList, projectId]);

  useEffect(() => {
    if (!episodesOpen) return;
    const handlePointerDown = (e: globalThis.MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setEpisodesOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEpisodesOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [episodesOpen]);

  const handleExportToEpisodeRenders = useCallback(async () => {
    if (!projectId || exportingToEpisode) return;
    setExportingToEpisode(true);
    setExportedDraftStatus(null);
    try {
      const res = await studioApiFetch(
        buildProjectApiPath(projectId, "/renders/export-to-episode"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (res && res.ok) {
        const data = (await res.json()) as { relativeDraftPath?: string };
        setExportedDraftStatus(data.relativeDraftPath || `Renders/${projectId}_Draft.mp4`);
        fetchProjectsList();
        setTimeout(() => setExportedDraftStatus(null), 5000);
      } else {
        // No completed render yet — open Renders panel and start Export (which auto-copies on completion)
        setRightPanelTab("renders");
        setRightCollapsed(false);
        if (!ffmpegMissing && !isRendering) {
          onExport?.();
        }
      }
    } catch {
      // ignore
    } finally {
      setExportingToEpisode(false);
    }
  }, [
    projectId,
    exportingToEpisode,
    fetchProjectsList,
    setRightPanelTab,
    setRightCollapsed,
    ffmpegMissing,
    isRendering,
    onExport,
  ]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    try {
      studioApiFetch(buildProjectApiPath(projectId, ""))
        .then((res) => (res && res.ok ? res.json() : null))
        .then((data: { realDir?: string; isAuthoritative?: boolean } | null) => {
          if (cancelled || !data) return;
          setProjectMeta({
            realDir: data.realDir,
            isAuthoritative: data.isAuthoritative,
          });
        })
        .catch(() => {});
    } catch {
      // Ignore in test environments without fetch
    }
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const totalFrames = duration > 0 ? Math.round(duration * 30) : 0;

  return (
    <div className="flex items-center justify-between h-10 px-3 bg-surface border-b border-border-strong shrink-0">
      {/* Left: logo + project name + episode context badges */}
      <div className="flex items-center gap-2.5 min-w-0">
        <HyperframesLogo />
        <span className="text-text-5 select-none" aria-hidden="true">
          |
        </span>
        <div ref={switcherRef} className="relative">
          <button
            type="button"
            data-testid="episode-switcher"
            onClick={() => {
              if (!episodesOpen) fetchProjectsList();
              setEpisodesOpen((prev) => !prev);
            }}
            className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-bg-2 border border-transparent hover:border-border-strong transition-colors text-step-11 font-semibold text-text-1 max-w-[280px]"
            title="Click to switch between ProductionStudio episodes"
          >
            <span className="truncate">{projectId}</span>
            <ChevronDown size={11} className="text-text-3 shrink-0" />
          </button>
          {episodesOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-80 max-h-96 overflow-y-auto rounded-md bg-surface border border-border-strong shadow-xl z-[250] p-1.5 flex flex-col gap-1">
              <div className="flex items-center justify-between px-2 py-1 border-b border-border">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
                  ProductionStudio Episodes
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fetchProjectsList();
                  }}
                  className="text-[10px] text-accent hover:underline"
                >
                  ↻ Refresh
                </button>
              </div>
              {episodesList.filter((ep) => ep.isAuthoritative).length > 0 ? (
                episodesList
                  .filter((ep) => ep.isAuthoritative)
                  .map((ep) => {
                    const isCurrent = ep.id === projectId;
                    const epBadge = ep.id.match(/^(EP\d+)/i)?.[1]?.toUpperCase() || "EP";
                    return (
                      <button
                        key={ep.id}
                        type="button"
                        onClick={() => {
                          setEpisodesOpen(false);
                          if (ep.id !== projectId) {
                            window.location.assign(`/?project=${encodeURIComponent(ep.id)}`);
                          }
                        }}
                        className={cn(
                          "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left transition-colors",
                          isCurrent
                            ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
                            : "hover:bg-bg-2 text-text-1 border border-transparent",
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="px-1.5 py-0.5 rounded bg-bg-3 font-mono text-[10px] font-bold text-emerald-300 shrink-0">
                            {epBadge}
                          </span>
                          <div className="flex flex-col min-w-0">
                            <span className="text-[11px] font-semibold truncate">{ep.id}</span>
                            <span className="text-[10px] text-text-4 truncate">
                              {ep.channel || "Turning_Point_Stories"}
                              {ep.sceneCount ? ` · ${ep.sceneCount} scenes` : ""}
                              {ep.hasDraftRender ? " · Draft MP4 ✓" : ""}
                            </span>
                          </div>
                        </div>
                        {isCurrent && (
                          <span className="text-emerald-400 text-xs font-bold shrink-0">✓</span>
                        )}
                      </button>
                    );
                  })
              ) : (
                <div className="px-2 py-2 text-[11px] text-text-4">
                  No ProductionStudio episodes found.
                </div>
              )}
              {episodesList.some((ep) => !ep.isAuthoritative) && (
                <>
                  <div className="px-2 pt-1.5 pb-0.5 border-t border-border text-[10px] font-semibold uppercase tracking-wider text-text-4">
                    Other Projects
                  </div>
                  {episodesList
                    .filter((ep) => !ep.isAuthoritative)
                    .map((ep) => {
                      const isCurrent = ep.id === projectId;
                      return (
                        <button
                          key={ep.id}
                          type="button"
                          onClick={() => {
                            setEpisodesOpen(false);
                            if (ep.id !== projectId) {
                              window.location.assign(`/?project=${encodeURIComponent(ep.id)}`);
                            }
                          }}
                          className={cn(
                            "w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-[11px] transition-colors",
                            isCurrent
                              ? "bg-accent/15 text-accent font-semibold"
                              : "hover:bg-bg-2 text-text-2",
                          )}
                        >
                          <span className="truncate">{ep.id}</span>
                          {isCurrent && <span className="text-xs font-bold">✓</span>}
                        </button>
                      );
                    })}
                </>
              )}
              <div className="pt-1.5 border-t border-border mt-1">
                <button
                  type="button"
                  data-testid="create-new-episode-button"
                  onClick={() => {
                    setEpisodesOpen(false);
                    setCreateEpisodeModalOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold transition-all cursor-pointer"
                >
                  <span>＋ New Episode from Studio Template</span>
                </button>
              </div>
            </div>
          )}
        </div>
        {activeCompPath && activeCompPath !== "index.html" && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-text-4 text-xs font-mono">/</span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 font-mono text-[11px] font-bold text-emerald-300">
              {activeCompPath
                .replace(/^compositions\//, "")
                .replace(/\.html$/, "")
                .toUpperCase()}
            </span>
            <button
              type="button"
              data-testid="header-back-to-master"
              onClick={() => shell.setActiveCompPath(null)}
              className="px-2 py-0.5 rounded bg-bg-2 hover:bg-emerald-500/20 border border-border-strong hover:border-emerald-500/40 font-mono text-[10px] font-semibold text-emerald-300 transition-colors"
              title="Return to root Master timeline (index.html)"
            >
              [← Master]
            </button>
          </div>
        )}
        <span
          className="px-1.5 py-0.5 rounded bg-bg-2 border border-border-strong font-mono text-[10px] text-text-2"
          title="Active composition file"
        >
          {activeCompPath || "index.html"}
        </span>
        {duration > 0 && (
          <span
            className="px-1.5 py-0.5 rounded bg-bg-2 border border-border-strong font-mono text-[10px] tabular-nums text-text-2"
            title="Authoritative composition duration and 30fps frame count"
          >
            {duration.toFixed(2)}s · {totalFrames.toLocaleString()}f
          </span>
        )}
        {projectMeta?.realDir && (
          <Tooltip label={`Workspace: ${projectMeta.realDir}`} side="bottom">
            <span
              className={cn(
                "px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold uppercase tracking-wide border select-none",
                projectMeta.isAuthoritative
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30",
              )}
            >
              {projectMeta.isAuthoritative ? "AUTHORITATIVE" : "NON-AUTH"}
            </span>
          </Tooltip>
        )}
      </div>
      {/* Right: toolbar buttons */}
      <div className="flex items-center gap-3">
        <div className="flex h-ctl items-center divide-x divide-border-strong overflow-hidden rounded-md border border-border-strong bg-bg-2">
          <Tooltip label={capturing ? "Capturing frame…" : "Capture current frame"} side="bottom">
            {/* A real download link, so it wears Button's recipe rather than being
              one: `download` on an <a> is what saves the frame, and no <button>
              can do that. `enabled:` never matches a link, so the ghost
              variant's hover look is repeated unprefixed here. */}
            <a
              href={captureFrameHref}
              download={captureFrameFilename}
              onClick={(e) => {
                if (capturing) {
                  e.preventDefault();
                  return;
                }
                trackStudioEvent("toolbar_action", { action: "capture_frame" });
                handleCaptureFrameClick(e);
              }}
              onFocus={refreshCaptureFrameTime}
              onPointerDown={refreshCaptureFrameTime}
              aria-disabled={capturing || undefined}
              className={cn(
                buttonBase,
                buttonVariants.ghost,
                buttonSizes.md,
                "h-full rounded-none max-[1000px]:px-2",
                capturing
                  ? "text-text-4 cursor-default"
                  : "hover:bg-hover hover:text-text-0 active:scale-[0.98]",
              )}
              aria-label={capturing ? "Capturing frame" : "Capture current frame"}
            >
              {capturing ? (
                <svg
                  className="animate-spin motion-reduce:animate-none h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              ) : (
                <Camera size={14} />
              )}
              <span className="max-[1000px]:hidden">{capturing ? "Capturing…" : "Capture"}</span>
            </a>
          </Tooltip>
          <Tooltip label="Inspector" side="bottom">
            <Button
              variant="ghost"
              aria-label="Inspector"
              aria-pressed={inspectorButtonActive}
              className={cn(
                "h-full rounded-none",
                inspectorButtonActive &&
                  "bg-on text-accent-ink enabled:hover:bg-on-hover enabled:hover:text-accent-ink",
              )}
              icon={<InspectorIcon size={16} />}
              onClick={() => {
                if (shouldOpenInspector(rightCollapsed, inspectorPanelActive)) {
                  trackStudioEvent("panel_toggle", { panel: "inspector", collapsed: false });
                  setRightPanelTab("design");
                  setRightCollapsed(false);
                  return;
                }
                trackStudioEvent("panel_toggle", { panel: "inspector", collapsed: true });
                // Keep the current selection when collapsing the Inspector — closing
                // the panel shouldn't deselect the element.
                setRightCollapsed(true);
              }}
            >
              Inspector
            </Button>
          </Tooltip>
          <Tooltip label="AI Agent & 22 Skills Assistant" side="bottom">
            <Button
              variant="ghost"
              aria-label="Assistant"
              aria-pressed={!rightCollapsed && rightPanelTab === "assistant"}
              className={cn(
                "h-full rounded-none",
                !rightCollapsed &&
                  rightPanelTab === "assistant" &&
                  "bg-on text-accent-ink enabled:hover:bg-on-hover enabled:hover:text-accent-ink",
              )}
              onClick={() => {
                setRightPanelTab("assistant");
                setRightCollapsed(false);
              }}
            >
              🤖 Assistant
            </Button>
          </Tooltip>
          <Tooltip
            label="3 Master Video Templates (Hero Split, Map Route, Archival Ledger)"
            side="bottom"
          >
            <Button
              variant="ghost"
              data-testid="header-templates-button"
              aria-label="Master Templates"
              onClick={() => setTemplatesModalOpen(true)}
              className="h-full rounded-none text-amber-300 font-semibold hover:text-amber-200"
            >
              📋 Templates
            </Button>
          </Tooltip>
        </div>
        {showThemeToggle && <ThemeToggle />}
        <Dock.WindowMenu />
        <OpenInDesktopButton />
        <Tooltip
          label={
            exportedDraftStatus
              ? `Copied to ${exportedDraftStatus}! episode-status.py & quick-qc.py are updated.`
              : `1-Click copy latest MP4 to Episodes/${projectId}/Renders/${projectId}_Draft.mp4`
          }
          side="bottom"
        >
          <Button
            variant="secondary"
            data-testid="header-export-episode-renders"
            disabled={exportingToEpisode}
            onClick={() => void handleExportToEpisodeRenders()}
            className={cn(
              exportedDraftStatus && "border-emerald-500/50 bg-emerald-500/15 text-emerald-300",
            )}
          >
            {exportingToEpisode
              ? "Copying…"
              : exportedDraftStatus
                ? "✓ In Renders/"
                : "→ Episode Renders/"}
          </Button>
        </Tooltip>
        <Tooltip
          label={
            ffmpegMissing
              ? "FFmpeg is not installed. Opens the Renders panel with the install command."
              : isRendering
                ? "A render is already in progress"
                : `Render & auto-copy to Episodes/${projectId}/Renders/${projectId}_Draft.mp4`
          }
          side="bottom"
        >
          <Button
            variant="primary"
            data-testid="header-export"
            disabled={isRendering}
            onClick={() => {
              if (isRendering) return;
              setRightPanelTab("renders");
              setRightCollapsed(false);
              // Without an encoder this render cannot finish, so the click
              // delivers the user to the prompt that fixes it instead of
              // queueing a job that exists only to fail. Disabling the button
              // would leave them staring at a dead control with no route to
              // the explanation.
              if (ffmpegMissing) return;
              onExport?.();
            }}
          >
            {isRendering ? "Rendering…" : "Export"}
          </Button>
        </Tooltip>
      </div>

      {/* 3 Master Templates Cloner Modal */}
      <TemplatesModal
        projectId={projectId}
        isOpen={templatesModalOpen}
        onClose={() => setTemplatesModalOpen(false)}
        onSceneCreated={() => {
          shell.reloadPreview();
        }}
      />

      {/* New Episode Scaffold Modal */}
      <CreateEpisodeModal
        isOpen={createEpisodeModalOpen}
        onClose={() => setCreateEpisodeModalOpen(false)}
      />
    </div>
  );
});
