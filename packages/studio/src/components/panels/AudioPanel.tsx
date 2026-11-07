import { memo, useState, useMemo, useRef, useCallback } from "react";
import { SearchInput } from "../ui/SearchInput";
import { usePlayerStore } from "../../player";

export interface AudioItem {
  id: string;
  name: string;
  category: "voiceover" | "music" | "sfx";
  duration: number; // in seconds
  url?: string;
  isStock?: boolean;
}

const STOCK_SFX: AudioItem[] = [
  { id: "sfx-whoosh", name: "Cinematic Whoosh", category: "sfx", duration: 0.8, isStock: true },
  { id: "sfx-sub-hit", name: "Deep Impact / Boom", category: "sfx", duration: 1.5, isStock: true },
  {
    id: "sfx-page-turn",
    name: "Document / Page Turn",
    category: "sfx",
    duration: 0.6,
    isStock: true,
  },
  {
    id: "sfx-shutter",
    name: "Camera Shutter Click",
    category: "sfx",
    duration: 0.4,
    isStock: true,
  },
  {
    id: "sfx-ambient-hum",
    name: "Historical Tension Drone",
    category: "music",
    duration: 12.0,
    isStock: true,
  },
];

export interface AudioPanelProps {
  projectId: string;
  assets?: string[];
  onAddAssetToTimeline?: (path: string) => void;
}

export const AudioPanel = memo(function AudioPanel({
  projectId,
  assets = [],
  onAddAssetToTimeline,
}: AudioPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<"all" | "voiceover" | "music" | "sfx">(
    "all",
  );
  const [playingId, setPlayingId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Discover audio assets in project
  const projectAudioItems: AudioItem[] = useMemo(() => {
    const audioExts = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"];
    return assets
      .filter((path) => audioExts.some((ext) => path.toLowerCase().endsWith(ext)))
      .map((path) => {
        const basename = path.split("/").pop() || path;
        const isVoice =
          basename.toLowerCase().includes("voice") || basename.toLowerCase().includes("narration");
        const isMusic =
          basename.toLowerCase().includes("bgm") ||
          basename.toLowerCase().includes("music") ||
          basename.toLowerCase().includes("theme");
        return {
          id: path,
          name: basename,
          category: isVoice ? "voiceover" : isMusic ? "music" : "sfx",
          duration: 3.0,
          url: `/api/projects/${projectId}/preview/${path}`,
          isStock: false,
        };
      });
  }, [assets, projectId]);

  const allItems = useMemo(() => {
    return [...projectAudioItems, ...STOCK_SFX];
  }, [projectAudioItems]);

  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (activeCategory !== "all" && item.category !== activeCategory) return false;
      if (searchQuery.trim() && !item.name.toLowerCase().includes(searchQuery.toLowerCase()))
        return false;
      return true;
    });
  }, [allItems, activeCategory, searchQuery]);

  const handleTogglePlay = useCallback(
    (item: AudioItem) => {
      if (playingId === item.id) {
        if (audioRef.current) {
          audioRef.current.pause();
        }
        setPlayingId(null);
        return;
      }

      if (audioRef.current) {
        audioRef.current.pause();
      }

      if (item.url) {
        const audio = new Audio(item.url);
        audio.onended = () => setPlayingId(null);
        audio.onerror = () => setPlayingId(null);
        audio.play().catch(() => setPlayingId(null));
        audioRef.current = audio;
        setPlayingId(item.id);
      } else {
        // Stock sound placeholder playback tone
        try {
          const ctx = new (
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          )();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + item.duration);
          osc.start();
          osc.stop(ctx.currentTime + item.duration);
          setPlayingId(item.id);
          setTimeout(() => setPlayingId(null), item.duration * 1000);
        } catch {
          setPlayingId(null);
        }
      }
    },
    [playingId],
  );

  const handleAddToTimeline = useCallback(
    (item: AudioItem) => {
      if (onAddAssetToTimeline && item.url) {
        onAddAssetToTimeline(item.id);
      } else {
        // Seek to current time
        const ct = usePlayerStore.getState().currentTime;
        console.log(`Add audio [${item.name}] at ${ct.toFixed(2)}s`);
      }
    },
    [onAddAssetToTimeline],
  );

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100 select-none overflow-hidden">
      {/* Category Pills & Search */}
      <div className="border-b border-neutral-800 p-2.5 space-y-2">
        <div className="flex items-center gap-1 overflow-x-auto text-[10px]">
          {(["all", "voiceover", "music", "sfx"] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`rounded px-2.5 py-1 uppercase tracking-wider font-semibold transition-colors ${
                activeCategory === cat
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  : "bg-neutral-900 text-neutral-400 hover:text-neutral-200 border border-neutral-800"
              }`}
            >
              {cat === "all" ? "All Audio" : cat}
            </button>
          ))}
        </div>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search voiceover, music, SFX..."
        />
      </div>

      {/* Audio List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filteredItems.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-center text-neutral-500 text-xs">
            <span className="text-xl mb-1">🎵</span>
            <span>No audio files found</span>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isPlaying = playingId === item.id;
            return (
              <div
                key={item.id}
                className="group flex items-center justify-between rounded-lg border border-neutral-800/80 bg-neutral-900/60 p-2 hover:border-neutral-700 hover:bg-neutral-900 transition-all"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => handleTogglePlay(item)}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      isPlaying
                        ? "border-amber-400 bg-amber-500/20 text-amber-300"
                        : "border-neutral-700 bg-neutral-800 text-neutral-300 hover:border-amber-400/50 hover:text-amber-300"
                    }`}
                    title={isPlaying ? "Pause" : "Play Preview"}
                  >
                    {isPlaying ? "⏸" : "▶"}
                  </button>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-neutral-200 truncate">{item.name}</p>
                    <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 font-mono">
                      <span className="uppercase text-amber-400/80">{item.category}</span>
                      <span>•</span>
                      <span>{item.duration.toFixed(1)}s</span>
                      {item.isStock && (
                        <>
                          <span>•</span>
                          <span className="text-cyan-400/70">Stock</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleAddToTimeline(item)}
                  className="opacity-80 group-hover:opacity-100 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-[10px] font-medium text-neutral-300 hover:border-amber-400/50 hover:bg-amber-500/10 hover:text-amber-300 transition-colors"
                >
                  + Add
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});
