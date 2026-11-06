import { create } from "zustand";
import {
  STUDIO_MOTION_PATH,
  applyStudioMotionManifest,
  emptyStudioMotionManifest,
  parseStudioMotionManifest,
  serializeStudioMotionManifest,
  type StudioElementMotionPayload,
  type StudioGsapMotion,
  type StudioMotionManifest,
  type StudioMotionStylePreset,
  type StudioMotionTarget,
} from "./studioMotion";

export interface MotionConflictInfo {
  target: StudioMotionTarget;
  targetLabel: string;
  incomingMotion: StudioElementMotionPayload;
  reason: string;
  hasHandAuthoredGsap: boolean;
  conflictingMotionIds: string[];
}

export interface StudioMotionCommitDeps {
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  recordEdit?: (entry: {
    label: string;
    files: Record<string, { before: string; after: string }>;
    created?: string[];
  }) => Promise<void>;
  iframeDoc: Document | null;
  activeCompPath: string | null;
  currentTime: number;
}

export interface MotionHistoryEntry {
  label: string;
  before: string;
  after: string;
}

interface StudioMotionStoreState {
  projectId: string | null;
  manifest: StudioMotionManifest;
  rawManifestContent: string;
  selectedMotionId: string | null;
  activeStylePreset: StudioMotionStylePreset;
  pendingConflict: MotionConflictInfo | null;
  recordEditRef: StudioMotionCommitDeps["recordEdit"];
  undoStack: MotionHistoryEntry[];
  redoStack: MotionHistoryEntry[];
  setProjectManifest: (projectId: string, rawContent: string) => void;
  setManifestLive: (
    nextManifest: StudioMotionManifest,
    iframeDoc: Document | null,
    activeCompPath: string | null,
    currentTime: number,
  ) => void;
  commitManifest: (
    nextManifest: StudioMotionManifest,
    label: string,
    deps: StudioMotionCommitDeps,
  ) => Promise<void>;
  undoMotion: (deps: StudioMotionCommitDeps) => Promise<string | null>;
  redoMotion: (deps: StudioMotionCommitDeps) => Promise<string | null>;
  setSelectedMotionId: (id: string | null) => void;
  setActiveStylePreset: (preset: StudioMotionStylePreset) => void;
  setPendingConflict: (conflict: MotionConflictInfo | null) => void;
  setRecordEditRef: (fn: StudioMotionCommitDeps["recordEdit"]) => void;
}

async function saveMotionFileRobustly(
  writeProjectFile: StudioMotionCommitDeps["writeProjectFile"],
  afterContent: string,
  beforeContent: string,
): Promise<boolean> {
  let createdFile = false;
  try {
    await writeProjectFile(
      STUDIO_MOTION_PATH,
      afterContent,
      beforeContent.length > 0 ? beforeContent : undefined,
    );
    if (beforeContent.length === 0) {
      createdFile = true;
    }
  } catch (err: unknown) {
    const currentContent =
      err &&
      typeof err === "object" &&
      "currentContent" in err &&
      typeof (err as { currentContent?: unknown }).currentContent === "string"
        ? (err as { currentContent: string }).currentContent
        : undefined;
    if (currentContent !== undefined) {
      await writeProjectFile(STUDIO_MOTION_PATH, afterContent, currentContent);
    } else {
      await writeProjectFile(STUDIO_MOTION_PATH, afterContent, undefined);
    }
  }
  return createdFile;
}

export const useStudioMotionStore = create<StudioMotionStoreState>((set, get) => ({
  projectId: null,
  manifest: emptyStudioMotionManifest(),
  rawManifestContent: "",
  selectedMotionId: null,
  activeStylePreset: "documentary",
  pendingConflict: null,
  recordEditRef: undefined,
  undoStack: [],
  redoStack: [],

  setProjectManifest: (projectId, rawContent) => {
    const prevProjectId = get().projectId;
    const parsed = rawContent.trim()
      ? parseStudioMotionManifest(rawContent)
      : emptyStudioMotionManifest();
    set({
      projectId,
      manifest: parsed,
      rawManifestContent: rawContent,
      ...(prevProjectId !== projectId ? { undoStack: [], redoStack: [] } : {}),
    });
  },

  setManifestLive: (nextManifest, iframeDoc, activeCompPath, currentTime) => {
    set({ manifest: nextManifest });
    if (iframeDoc) {
      applyStudioMotionManifest(iframeDoc, nextManifest, activeCompPath, currentTime);
    }
  },

  commitManifest: async (nextManifest, label, deps) => {
    const beforeContent = get().rawManifestContent;
    const afterContent = serializeStudioMotionManifest(nextManifest);

    set((state) => ({
      manifest: nextManifest,
      rawManifestContent: afterContent,
      undoStack:
        beforeContent !== afterContent
          ? [...state.undoStack, { label, before: beforeContent, after: afterContent }]
          : state.undoStack,
      redoStack: beforeContent !== afterContent ? [] : state.redoStack,
    }));

    if (deps.iframeDoc) {
      applyStudioMotionManifest(
        deps.iframeDoc,
        nextManifest,
        deps.activeCompPath,
        deps.currentTime,
      );
    }

    const createdFile = await saveMotionFileRobustly(
      deps.writeProjectFile,
      afterContent,
      beforeContent,
    );

    const recordFn = deps.recordEdit ?? get().recordEditRef;
    if (recordFn && beforeContent !== afterContent) {
      await recordFn({
        label,
        files: {
          [STUDIO_MOTION_PATH]: {
            before: beforeContent,
            after: afterContent,
          },
        },
        ...(createdFile ? { created: [STUDIO_MOTION_PATH] } : {}),
      });
    }
  },

  undoMotion: async (deps) => {
    const stack = get().undoStack;
    if (stack.length === 0) return null;
    const entry = stack[stack.length - 1]!;
    const nextUndo = stack.slice(0, -1);
    const nextRedo = [...get().redoStack, entry];
    const parsed = entry.before.trim()
      ? parseStudioMotionManifest(entry.before)
      : emptyStudioMotionManifest();

    set({
      manifest: parsed,
      rawManifestContent: entry.before,
      undoStack: nextUndo,
      redoStack: nextRedo,
    });

    if (deps.iframeDoc) {
      applyStudioMotionManifest(deps.iframeDoc, parsed, deps.activeCompPath, deps.currentTime);
    }

    const revertedContent =
      entry.before.trim().length > 0 ? entry.before : serializeStudioMotionManifest(parsed);
    await saveMotionFileRobustly(deps.writeProjectFile, revertedContent, entry.after);
    return entry.label;
  },

  redoMotion: async (deps) => {
    const stack = get().redoStack;
    if (stack.length === 0) return null;
    const entry = stack[stack.length - 1]!;
    const nextRedo = stack.slice(0, -1);
    const nextUndo = [...get().undoStack, entry];
    const parsed = entry.after.trim()
      ? parseStudioMotionManifest(entry.after)
      : emptyStudioMotionManifest();

    set({
      manifest: parsed,
      rawManifestContent: entry.after,
      undoStack: nextUndo,
      redoStack: nextRedo,
    });

    if (deps.iframeDoc) {
      applyStudioMotionManifest(deps.iframeDoc, parsed, deps.activeCompPath, deps.currentTime);
    }

    const currentDiskContent =
      entry.before.trim().length > 0
        ? entry.before
        : serializeStudioMotionManifest(emptyStudioMotionManifest());
    await saveMotionFileRobustly(deps.writeProjectFile, entry.after, currentDiskContent);
    return entry.label;
  },

  setSelectedMotionId: (id) => set({ selectedMotionId: id }),
  setActiveStylePreset: (preset) => set({ activeStylePreset: preset }),
  setPendingConflict: (conflict) => set({ pendingConflict: conflict }),
  setRecordEditRef: (fn) => set({ recordEditRef: fn }),
}));

export function getMotionsForTarget(
  manifest: StudioMotionManifest,
  target: StudioMotionTarget | null,
): StudioGsapMotion[] {
  if (!target) return [];
  return manifest.motions.filter((m) => {
    if (target.id && m.target.id === target.id) return true;
    if (target.selector && m.target.selector === target.selector) return true;
    return false;
  });
}

/**
 * Checks whether the target element in the preview document has a hand-authored
 * GSAP tween or an overlapping Studio motion that requires user confirmation
 * (Replace, Combine, or Cancel).
 */
export function detectStudioMotionConflict(
  manifest: StudioMotionManifest,
  target: StudioMotionTarget,
  incomingMotion: StudioElementMotionPayload,
  iframeDoc: Document | null,
): MotionConflictInfo | null {
  const targetId = target.id || target.selector?.replace(/^#/, "") || "";
  const targetLabel = targetId || "Selected Element";

  let hasHandAuthoredGsap = false;
  if (iframeDoc && targetId && incomingMotion.category !== "transition") {
    const scripts = Array.from(iframeDoc.querySelectorAll("script"));
    const selectorToken = `#${targetId}`;
    for (const s of scripts) {
      const code = s.textContent || "";
      if (
        code.includes(selectorToken) &&
        (code.includes("gsap.") ||
          code.includes(".to(") ||
          code.includes(".from(") ||
          code.includes(".fromTo("))
      ) {
        hasHandAuthoredGsap = true;
        break;
      }
    }
  }

  const existingMotions = getMotionsForTarget(manifest, target);

  const inStart = incomingMotion.start + (incomingMotion.delay ?? 0);
  const inEnd = inStart + incomingMotion.duration;

  const conflictingMotions = existingMotions.filter((m) => {
    const mStart = m.start + (m.delay ?? 0);
    const mEnd = mStart + m.duration;
    const overlapsTime = inStart < mEnd && inEnd > mStart;
    const sameCategory =
      incomingMotion.category &&
      m.category &&
      incomingMotion.category === m.category &&
      incomingMotion.category !== "emphasis";
    return overlapsTime || sameCategory;
  });

  if (!hasHandAuthoredGsap && conflictingMotions.length === 0) {
    return null;
  }

  const reasons: string[] = [];
  if (hasHandAuthoredGsap) {
    reasons.push(`Hand-authored GSAP timeline animation detected on #${targetId}`);
  }
  if (conflictingMotions.length > 0) {
    const names = conflictingMotions.map((m) => m.name || m.presetId || "Motion").join(", ");
    reasons.push(`Existing motion (${names}) on #${targetId}`);
  }

  return {
    target,
    targetLabel,
    incomingMotion,
    reason: reasons.join(" + "),
    hasHandAuthoredGsap,
    conflictingMotionIds: conflictingMotions
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id)),
  };
}
