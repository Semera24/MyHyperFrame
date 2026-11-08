import { create } from "zustand";
import { liveTime, usePlayerStore, type TimelineElement } from "../player";
import { batchElementUpdates } from "../player/store/batchElementUpdates";
import { markScenesStale } from "../player/sceneSwap";
import { buildProjectApiPath } from "./projectRouting";
import { studioApiFetch } from "./studioApiFetch";
import { studioWriteHeaders } from "./studioFileVersion";
import { saveServerRewriteWithHistory, type RecordEditInput } from "./studioFileHistory";
import { createStudioSaveHttpError } from "./studioSaveDiagnostics";
import {
  buildStableSelector,
  findClosestByAttribute,
  getSelectorIndex,
  getSourceFileForElement,
  normalizeTimelineCompositionSource,
} from "../components/editor/domEditingDom";
import { readHfId } from "../components/editor/domEditing";

export type BackdropCheckMode = "default" | "checkerboard" | "light" | "dark";

export interface DocumentaryQcOverlayState {
  safeZoneVisible: boolean;
  backdropMode: BackdropCheckMode;
  toggleSafeZone: () => void;
  cycleBackdropMode: () => void;
}

const BACKDROP_ORDER: BackdropCheckMode[] = ["default", "checkerboard", "light", "dark"];

export const useDocumentaryQcOverlayStore = create<DocumentaryQcOverlayState>((set) => ({
  safeZoneVisible: false,
  backdropMode: "default",
  toggleSafeZone: () => set((s) => ({ safeZoneVisible: !s.safeZoneVisible })),
  cycleBackdropMode: () =>
    set((s) => {
      const idx = BACKDROP_ORDER.indexOf(s.backdropMode);
      return { backdropMode: BACKDROP_ORDER[(idx + 1) % BACKDROP_ORDER.length]! };
    }),
}));

export type DocumentaryPresetId = "callout-card" | "map-badge" | "stat-card" | "subscribe-cta";

export interface UnbundleCandidate {
  container: HTMLElement;
  children: HTMLElement[];
}

function isFlexOrGridDisplay(el: HTMLElement): boolean {
  const win = el.ownerDocument?.defaultView;
  if (!win) return false;
  const display = win.getComputedStyle(el).display || el.style.display || "";
  return (
    display === "grid" ||
    display === "inline-grid" ||
    display === "flex" ||
    display === "inline-flex"
  );
}

function getVisualElementChildren(container: HTMLElement): HTMLElement[] {
  const SKIP_TAGS = new Set([
    "script",
    "style",
    "link",
    "meta",
    "defs",
    "template",
    "noscript",
    "span",
    "strong",
    "em",
    "b",
    "i",
    "br",
    "small",
    "sub",
    "sup",
  ]);
  return Array.from(container.children).filter((child): child is HTMLElement => {
    const htmlCtor =
      container.ownerDocument?.defaultView?.HTMLElement ??
      (typeof HTMLElement !== "undefined" ? HTMLElement : null);
    if (!((htmlCtor && child instanceof htmlCtor) || child?.nodeType === 1)) return false;
    return !SKIP_TAGS.has(child.tagName.toLowerCase());
  });
}

/**
 * Detects if `el` or any of its ancestors (below the composition root) is a
 * CSS Grid / Flex layout container or multi-child card wrapper whose children
 * can be unbundled into free `position: absolute` layers.
 */
export function detectUnbundleCandidate(el: HTMLElement | null): UnbundleCandidate | null {
  if (!el) return null;
  let highestFlexOrGrid: UnbundleCandidate | null = null;
  let nearestMultiChild: UnbundleCandidate | null = null;

  let cursor: HTMLElement | null = el;
  while (
    cursor &&
    !cursor.hasAttribute("data-composition-id") &&
    cursor !== cursor.ownerDocument.body
  ) {
    if (cursor.tagName.toLowerCase() !== "svg") {
      const children = getVisualElementChildren(cursor);
      if (children.length > 0 && isFlexOrGridDisplay(cursor)) {
        highestFlexOrGrid = { container: cursor, children };
      } else if (children.length > 1 && !nearestMultiChild) {
        nearestMultiChild = { container: cursor, children };
      }
    }
    cursor = cursor.parentElement;
  }

  return highestFlexOrGrid ?? nearestMultiChild;
}

function measureScale(el: HTMLElement): { scaleX: number; scaleY: number } {
  const compRoot = findClosestByAttribute(el, ["data-composition-id"]) ?? el.ownerDocument.body;
  const rect = compRoot.getBoundingClientRect();
  const logicalW =
    Number.parseFloat(compRoot.getAttribute("data-width") ?? "") || compRoot.offsetWidth || 1920;
  const logicalH =
    Number.parseFloat(compRoot.getAttribute("data-height") ?? "") || compRoot.offsetHeight || 1080;
  const scaleX = rect.width > 0 && logicalW > 0 ? rect.width / logicalW : 1;
  const scaleY = rect.height > 0 && logicalH > 0 ? rect.height / logicalH : 1;
  return {
    scaleX: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
    scaleY: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1,
  };
}

function buildElementTarget(el: HTMLElement, sourceFile: string, activeCompPath: string | null) {
  const hfId = readHfId(el);
  const rawSelector = buildStableSelector(el);
  const selector = rawSelector ?? (hfId ? `[data-hf-id="${hfId}"]` : undefined);
  const selectorIndex = getSelectorIndex(
    el.ownerDocument,
    el,
    rawSelector,
    sourceFile,
    activeCompPath,
  );
  return {
    id: el.id || undefined,
    hfId: hfId || undefined,
    selector,
    selectorIndex,
  };
}

export async function unbundleElementContainer(params: {
  element: HTMLElement;
  projectId: string;
  activeCompPath: string | null;
  writeFile?: (path: string, content: string) => Promise<boolean>;
  recordEdit?: (entry: RecordEditInput) => void;
  reloadPreview: () => void;
  showToast?: (message: string, variant?: "error" | "info") => void;
}): Promise<boolean> {
  const candidate = detectUnbundleCandidate(params.element);
  if (!candidate) {
    params.showToast?.(
      "Selected layer is not inside a Grid, Flex, or multi-layer container.",
      "info",
    );
    return false;
  }

  const { container } = candidate;
  const { sourceFile } = getSourceFileForElement(container, params.activeCompPath);
  const { scaleX, scaleY } = measureScale(container);
  const containerRect = container.getBoundingClientRect();
  const offsetParent =
    (container.offsetParent as HTMLElement | null) ??
    findClosestByAttribute(container, ["data-composition-id"]) ??
    container.ownerDocument.body;
  const parentRect = offsetParent.getBoundingClientRect();

  const containerBox = {
    left: Math.round((containerRect.left - parentRect.left) / scaleX),
    top: Math.round((containerRect.top - parentRect.top) / scaleY),
    width: Math.max(1, Math.round(containerRect.width / scaleX)),
    height: Math.max(1, Math.round(containerRect.height / scaleY)),
  };

  const containerTarget = buildElementTarget(container, sourceFile, params.activeCompPath);
  const { localStart, defaultDuration } = resolveActiveSceneTargetAtPlayhead(
    params.activeCompPath,
    sourceFile,
  );

  // Recursively measure all visual child/descendant layers inside container
  const measuredEntries: Array<{
    target: ReturnType<typeof buildElementTarget>;
    left: number;
    top: number;
    width: number;
    height: number;
    zIndex: number;
    start?: number;
    duration?: number;
  }> = [];

  let zCounter = 10;
  const collectDescendants = (parentEl: HTMLElement) => {
    const parentBox = parentEl.getBoundingClientRect();
    const directChildren = getVisualElementChildren(parentEl);
    for (const child of directChildren) {
      const childRect = child.getBoundingClientRect();
      const childId = child.id || readHfId(child);
      const storeEl = (usePlayerStore.getState().elements ?? []).find(
        (e) => e.id === childId || e.hfId === childId,
      );
      measuredEntries.push({
        target: buildElementTarget(child, sourceFile, params.activeCompPath),
        left: Math.round((childRect.left - parentBox.left) / scaleX),
        top: Math.round((childRect.top - parentBox.top) / scaleY),
        width: Math.max(1, Math.round(childRect.width / scaleX)),
        height: Math.max(1, Math.round(childRect.height / scaleY)),
        zIndex: zCounter++,
        start: storeEl ? undefined : localStart,
        duration: storeEl ? undefined : defaultDuration,
      });
      if (child.tagName.toLowerCase() !== "svg" && getVisualElementChildren(child).length > 0) {
        collectDescendants(child);
      }
    }
  };
  collectDescendants(container);

  const noopWrite = async () => true;
  const noopRecord = () => {};

  const saved = await saveServerRewriteWithHistory({
    projectId: params.projectId,
    path: sourceFile,
    label: "Unbundle container into free layers",
    writeFile: params.writeFile ?? noopWrite,
    recordEdit: params.recordEdit ?? noopRecord,
    rewrite: async (originalContent) => {
      const response = await studioApiFetch(
        buildProjectApiPath(
          params.projectId,
          `/file-mutations/unbundle-container/${encodeURIComponent(sourceFile)}`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...studioWriteHeaders() },
          body: JSON.stringify({
            containerTarget,
            containerBox,
            children: measuredEntries,
          }),
        },
      );
      if (!response.ok) {
        throw await createStudioSaveHttpError(
          response,
          `Failed to unbundle container in ${sourceFile}`,
        );
      }
      const data = (await response.json()) as {
        changed?: boolean;
        content?: string;
      };
      if (!data.changed) return null;
      return {
        disk: typeof data.content === "string" ? data.content : originalContent,
      };
    },
  });

  if (saved) {
    params.reloadPreview();
    params.showToast?.(
      `Unbundled ${measuredEntries.length} layers into freely movable layers.`,
      "info",
    );
    return true;
  }
  return false;
}

export function resolveActiveSceneTargetAtPlayhead(
  activeCompPath: string | null,
  selectedSourceFile?: string | null,
): { targetFile: string; localStart: number; defaultDuration: number; playheadTime: number } {
  const state = usePlayerStore.getState();
  const live = typeof liveTime.get === "function" ? liveTime.get() : liveTime.latest();
  const currentTime = Number.isFinite(live) && live > 0 ? live : (state.currentTime ?? 0);
  const elements = state.elements ?? [];
  const manifestClips = state.clipManifest ?? [];

  // Find a sub-composition clip active at the playhead
  const activeSceneClip =
    elements.find(
      (el) =>
        (el.kind === "composition" || Boolean(el.compositionSrc)) &&
        currentTime >= el.start &&
        currentTime <= el.start + el.duration,
    ) ??
    manifestClips.find(
      (clip) =>
        (clip.kind === "composition" || Boolean(clip.compositionSrc)) &&
        currentTime >= clip.start &&
        currentTime <= clip.start + clip.duration,
    );

  if (activeSceneClip) {
    const compFile =
      normalizeTimelineCompositionSource(activeSceneClip.compositionSrc ?? undefined) ??
      ("sourceFile" in activeSceneClip ? activeSceneClip.sourceFile : undefined) ??
      (activeSceneClip.compositionId && activeSceneClip.compositionId !== "main"
        ? `compositions/${activeSceneClip.compositionId}.html`
        : null);
    if (compFile && compFile !== "index.html") {
      const localStart = Math.max(0, currentTime - activeSceneClip.start);
      const remaining = Math.max(0.5, activeSceneClip.duration - localStart);
      return {
        targetFile: compFile,
        localStart,
        defaultDuration: Math.min(5, remaining),
        playheadTime: currentTime,
      };
    }
  }

  if (selectedSourceFile && selectedSourceFile !== "index.html") {
    return {
      targetFile: selectedSourceFile,
      localStart: 0,
      defaultDuration: 5,
      playheadTime: currentTime,
    };
  }

  return {
    targetFile: activeCompPath || "index.html",
    localStart: Math.max(0, currentTime),
    defaultDuration: 5,
    playheadTime: currentTime,
  };
}

export async function insertFreeLayerInActiveScene(params: {
  kind: "text" | "image" | "group" | "preset";
  presetId?: DocumentaryPresetId;
  text?: string;
  src?: string;
  projectId: string;
  activeCompPath: string | null;
  selectedSourceFile?: string | null;
  writeFile?: (path: string, content: string) => Promise<boolean>;
  recordEdit?: (entry: RecordEditInput) => void;
  reloadPreview: () => void;
  showToast?: (message: string, variant?: "error" | "info") => void;
}): Promise<string | null> {
  const { targetFile, localStart, defaultDuration, playheadTime } =
    resolveActiveSceneTargetAtPlayhead(params.activeCompPath, params.selectedSourceFile);

  let insertedId: string | null = null;
  const noopWrite = async () => true;
  const noopRecord = () => {};

  const saved = await saveServerRewriteWithHistory({
    projectId: params.projectId,
    path: targetFile,
    label: `Add ${params.kind} layer`,
    writeFile: params.writeFile ?? noopWrite,
    recordEdit: params.recordEdit ?? noopRecord,
    rewrite: async (originalContent) => {
      const response = await studioApiFetch(
        buildProjectApiPath(
          params.projectId,
          `/file-mutations/insert-element/${encodeURIComponent(targetFile)}`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...studioWriteHeaders() },
          body: JSON.stringify({
            kind: params.kind,
            presetId: params.presetId,
            start: localStart,
            duration: defaultDuration,
            text: params.text,
            src: params.src,
          }),
        },
      );
      if (!response.ok) {
        throw await createStudioSaveHttpError(
          response,
          `Failed to insert ${params.kind} layer in ${targetFile}`,
        );
      }
      const data = (await response.json()) as {
        changed?: boolean;
        content?: string;
        elementId?: string;
      };
      if (!data.changed) return null;
      insertedId = data.elementId ?? null;
      return {
        disk: typeof data.content === "string" ? data.content : originalContent,
      };
    },
  });

  if (saved) {
    const store = usePlayerStore.getState();
    store.setCurrentTime(playheadTime);
    const previewIframe = document.querySelector<HTMLIFrameElement>(
      'iframe[title="Composition Preview"]',
    );
    if (previewIframe) {
      markScenesStale(previewIframe, [targetFile, "index.html"]);
    }
    params.reloadPreview();
    if (insertedId) {
      store.setSelectedElementId(insertedId);
    }
    // Seek back to the exact playhead position after the preview swap/reload settles
    const restoreSeek = () => {
      const s = usePlayerStore.getState();
      s.setCurrentTime(playheadTime);
      s.requestSeek(playheadTime);
      liveTime.notifySeek(playheadTime);
      if (insertedId) {
        s.setSelectedElementId(insertedId);
      }
    };
    setTimeout(restoreSeek, 120);
    setTimeout(restoreSeek, 450);
    params.showToast?.(
      `Added ${params.kind} layer (${insertedId ?? "new"}) to ${targetFile}`,
      "info",
    );
    return insertedId;
  }
  return null;
}

export async function uploadAndInsertImageInActiveScene(params: {
  file: File;
  projectId: string;
  activeCompPath: string | null;
  selectedSourceFile?: string | null;
  reloadPreview: () => void;
  showToast?: (message: string, variant?: "error" | "info") => void;
}): Promise<string | null> {
  const form = new FormData();
  form.append("files", params.file);
  const uploadRes = await studioApiFetch(
    buildProjectApiPath(params.projectId, "/upload?subDir=assets"),
    {
      method: "POST",
      headers: { ...studioWriteHeaders() },
      body: form,
    },
  );
  if (!uploadRes.ok) {
    params.showToast?.("Failed to upload image to project assets/", "error");
    return null;
  }
  const data = (await uploadRes.json()) as { uploaded?: string[] };
  const uploadedPath = data.uploaded?.[0];
  if (!uploadedPath) {
    params.showToast?.("Image upload returned no asset path", "error");
    return null;
  }
  return insertFreeLayerInActiveScene({
    kind: "image",
    src: uploadedPath,
    projectId: params.projectId,
    activeCompPath: params.activeCompPath,
    selectedSourceFile: params.selectedSourceFile,
    reloadPreview: params.reloadPreview,
    showToast: params.showToast,
  });
}

export async function groupSelectedElementsIntoLayer(params: {
  elements: HTMLElement[];
  groupLabel?: string;
  projectId: string;
  activeCompPath: string | null;
  writeFile?: (path: string, content: string) => Promise<boolean>;
  recordEdit?: (entry: RecordEditInput) => void;
  reloadPreview: () => void;
  showToast?: (message: string, variant?: "error" | "info") => void;
}): Promise<string | null> {
  const validEls = params.elements.filter(Boolean);
  if (validEls.length === 0) return null;

  const firstEl = validEls[0]!;
  const { sourceFile } = getSourceFileForElement(firstEl, params.activeCompPath);
  const { scaleX, scaleY } = measureScale(firstEl);
  const compRoot =
    findClosestByAttribute(firstEl, ["data-composition-id"]) ?? firstEl.ownerDocument.body;
  const rootRect = compRoot.getBoundingClientRect();

  const boxes = validEls.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      el,
      left: (r.left - rootRect.left) / scaleX,
      top: (r.top - rootRect.top) / scaleY,
      width: Math.max(1, r.width / scaleX),
      height: Math.max(1, r.height / scaleY),
    };
  });

  const minLeft = Math.min(...boxes.map((b) => b.left));
  const minTop = Math.min(...boxes.map((b) => b.top));
  const maxRight = Math.max(...boxes.map((b) => b.left + b.width));
  const maxBottom = Math.max(...boxes.map((b) => b.top + b.height));

  const bbox = {
    left: Math.round(minLeft),
    top: Math.round(minTop),
    width: Math.max(1, Math.round(maxRight - minLeft)),
    height: Math.max(1, Math.round(maxBottom - minTop)),
  };

  const members = boxes.map((b, idx) => ({
    target: buildElementTarget(b.el, sourceFile, params.activeCompPath),
    left: Math.round(b.left - minLeft),
    top: Math.round(b.top - minTop),
    width: Math.round(b.width),
    height: Math.round(b.height),
    zIndex: 10 + idx,
  }));

  const { localStart, defaultDuration } = resolveActiveSceneTargetAtPlayhead(
    params.activeCompPath,
    sourceFile,
  );

  let createdGroupId: string | null = null;
  const noopWrite = async () => true;
  const noopRecord = () => {};

  const saved = await saveServerRewriteWithHistory({
    projectId: params.projectId,
    path: sourceFile,
    label: "Group selected layers",
    writeFile: params.writeFile ?? noopWrite,
    recordEdit: params.recordEdit ?? noopRecord,
    rewrite: async (originalContent) => {
      const response = await studioApiFetch(
        buildProjectApiPath(
          params.projectId,
          `/file-mutations/group-elements/${encodeURIComponent(sourceFile)}`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...studioWriteHeaders() },
          body: JSON.stringify({
            groupLabel: params.groupLabel || "Group",
            bbox,
            start: localStart,
            duration: defaultDuration,
            members,
          }),
        },
      );
      if (!response.ok) {
        throw await createStudioSaveHttpError(
          response,
          `Failed to group elements in ${sourceFile}`,
        );
      }
      const data = (await response.json()) as {
        changed?: boolean;
        content?: string;
        groupId?: string;
      };
      if (!data.changed) return null;
      createdGroupId = data.groupId ?? null;
      return {
        disk: typeof data.content === "string" ? data.content : originalContent,
      };
    },
  });

  if (saved) {
    params.reloadPreview();
    if (createdGroupId) {
      usePlayerStore.getState().setSelectedElementId(createdGroupId);
    }
    params.showToast?.(`Grouped ${validEls.length} layer(s) into #${createdGroupId}`, "info");
    return createdGroupId;
  }
  return null;
}

export async function pinRevisionNoteToQc(params: {
  projectId: string;
  timestampSeconds: number;
  frame: number;
  sceneFile: string;
  elementId: string;
  note: string;
}): Promise<{ ok: boolean; notesPath?: string }> {
  const response = await studioApiFetch(buildProjectApiPath(params.projectId, "/revision-notes"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...studioWriteHeaders() },
    body: JSON.stringify(params),
  });
  if (!response.ok) return { ok: false };
  const data = (await response.json()) as { ok?: boolean; notesPath?: string };
  return { ok: Boolean(data.ok), notesPath: data.notesPath };
}

/**
 * Reorders visual timeline track rows between `fromTrackNumber` and `toTrackNumber`
 * (triggered by clicking `↑` / `↓` or dragging the `⠿` grip handle on a track header row).
 *
 * Immediately updates:
 * 1. The live preview iframe DOM (`element.style.zIndex` and `data-track-index`) so canvas
 *    stacking changes on the exact frame of the interaction.
 * 2. `usePlayerStore` (`track`, `authoredTrack`, `zIndex`) so the timeline rows swap immediately.
 * 3. The underlying HTML source file(s) via `/file-mutations/reorder-tracks/*`.
 */
export async function reorderTimelineTrackRows(params: {
  fromTrackNumber: number;
  toTrackNumber: number;
  displayTrackOrder: readonly number[];
  tracks: readonly (readonly [number, readonly TimelineElement[]])[];
  projectId?: string | null;
  activeCompPath?: string | null;
  iframe?: HTMLIFrameElement | null;
}): Promise<boolean> {
  const { fromTrackNumber, toTrackNumber, displayTrackOrder, tracks } = params;
  if (fromTrackNumber === toTrackNumber) return false;

  const trackMap = new Map<number, readonly TimelineElement[]>(tracks);
  const visualTracks = displayTrackOrder.filter((t) => {
    const els = trackMap.get(t) ?? [];
    return els.length > 0 && els.every((el) => el.tag !== "audio");
  });

  const fromIdx = visualTracks.indexOf(fromTrackNumber);
  const toIdx = visualTracks.indexOf(toTrackNumber);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return false;

  const minIdx = Math.min(fromIdx, toIdx);
  const maxIdx = Math.max(fromIdx, toIdx);

  // Available ascending track slots for [minIdx..maxIdx]
  const slotTracks = visualTracks
    .slice(minIdx, maxIdx + 1)
    .slice()
    .sort((a, b) => a - b);

  // Reorder the rows within [minIdx..maxIdx]
  const reorderedOldTracks = visualTracks.slice(minIdx, maxIdx + 1);
  const [movedTrack] = reorderedOldTracks.splice(fromIdx - minIdx, 1);
  if (movedTrack === undefined) return false;
  reorderedOldTracks.splice(toIdx - minIdx, 0, movedTrack);

  const previewIframe =
    params.iframe ??
    document.querySelector<HTMLIFrameElement>('iframe[title="Composition Preview"]');
  const doc = previewIframe?.contentDocument ?? null;

  const findLiveDomNode = (el: TimelineElement): HTMLElement | null => {
    if (!doc) return null;
    const rawId = el.domId ?? el.id;
    if (rawId) {
      const byId = doc.getElementById(rawId);
      if (byId) return byId;
      const byHf = doc.querySelector<HTMLElement>(`[data-hf-id="${CSS.escape(rawId)}"]`);
      if (byHf) return byHf;
    }
    if (el.hfId) {
      const byHf = doc.querySelector<HTMLElement>(`[data-hf-id="${CSS.escape(el.hfId)}"]`);
      if (byHf) return byHf;
    }
    return null;
  };

  const readCurrentZ = (els: readonly TimelineElement[]): number => {
    let best = 0;
    for (const el of els) {
      const domNode = findLiveDomNode(el);
      if (domNode) {
        const inlineZ = Number.parseInt(domNode.style.zIndex || "", 10);
        if (Number.isFinite(inlineZ)) {
          best = Math.max(best, inlineZ);
          continue;
        }
        const compZ = Number.parseInt(
          domNode.ownerDocument.defaultView?.getComputedStyle(domNode).zIndex ?? "",
          10,
        );
        if (Number.isFinite(compZ)) {
          best = Math.max(best, compZ);
          continue;
        }
      }
      if (typeof el.zIndex === "number" && Number.isFinite(el.zIndex)) {
        best = Math.max(best, el.zIndex);
      }
    }
    return best;
  };

  // Compute existing z bounds in the affected range so upper rows always have strictly higher z-index
  // than lower rows in the affected slice (top row = highest z = in front on canvas).
  const currentZs = reorderedOldTracks.map((oldTrk) => readCurrentZ(trackMap.get(oldTrk) ?? []));
  const highestExistingZ = Math.max(...currentZs, 20);
  const sliceLen = reorderedOldTracks.length;

  const storeUpdates: Array<{
    key: string;
    track: number;
    authoredTrack: number;
    zIndex: number;
  }> = [];

  const filePatches = new Map<
    string,
    Array<{
      target: ReturnType<typeof buildElementTarget>;
      trackIndex: number;
      zIndex: number;
    }>
  >();

  for (let i = 0; i < sliceLen; i++) {
    const oldTrack = reorderedOldTracks[i]!;
    const newTrack = slotTracks[i]!;
    // Strictly descending z-index from top of slice (i = 0) to bottom of slice (i = sliceLen - 1)
    const newZ = highestExistingZ + (sliceLen - i) * 10;
    const rowEls = trackMap.get(oldTrack) ?? [];

    for (const el of rowEls) {
      const key = el.key ?? el.id;
      storeUpdates.push({
        key,
        track: newTrack,
        authoredTrack: Math.round(newTrack),
        zIndex: newZ,
      });

      const domNode = findLiveDomNode(el);
      if (domNode) {
        const win = domNode.ownerDocument.defaultView;
        if (win && win.getComputedStyle(domNode).position === "static" && !domNode.style.position) {
          domNode.style.position = "relative";
        }
        domNode.style.zIndex = String(newZ);
        domNode.setAttribute("data-track-index", String(Math.round(newTrack)));

        const { sourceFile } = getSourceFileForElement(domNode, params.activeCompPath ?? null);
        const list = filePatches.get(sourceFile) ?? [];
        list.push({
          target: buildElementTarget(domNode, sourceFile, params.activeCompPath ?? null),
          trackIndex: Math.round(newTrack),
          zIndex: newZ,
        });
        filePatches.set(sourceFile, list);
      } else {
        const fallbackFile =
          el.sourceFile ??
          (el.parentCompositionId && el.parentCompositionId !== "main"
            ? `compositions/${el.parentCompositionId}.html`
            : params.activeCompPath || "index.html");
        const rawId = el.domId ?? el.id;
        const list = filePatches.get(fallbackFile) ?? [];
        list.push({
          target: {
            id: rawId,
            hfId: el.hfId ?? (rawId.startsWith("hf-") ? rawId : undefined),
            selector: rawId ? `#${rawId}` : undefined,
          },
          trackIndex: Math.round(newTrack),
          zIndex: newZ,
        });
        filePatches.set(fallbackFile, list);
      }
    }
  }

  // Apply optimistic store updates immediately so timeline rows swap on this frame
  const store = usePlayerStore.getState();
  batchElementUpdates(() => {
    for (const u of storeUpdates) {
      store.updateElement(u.key, {
        track: u.track,
        authoredTrack: u.authoredTrack,
        zIndex: u.zIndex,
      });
    }
  });

  // Persist to HTML source files on disk if projectId is available
  const resolvedProjectId = params.projectId || store.timelineProjectId;
  if (resolvedProjectId) {
    const noopWrite = async () => true;
    const noopRecord = () => {};
    for (const [sourceFile, entries] of filePatches.entries()) {
      if (entries.length === 0) continue;
      await saveServerRewriteWithHistory({
        projectId: resolvedProjectId,
        path: sourceFile,
        label: "Reorder layer track & z-index",
        writeFile: noopWrite,
        recordEdit: noopRecord,
        rewrite: async (originalContent) => {
          const response = await studioApiFetch(
            buildProjectApiPath(
              resolvedProjectId,
              `/file-mutations/reorder-tracks/${encodeURIComponent(sourceFile)}`,
            ),
            {
              method: "POST",
              headers: { "Content-Type": "application/json", ...studioWriteHeaders() },
              body: JSON.stringify({ entries }),
            },
          );
          if (!response.ok) return null;
          const data = (await response.json()) as { changed?: boolean; content?: string };
          if (!data.changed) return null;
          return {
            disk: typeof data.content === "string" ? data.content : originalContent,
          };
        },
      }).catch(() => {});
    }
  }

  return true;
}

/**
 * Toggles `data-hidden` on a live DOM element in the preview iframe and persists
 * the change to the element's underlying HTML source file.
 */
export async function toggleDomLayerHidden(params: {
  element: HTMLElement;
  projectId?: string | null;
  activeCompPath?: string | null;
}): Promise<boolean> {
  const { element, activeCompPath } = params;
  const nextHidden = !element.hasAttribute("data-hidden");

  if (nextHidden) {
    element.setAttribute("data-hidden", "");
    element.style.visibility = "hidden";
  } else {
    element.removeAttribute("data-hidden");
    element.style.visibility = "";
  }

  // Also sync timeline element hidden flag if present in usePlayerStore
  const store = usePlayerStore.getState();
  const elemId = element.id || element.getAttribute("data-hf-id");
  if (elemId) {
    for (const el of store.elements) {
      if (el.domId === elemId || el.id === elemId || el.hfId === elemId) {
        store.updateElement(el.key ?? el.id, { hidden: nextHidden });
      }
    }
  }

  const resolvedProjectId = params.projectId || store.timelineProjectId;
  if (!resolvedProjectId) return nextHidden;

  const { sourceFile } = getSourceFileForElement(element, activeCompPath ?? null);
  const target = buildElementTarget(element, sourceFile, activeCompPath ?? null);

  await studioApiFetch(
    buildProjectApiPath(resolvedProjectId, "/file-mutations/patch-element-batches"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...studioWriteHeaders() },
      body: JSON.stringify({
        batches: [
          {
            sourceFile,
            patches: [
              {
                target,
                operations: [
                  {
                    type: "attribute",
                    property: "data-hidden",
                    value: nextHidden ? "" : null,
                  },
                ],
              },
            ],
          },
        ],
      }),
    },
  ).catch(() => {});

  return nextHidden;
}

/**
 * Toggles the `data-locked` attribute on a DOM element in-place and persists
 * the change to the element's underlying HTML source file. When locked, the
 * element is ignored by canvas hit-testing so underlying/surrounding elements
 * can be freely selected and edited.
 */
export async function toggleDomLayerLocked(params: {
  element: HTMLElement;
  projectId?: string | null;
  activeCompPath?: string | null;
}): Promise<boolean> {
  const { element, activeCompPath } = params;
  const isCurrentlyLocked =
    element.hasAttribute("data-locked") || element.hasAttribute("data-timeline-locked");
  const nextLocked = !isCurrentlyLocked;

  if (nextLocked) {
    element.setAttribute("data-locked", "true");
  } else {
    element.removeAttribute("data-locked");
    element.removeAttribute("data-timeline-locked");
  }

  // Also sync timeline element timelineLocked flag if present in usePlayerStore
  const store = usePlayerStore.getState();
  const elemId = element.id || element.getAttribute("data-hf-id");
  if (elemId) {
    for (const el of store.elements) {
      if (el.domId === elemId || el.id === elemId || el.hfId === elemId) {
        store.updateElement(el.key ?? el.id, { timelineLocked: nextLocked });
      }
    }
  }

  const resolvedProjectId = params.projectId || store.timelineProjectId;
  if (!resolvedProjectId) return nextLocked;

  const { sourceFile } = getSourceFileForElement(element, activeCompPath ?? null);
  const target = buildElementTarget(element, sourceFile, activeCompPath ?? null);

  await studioApiFetch(
    buildProjectApiPath(resolvedProjectId, "/file-mutations/patch-element-batches"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...studioWriteHeaders() },
      body: JSON.stringify({
        batches: [
          {
            sourceFile,
            patches: [
              {
                target,
                operations: [
                  {
                    type: "attribute",
                    property: "data-locked",
                    value: nextLocked ? "true" : null,
                  },
                ],
              },
            ],
          },
        ],
      }),
    },
  ).catch(() => {});

  return nextLocked;
}
