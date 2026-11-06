import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface SceneTimingCue {
  id?: string;
  seconds?: number;
  frame?: number;
  visualIntent?: string;
  spokenEmphasisSeconds?: number;
  recommendedEasing?: string;
}

export interface EpisodeBrainContext {
  episodeId: string;
  episodeDir: string;
  sceneId: string;
  sceneScriptText?: string;
  sceneDurationSeconds?: number;
  sceneStartFrame?: number;
  sceneEndFrame?: number;
  firstPhrase?: string;
  lastPhrase?: string;
  cues: SceneTimingCue[];
  availableAssets: {
    backgrounds: string[];
    characters: string[];
    maps: string[];
    props: string[];
    others: string[];
  };
}

/**
 * Resolves the parent episode directory from the project directory.
 * (e.g. /path/to/episodes/EP02_TV_Reshaped_Trump/Sources -> /path/to/episodes/EP02_TV_Reshaped_Trump)
 */
export function findEpisodeRoot(projectDir: string): string | null {
  const candidates = [projectDir, dirname(projectDir), resolve(projectDir, "..")];

  for (const cand of candidates) {
    if (
      existsSync(join(cand, "Timing")) ||
      existsSync(join(cand, "Brief")) ||
      existsSync(join(cand, "Images")) ||
      existsSync(join(cand, "Audio"))
    ) {
      return cand;
    }
  }

  return null;
}

/**
 * Normalizes a scene string like "compositions/s02.html" or "s02.html" into "S02".
 */
export function normalizeSceneId(sceneFile?: string): string {
  if (!sceneFile) return "S01";
  const name = basename(sceneFile, ".html");
  const match = /s?0*(\d+)/i.exec(name);
  if (match && match[1]) {
    const num = parseInt(match[1], 10);
    return `S${num < 10 ? `0${num}` : num}`;
  }
  return name.toUpperCase();
}

/**
 * Extracts the scene-specific script text from Brief/*Script.md.
 */
function extractSceneScript(episodeDir: string, sceneId: string): string | undefined {
  const briefDir = join(episodeDir, "Brief");
  if (!existsSync(briefDir)) return undefined;

  let scriptFiles: string[] = [];
  try {
    scriptFiles = readdirSync(briefDir).filter((f) => /script/i.test(f) && f.endsWith(".md"));
  } catch {
    return undefined;
  }

  for (const sf of scriptFiles) {
    try {
      const content = readFileSync(join(briefDir, sf), "utf-8");
      // Match section e.g. "## S02 — ..." or "## S02\n" until next "## S" or end
      const sectionRegex = new RegExp(
        `##\\s*${sceneId}\\b[^\n]*\n([\\s\\S]*?)(?=\n##\\s*S\\d|$)`,
        "i",
      );
      const match = sectionRegex.exec(content);
      if (match && match[1]) {
        return match[1].trim();
      }
    } catch {
      /* ignore */
    }
  }

  return undefined;
}

/**
 * Extracts scene-specific audio timing cues and durations from Timing/*Timing_Map.json.
 */
function extractSceneTiming(
  episodeDir: string,
  sceneId: string,
): {
  durationSeconds?: number;
  startFrame?: number;
  endFrame?: number;
  firstPhrase?: string;
  lastPhrase?: string;
  cues: SceneTimingCue[];
} {
  const timingDir = join(episodeDir, "Timing");
  const result: {
    durationSeconds?: number;
    startFrame?: number;
    endFrame?: number;
    firstPhrase?: string;
    lastPhrase?: string;
    cues: SceneTimingCue[];
  } = { cues: [] };

  if (!existsSync(timingDir)) return result;

  let jsonFiles: string[] = [];
  try {
    jsonFiles = readdirSync(timingDir).filter((f) => /timing_map/i.test(f) && f.endsWith(".json"));
  } catch {
    return result;
  }

  for (const jf of jsonFiles) {
    try {
      const parsed = JSON.parse(readFileSync(join(timingDir, jf), "utf-8")) as {
        fps?: number;
        scenes?: Array<{
          id?: string;
          start_frame?: number;
          end_frame_exclusive?: number;
          first_phrase?: string;
          last_phrase?: string;
          cues?: Array<{
            id?: string;
            supplied_seconds?: number;
            frame?: number;
            visual_intent?: string;
            spoken_emphasis_hit_seconds?: number;
            recommended_easing?: string;
          }>;
        }>;
      };

      const fps = parsed.fps || 30;
      const matchedScene = (parsed.scenes || []).find(
        (s) => s.id?.toUpperCase() === sceneId.toUpperCase(),
      );

      if (matchedScene) {
        result.startFrame = matchedScene.start_frame;
        result.endFrame = matchedScene.end_frame_exclusive;
        if (typeof result.startFrame === "number" && typeof result.endFrame === "number") {
          result.durationSeconds = (result.endFrame - result.startFrame) / fps;
        }
        result.firstPhrase = matchedScene.first_phrase;
        result.lastPhrase = matchedScene.last_phrase;

        if (Array.isArray(matchedScene.cues)) {
          result.cues = matchedScene.cues.map((c) => ({
            id: c.id,
            seconds: c.supplied_seconds,
            frame: c.frame,
            visualIntent: c.visual_intent,
            spokenEmphasisSeconds: c.spoken_emphasis_hit_seconds,
            recommendedEasing: c.recommended_easing,
          }));
        }
        break;
      }
    } catch {
      /* ignore */
    }
  }

  return result;
}

/**
 * Scans episode Images/ and Sources/assets/ for production-ready images.
 */
function scanAvailableAssets(
  episodeDir: string,
  projectDir: string,
): EpisodeBrainContext["availableAssets"] {
  const assets: EpisodeBrainContext["availableAssets"] = {
    backgrounds: [],
    characters: [],
    maps: [],
    props: [],
    others: [],
  };

  const dirsToScan = [
    join(episodeDir, "Images"),
    join(projectDir, "assets"),
    join(episodeDir, "Sources", "assets"),
  ];

  for (const dir of dirsToScan) {
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        if (!/\.(png|jpe?g|svg|webp)$/i.test(file)) continue;
        const lower = file.toLowerCase();
        const assetRef = dir.includes("assets") ? `assets/${file}` : `Images/${file}`;

        if (lower.includes("_bg_") || lower.includes("background") || lower.includes("canvas")) {
          if (!assets.backgrounds.includes(assetRef)) assets.backgrounds.push(assetRef);
        } else if (
          lower.includes("_char_") ||
          lower.includes("character") ||
          lower.includes("contestant")
        ) {
          if (!assets.characters.includes(assetRef)) assets.characters.push(assetRef);
        } else if (lower.includes("_map_") || lower.includes("route") || lower.includes("canal")) {
          if (!assets.maps.includes(assetRef)) assets.maps.push(assetRef);
        } else if (
          lower.includes("_prop_") ||
          lower.includes("screen") ||
          lower.includes("table")
        ) {
          if (!assets.props.includes(assetRef)) assets.props.push(assetRef);
        } else {
          if (!assets.others.includes(assetRef)) assets.others.push(assetRef);
        }
      }
    } catch {
      /* ignore */
    }
  }

  return assets;
}

/**
 * Loads the complete Episode Brain context for the current scene.
 */
export function loadEpisodeBrainContext(
  projectDir: string,
  sceneFile?: string,
): EpisodeBrainContext | null {
  const episodeDir = findEpisodeRoot(projectDir);
  if (!episodeDir) return null;

  const episodeId = basename(episodeDir);
  const sceneId = normalizeSceneId(sceneFile);
  const sceneScriptText = extractSceneScript(episodeDir, sceneId);
  const timing = extractSceneTiming(episodeDir, sceneId);
  const availableAssets = scanAvailableAssets(episodeDir, projectDir);

  return {
    episodeId,
    episodeDir,
    sceneId,
    sceneScriptText,
    sceneDurationSeconds: timing.durationSeconds,
    sceneStartFrame: timing.startFrame,
    sceneEndFrame: timing.endFrame,
    firstPhrase: timing.firstPhrase,
    lastPhrase: timing.lastPhrase,
    cues: timing.cues,
    availableAssets,
  };
}

/**
 * Formats Episode Brain context into an XML prompt block.
 */
export function formatEpisodeBrainPrompt(brain: EpisodeBrainContext): string {
  const lines: string[] = [
    `## Episode Production Brain Context (${brain.episodeId} · ${brain.sceneId})`,
    `- **Episode Root**: \`${brain.episodeDir}\``,
  ];

  if (typeof brain.sceneDurationSeconds === "number") {
    lines.push(
      `- **Target Scene Audio Duration**: \`${brain.sceneDurationSeconds.toFixed(2)}s\` (Frames ${brain.sceneStartFrame ?? 0}..${brain.sceneEndFrame ?? Math.round(brain.sceneDurationSeconds * 30)} @ 30fps)`,
    );
  }

  if (brain.sceneScriptText) {
    lines.push(
      "",
      `### Narration Script for ${brain.sceneId}:`,
      "> " + brain.sceneScriptText.replace(/\n+/g, "\n> "),
    );
  }

  if (brain.firstPhrase && brain.lastPhrase) {
    lines.push(`- **Speech Window**: "${brain.firstPhrase}" ➔ "${brain.lastPhrase}"`);
  }

  if (brain.cues.length > 0) {
    lines.push("", `### Audio Timing Cues for ${brain.sceneId}:`);
    for (const cue of brain.cues) {
      const sec = typeof cue.seconds === "number" ? `${cue.seconds.toFixed(2)}s` : "cue";
      const frameStr = typeof cue.frame === "number" ? ` (Frame ${cue.frame})` : "";
      const easingStr = cue.recommendedEasing ? ` [ease: ${cue.recommendedEasing}]` : "";
      lines.push(`- **@ ${sec}${frameStr}**: ${cue.visualIntent || "Visual cue"}${easingStr}`);
    }
  }

  const assetCategories = [
    { label: "Background Plates", items: brain.availableAssets.backgrounds },
    { label: "Character Cutouts", items: brain.availableAssets.characters },
    { label: "Geopolitical Maps & Routes", items: brain.availableAssets.maps },
    { label: "Props & Overlays", items: brain.availableAssets.props },
  ];

  const hasAssets = assetCategories.some((c) => c.items.length > 0);
  if (hasAssets) {
    lines.push("", "### Available Production Assets for this Episode:");
    for (const cat of assetCategories) {
      if (cat.items.length > 0) {
        lines.push(
          `- **${cat.label}**: ${cat.items
            .slice(0, 10)
            .map((a) => `\`${a}\``)
            .join(", ")}`,
        );
      }
    }
  }

  return lines.join("\n");
}
