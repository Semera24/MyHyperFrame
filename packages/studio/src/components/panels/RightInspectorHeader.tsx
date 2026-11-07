import { memo, useEffect, useRef, useState } from "react";
import { CaretDown, Robot, Sliders, Stack } from "@phosphor-icons/react";
import { useDockLayoutStore } from "../dock/dockLayoutStore";
import type { PanelId } from "../dock/panelRegistry";

export interface RightInspectorHeaderProps {
  activePanelId: PanelId;
  renderCount?: number;
}

const SECONDARY_RIGHT_PANELS: {
  id: PanelId;
  label: string;
  hint: string;
}[] = [
  { id: "layers", label: "Layers", hint: "Scene layer stack & ordering" },
  { id: "handoff", label: "Handoff", hint: "Episode QC & handoff checklist" },
  { id: "renders", label: "Renders", hint: "MP4 export & render queue" },
  { id: "variables", label: "Variables", hint: "Composition parameters" },
  { id: "motionBlur", label: "Motion Blur", hint: "Shutter angle & samples" },
];

export const RightInspectorHeader = memo(function RightInspectorHeader({
  activePanelId,
  renderCount = 0,
}: RightInspectorHeaderProps) {
  const activatePanel = useDockLayoutStore((s) => s.activatePanel);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const isInspectorActive = activePanelId === "design";
  const isAssistantActive = activePanelId === "assistant";
  const activeSecondary = SECONDARY_RIGHT_PANELS.find((p) => p.id === activePanelId);

  return (
    <div
      data-testid="right-inspector-header"
      className="flex items-center justify-between gap-1 border-b border-neutral-800 bg-neutral-950 px-2.5 py-1.5 shrink-0 select-none"
    >
      {/* Primary Inspector Button */}
      <button
        type="button"
        data-testid="right-tab-inspector"
        onClick={() => activatePanel("design")}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
          isInspectorActive
            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
            : "text-neutral-300 hover:text-white hover:bg-neutral-900 border border-transparent"
        }`}
      >
        <Sliders size={13} weight="bold" aria-hidden="true" />
        <span>Inspector</span>
      </button>

      {/* Secondary Panels Menu (Layers, Handoff, Renders) + Collapsible Assistant */}
      <div className="flex items-center gap-1">
        <div ref={menuRef} className="relative">
          <button
            type="button"
            data-testid="right-panels-menu-button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
              activeSecondary || menuOpen
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold"
                : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 border border-neutral-800"
            }`}
            title="Switch to Layers, Handoff, Renders, Variables, or Motion Blur"
          >
            <Stack size={12} weight="bold" aria-hidden="true" />
            <span>{activeSecondary ? activeSecondary.label : "Panels"}</span>
            {renderCount > 0 && !activeSecondary && (
              <span className="rounded-full bg-amber-500/25 px-1 text-[9px] font-mono text-amber-300">
                {renderCount}
              </span>
            )}
            <CaretDown size={10} weight="bold" aria-hidden="true" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              data-testid="right-panels-menu"
              className="absolute right-0 top-full mt-1.5 z-200 w-56 rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 shadow-xl text-xs"
            >
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                Workspace Panels
              </div>
              {SECONDARY_RIGHT_PANELS.map((panel) => {
                const isSelected = activePanelId === panel.id;
                const label =
                  panel.id === "renders" && renderCount > 0
                    ? `Renders (${renderCount})`
                    : panel.label;
                return (
                  <button
                    key={panel.id}
                    type="button"
                    role="menuitem"
                    data-testid={`right-menu-${panel.id}`}
                    onClick={() => {
                      activatePanel(panel.id);
                      setMenuOpen(false);
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? "bg-amber-500/20 text-amber-200 font-semibold"
                        : "text-neutral-200 hover:bg-neutral-800"
                    }`}
                  >
                    <div>
                      <div>{label}</div>
                      <div className="text-[10px] text-neutral-500">{panel.hint}</div>
                    </div>
                    {isSelected && <span className="text-amber-300 text-[11px]">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Collapsible Assistant Button (collapsed by default) */}
        <button
          type="button"
          data-testid="right-tab-assistant"
          aria-pressed={isAssistantActive}
          onClick={() => activatePanel(isAssistantActive ? "design" : "assistant")}
          title={
            isAssistantActive
              ? "Collapse AI Assistant and return to Inspector"
              : "Open AI Assistant"
          }
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
            isAssistantActive
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold"
              : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 border border-neutral-800"
          }`}
        >
          <Robot size={13} weight="bold" aria-hidden="true" />
          <span>Assistant</span>
        </button>
      </div>
    </div>
  );
});
