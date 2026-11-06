import type {
  StudioElementMotionPayload,
  StudioGsapCustomEase,
  StudioGsapMotionDirection,
  StudioGsapMotionValues,
  StudioMotionCategory,
  StudioMotionKeyframe,
  StudioMotionPathConfig,
  StudioMotionPathPoint,
  StudioMotionStylePreset,
  StudioSceneTransitionConfig,
} from "./studioMotion";
import { roundTo3 } from "../../utils/rounding";

export const STUDIO_MOTION_DRAG_MIME = "application/x-hyperframes-motion";

export interface StudioMotionDragPayload {
  presetId: string;
  category: StudioMotionCategory;
  stylePreset: StudioMotionStylePreset;
  /** Optional existing motion block ID when dragging an already-applied motion block on the timeline */
  existingMotionId?: string;
}

export interface MotionStyleProfile {
  id: StudioMotionStylePreset;
  label: string;
  description: string;
  durationMultiplier: number;
  distanceMultiplier: number;
  intensityMultiplier: number;
  defaultEase: string;
}

export const MOTION_STYLE_PROFILES: Record<StudioMotionStylePreset, MotionStyleProfile> = {
  subtle: {
    id: "subtle",
    label: "Subtle",
    description: "Quiet, slow-paced movement for solemn historical passages.",
    durationMultiplier: 1.2,
    distanceMultiplier: 0.65,
    intensityMultiplier: 0.65,
    defaultEase: "sine.inOut",
  },
  documentary: {
    id: "documentary",
    label: "Documentary",
    description: "Purposeful narration-paced movement for Turning Point Stories.",
    durationMultiplier: 1.0,
    distanceMultiplier: 1.0,
    intensityMultiplier: 1.0,
    defaultEase: "power2.out",
  },
  energetic: {
    id: "energetic",
    label: "Energetic",
    description: "Crisp, higher-contrast motion for hooks and turning points.",
    durationMultiplier: 0.75,
    distanceMultiplier: 1.4,
    intensityMultiplier: 1.35,
    defaultEase: "back.out(1.7)",
  },
};

export interface MotionPresetDefinition {
  id: string;
  name: string;
  category: StudioMotionCategory;
  family: "core-batch-1" | "extended-family";
  summary: string;
  defaultDuration: number;
  defaultDistance?: number;
  defaultDirection?: StudioGsapMotionDirection;
  defaultEase: string;
  defaultHoldDuration?: number;
  supportsDirection?: boolean;
  supportsDistance?: boolean;
  supportsScale?: boolean;
  supportsRotation?: boolean;
  supportsColor?: boolean;
  supportsHold?: boolean;
  supportsPath?: boolean;
  previewAnimClass: string;
}

export const MOTION_PRESET_CATALOG: readonly MotionPresetDefinition[] = [
  // ── ENTRANCE (15) ──────────────────────────────────────────────────────────
  {
    id: "entrance-appear",
    name: "Appear",
    category: "entrance",
    family: "core-batch-1",
    summary: "Immediate, clean appearance on cue without spatial drift.",
    defaultDuration: 0.12,
    defaultEase: "none",
    previewAnimClass: "appear",
  },
  {
    id: "entrance-fade-in",
    name: "Fade In",
    category: "entrance",
    family: "core-batch-1",
    summary: "Smooth opacity dissolve from transparent to full presence.",
    defaultDuration: 0.75,
    defaultEase: "power2.out",
    previewAnimClass: "fade-in",
  },
  {
    id: "entrance-rise-up",
    name: "Rise Up",
    category: "entrance",
    family: "core-batch-1",
    summary: "Signature documentary upward settle for headlines and archival cards.",
    defaultDuration: 0.85,
    defaultDistance: 28,
    defaultDirection: "up",
    defaultEase: "power3.out",
    supportsDirection: true,
    supportsDistance: true,
    previewAnimClass: "rise-up",
  },
  {
    id: "entrance-fly-in",
    name: "Fly / Slide In",
    category: "entrance",
    family: "core-batch-1",
    summary: "Directional slide entrance from up, down, left, or right.",
    defaultDuration: 0.75,
    defaultDistance: 64,
    defaultDirection: "left",
    defaultEase: "power3.out",
    supportsDirection: true,
    supportsDistance: true,
    previewAnimClass: "slide-in",
  },
  {
    id: "entrance-pop",
    name: "Pop / Scale",
    category: "entrance",
    family: "core-batch-1",
    summary: "Controlled scale-in with subtle settle for callouts and badges.",
    defaultDuration: 0.65,
    defaultEase: "back.out(1.7)",
    supportsScale: true,
    previewAnimClass: "pop-in",
  },
  {
    id: "entrance-wipe",
    name: "Wipe",
    category: "entrance",
    family: "core-batch-1",
    summary: "Directional clip-path reveal ideal for maps, timelines, and lower thirds.",
    defaultDuration: 0.8,
    defaultDirection: "right",
    defaultEase: "power2.inOut",
    supportsDirection: true,
    previewAnimClass: "wipe-in",
  },
  {
    id: "entrance-peek-in",
    name: "Peek In",
    category: "entrance",
    family: "extended-family",
    summary: "Cropped edge reveal combined with a short slide.",
    defaultDuration: 0.7,
    defaultDistance: 24,
    defaultDirection: "up",
    defaultEase: "power2.out",
    supportsDirection: true,
    supportsDistance: true,
    previewAnimClass: "peek-in",
  },
  {
    id: "entrance-zoom",
    name: "Zoom",
    category: "entrance",
    family: "extended-family",
    summary: "Smooth depth zoom from 78% scale to rest.",
    defaultDuration: 0.8,
    defaultEase: "power2.out",
    supportsScale: true,
    previewAnimClass: "zoom-in",
  },
  {
    id: "entrance-split",
    name: "Split",
    category: "entrance",
    family: "extended-family",
    summary: "Center-outward horizontal or vertical curtain reveal.",
    defaultDuration: 0.75,
    defaultDirection: "out",
    defaultEase: "power2.inOut",
    supportsDirection: true,
    previewAnimClass: "split-in",
  },
  {
    id: "entrance-expand",
    name: "Expand",
    category: "entrance",
    family: "extended-family",
    summary: "Horizontal width expansion for banners and dividers.",
    defaultDuration: 0.7,
    defaultEase: "power3.out",
    supportsScale: true,
    previewAnimClass: "expand-in",
  },
  {
    id: "entrance-stretch",
    name: "Stretch",
    category: "entrance",
    family: "extended-family",
    summary: "Elastic aspect-ratio settle into place.",
    defaultDuration: 0.75,
    defaultEase: "back.out(1.7)",
    supportsScale: true,
    previewAnimClass: "stretch-in",
  },
  {
    id: "entrance-box",
    name: "Box",
    category: "entrance",
    family: "extended-family",
    summary: "Rectangular frame iris expanding from center to full bounds.",
    defaultDuration: 0.75,
    defaultEase: "power2.out",
    previewAnimClass: "box-in",
  },
  {
    id: "entrance-blinds",
    name: "Blinds",
    category: "entrance",
    family: "extended-family",
    summary: "Horizontal slat-style vertical fold reveal.",
    defaultDuration: 0.75,
    defaultDirection: "down",
    defaultEase: "power2.out",
    supportsDirection: true,
    previewAnimClass: "blinds-in",
  },
  {
    id: "entrance-checkerboard",
    name: "Checkerboard",
    category: "entrance",
    family: "extended-family",
    summary: "Stepped mosaic reveal with crisp documentary pacing.",
    defaultDuration: 0.8,
    defaultEase: "sine.inOut",
    previewAnimClass: "checker-in",
  },
  {
    id: "entrance-strips",
    name: "Strips",
    category: "entrance",
    family: "extended-family",
    summary: "Angled diagonal wipe reveal across the element.",
    defaultDuration: 0.8,
    defaultDirection: "right",
    defaultEase: "power2.out",
    supportsDirection: true,
    previewAnimClass: "strips-in",
  },

  // ── EMPHASIS (9) ───────────────────────────────────────────────────────────
  {
    id: "emphasis-pulse",
    name: "Pulse",
    category: "emphasis",
    family: "core-batch-1",
    summary: "Bounded scale pulse that draws the eye and returns cleanly to 100%.",
    defaultDuration: 0.9,
    defaultHoldDuration: 0.15,
    defaultEase: "sine.inOut",
    supportsScale: true,
    supportsHold: true,
    previewAnimClass: "pulse",
  },
  {
    id: "emphasis-highlight",
    name: "Highlight",
    category: "emphasis",
    family: "core-batch-1",
    summary: "Controlled luminance lift for quotes, evidence cards, or map markers.",
    defaultDuration: 1.0,
    defaultHoldDuration: 0.25,
    defaultEase: "sine.inOut",
    supportsHold: true,
    previewAnimClass: "highlight",
  },
  {
    id: "emphasis-grow-shrink",
    name: "Grow / Shrink",
    category: "emphasis",
    family: "extended-family",
    summary: "Measured expansion and return to original size.",
    defaultDuration: 1.0,
    defaultHoldDuration: 0.2,
    defaultEase: "power2.inOut",
    supportsScale: true,
    supportsHold: true,
    previewAnimClass: "grow-shrink",
  },
  {
    id: "emphasis-spin",
    name: "Spin",
    category: "emphasis",
    family: "extended-family",
    summary: "Controlled rotation around center (clockwise or counter-clockwise).",
    defaultDuration: 1.1,
    defaultDirection: "cw",
    defaultEase: "power2.inOut",
    supportsDirection: true,
    supportsRotation: true,
    previewAnimClass: "spin",
  },
  {
    id: "emphasis-tilt",
    name: "Brief Tilt",
    category: "emphasis",
    family: "extended-family",
    summary: "Restrained +/- 3 deg documentary rock that settles back to 0 deg.",
    defaultDuration: 0.85,
    defaultEase: "sine.inOut",
    supportsRotation: true,
    previewAnimClass: "tilt",
  },
  {
    id: "emphasis-transparency",
    name: "Transparency",
    category: "emphasis",
    family: "extended-family",
    summary: "Temporary dim and restore to yield focus to narration.",
    defaultDuration: 1.1,
    defaultHoldDuration: 0.3,
    defaultEase: "sine.inOut",
    supportsHold: true,
    previewAnimClass: "transparency",
  },
  {
    id: "emphasis-fill-color",
    name: "Fill Color",
    category: "emphasis",
    family: "extended-family",
    summary: "Bounded warm gold background fill emphasis for cards and badges.",
    defaultDuration: 1.0,
    defaultHoldDuration: 0.25,
    defaultEase: "sine.inOut",
    supportsColor: true,
    supportsHold: true,
    previewAnimClass: "fill-color",
  },
  {
    id: "emphasis-line-color",
    name: "Line Color",
    category: "emphasis",
    family: "extended-family",
    summary: "Bounded border/outline color emphasis.",
    defaultDuration: 1.0,
    defaultHoldDuration: 0.25,
    defaultEase: "sine.inOut",
    supportsColor: true,
    supportsHold: true,
    previewAnimClass: "line-color",
  },
  {
    id: "emphasis-font-color",
    name: "Font Color",
    category: "emphasis",
    family: "extended-family",
    summary: "Bounded text color accent for key dates, numbers, and headlines.",
    defaultDuration: 1.0,
    defaultHoldDuration: 0.25,
    defaultEase: "sine.inOut",
    supportsColor: true,
    supportsHold: true,
    previewAnimClass: "font-color",
  },

  // ── EXIT (11) ──────────────────────────────────────────────────────────────
  {
    id: "exit-fade-out",
    name: "Fade Out",
    category: "exit",
    family: "core-batch-1",
    summary: "Smooth opacity dissolve out to transparent.",
    defaultDuration: 0.7,
    defaultEase: "power2.in",
    previewAnimClass: "fade-out",
  },
  {
    id: "exit-disappear",
    name: "Disappear",
    category: "exit",
    family: "extended-family",
    summary: "Clean instant cut-out at the end of the motion block.",
    defaultDuration: 0.1,
    defaultEase: "none",
    previewAnimClass: "disappear",
  },
  {
    id: "exit-fly-out",
    name: "Fly / Slide Out",
    category: "exit",
    family: "extended-family",
    summary: "Directional slide exit with fade.",
    defaultDuration: 0.7,
    defaultDistance: 48,
    defaultDirection: "down",
    defaultEase: "power2.in",
    supportsDirection: true,
    supportsDistance: true,
    previewAnimClass: "slide-out",
  },
  {
    id: "exit-peek-out",
    name: "Peek Out",
    category: "exit",
    family: "extended-family",
    summary: "Cropped edge tuck-away exit.",
    defaultDuration: 0.65,
    defaultDistance: 24,
    defaultDirection: "down",
    defaultEase: "power2.in",
    supportsDirection: true,
    supportsDistance: true,
    previewAnimClass: "peek-out",
  },
  {
    id: "exit-zoom-out",
    name: "Zoom Out",
    category: "exit",
    family: "extended-family",
    summary: "Controlled shrink to 84% scale with fade out.",
    defaultDuration: 0.7,
    defaultEase: "power2.in",
    supportsScale: true,
    previewAnimClass: "zoom-out",
  },
  {
    id: "exit-wipe-out",
    name: "Wipe Out",
    category: "exit",
    family: "extended-family",
    summary: "Directional clip-path wipe clear.",
    defaultDuration: 0.75,
    defaultDirection: "right",
    defaultEase: "power2.inOut",
    supportsDirection: true,
    previewAnimClass: "wipe-out",
  },
  {
    id: "exit-split-out",
    name: "Split Out",
    category: "exit",
    family: "extended-family",
    summary: "Outer edges close inward to center.",
    defaultDuration: 0.7,
    defaultEase: "power2.inOut",
    previewAnimClass: "split-out",
  },
  {
    id: "exit-box-out",
    name: "Box Out",
    category: "exit",
    family: "extended-family",
    summary: "Rectangular frame iris closing inward.",
    defaultDuration: 0.7,
    defaultEase: "power2.in",
    previewAnimClass: "box-out",
  },
  {
    id: "exit-blinds-out",
    name: "Blinds Out",
    category: "exit",
    family: "extended-family",
    summary: "Horizontal slat fold-away exit.",
    defaultDuration: 0.7,
    defaultEase: "power2.in",
    previewAnimClass: "blinds-out",
  },
  {
    id: "exit-checkerboard-out",
    name: "Checkerboard Out",
    category: "exit",
    family: "extended-family",
    summary: "Stepped grid dissolve out.",
    defaultDuration: 0.75,
    defaultEase: "sine.inOut",
    previewAnimClass: "checker-out",
  },
  {
    id: "exit-strips-out",
    name: "Strips Out",
    category: "exit",
    family: "extended-family",
    summary: "Angled strip wipe exit.",
    defaultDuration: 0.75,
    defaultDirection: "right",
    defaultEase: "power2.in",
    supportsDirection: true,
    previewAnimClass: "strips-out",
  },

  // ── MOTION PATHS (5) ───────────────────────────────────────────────────────
  {
    id: "path-line",
    name: "Straight Line",
    category: "path",
    family: "extended-family",
    summary: "Point-to-point linear translation with reversible direction.",
    defaultDuration: 1.2,
    defaultDistance: 160,
    defaultDirection: "right",
    defaultEase: "power2.inOut",
    supportsDirection: true,
    supportsDistance: true,
    supportsPath: true,
    previewAnimClass: "path-line",
  },
  {
    id: "path-arc",
    name: "Arc Path",
    category: "path",
    family: "extended-family",
    summary: "Smooth 3-point curved arc ideal for map routes and arrows.",
    defaultDuration: 1.4,
    defaultDistance: 180,
    defaultDirection: "right",
    defaultEase: "sine.inOut",
    supportsDirection: true,
    supportsDistance: true,
    supportsPath: true,
    previewAnimClass: "path-arc",
  },
  {
    id: "path-curve",
    name: "S-Curve Path",
    category: "path",
    family: "extended-family",
    summary: "4-point inflected curve across the stage.",
    defaultDuration: 1.6,
    defaultDistance: 200,
    defaultEase: "sine.inOut",
    supportsDistance: true,
    supportsPath: true,
    previewAnimClass: "path-curve",
  },
  {
    id: "path-turn",
    name: "Right-Angle Turn",
    category: "path",
    family: "extended-family",
    summary: "90-degree L-turn path for diagram callouts and trade routes.",
    defaultDuration: 1.4,
    defaultDistance: 140,
    defaultEase: "power2.inOut",
    supportsDistance: true,
    supportsPath: true,
    previewAnimClass: "path-turn",
  },
  {
    id: "path-custom",
    name: "Custom Draggable Path",
    category: "path",
    family: "extended-family",
    summary: "Multi-waypoint editable path with add/drag/remove points & reverse.",
    defaultDuration: 1.8,
    defaultDistance: 180,
    defaultEase: "none",
    supportsPath: true,
    previewAnimClass: "path-custom",
  },

  // ── SCENE TRANSITIONS (8) ──────────────────────────────────────────────────
  {
    id: "transition-cut",
    name: "Cut",
    category: "transition",
    family: "core-batch-1",
    summary: "Clean instant documentary cut at the scene boundary.",
    defaultDuration: 0.04,
    defaultEase: "none",
    previewAnimClass: "trans-cut",
  },
  {
    id: "transition-crossfade",
    name: "Fade / Crossfade",
    category: "transition",
    family: "core-batch-1",
    summary: "Smooth dissolve across the scene boundary.",
    defaultDuration: 0.8,
    defaultEase: "sine.inOut",
    previewAnimClass: "trans-crossfade",
  },
  {
    id: "transition-wipe",
    name: "Directional Wipe",
    category: "transition",
    family: "core-batch-1",
    summary: "Clean directional edge wipe from one scene to the next.",
    defaultDuration: 0.85,
    defaultDirection: "right",
    defaultEase: "power2.inOut",
    supportsDirection: true,
    previewAnimClass: "trans-wipe",
  },
  {
    id: "transition-push",
    name: "Push",
    category: "transition",
    family: "extended-family",
    summary: "Incoming scene pushes the outgoing scene across the frame.",
    defaultDuration: 0.85,
    defaultDirection: "left",
    defaultEase: "power3.inOut",
    supportsDirection: true,
    previewAnimClass: "trans-push",
  },
  {
    id: "transition-reveal",
    name: "Reveal",
    category: "transition",
    family: "extended-family",
    summary: "Outgoing scene glides and fades away to reveal the new scene.",
    defaultDuration: 0.9,
    defaultDirection: "left",
    defaultEase: "power2.out",
    supportsDirection: true,
    previewAnimClass: "trans-reveal",
  },
  {
    id: "transition-split",
    name: "Split",
    category: "transition",
    family: "extended-family",
    summary: "Center-outward split reveal into the incoming scene.",
    defaultDuration: 0.85,
    defaultEase: "power2.inOut",
    previewAnimClass: "trans-split",
  },
  {
    id: "transition-zoom",
    name: "Restrained Zoom",
    category: "transition",
    family: "extended-family",
    summary: "Subtle 6% camera push-through dissolve suited for historical chapters.",
    defaultDuration: 0.9,
    defaultEase: "power2.out",
    supportsScale: true,
    previewAnimClass: "trans-zoom",
  },
  {
    id: "transition-morph",
    name: "Matched-Object Morph",
    category: "transition",
    family: "extended-family",
    summary: "Smoothly interpolates matching elements across consecutive scenes.",
    defaultDuration: 0.95,
    defaultEase: "power3.inOut",
    previewAnimClass: "trans-morph",
  },
] as const;

export function getMotionPresetById(presetId: string): MotionPresetDefinition | undefined {
  return MOTION_PRESET_CATALOG.find((p) => p.id === presetId);
}

export interface CompileMotionPresetOptions {
  id?: string;
  start: number;
  duration?: number;
  delay?: number;
  holdDuration?: number;
  direction?: StudioGsapMotionDirection;
  distance?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  accentColor?: string;
  ease?: string;
  customEase?: StudioGsapCustomEase;
  stylePreset?: StudioMotionStylePreset;
  motionPath?: StudioMotionPathConfig;
  transition?: StudioSceneTransitionConfig;
  order?: number;
}

function defaultWaypointsForPathPreset(
  presetId: string,
  distance: number,
  direction: StudioGsapMotionDirection,
): StudioMotionPathConfig {
  const signX = direction === "left" ? -1 : 1;
  const signY = direction === "up" ? -1 : 1;
  if (presetId === "path-arc") {
    return {
      type: "arc",
      points: [
        { x: 0, y: 0 },
        { x: Math.round(distance * 0.5 * signX), y: Math.round(-distance * 0.35 * signY) },
        { x: Math.round(distance * signX), y: 0 },
      ],
      reverse: false,
    };
  }
  if (presetId === "path-curve") {
    return {
      type: "curve",
      points: [
        { x: 0, y: 0 },
        { x: Math.round(distance * 0.33 * signX), y: Math.round(-distance * 0.28) },
        { x: Math.round(distance * 0.66 * signX), y: Math.round(distance * 0.28) },
        { x: Math.round(distance * signX), y: 0 },
      ],
      reverse: false,
    };
  }
  if (presetId === "path-turn") {
    return {
      type: "turn",
      points: [
        { x: 0, y: 0 },
        { x: Math.round(distance * 0.7 * signX), y: 0 },
        { x: Math.round(distance * 0.7 * signX), y: Math.round(distance * 0.5 * signY) },
      ],
      reverse: false,
    };
  }
  if (presetId === "path-custom") {
    return {
      type: "custom",
      points: [
        { x: 0, y: 0 },
        { x: Math.round(distance * 0.4 * signX), y: Math.round(-distance * 0.25) },
        { x: Math.round(distance * 0.8 * signX), y: Math.round(distance * 0.2) },
        { x: Math.round(distance * signX), y: 0 },
      ],
      reverse: false,
    };
  }
  return {
    type: "line",
    points: [
      { x: 0, y: 0 },
      {
        x: direction === "up" || direction === "down" ? 0 : Math.round(distance * signX),
        y:
          direction === "up"
            ? -Math.round(distance)
            : direction === "down"
              ? Math.round(distance)
              : 0,
      },
    ],
    reverse: false,
  };
}

export function reversePathWaypoints(
  points: readonly StudioMotionPathPoint[],
): StudioMotionPathPoint[] {
  return [...points].reverse().map((p) => ({ x: p.x, y: p.y }));
}

function buildKeyframesFromMotionPath(
  pathConfig: StudioMotionPathConfig,
  ease: string,
): {
  from: StudioGsapMotionValues;
  to: StudioGsapMotionValues;
  keyframes: StudioMotionKeyframe[];
} {
  const orderedPoints: StudioMotionPathPoint[] = pathConfig.reverse
    ? [...pathConfig.points].reverse()
    : pathConfig.points;
  const first = orderedPoints[0] ?? { x: 0, y: 0 };
  const last = orderedPoints[orderedPoints.length - 1] ?? { x: 0, y: 0 };
  const n = Math.max(1, orderedPoints.length - 1);
  const keyframes: StudioMotionKeyframe[] = orderedPoints.map((pt, idx) => ({
    progress: roundTo3(idx / n),
    values: { x: pt.x, y: pt.y },
    ease,
  }));
  return {
    from: { x: first.x, y: first.y },
    to: { x: last.x, y: last.y },
    keyframes,
  };
}

function directionalOffsets(
  direction: StudioGsapMotionDirection,
  distance: number,
): { x: number; y: number } {
  switch (direction) {
    case "up":
      return { x: 0, y: distance };
    case "down":
      return { x: 0, y: -distance };
    case "left":
      return { x: distance, y: 0 };
    case "right":
      return { x: -distance, y: 0 };
    default:
      return { x: 0, y: distance };
  }
}

function wipeInsetForDirection(
  direction: StudioGsapMotionDirection,
  isExit: boolean,
): { fromClip: string; toClip: string } {
  const full = "inset(0% 0% 0% 0%)";
  let hidden = "inset(0% 100% 0% 0%)";
  if (direction === "left") hidden = "inset(0% 0% 0% 100%)";
  else if (direction === "up") hidden = "inset(100% 0% 0% 0%)";
  else if (direction === "down") hidden = "inset(0% 0% 100% 0%)";
  return isExit ? { fromClip: full, toClip: hidden } : { fromClip: hidden, toClip: full };
}

// fallow-ignore-next-line complexity
export function compileMotionPreset(
  presetId: string,
  options: CompileMotionPresetOptions,
): StudioElementMotionPayload {
  const def = getMotionPresetById(presetId) ?? MOTION_PRESET_CATALOG[2]!;
  const stylePreset: StudioMotionStylePreset = options.stylePreset ?? "documentary";
  const profile = MOTION_STYLE_PROFILES[stylePreset];

  const start = roundTo3(Math.max(0, options.start));
  const duration = roundTo3(
    Math.max(0.04, options.duration ?? def.defaultDuration * profile.durationMultiplier),
  );
  const delay = roundTo3(Math.max(0, options.delay ?? 0));
  const holdDuration = roundTo3(Math.max(0, options.holdDuration ?? def.defaultHoldDuration ?? 0));
  const direction: StudioGsapMotionDirection = options.direction ?? def.defaultDirection ?? "up";
  const distance = roundTo3(
    Math.max(0, options.distance ?? (def.defaultDistance ?? 32) * profile.distanceMultiplier),
  );
  const ease = options.ease ?? def.defaultEase ?? profile.defaultEase;
  const accentColor = options.accentColor ?? "#C49A44";

  let from: StudioGsapMotionValues = { autoAlpha: 0 };
  let to: StudioGsapMotionValues = { autoAlpha: 1 };
  let keyframes: StudioMotionKeyframe[] | undefined;
  let motionPath = options.motionPath;

  switch (def.id) {
    // ── ENTRANCE ──
    case "entrance-appear":
      from = { autoAlpha: 0 };
      to = { autoAlpha: 1 };
      break;
    case "entrance-fade-in":
      from = { autoAlpha: options.opacity ?? 0 };
      to = { autoAlpha: 1 };
      break;
    case "entrance-rise-up":
    case "entrance-fly-in": {
      const off = directionalOffsets(direction, distance);
      from = { x: off.x, y: off.y, autoAlpha: options.opacity ?? 0 };
      to = { x: 0, y: 0, autoAlpha: 1 };
      break;
    }
    case "entrance-peek-in": {
      const off = directionalOffsets(direction, distance);
      const { fromClip, toClip } = wipeInsetForDirection(direction, false);
      from = { x: off.x, y: off.y, clipPath: fromClip, autoAlpha: 0.2 };
      to = { x: 0, y: 0, clipPath: toClip, autoAlpha: 1 };
      break;
    }
    case "entrance-zoom": {
      const startScale = roundTo3(options.scale ?? 1 - 0.22 * profile.intensityMultiplier);
      from = { scale: startScale, autoAlpha: 0 };
      to = { scale: 1, autoAlpha: 1 };
      break;
    }
    case "entrance-pop": {
      const startScale = roundTo3(options.scale ?? 1 - 0.14 * profile.intensityMultiplier);
      from = { scale: startScale, autoAlpha: 0 };
      to = { scale: 1, autoAlpha: 1 };
      break;
    }
    case "entrance-wipe": {
      const { fromClip, toClip } = wipeInsetForDirection(direction, false);
      from = { clipPath: fromClip, autoAlpha: 1 };
      to = { clipPath: toClip, autoAlpha: 1 };
      break;
    }
    case "entrance-split":
      from = { clipPath: "inset(0% 50% 0% 50%)", autoAlpha: 0.3 };
      to = { clipPath: "inset(0% 0% 0% 0%)", autoAlpha: 1 };
      break;
    case "entrance-expand":
      from = { scaleX: roundTo3(options.scale ?? 0.25), autoAlpha: 0 };
      to = { scaleX: 1, autoAlpha: 1 };
      break;
    case "entrance-stretch":
      from = { scaleX: 1.22, scaleY: 0.78, autoAlpha: 0 };
      to = { scaleX: 1, scaleY: 1, autoAlpha: 1 };
      break;
    case "entrance-box":
      from = { clipPath: "inset(38% 38% 38% 38%)", scale: 0.96, autoAlpha: 0 };
      to = { clipPath: "inset(0% 0% 0% 0%)", scale: 1, autoAlpha: 1 };
      break;
    case "entrance-blinds":
      from = { scaleY: 0.15, clipPath: "inset(0% 0% 85% 0%)", autoAlpha: 0 };
      to = { scaleY: 1, clipPath: "inset(0% 0% 0% 0%)", autoAlpha: 1 };
      break;
    case "entrance-checkerboard":
      from = { scale: 0.97, filter: "contrast(1.4) brightness(0.6)", autoAlpha: 0 };
      to = { scale: 1, filter: "contrast(1) brightness(1)", autoAlpha: 1 };
      break;
    case "entrance-strips":
      from = { x: -18, clipPath: "inset(0% 100% 0% 0%)", autoAlpha: 0 };
      to = { x: 0, clipPath: "inset(0% 0% 0% 0%)", autoAlpha: 1 };
      break;

    // ── EMPHASIS (Strictly bounded — returns to rest at progress = 1) ──
    case "emphasis-pulse": {
      const peakScale = roundTo3(options.scale ?? 1 + 0.08 * profile.intensityMultiplier);
      const holdFrac = Math.min(0.4, holdDuration / Math.max(0.2, duration));
      from = { scale: 1 };
      to = { scale: 1 };
      keyframes = [
        { progress: 0, values: { scale: 1 } },
        { progress: roundTo3(0.45 - holdFrac / 2), values: { scale: peakScale }, ease },
        { progress: roundTo3(0.55 + holdFrac / 2), values: { scale: peakScale }, ease: "none" },
        { progress: 1, values: { scale: 1 }, ease },
      ];
      break;
    }
    case "emphasis-grow-shrink": {
      const peakScale = roundTo3(options.scale ?? 1 + 0.15 * profile.intensityMultiplier);
      const holdFrac = Math.min(0.4, holdDuration / Math.max(0.2, duration));
      from = { scale: 1 };
      to = { scale: 1 };
      keyframes = [
        { progress: 0, values: { scale: 1 } },
        { progress: roundTo3(0.42 - holdFrac / 2), values: { scale: peakScale }, ease },
        { progress: roundTo3(0.58 + holdFrac / 2), values: { scale: peakScale }, ease: "none" },
        { progress: 1, values: { scale: 1 }, ease },
      ];
      break;
    }
    case "emphasis-spin": {
      const angle = options.rotation ?? (direction === "ccw" ? -360 : 360);
      from = { rotation: 0 };
      to = { rotation: angle };
      break;
    }
    case "emphasis-tilt": {
      const deg = roundTo3((options.rotation ?? 3) * profile.intensityMultiplier);
      from = { rotation: 0 };
      to = { rotation: 0 };
      keyframes = [
        { progress: 0, values: { rotation: 0 } },
        { progress: 0.3, values: { rotation: -deg }, ease: "sine.out" },
        { progress: 0.68, values: { rotation: roundTo3(deg * 0.8) }, ease: "sine.inOut" },
        { progress: 1, values: { rotation: 0 }, ease: "sine.inOut" },
      ];
      break;
    }
    case "emphasis-highlight": {
      const holdFrac = Math.min(0.45, holdDuration / Math.max(0.2, duration));
      from = { filter: "brightness(1)", scale: 1 };
      to = { filter: "brightness(1)", scale: 1 };
      keyframes = [
        { progress: 0, values: { filter: "brightness(1)", scale: 1 } },
        {
          progress: roundTo3(0.38 - holdFrac / 2),
          values: { filter: "brightness(1.32)", scale: 1.02 },
          ease,
        },
        {
          progress: roundTo3(0.62 + holdFrac / 2),
          values: { filter: "brightness(1.32)", scale: 1.02 },
          ease: "none",
        },
        { progress: 1, values: { filter: "brightness(1)", scale: 1 }, ease },
      ];
      break;
    }
    case "emphasis-transparency": {
      const dipOpacity = roundTo3(options.opacity ?? 0.42);
      const holdFrac = Math.min(0.45, holdDuration / Math.max(0.2, duration));
      from = { opacity: 1 };
      to = { opacity: 1 };
      keyframes = [
        { progress: 0, values: { opacity: 1 } },
        { progress: roundTo3(0.38 - holdFrac / 2), values: { opacity: dipOpacity }, ease },
        { progress: roundTo3(0.62 + holdFrac / 2), values: { opacity: dipOpacity }, ease: "none" },
        { progress: 1, values: { opacity: 1 }, ease },
      ];
      break;
    }
    case "emphasis-fill-color": {
      from = { backgroundColor: "rgba(196, 154, 68, 0)" };
      to = { backgroundColor: "rgba(196, 154, 68, 0)" };
      keyframes = [
        { progress: 0, values: { backgroundColor: "rgba(196, 154, 68, 0)" } },
        { progress: 0.35, values: { backgroundColor: accentColor }, ease },
        { progress: 0.68, values: { backgroundColor: accentColor }, ease: "none" },
        { progress: 1, values: { backgroundColor: "rgba(196, 154, 68, 0)" }, ease },
      ];
      break;
    }
    case "emphasis-line-color": {
      from = { borderColor: "rgba(196, 154, 68, 0.25)" };
      to = { borderColor: "rgba(196, 154, 68, 0.25)" };
      keyframes = [
        { progress: 0, values: { borderColor: "rgba(196, 154, 68, 0.25)" } },
        { progress: 0.35, values: { borderColor: accentColor }, ease },
        { progress: 0.68, values: { borderColor: accentColor }, ease: "none" },
        { progress: 1, values: { borderColor: "rgba(196, 154, 68, 0.25)" }, ease },
      ];
      break;
    }
    case "emphasis-font-color": {
      from = { color: "#F5F0E6" };
      to = { color: "#F5F0E6" };
      keyframes = [
        { progress: 0, values: { color: "#F5F0E6" } },
        { progress: 0.35, values: { color: accentColor }, ease },
        { progress: 0.68, values: { color: accentColor }, ease: "none" },
        { progress: 1, values: { color: "#F5F0E6" }, ease },
      ];
      break;
    }

    // ── EXIT ──
    case "exit-disappear":
    case "exit-fade-out":
      from = { autoAlpha: 1 };
      to = { autoAlpha: options.opacity ?? 0 };
      break;
    case "exit-fly-out": {
      const off = directionalOffsets(direction, -distance);
      from = { x: 0, y: 0, autoAlpha: 1 };
      to = { x: off.x, y: off.y, autoAlpha: 0 };
      break;
    }
    case "exit-peek-out": {
      const off = directionalOffsets(direction, -distance);
      const { fromClip, toClip } = wipeInsetForDirection(direction, true);
      from = { x: 0, y: 0, clipPath: fromClip, autoAlpha: 1 };
      to = { x: off.x, y: off.y, clipPath: toClip, autoAlpha: 0 };
      break;
    }
    case "exit-zoom-out":
      from = { scale: 1, autoAlpha: 1 };
      to = { scale: roundTo3(options.scale ?? 0.82), autoAlpha: 0 };
      break;
    case "exit-wipe-out": {
      const { fromClip, toClip } = wipeInsetForDirection(direction, true);
      from = { clipPath: fromClip, autoAlpha: 1 };
      to = { clipPath: toClip, autoAlpha: 0 };
      break;
    }
    case "exit-split-out":
      from = { clipPath: "inset(0% 0% 0% 0%)", autoAlpha: 1 };
      to = { clipPath: "inset(0% 50% 0% 50%)", autoAlpha: 0 };
      break;
    case "exit-box-out":
      from = { clipPath: "inset(0% 0% 0% 0%)", scale: 1, autoAlpha: 1 };
      to = { clipPath: "inset(38% 38% 38% 38%)", scale: 0.95, autoAlpha: 0 };
      break;
    case "exit-blinds-out":
      from = { scaleY: 1, clipPath: "inset(0% 0% 0% 0%)", autoAlpha: 1 };
      to = { scaleY: 0.15, clipPath: "inset(85% 0% 0% 0%)", autoAlpha: 0 };
      break;
    case "exit-checkerboard-out":
      from = { scale: 1, filter: "contrast(1) brightness(1)", autoAlpha: 1 };
      to = { scale: 0.96, filter: "contrast(1.4) brightness(0.5)", autoAlpha: 0 };
      break;
    case "exit-strips-out":
      from = { x: 0, clipPath: "inset(0% 0% 0% 0%)", autoAlpha: 1 };
      to = { x: 18, clipPath: "inset(0% 0% 0% 100%)", autoAlpha: 0 };
      break;

    // ── MOTION PATHS ──
    case "path-line":
    case "path-arc":
    case "path-curve":
    case "path-turn":
    case "path-custom": {
      motionPath = options.motionPath ?? defaultWaypointsForPathPreset(def.id, distance, direction);
      const compiledPath = buildKeyframesFromMotionPath(motionPath, ease);
      from = compiledPath.from;
      to = compiledPath.to;
      keyframes = compiledPath.keyframes;
      break;
    }

    // ── SCENE TRANSITIONS ──
    case "transition-cut":
      from = { autoAlpha: 1 };
      to = { autoAlpha: 1 };
      break;
    case "transition-crossfade":
      from = { autoAlpha: 0 };
      to = { autoAlpha: 1 };
      break;
    case "transition-wipe": {
      const { fromClip, toClip } = wipeInsetForDirection(direction, false);
      from = { clipPath: fromClip, autoAlpha: 1 };
      to = { clipPath: toClip, autoAlpha: 1 };
      break;
    }
    case "transition-push": {
      const off = directionalOffsets(direction, 260);
      from = { x: off.x, y: off.y, autoAlpha: 0.25 };
      to = { x: 0, y: 0, autoAlpha: 1 };
      break;
    }
    case "transition-reveal": {
      const off = directionalOffsets(direction, 120);
      from = { x: off.x, y: off.y, scale: 0.98, autoAlpha: 0 };
      to = { x: 0, y: 0, scale: 1, autoAlpha: 1 };
      break;
    }
    case "transition-split":
      from = { clipPath: "inset(0% 50% 0% 50%)", autoAlpha: 0.2 };
      to = { clipPath: "inset(0% 0% 0% 0%)", autoAlpha: 1 };
      break;
    case "transition-zoom":
      from = { scale: roundTo3(options.scale ?? 1.06), autoAlpha: 0 };
      to = { scale: 1, autoAlpha: 1 };
      break;
    case "transition-morph":
      from = { y: 18, scale: 0.96, autoAlpha: 0 };
      to = { y: 0, scale: 1, autoAlpha: 1 };
      break;
  }

  return {
    id: options.id ?? `motion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: def.name,
    presetId: def.id,
    category: def.category,
    stylePreset,
    start,
    duration,
    ...(delay > 0 ? { delay } : {}),
    ...(holdDuration > 0 ? { holdDuration } : {}),
    ...(def.supportsDirection ? { direction } : {}),
    ...(def.supportsDistance ? { distance } : {}),
    ease,
    ...(options.customEase ? { customEase: options.customEase } : {}),
    from,
    to,
    ...(keyframes ? { keyframes } : {}),
    ...(motionPath ? { motionPath } : {}),
    ...(options.transition ? { transition: options.transition } : {}),
    ...(options.order != null ? { order: options.order } : {}),
  };
}
