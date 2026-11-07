import { memo, useMemo, type ReactNode } from "react";
import {
  ArrowsLeftRight,
  FilmStrip,
  Sparkle,
  SquaresFour,
  TextT,
  Waveform,
} from "@phosphor-icons/react";
import { useDockLayoutStore } from "../dock/dockLayoutStore";
import type { PanelId } from "../dock/panelRegistry";
import { Tooltip } from "../ui/Tooltip";

export interface CreationCategory {
  id: PanelId;
  label: string;
  icon: ReactNode;
  description: string;
}

export const CREATION_CATEGORIES: CreationCategory[] = [
  {
    id: "compositions",
    label: "Media",
    icon: <FilmStrip size={15} weight="duotone" aria-hidden="true" />,
    description: "Scene clips & assets",
  },
  {
    id: "audio",
    label: "Audio",
    icon: <Waveform size={15} weight="bold" aria-hidden="true" />,
    description: "Voiceover, music & SFX",
  },
  {
    id: "text",
    label: "Text",
    icon: <TextT size={15} weight="bold" aria-hidden="true" />,
    description: "Titles, quotes & lower thirds",
  },
  {
    id: "motion",
    label: "Motion",
    icon: <Sparkle size={15} weight="fill" aria-hidden="true" />,
    description: "Entrance, emphasis & exit effects",
  },
  {
    id: "transitions",
    label: "Transitions",
    icon: <ArrowsLeftRight size={15} weight="bold" aria-hidden="true" />,
    description: "Dissolves, wipes & scene cuts",
  },
  {
    id: "catalog",
    label: "Templates",
    icon: <SquaresFour size={15} weight="duotone" aria-hidden="true" />,
    description: "Blocks & templates",
  },
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
      role="tablist"
      aria-label="Creation categories"
      className="grid grid-cols-6 gap-1 border-b border-neutral-800 bg-neutral-950 px-1.5 py-1.5 shrink-0 select-none overflow-hidden"
    >
      {CREATION_CATEGORIES.map((cat) => {
        const isActive = currentActiveId === cat.id;
        return (
          <Tooltip key={cat.id} label={`${cat.label} — ${cat.description}`}>
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`creation-tab-${cat.id}`}
              onClick={() => activatePanel(cat.id)}
              title={`${cat.label} — ${cat.description}`}
              className={`flex flex-col items-center justify-center gap-0.5 py-1 px-0.5 rounded-md text-[10px] leading-tight font-medium transition-all min-w-0 cursor-pointer ${
                isActive
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold"
                  : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 border border-transparent"
              }`}
            >
              {cat.icon}
              <span className="truncate max-w-full tracking-tight">{cat.label}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
});
