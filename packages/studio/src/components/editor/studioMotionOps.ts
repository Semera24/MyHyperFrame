// ── Manifest parse, serialize, and CRUD operations ──

import type { DomEditSelection } from "./domEditing";
import {
  DEFAULT_CUSTOM_EASE_POINTS,
  GSAP_EASE_CONTROL_POINTS,
  CUSTOM_EASE_DATA_PATTERN,
  STUDIO_MOTION_ATTR,
  STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR,
  STUDIO_MOTION_ORIGINAL_OPACITY_ATTR,
  STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR,
  STUDIO_MOTION_ORIGINAL_CLIP_PATH_ATTR,
  STUDIO_MOTION_ORIGINAL_FILTER_ATTR,
  STUDIO_MOTION_ORIGINAL_BG_COLOR_ATTR,
  STUDIO_MOTION_ORIGINAL_BORDER_COLOR_ATTR,
  STUDIO_MOTION_ORIGINAL_COLOR_ATTR,
  type StudioCustomEaseControlPoints,
  type StudioGsapCustomEase,
  type StudioGsapMotion,
  type StudioGsapMotionDirection,
  type StudioGsapMotionPreset,
  type StudioGsapPresetMotionOptions,
  type StudioGsapMotionValues,
  type StudioMotionCategory,
  type StudioMotionKeyframe,
  type StudioMotionManifest,
  type StudioMotionPathConfig,
  type StudioMotionStylePreset,
  type StudioMotionTarget,
  type StudioSceneTransitionConfig,
} from "./studioMotionTypes";
import { roundTo3 } from "../../utils/rounding";

// ── Private helpers ──

function clampPositiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampNonNegativeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function sanitizeEase(value: string): string {
  return value.trim() || "none";
}

function roundEaseNumber(value: number): number {
  return roundTo3(value);
}

function clampRange(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function formatEaseNumber(value: number): string {
  const rounded = roundEaseNumber(value);
  if (Object.is(rounded, -0)) return "0";
  return `${rounded}`;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ── Custom ease points ──

export function clampStudioCustomEasePoints(
  points: Partial<StudioCustomEaseControlPoints>,
): StudioCustomEaseControlPoints {
  return {
    x1: roundEaseNumber(clampRange(points.x1 ?? DEFAULT_CUSTOM_EASE_POINTS.x1, 0, 1, 0.215)),
    y1: roundEaseNumber(clampRange(points.y1 ?? DEFAULT_CUSTOM_EASE_POINTS.y1, -0.6, 1.6, 0.61)),
    x2: roundEaseNumber(clampRange(points.x2 ?? DEFAULT_CUSTOM_EASE_POINTS.x2, 0, 1, 0.355)),
    y2: roundEaseNumber(clampRange(points.y2 ?? DEFAULT_CUSTOM_EASE_POINTS.y2, -0.6, 1.6, 1)),
  };
}

export function parseStudioCustomEaseData(
  data: string | undefined,
): StudioCustomEaseControlPoints | null {
  if (!data) return null;
  const match = data.trim().match(CUSTOM_EASE_DATA_PATTERN);
  if (!match) return null;
  const points = {
    x1: Number.parseFloat(match[1] ?? ""),
    y1: Number.parseFloat(match[2] ?? ""),
    x2: Number.parseFloat(match[3] ?? ""),
    y2: Number.parseFloat(match[4] ?? ""),
  };
  if (!Object.values(points).every(Number.isFinite)) return null;
  return clampStudioCustomEasePoints(points);
}

export function serializeStudioCustomEaseData(points: StudioCustomEaseControlPoints): string {
  const clamped = clampStudioCustomEasePoints(points);
  return `M0,0 C${formatEaseNumber(clamped.x1)},${formatEaseNumber(clamped.y1)} ${formatEaseNumber(clamped.x2)},${formatEaseNumber(clamped.y2)} 1,1`;
}

export function controlPointsForGsapEase(ease: string): StudioCustomEaseControlPoints {
  return GSAP_EASE_CONTROL_POINTS[ease] ?? DEFAULT_CUSTOM_EASE_POINTS;
}

// ── Preset motion builder ──

export function buildStudioGsapPresetMotion(
  preset: StudioGsapMotionPreset,
  options: StudioGsapPresetMotionOptions,
): Omit<StudioGsapMotion, "kind" | "target" | "updatedAt"> {
  const start = clampNonNegativeNumber(options.start, 0);
  const duration = clampPositiveNumber(options.duration, 0.6);
  const distance = clampPositiveNumber(options.distance, 32);
  const ease = sanitizeEase(options.ease);
  const direction = options.direction ?? "up";
  const base = { start, duration, ease, customEase: options.customEase };

  if (preset === "pop") {
    return {
      ...base,
      from: { scale: 0.88, autoAlpha: 0 },
      to: { scale: 1, autoAlpha: 1 },
    };
  }

  if (preset === "slide") {
    const x = direction === "right" ? -distance : direction === "left" ? distance : 0;
    const y = direction === "down" ? -distance : direction === "up" ? distance : 0;
    return {
      ...base,
      from: { x, y, autoAlpha: 0 },
      to: { x: 0, y: 0, autoAlpha: 1 },
    };
  }

  return {
    ...base,
    from: { y: direction === "down" ? -distance : distance, autoAlpha: 0 },
    to: { y: 0, autoAlpha: 1 },
  };
}

// ── Manifest parse/serialize ──

function parseMotionValues(
  value: unknown,
  allowStyleStrings = false,
): StudioGsapMotionValues | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const parsed: StudioGsapMotionValues = {};
  for (const key of [
    "x",
    "y",
    "scale",
    "scaleX",
    "scaleY",
    "rotation",
    "opacity",
    "autoAlpha",
  ] as const) {
    const next = finiteNumber(record[key]);
    if (next != null) parsed[key] = next;
  }
  if (allowStyleStrings) {
    for (const key of ["clipPath", "filter", "backgroundColor", "borderColor", "color"] as const) {
      const next = typeof record[key] === "string" ? record[key].trim() : "";
      if (next) parsed[key] = next;
    }
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
}

function parseKeyframes(value: unknown): StudioMotionKeyframe[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const keyframes: StudioMotionKeyframe[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const progress = finiteNumber(rec.progress);
    const values = parseMotionValues(rec.values, true);
    if (progress == null || progress < 0 || progress > 1 || !values) continue;
    const ease = typeof rec.ease === "string" && rec.ease.trim() ? rec.ease.trim() : undefined;
    keyframes.push({ progress, values, ...(ease ? { ease } : {}) });
  }
  return keyframes.length > 0 ? keyframes : undefined;
}

function parseMotionPath(value: unknown): StudioMotionPathConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  const type = rec.type;
  if (
    type !== "line" &&
    type !== "arc" &&
    type !== "curve" &&
    type !== "turn" &&
    type !== "custom"
  ) {
    return undefined;
  }
  if (!Array.isArray(rec.points)) return undefined;
  const points: Array<{ x: number; y: number }> = [];
  for (const pt of rec.points) {
    if (!pt || typeof pt !== "object") continue;
    const pr = pt as Record<string, unknown>;
    const x = finiteNumber(pr.x);
    const y = finiteNumber(pr.y);
    if (x != null && y != null) points.push({ x, y });
  }
  if (points.length < 2) return undefined;
  return {
    type,
    points,
    ...(typeof rec.reverse === "boolean" ? { reverse: rec.reverse } : {}),
  };
}

function parseTransitionConfig(value: unknown): StudioSceneTransitionConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  const fromSceneId = typeof rec.fromSceneId === "string" ? rec.fromSceneId : "";
  const toSceneId = typeof rec.toSceneId === "string" ? rec.toSceneId : "";
  const cutTime = finiteNumber(rec.cutTime);
  const type = rec.type;
  if (
    !fromSceneId ||
    !toSceneId ||
    cutTime == null ||
    (type !== "cut" &&
      type !== "crossfade" &&
      type !== "push" &&
      type !== "wipe" &&
      type !== "reveal" &&
      type !== "split" &&
      type !== "zoom" &&
      type !== "morph")
  ) {
    return undefined;
  }
  return {
    fromSceneId,
    toSceneId,
    cutTime,
    type,
    ...(typeof rec.direction === "string"
      ? { direction: rec.direction as StudioGsapMotionDirection }
      : {}),
  };
}

function parseTarget(value: unknown): StudioMotionTarget | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const sourceFile = typeof record.sourceFile === "string" ? record.sourceFile : "";
  if (!sourceFile) return null;
  const selector = typeof record.selector === "string" ? record.selector : undefined;
  const id = typeof record.id === "string" ? record.id : undefined;
  if (!selector && !id) return null;
  return {
    sourceFile,
    selector,
    selectorIndex: finiteNumber(record.selectorIndex) ?? undefined,
    id,
  };
}

function parseCustomEase(value: unknown): StudioGsapCustomEase | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const data = typeof record.data === "string" ? record.data.trim() : "";
  if (!id || !data) return undefined;
  return { id, data };
}

function parseGsapMotion(value: unknown): StudioGsapMotion | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== "gsap-motion") return null;
  const target = parseTarget(record.target);
  if (!target) return null;
  const start = finiteNumber(record.start);
  const duration = finiteNumber(record.duration);
  if (start == null || duration == null || start < 0 || duration <= 0) return null;
  const ease = typeof record.ease === "string" && record.ease.trim() ? record.ease.trim() : "none";
  const allowStyleStrings = Boolean(
    record.presetId || record.category || record.id || record.keyframes || record.transition,
  );
  const from = parseMotionValues(record.from, allowStyleStrings);
  const to = parseMotionValues(record.to, allowStyleStrings);
  if (!from || !to) return null;
  const keyframes = parseKeyframes(record.keyframes);
  const motionPath = parseMotionPath(record.motionPath);
  const transition = parseTransitionConfig(record.transition);
  return {
    ...(typeof record.id === "string" && record.id ? { id: record.id } : {}),
    ...(typeof record.name === "string" && record.name ? { name: record.name } : {}),
    ...(typeof record.presetId === "string" && record.presetId
      ? { presetId: record.presetId }
      : {}),
    ...(typeof record.category === "string"
      ? { category: record.category as StudioMotionCategory }
      : {}),
    ...(typeof record.stylePreset === "string"
      ? { stylePreset: record.stylePreset as StudioMotionStylePreset }
      : {}),
    kind: "gsap-motion",
    target,
    start,
    duration,
    ...(finiteNumber(record.delay) != null ? { delay: finiteNumber(record.delay)! } : {}),
    ...(finiteNumber(record.holdDuration) != null
      ? { holdDuration: finiteNumber(record.holdDuration)! }
      : {}),
    ...(typeof record.direction === "string"
      ? { direction: record.direction as StudioGsapMotionDirection }
      : {}),
    ...(finiteNumber(record.distance) != null ? { distance: finiteNumber(record.distance)! } : {}),
    ease,
    customEase: parseCustomEase(record.customEase),
    from,
    to,
    ...(keyframes ? { keyframes } : {}),
    ...(motionPath ? { motionPath } : {}),
    ...(transition ? { transition } : {}),
    ...(finiteNumber(record.order) != null ? { order: finiteNumber(record.order)! } : {}),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

export function emptyStudioMotionManifest(): StudioMotionManifest {
  return { version: 1, motions: [] };
}

export function parseStudioMotionManifest(content: string): StudioMotionManifest {
  if (!content.trim()) return emptyStudioMotionManifest();
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyStudioMotionManifest();
    const motions = (parsed as { motions?: unknown }).motions;
    if (!Array.isArray(motions)) return emptyStudioMotionManifest();
    return {
      version: 1,
      motions: motions
        .map(parseGsapMotion)
        .filter((motion): motion is StudioGsapMotion => motion !== null),
    };
  } catch {
    return emptyStudioMotionManifest();
  }
}

export function serializeStudioMotionManifest(manifest: StudioMotionManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// ── Path helpers ──

function normalizeStudioFileChangePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

export function isStudioMotionManifestPath(path: string | null): boolean {
  if (!path) return false;
  const normalized = normalizeStudioFileChangePath(path);
  return (
    normalized === "." + "/" + ".hyperframes/studio-motion.json".slice(1) ||
    normalized === ".hyperframes/studio-motion.json" ||
    normalized.endsWith("/.hyperframes/studio-motion.json")
  );
}

// ── CRUD helpers ──

export function selectionTarget(selection: DomEditSelection): StudioMotionTarget {
  return {
    sourceFile: selection.sourceFile || "index.html",
    selector: selection.selector,
    selectorIndex: selection.selectorIndex,
    id: selection.id ?? undefined,
  };
}

export function targetKey(target: StudioMotionTarget): string {
  return [
    target.sourceFile,
    target.id ? `id:${target.id}` : "",
    target.selector ? `selector:${target.selector}` : "",
    target.selectorIndex != null ? `index:${target.selectorIndex}` : "",
  ].join("|");
}

export function sameSelectionTarget(
  motion: StudioGsapMotion,
  selection: DomEditSelection,
): boolean {
  const target = selectionTarget(selection);
  if (motion.target.sourceFile !== target.sourceFile) return false;
  if (motion.target.id && target.id && motion.target.id === target.id) return true;
  return targetKey(motion.target) === targetKey(target);
}

export function upsertStudioGsapMotion(
  manifest: StudioMotionManifest,
  selection: DomEditSelection,
  motion: Omit<StudioGsapMotion, "kind" | "target" | "updatedAt">,
): StudioMotionManifest {
  const target = selectionTarget(selection);
  const nextMotion: StudioGsapMotion = {
    kind: "gsap-motion",
    target,
    ...motion,
    updatedAt: new Date().toISOString(),
  };
  return {
    version: 1,
    motions: [
      ...manifest.motions.filter((existing) => targetKey(existing.target) !== targetKey(target)),
      nextMotion,
    ],
  };
}

export function addStudioGsapMotion(
  manifest: StudioMotionManifest,
  target: StudioMotionTarget,
  motion: Omit<StudioGsapMotion, "kind" | "target" | "updatedAt">,
): StudioMotionManifest {
  const id =
    motion.id ?? `motion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const nextMotion: StudioGsapMotion = {
    ...motion,
    id,
    kind: "gsap-motion",
    target,
    order: motion.order ?? manifest.motions.length,
    updatedAt: new Date().toISOString(),
  };
  return {
    version: 1,
    motions: [...manifest.motions, nextMotion],
  };
}

export function updateStudioGsapMotionById(
  manifest: StudioMotionManifest,
  motionId: string,
  patch: Partial<Omit<StudioGsapMotion, "kind">>,
): StudioMotionManifest {
  return {
    version: 1,
    motions: manifest.motions.map((motion) =>
      motion.id === motionId
        ? { ...motion, ...patch, id: motionId, updatedAt: new Date().toISOString() }
        : motion,
    ),
  };
}

export function removeStudioGsapMotionById(
  manifest: StudioMotionManifest,
  motionId: string,
): StudioMotionManifest {
  return {
    version: 1,
    motions: manifest.motions.filter((motion) => motion.id !== motionId),
  };
}

export function duplicateStudioGsapMotionById(
  manifest: StudioMotionManifest,
  motionId: string,
): { manifest: StudioMotionManifest; duplicatedId: string | null } {
  const idx = manifest.motions.findIndex((m) => m.id === motionId);
  if (idx < 0) return { manifest, duplicatedId: null };
  const source = manifest.motions[idx]!;
  const duplicatedId = `motion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const copy: StudioGsapMotion = {
    ...source,
    id: duplicatedId,
    name: source.name ? `${source.name} (Copy)` : undefined,
    start: roundTo3(source.start + source.duration + 0.1),
    order: (source.order ?? idx) + 1,
    updatedAt: new Date().toISOString(),
  };
  const next = [...manifest.motions];
  next.splice(idx + 1, 0, copy);
  return {
    manifest: { version: 1, motions: next },
    duplicatedId,
  };
}

export function reorderStudioGsapMotionById(
  manifest: StudioMotionManifest,
  motionId: string,
  direction: "up" | "down",
): StudioMotionManifest {
  const targetMotion = manifest.motions.find((m) => m.id === motionId);
  if (!targetMotion) return manifest;
  const key = targetKey(targetMotion.target);
  const siblingIndices = manifest.motions
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => targetKey(m.target) === key)
    .map(({ idx }) => idx);
  const pos = siblingIndices.indexOf(manifest.motions.indexOf(targetMotion));
  const swapPos = direction === "up" ? pos - 1 : pos + 1;
  if (pos < 0 || swapPos < 0 || swapPos >= siblingIndices.length) return manifest;
  const idxA = siblingIndices[pos]!;
  const idxB = siblingIndices[swapPos]!;
  const next = [...manifest.motions];
  const temp = next[idxA]!;
  next[idxA] = next[idxB]!;
  next[idxB] = temp;
  return {
    version: 1,
    motions: next.map((m, i) => ({ ...m, order: i })),
  };
}

export function removeStudioMotionForSelection(
  manifest: StudioMotionManifest,
  selection: DomEditSelection,
): StudioMotionManifest {
  return {
    version: 1,
    motions: manifest.motions.filter((motion) => !sameSelectionTarget(motion, selection)),
  };
}

export function getStudioMotionForSelection(
  manifest: StudioMotionManifest,
  selection: DomEditSelection,
): StudioGsapMotion | null {
  return manifest.motions.find((motion) => sameSelectionTarget(motion, selection)) ?? null;
}

export function getStudioMotionsForSelection(
  manifest: StudioMotionManifest,
  selection: DomEditSelection,
): StudioGsapMotion[] {
  return manifest.motions.filter((motion) => sameSelectionTarget(motion, selection));
}

// ── HTML-attribute–backed motion storage ──

export type StudioElementMotionPayload = Omit<StudioGsapMotion, "kind" | "target" | "updatedAt">;

function parseSingleElementMotionPayload(
  record: Record<string, unknown>,
  allowStyleStrings = false,
): StudioElementMotionPayload | null {
  const start = finiteNumber(record.start);
  const duration = finiteNumber(record.duration);
  if (start == null || duration == null || start < 0 || duration <= 0) return null;
  const ease = typeof record.ease === "string" && record.ease.trim() ? record.ease.trim() : "none";
  const hasExtendedMeta =
    allowStyleStrings ||
    Boolean(
      record.presetId || record.category || record.id || record.keyframes || record.transition,
    );
  const from = parseMotionValues(record.from, hasExtendedMeta);
  const to = parseMotionValues(record.to, hasExtendedMeta);
  if (!from || !to) return null;
  const base: StudioElementMotionPayload = {
    start,
    duration,
    ease,
    customEase: parseCustomEase(record.customEase),
    from,
    to,
  };
  if (typeof record.id === "string" && record.id) base.id = record.id;
  if (typeof record.name === "string" && record.name) base.name = record.name;
  if (typeof record.presetId === "string" && record.presetId) base.presetId = record.presetId;
  if (typeof record.category === "string") base.category = record.category as StudioMotionCategory;
  if (typeof record.stylePreset === "string")
    base.stylePreset = record.stylePreset as StudioMotionStylePreset;
  if (finiteNumber(record.delay) != null) base.delay = finiteNumber(record.delay)!;
  if (finiteNumber(record.holdDuration) != null)
    base.holdDuration = finiteNumber(record.holdDuration)!;
  if (typeof record.direction === "string")
    base.direction = record.direction as StudioGsapMotionDirection;
  if (finiteNumber(record.distance) != null) base.distance = finiteNumber(record.distance)!;
  const keyframes = parseKeyframes(record.keyframes);
  if (keyframes) base.keyframes = keyframes;
  const motionPath = parseMotionPath(record.motionPath);
  if (motionPath) base.motionPath = motionPath;
  const transition = parseTransitionConfig(record.transition);
  if (transition) base.transition = transition;
  if (finiteNumber(record.order) != null) base.order = finiteNumber(record.order)!;
  return base;
}

export function readStudioMotionFromElement(
  element: HTMLElement,
): StudioElementMotionPayload | null {
  const json = element.getAttribute(STUDIO_MOTION_ATTR);
  if (!json || json === "true") return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    if (Array.isArray((parsed as { motions?: unknown }).motions)) {
      const list = (parsed as { motions: unknown[] }).motions;
      for (const item of list) {
        if (item && typeof item === "object") {
          const first = parseSingleElementMotionPayload(item as Record<string, unknown>, true);
          if (first) return first;
        }
      }
      return null;
    }
    return parseSingleElementMotionPayload(parsed as Record<string, unknown>, false);
  } catch {
    return null;
  }
}

export function readStudioMotionsFromElement(element: HTMLElement): StudioElementMotionPayload[] {
  const json = element.getAttribute(STUDIO_MOTION_ATTR);
  if (!json || json === "true") return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    if (Array.isArray((parsed as { motions?: unknown }).motions)) {
      return ((parsed as { motions: unknown[] }).motions ?? [])
        .map((item) =>
          item && typeof item === "object"
            ? parseSingleElementMotionPayload(item as Record<string, unknown>, true)
            : null,
        )
        .filter((item): item is StudioElementMotionPayload => item !== null);
    }
    const single = parseSingleElementMotionPayload(parsed as Record<string, unknown>, true);
    return single ? [single] : [];
  } catch {
    return [];
  }
}

function ensureOriginalElementMotionAttrs(element: HTMLElement): void {
  if (!element.getAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR)) {
    element.setAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR, element.style.transform);
    element.setAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR, element.style.opacity);
    element.setAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR, element.style.visibility);
    element.setAttribute(STUDIO_MOTION_ORIGINAL_CLIP_PATH_ATTR, element.style.clipPath);
    element.setAttribute(STUDIO_MOTION_ORIGINAL_FILTER_ATTR, element.style.filter);
    element.setAttribute(STUDIO_MOTION_ORIGINAL_BG_COLOR_ATTR, element.style.backgroundColor);
    element.setAttribute(STUDIO_MOTION_ORIGINAL_BORDER_COLOR_ATTR, element.style.borderColor);
    element.setAttribute(STUDIO_MOTION_ORIGINAL_COLOR_ATTR, element.style.color);
  }
}

export function writeStudioMotionToElement(
  element: HTMLElement,
  motion: StudioElementMotionPayload,
): void {
  if (!element.getAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR)) {
    element.setAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR, element.style.transform);
    element.setAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR, element.style.opacity);
    element.setAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR, element.style.visibility);
  }
  const payload: StudioElementMotionPayload = {
    start: motion.start,
    duration: motion.duration,
    ease: motion.ease,
    from: motion.from,
    to: motion.to,
  };
  if (motion.customEase) payload.customEase = motion.customEase;
  if (motion.id) payload.id = motion.id;
  if (motion.name) payload.name = motion.name;
  if (motion.presetId) payload.presetId = motion.presetId;
  if (motion.category) payload.category = motion.category;
  if (motion.stylePreset) payload.stylePreset = motion.stylePreset;
  if (motion.delay != null) payload.delay = motion.delay;
  if (motion.holdDuration != null) payload.holdDuration = motion.holdDuration;
  if (motion.direction) payload.direction = motion.direction;
  if (motion.distance != null) payload.distance = motion.distance;
  if (motion.keyframes) payload.keyframes = motion.keyframes;
  if (motion.motionPath) payload.motionPath = motion.motionPath;
  if (motion.transition) payload.transition = motion.transition;
  if (motion.order != null) payload.order = motion.order;
  element.setAttribute(STUDIO_MOTION_ATTR, JSON.stringify(payload));
}

export function writeStudioMotionsToElement(
  element: HTMLElement,
  motions: StudioElementMotionPayload[],
): void {
  if (motions.length === 0) {
    clearStudioMotionFromElement(element);
    return;
  }
  ensureOriginalElementMotionAttrs(element);
  if (motions.length === 1) {
    writeStudioMotionToElement(element, motions[0]!);
    return;
  }
  element.setAttribute(STUDIO_MOTION_ATTR, JSON.stringify({ version: 1, motions }));
}

export function clearStudioMotionFromElement(
  element: HTMLElement,
  gsap?: { set?: (target: HTMLElement, vars: Record<string, unknown>) => void },
): void {
  if (!element.hasAttribute(STUDIO_MOTION_ATTR)) return;
  gsap?.set?.(element, {
    clearProps: "transform,opacity,visibility,clipPath,filter,backgroundColor,borderColor,color",
  });
  element.style.transform = element.getAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR) ?? "";
  element.style.opacity = element.getAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR) ?? "";
  element.style.visibility = element.getAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR) ?? "";
  if (element.hasAttribute(STUDIO_MOTION_ORIGINAL_CLIP_PATH_ATTR)) {
    element.style.clipPath = element.getAttribute(STUDIO_MOTION_ORIGINAL_CLIP_PATH_ATTR) ?? "";
  }
  if (element.hasAttribute(STUDIO_MOTION_ORIGINAL_FILTER_ATTR)) {
    element.style.filter = element.getAttribute(STUDIO_MOTION_ORIGINAL_FILTER_ATTR) ?? "";
  }
  if (element.hasAttribute(STUDIO_MOTION_ORIGINAL_BG_COLOR_ATTR)) {
    element.style.backgroundColor =
      element.getAttribute(STUDIO_MOTION_ORIGINAL_BG_COLOR_ATTR) ?? "";
  }
  if (element.hasAttribute(STUDIO_MOTION_ORIGINAL_BORDER_COLOR_ATTR)) {
    element.style.borderColor =
      element.getAttribute(STUDIO_MOTION_ORIGINAL_BORDER_COLOR_ATTR) ?? "";
  }
  if (element.hasAttribute(STUDIO_MOTION_ORIGINAL_COLOR_ATTR)) {
    element.style.color = element.getAttribute(STUDIO_MOTION_ORIGINAL_COLOR_ATTR) ?? "";
  }
  element.removeAttribute(STUDIO_MOTION_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_CLIP_PATH_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_FILTER_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_BG_COLOR_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_BORDER_COLOR_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_COLOR_ATTR);
}
