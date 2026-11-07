import { memo, useState, useMemo, useCallback } from "react";
import { SearchInput } from "../ui/SearchInput";
import { useStudioShellContext } from "../../contexts/StudioContext";

export interface TextPreset {
  id: string;
  name: string;
  category: "title" | "subtitle" | "callout" | "lowerthird" | "label";
  previewText: string;
  defaultText: string;
  styleSnippet: Record<string, string>;
  fontFamily: string;
}

const TEXT_PRESETS: TextPreset[] = [
  {
    id: "text-title-bold",
    name: "Hero Title",
    category: "title",
    previewText: "THE TURNING POINT",
    defaultText: "THE TURNING POINT",
    fontFamily: "Cinzel, serif",
    styleSnippet: {
      fontSize: "48px",
      fontWeight: "800",
      letterSpacing: "0.15em",
      color: "#F8FAFC",
      textShadow: "0 4px 12px rgba(0,0,0,0.8)",
      textTransform: "uppercase",
    },
  },
  {
    id: "text-subtitle-serif",
    name: "Historical Subtitle",
    category: "subtitle",
    previewText: "October 14, 1066 • Hastings",
    defaultText: "October 14, 1066 • Hastings",
    fontFamily: "Georgia, serif",
    styleSnippet: {
      fontSize: "24px",
      fontStyle: "italic",
      color: "#CBD5E1",
      letterSpacing: "0.05em",
    },
  },
  {
    id: "text-callout-quote",
    name: "Narration Callout",
    category: "callout",
    previewText: "“History is a set of lies agreed upon.”",
    defaultText: "“History is a set of lies agreed upon.”",
    fontFamily: "Charter, serif",
    styleSnippet: {
      fontSize: "28px",
      lineHeight: "1.4",
      color: "#FEF3C7",
      backgroundColor: "rgba(15, 23, 42, 0.75)",
      padding: "16px 24px",
      borderRadius: "8px",
      borderLeft: "4px solid #F59E0B",
    },
  },
  {
    id: "text-lower-third",
    name: "Documentary Lower Third",
    category: "lowerthird",
    previewText: "NAPOLEON BONAPARTE\nEmperor of the French",
    defaultText: "NAPOLEON BONAPARTE\nEmperor of the French",
    fontFamily: "system-ui, -apple-system, sans-serif",
    styleSnippet: {
      fontSize: "22px",
      fontWeight: "700",
      color: "#FFFFFF",
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      padding: "10px 18px",
      borderRadius: "4px",
      borderLeft: "4px solid #38BDF8",
    },
  },
  {
    id: "text-date-locator",
    name: "Date & Location Tag",
    category: "label",
    previewText: "MEDITERRANEAN SEA • 180 AD",
    defaultText: "MEDITERRANEAN SEA • 180 AD",
    fontFamily: "ui-monospace, monospace",
    styleSnippet: {
      fontSize: "14px",
      fontWeight: "600",
      letterSpacing: "0.2em",
      color: "#94A3B8",
      backgroundColor: "rgba(30, 41, 59, 0.8)",
      padding: "6px 12px",
      borderRadius: "4px",
    },
  },
  {
    id: "text-metric-stat",
    name: "Big Metric / Stat",
    category: "callout",
    previewText: "300,000 SOLDIERS",
    defaultText: "300,000 SOLDIERS",
    fontFamily: "Impact, sans-serif",
    styleSnippet: {
      fontSize: "56px",
      fontWeight: "900",
      letterSpacing: "0.05em",
      color: "#EF4444",
      textShadow: "0 2px 8px rgba(0,0,0,0.9)",
    },
  },
];

export interface TextPresetsPanelProps {
  onAddText?: (text: string, style?: Record<string, string>) => void;
}

export const TextPresetsPanel = memo(function TextPresetsPanel({
  onAddText,
}: TextPresetsPanelProps) {
  const { showToast } = useStudioShellContext();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const filteredPresets = useMemo(() => {
    return TEXT_PRESETS.filter((preset) => {
      if (activeCategory !== "all" && preset.category !== activeCategory) return false;
      if (
        searchQuery.trim() &&
        !preset.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !preset.previewText.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [activeCategory, searchQuery]);

  const handleApplyPreset = useCallback(
    (preset: TextPreset) => {
      if (onAddText) {
        onAddText(preset.defaultText, preset.styleSnippet);
      }
      showToast(`Added "${preset.name}" to scene`, "info");
    },
    [onAddText, showToast],
  );

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100 select-none overflow-hidden">
      {/* Category Filter & Search */}
      <div className="border-b border-neutral-800 p-2.5 space-y-2">
        <div className="flex items-center gap-1 overflow-x-auto text-[10px]">
          {(["all", "title", "subtitle", "callout", "lowerthird", "label"] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`rounded px-2 py-1 uppercase tracking-wider font-semibold transition-colors whitespace-nowrap ${
                activeCategory === cat
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  : "bg-neutral-900 text-neutral-400 hover:text-neutral-200 border border-neutral-800"
              }`}
            >
              {cat === "all" ? "All Styles" : cat}
            </button>
          ))}
        </div>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search titles, quotes, lower thirds..."
        />
      </div>

      {/* Preset Cards List */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {filteredPresets.map((preset) => (
          <div
            key={preset.id}
            className="group relative overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/70 p-3 hover:border-amber-400/60 hover:bg-neutral-900 transition-all cursor-pointer shadow-sm"
            onClick={() => handleApplyPreset(preset)}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-neutral-200">{preset.name}</span>
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] font-mono text-neutral-400 uppercase">
                {preset.category}
              </span>
            </div>

            {/* Visual Text Style Preview */}
            <div className="rounded bg-black/60 p-3 border border-neutral-800/80 min-h-[50px] flex items-center justify-center text-center">
              <span
                style={{
                  fontFamily: preset.fontFamily,
                  fontSize: "14px",
                  lineHeight: "1.3",
                  color: preset.styleSnippet.color || "#FFF",
                  fontWeight: preset.styleSnippet.fontWeight || "normal",
                  letterSpacing: preset.styleSnippet.letterSpacing || "normal",
                  fontStyle: preset.styleSnippet.fontStyle || "normal",
                }}
                className="truncate block max-w-full"
              >
                {preset.previewText}
              </span>
            </div>

            {/* Quick Action Footer */}
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-neutral-400">
              <span className="font-mono text-[9px] text-neutral-500">{preset.fontFamily}</span>
              <span className="text-amber-400 font-medium group-hover:underline">
                + Add to Scene
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
