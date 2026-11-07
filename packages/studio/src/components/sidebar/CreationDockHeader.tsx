import { memo, useMemo } from "react";
import { useDockLayoutStore } from "../dock/dockLayoutStore";
import type { PanelId } from "../dock/panelRegistry";

export interface CreationCategory {
  id: PanelId;
  label: string;
  icon: string;
  description: string;
}

export const CREATION_CATEGORIES: CreationCategory[] = [
  { id: "compositions", label: "Media", icon: "📁", description: "Scene clips & assets" },
  { id: "audio", label: "Audio", icon: "🎵", description: "Voiceover, music & SFX" },
  { id: "text", label: "Text", icon: "🔤", description: "Titles, quotes & lower thirds" },
  { id: "motion", label: "Motion", icon: "✨", description: "Entrance, emphasis & exit effects" },
  {
    id: "transitions",
    label: "Transitions",
    icon: "🔀",
    description: "Dissolves, wipes & scene cuts",
  },
  { id: "catalog", label: "Templates", icon: "📦", description: "Blocks & templates" },
];

export const CreationDockHeader = memo(function CreationDockHeader({
  activePanelId,
}: {
  activePanelId?: PanelId;
}) {
  const activatePanel = useDockLayoutStore((s) => s.activatePanel);
  const activePanelFromStore = useDockLayoutStore((s) => s.activePanel);
  const activeGroupPanels = useDockLayoutStore((s) => s.groupActivePanels ?? []);

  const currentActiveId = useMemo(() => {
    if (activePanelId) return activePanelId;
    const match = CREATION_CATEGORIES.find((cat) => activeGroupPanels.includes(cat.id));
    return match?.id || activePanelFromStore || "compositions";
  }, [activePanelId, activeGroupPanels, activePanelFromStore]);

  return (
    <div
      data-testid="creation-dock-header"
      className="flex items-center gap-1 border-b border-neutral-800 bg-neutral-950 px-2 py-1.5 shrink-0 overflow-x-auto select-none scrollbar-none"
    >
      {CREATION_CATEGORIES.map((cat) => {
        const isActive = currentActiveId === cat.id;
        return (
          <button
            key={cat.id}
            type="button"
            data-testid={`creation-tab-${cat.id}`}
            onClick={() => activatePanel(cat.id)}
            title={cat.description}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all whitespace-nowrap cursor-pointer ${
              isActive
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm"
                : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 border border-transparent"
            }`}
          >
            <span className="text-xs">{cat.icon}</span>
            <span>{cat.label}</span>
          </button>
        );
      })}
    </div>
  );
});
