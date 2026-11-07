import { memo, useCallback, useEffect, useState } from "react";
import { usePlayerStore } from "../../player";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { studioApiFetch } from "../../utils/studioApiFetch";
import { LayersPanel } from "../editor/LayersPanel";

export interface ProjectSettingsInspectorProps {
  projectId: string | null;
  projectDir?: string | null;
  activeCompPath: string | null;
  onOpenAssistant?: () => void;
}

export const ProjectSettingsInspector = memo(function ProjectSettingsInspector({
  projectId,
  projectDir,
  activeCompPath,
  onOpenAssistant,
}: ProjectSettingsInspectorProps) {
  const duration = usePlayerStore((s) => s.duration);
  const elements = usePlayerStore((s) => s.elements);
  const [meta, setMeta] = useState<{
    realDir?: string;
    isAuthoritative?: boolean;
    channel?: string;
    sceneCount?: number;
  } | null>(null);
  const [layersExpanded, setLayersExpanded] = useState(true);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    try {
      studioApiFetch(buildProjectApiPath(projectId, ""))
        .then((res) => (res && res.ok ? res.json() : null))
        .then(
          (
            data: {
              realDir?: string;
              isAuthoritative?: boolean;
              channel?: string;
              sceneCount?: number;
            } | null,
          ) => {
            if (!cancelled && data) setMeta(data);
          },
        )
        .catch(() => {});
    } catch {
      // Ignore in non-network test environments
    }
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleCopyDraftToRenders = useCallback(async () => {
    if (!projectId) return;
    setCopyStatus("Copying...");
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
        setCopyStatus(`Copied → ${data.relativeDraftPath || "Renders/"}`);
      } else {
        setCopyStatus("Run Export first to generate MP4");
      }
    } catch {
      setCopyStatus("Failed to copy render");
    }
    setTimeout(() => setCopyStatus(null), 4000);
  }, [projectId]);

  const totalFrames = duration > 0 ? Math.round(duration * 30) : 0;
  const savedLocation = meta?.realDir || projectDir || `episodes/${projectId ?? "project"}/Sources`;

  return (
    <div
      data-testid="project-settings-inspector"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-panel-bg text-panel-text-1 select-none"
    >
      {/* CapCut-style Details / Project Settings header */}
      <div className="flex items-center justify-between border-b border-panel-hairline px-4 py-2.5 shrink-0">
        <span className="text-xs font-semibold tracking-wide text-accent-ink">
          Project Settings
        </span>
        {onOpenAssistant && (
          <button
            type="button"
            data-testid="inspector-open-assistant-button"
            onClick={onOpenAssistant}
            className="rounded border border-panel-border bg-panel-bg-subtle px-2 py-0.5 text-[10px] font-medium text-panel-text-2 hover:bg-hover hover:text-panel-text-0 transition-colors cursor-pointer"
            title="Open collapsible AI Assistant panel"
          >
            Assistant
          </button>
        )}
      </div>

      {/* Project Details Table */}
      <div className="border-b border-panel-hairline px-4 py-3 space-y-2 text-[11px] shrink-0">
        <div className="grid grid-cols-[100px_1fr] items-baseline gap-2">
          <span className="text-panel-text-3">Name:</span>
          <span
            data-testid="project-settings-name"
            className="font-semibold text-panel-text-0 truncate"
          >
            {projectId || "Untitled"}
          </span>
        </div>

        <div className="grid grid-cols-[100px_1fr] items-baseline gap-2">
          <span className="text-panel-text-3">Location:</span>
          <span
            className="font-mono text-[10px] text-panel-text-2 break-all line-clamp-2"
            title={savedLocation}
          >
            {savedLocation}
          </span>
        </div>

        <div className="grid grid-cols-[100px_1fr] items-baseline gap-2">
          <span className="text-panel-text-3">Composition:</span>
          <span className="font-mono text-[10.5px] text-panel-text-1 truncate">
            {activeCompPath || "index.html"}
          </span>
        </div>

        <div className="h-px bg-panel-hairline my-1.5" />

        <div className="grid grid-cols-[100px_1fr] items-baseline gap-2">
          <span className="text-panel-text-3">Resolution:</span>
          <span className="font-mono text-panel-text-1">1920 × 1080</span>
        </div>

        <div className="grid grid-cols-[100px_1fr] items-baseline gap-2">
          <span className="text-panel-text-3">Aspect ratio:</span>
          <span className="font-mono text-panel-text-1">16:9</span>
        </div>

        <div className="grid grid-cols-[100px_1fr] items-baseline gap-2">
          <span className="text-panel-text-3">Frame rate:</span>
          <span className="font-mono text-panel-text-1">30.00 fps</span>
        </div>

        <div className="grid grid-cols-[100px_1fr] items-baseline gap-2">
          <span className="text-panel-text-3">Duration:</span>
          <span className="font-mono text-panel-text-1 tabular-nums">
            {duration > 0 ? `${duration.toFixed(2)}s (${totalFrames}f)` : "—"}
          </span>
        </div>

        <div className="grid grid-cols-[100px_1fr] items-baseline gap-2">
          <span className="text-panel-text-3">Color space:</span>
          <span className="font-mono text-panel-text-1">Rec. 709</span>
        </div>

        <div className="grid grid-cols-[100px_1fr] items-baseline gap-2">
          <span className="text-panel-text-3">Free layer:</span>
          <span className="text-emerald-300 font-medium">Turned on</span>
        </div>

        {meta?.isAuthoritative && (
          <div className="pt-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400/90">
              Authoritative Episode
            </span>
            <button
              type="button"
              onClick={() => void handleCopyDraftToRenders()}
              className="rounded border border-panel-border bg-panel-bg-subtle px-2 py-0.5 text-[10px] font-medium text-panel-text-2 hover:bg-hover hover:text-panel-text-0 transition-colors cursor-pointer"
              title="Copy latest rendered MP4 to episode Renders/ folder"
            >
              {copyStatus || "Copy Draft to Renders/"}
            </button>
          </div>
        )}
      </div>

      {/* Collapsible Scene Layers Browser */}
      <div className="flex items-center justify-between border-b border-panel-hairline px-4 py-2 shrink-0">
        <button
          type="button"
          onClick={() => setLayersExpanded((prev) => !prev)}
          className="flex w-full items-center justify-between text-left text-[11px] font-semibold text-panel-text-2 hover:text-panel-text-0 cursor-pointer"
        >
          <span>Scene Layers ({elements.length})</span>
          <span className="font-mono text-[10px] text-panel-text-3">
            {layersExpanded ? "▾" : "▸"}
          </span>
        </button>
      </div>
      {layersExpanded && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <LayersPanel />
        </div>
      )}
    </div>
  );
});
