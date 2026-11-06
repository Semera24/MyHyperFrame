import { create } from "zustand";
import { persist } from "zustand/middleware";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { studioApiFetch } from "../../utils/studioApiFetch";
import { studioWriteHeaders } from "../../utils/studioFileVersion";

export type TargetAiAgent = "Claude Code" | "Codex" | "Antigravity" | "ChatGPT";

export const AI_AGENTS: readonly TargetAiAgent[] = [
  "Claude Code",
  "Codex",
  "Antigravity",
  "ChatGPT",
] as const;

export interface CanvasCommentPin {
  id: string;
  pinNumber: number;
  stageX: number;
  stageY: number;
  pctX: number;
  pctY: number;
  timestampSeconds: number;
  frame: number;
  sceneFile: string;
  elementId: string;
  hfId?: string;
  tagName?: string;
  boundingBox?: { left: number; top: number; width: number; height: number };
  targetAgent: TargetAiAgent;
  note: string;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
}

export type DraftCanvasPin = Omit<CanvasCommentPin, "id" | "pinNumber" | "createdAt" | "status">;

interface CanvasCommentsState {
  commentModeActive: boolean;
  showAllPins: boolean;
  drawerOpen: boolean;
  selectedAgent: TargetAiAgent;
  pins: CanvasCommentPin[];
  activePinId: string | null;
  draftPin: DraftCanvasPin | null;
  setCommentModeActive: (active: boolean) => void;
  toggleCommentMode: () => void;
  setShowAllPins: (show: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
  setSelectedAgent: (agent: TargetAiAgent) => void;
  setActivePinId: (id: string | null) => void;
  setDraftPin: (draft: DraftCanvasPin | null) => void;
  loadPins: (projectId: string) => Promise<void>;
  saveDraftPin: (projectId: string, draft: DraftCanvasPin) => Promise<CanvasCommentPin | null>;
  togglePinStatus: (projectId: string, pinId: string) => Promise<void>;
  deletePin: (projectId: string, pinId: string) => Promise<void>;
}

const CIRCLED_NUMBERS = [
  "①",
  "②",
  "③",
  "④",
  "⑤",
  "⑥",
  "⑦",
  "⑧",
  "⑨",
  "⑩",
  "⑪",
  "⑫",
  "⑬",
  "⑭",
  "⑮",
  "⑯",
  "⑰",
  "⑱",
  "⑲",
  "⑳",
];

export function formatPinBadgeNumber(n: number): string {
  return CIRCLED_NUMBERS[n - 1] ?? `#${n}`;
}

export function formatSinglePinPromptForAgent(
  pin: Pick<
    CanvasCommentPin,
    | "pinNumber"
    | "stageX"
    | "stageY"
    | "timestampSeconds"
    | "frame"
    | "sceneFile"
    | "elementId"
    | "hfId"
    | "tagName"
    | "boundingBox"
    | "note"
  >,
  agent: TargetAiAgent,
  projectId?: string | null,
): string {
  const bboxStr = pin.boundingBox
    ? `left: ${pin.boundingBox.left}px, top: ${pin.boundingBox.top}px, width: ${pin.boundingBox.width}px, height: ${pin.boundingBox.height}px`
    : "n/a";
  const selectorStr = [
    pin.elementId && pin.elementId !== "scene" ? `#${pin.elementId}` : null,
    pin.hfId ? `[data-hf-id="${pin.hfId}"]` : null,
    pin.tagName ? `<${pin.tagName}>` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const headerByAgent: Record<TargetAiAgent, string> = {
    "Claude Code": `### [Claude Code] HyperFrames Studio Spatial Fix Request (Pin #${pin.pinNumber})`,
    Codex: `### [Codex] HyperFrames Studio Spatial Patch Task (Pin #${pin.pinNumber})`,
    Antigravity: `### [Antigravity] HyperFrames Studio Canvas Revision Pin #${pin.pinNumber}`,
    ChatGPT: `### [ChatGPT] HyperFrames HTML/GSAP Scene Edit Request (Pin #${pin.pinNumber})`,
  };

  return [
    headerByAgent[agent],
    projectId ? `- **Episode / Project**: \`${projectId}\`` : null,
    `- **Target Scene File**: \`Sources/${pin.sceneFile}\``,
    `- **Playhead Timestamp**: \`${pin.timestampSeconds.toFixed(2)}s\` (Frame \`${pin.frame}\` @ 30fps)`,
    `- **Canvas Pin Coordinate (1920×1080)**: \`(${pin.stageX}px, ${pin.stageY}px)\``,
    `- **Target DOM Element**: \`${selectorStr || pin.elementId}\``,
    `- **Current Element Bounding Box**: \`${bboxStr}\``,
    `- **Requested Fix**:`,
    `  > ${pin.note}`,
    "",
    `Please apply this fix directly in \`Sources/${pin.sceneFile}\` while preserving existing \`data-hf-id\` attributes and 1920×1080 safe margins (90px × 70px).`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function formatAllOpenPinsPromptForAgent(
  pins: readonly CanvasCommentPin[],
  agent: TargetAiAgent,
  projectId?: string | null,
): string {
  const openPins = pins.filter((p) => p.status === "OPEN");
  if (openPins.length === 0) return "";
  return [
    `# [${agent}] HyperFrames Studio Batch Canvas Revisions (${openPins.length} Open Pin${openPins.length === 1 ? "" : "s"})`,
    projectId ? `**Project**: \`${projectId}\` (\`QC/${projectId}_Revision_Notes.md\`)` : "",
    "",
    ...openPins.map((pin) => formatSinglePinPromptForAgent(pin, agent, projectId)),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const useCanvasCommentsStore = create<CanvasCommentsState>()(
  persist(
    (set, get) => ({
      commentModeActive: false,
      showAllPins: false,
      drawerOpen: false,
      selectedAgent: "Codex",
      pins: [],
      activePinId: null,
      draftPin: null,
      setCommentModeActive: (active) =>
        set({
          commentModeActive: active,
          ...(active ? {} : { draftPin: null }),
        }),
      toggleCommentMode: () =>
        set((state) => ({
          commentModeActive: !state.commentModeActive,
          ...(state.commentModeActive ? { draftPin: null } : {}),
        })),
      setShowAllPins: (show) => set({ showAllPins: show }),
      setDrawerOpen: (open) => set({ drawerOpen: open }),
      setSelectedAgent: (agent) => set({ selectedAgent: agent }),
      setActivePinId: (id) => set({ activePinId: id }),
      setDraftPin: (draft) => set({ draftPin: draft }),
      loadPins: async (projectId) => {
        if (!projectId) return;
        const res = await studioApiFetch(buildProjectApiPath(projectId, "/canvas-comments")).catch(
          () => null,
        );
        if (!res || !res.ok) return;
        const data = (await res.json()) as { pins?: CanvasCommentPin[] };
        if (Array.isArray(data.pins)) {
          set({ pins: data.pins });
        }
      },
      saveDraftPin: async (projectId, draft) => {
        if (!projectId || !draft.note.trim()) return null;
        const res = await studioApiFetch(buildProjectApiPath(projectId, "/canvas-comments"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...studioWriteHeaders() },
          body: JSON.stringify(draft),
        }).catch(() => null);
        if (!res || !res.ok) return null;
        const data = (await res.json()) as {
          pin?: CanvasCommentPin;
          pins?: CanvasCommentPin[];
        };
        if (Array.isArray(data.pins)) {
          set({
            pins: data.pins,
            draftPin: null,
            activePinId: data.pin?.id ?? null,
          });
        }
        return data.pin ?? null;
      },
      togglePinStatus: async (projectId, pinId) => {
        const target = get().pins.find((p) => p.id === pinId);
        if (!target || !projectId) return;
        const nextStatus = target.status === "OPEN" ? "RESOLVED" : "OPEN";
        const res = await studioApiFetch(
          buildProjectApiPath(projectId, `/canvas-comments/${encodeURIComponent(pinId)}`),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...studioWriteHeaders() },
            body: JSON.stringify({ status: nextStatus }),
          },
        ).catch(() => null);
        if (!res || !res.ok) return;
        const data = (await res.json()) as { pins?: CanvasCommentPin[] };
        if (Array.isArray(data.pins)) set({ pins: data.pins });
      },
      deletePin: async (projectId, pinId) => {
        if (!projectId) return;
        const res = await studioApiFetch(
          buildProjectApiPath(projectId, `/canvas-comments/${encodeURIComponent(pinId)}`),
          {
            method: "DELETE",
            headers: { ...studioWriteHeaders() },
          },
        ).catch(() => null);
        if (!res || !res.ok) return;
        const data = (await res.json()) as { pins?: CanvasCommentPin[] };
        if (Array.isArray(data.pins)) {
          set((state) => ({
            pins: data.pins!,
            activePinId: state.activePinId === pinId ? null : state.activePinId,
          }));
        }
      },
    }),
    {
      name: "hf-canvas-comments-settings",
      partialize: (state) => ({
        selectedAgent: state.selectedAgent,
        showAllPins: state.showAllPins,
      }),
    },
  ),
);
