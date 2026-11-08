/**
 * Timeline Macro Tools for WebMCP:
 * Exposes high-level NLE video editing operations (split, silence trim, b-roll, captions)
 * to connected AI coding and editing agents (Claude Code, OpenAI Codex, Gemini AGY).
 */

import { toolOk, toolFailure, type ToolResult } from "../toolResult";
import { studioApiFetch } from "../../utils/studioApiFetch";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { VIRAL_PRESETS, type ViralPresetName } from "../../captions/viralPresets";

// ---------------------------------------------------------------------------
// 1. Generate Dynamic Viral Captions
// ---------------------------------------------------------------------------

export const STUDIO_GENERATE_CAPTIONS_DESCRIPTION =
  "Generate dynamic, word-by-word animated viral karaoke captions from narration audio with synchronized active word pops (Hormozi, Neon, or Clean preset).";

export const STUDIO_GENERATE_CAPTIONS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    stylePreset: {
      type: "string",
      enum: ["hormozi", "neon", "clean"],
      description: "Visual preset: 'hormozi' (high-voltage yellow pop + black stroke), 'neon' (cyberpunk glow), or 'clean' (subtle documentary white on box).",
      default: "hormozi",
    },
    wordsPerGroup: {
      type: "number",
      description: "Number of words visible at once per group (2 to 5, default 3 for high-energy pacing).",
      default: 3,
    },
  },
};

export interface StudioGenerateCaptionsInput {
  stylePreset?: ViralPresetName;
  wordsPerGroup?: number;
}

export interface StudioGenerateCaptionsResult {
  ok: boolean;
  preset: string;
  captionFile: string;
  wordCount?: number;
  message: string;
}

// ---------------------------------------------------------------------------
// 2. Split Timeline Clip
// ---------------------------------------------------------------------------

export const STUDIO_SPLIT_CLIP_DESCRIPTION =
  "Split a video, scene, or audio clip at the specified timestamp or current playhead, creating two adjacent clips.";

export const STUDIO_SPLIT_CLIP_INPUT_SCHEMA = {
  type: "object",
  properties: {
    time: {
      type: "number",
      description: "Timestamp in seconds where the cut should be made.",
    },
    clipId: {
      type: "string",
      description: "Optional ID or selector of the clip to split. If omitted, splits the selected clip or clip at playhead.",
    },
  },
  required: ["time"],
};

export interface StudioSplitClipInput {
  time: number;
  clipId?: string;
}

export interface StudioSplitClipResult {
  ok: boolean;
  splitTime: number;
  originalClipId: string;
  newClipId: string;
}

// ---------------------------------------------------------------------------
// 3. Remove Silence / Dead Gaps
// ---------------------------------------------------------------------------

export const STUDIO_REMOVE_SILENCE_DESCRIPTION =
  "Automatically detect pauses or dead gaps between timeline clips and ripple-collapse them to tighten pacing.";

export const STUDIO_REMOVE_SILENCE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    minPauseSeconds: {
      type: "number",
      description: "Minimum pause threshold in seconds to consider silence (default 0.5s).",
      default: 0.5,
    },
  },
};

export interface StudioRemoveSilenceInput {
  minPauseSeconds?: number;
}

export interface StudioRemoveSilenceResult {
  ok: boolean;
  gapsRemoved: number;
  timeSavedSeconds: number;
}

// ---------------------------------------------------------------------------
// 4. Insert B-Roll Visual Overlay
// ---------------------------------------------------------------------------

export const STUDIO_INSERT_BROLL_DESCRIPTION =
  "Insert an image, video, or graphic card overlay into the timeline at a specific start and duration.";

export const STUDIO_INSERT_BROLL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    src: {
      type: "string",
      description: "Asset URL or relative path (e.g. 'assets/chart.png' or 'https://...').",
    },
    startTime: {
      type: "number",
      description: "Start time on the timeline in seconds.",
    },
    duration: {
      type: "number",
      description: "Duration in seconds for the overlay.",
    },
    title: {
      type: "string",
      description: "Optional label for the B-roll layer.",
    },
  },
  required: ["src", "startTime", "duration"],
};

export interface StudioInsertBrollInput {
  src: string;
  startTime: number;
  duration: number;
  title?: string;
}

export interface StudioInsertBrollResult {
  ok: boolean;
  layerId: string;
  startTime: number;
  duration: number;
}

// ---------------------------------------------------------------------------
// Tool Implementations
// ---------------------------------------------------------------------------

export interface TimelineMacroToolDeps {
  getProjectId: () => string | null;
  getCurrentTime: () => number;
  reloadPreview: () => void;
  showToast?: (message: string, tone?: "info" | "success" | "error") => void;
}

export async function studioGenerateCaptions(
  deps: TimelineMacroToolDeps,
  input: StudioGenerateCaptionsInput,
): Promise<ToolResult<StudioGenerateCaptionsResult>> {
  const projectId = deps.getProjectId();
  if (!projectId) {
    return toolFailure("blocked", "No active project is loaded in Studio.");
  }

  const presetName = input.stylePreset ?? "hormozi";
  const wordsPerGroup = input.wordsPerGroup ?? (VIRAL_PRESETS[presetName]?.wordsPerGroup || 3);

  try {
    const res = await studioApiFetch(
      buildProjectApiPath(projectId, "/handoff/generate-viral-captions"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stylePreset: presetName, wordsPerGroup }),
      },
    );

    if (!res || !res.ok) {
      const err = await res?.json().catch(() => ({}));
      return toolFailure(
        "failed",
        (err as { error?: string }).error || "Failed to generate viral captions on server.",
      );
    }

    const data = (await res.json()) as {
      ok: boolean;
      captionFile: string;
      wordCount?: number;
      message?: string;
    };

    deps.reloadPreview();
    deps.showToast?.(`✓ Generated viral ${presetName} karaoke captions!`, "success");

    return toolOk({
      preset: presetName,
      captionFile: data.captionFile || "compositions/captions.html",
      wordCount: data.wordCount,
      message: `Generated viral karaoke captions using '${presetName}' preset.`,
    });
  } catch (error) {
    return toolFailure("failed", String(error));
  }
}

export async function studioSplitClip(
  deps: TimelineMacroToolDeps,
  input: StudioSplitClipInput,
): Promise<ToolResult<StudioSplitClipResult>> {
  const projectId = deps.getProjectId();
  if (!projectId) {
    return toolFailure("blocked", "No active project is loaded in Studio.");
  }

  const splitTime = typeof input.time === "number" ? input.time : deps.getCurrentTime();

  try {
    const res = await studioApiFetch(buildProjectApiPath(projectId, "/handoff/macro/split-clip"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time: splitTime, clipId: input.clipId }),
    });

    if (!res || !res.ok) {
      const err = await res?.json().catch(() => ({}));
      return toolFailure(
        "failed",
        (err as { error?: string }).error || "Failed to split clip on server.",
      );
    }

    const data = (await res.json()) as {
      ok: boolean;
      splitTime: number;
      originalClipId: string;
      newClipId: string;
    };

    deps.reloadPreview();
    deps.showToast?.(`✓ Split clip at ${splitTime.toFixed(2)}s`, "success");

    return toolOk({
      splitTime: data.splitTime ?? splitTime,
      originalClipId: data.originalClipId ?? "clip-1",
      newClipId: data.newClipId ?? "clip-2",
    });
  } catch (error) {
    return toolFailure("failed", String(error));
  }
}

export async function studioRemoveSilence(
  deps: TimelineMacroToolDeps,
  input: StudioRemoveSilenceInput,
): Promise<ToolResult<StudioRemoveSilenceResult>> {
  const projectId = deps.getProjectId();
  if (!projectId) {
    return toolFailure("blocked", "No active project is loaded in Studio.");
  }

  const minPause = input.minPauseSeconds ?? 0.5;

  try {
    const res = await studioApiFetch(
      buildProjectApiPath(projectId, "/handoff/macro/remove-silence"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minPauseSeconds: minPause }),
      },
    );

    if (!res || !res.ok) {
      const err = await res?.json().catch(() => ({}));
      return toolFailure(
        "failed",
        (err as { error?: string }).error || "Failed to trim silence.",
      );
    }

    const data = (await res.json()) as {
      ok: boolean;
      gapsRemoved: number;
      timeSavedSeconds: number;
    };

    deps.reloadPreview();
    deps.showToast?.(
      `✓ Removed ${data.gapsRemoved ?? 0} pause(s), saved ${(data.timeSavedSeconds ?? 0).toFixed(2)}s`,
      "success",
    );

    return toolOk({
      gapsRemoved: data.gapsRemoved ?? 0,
      timeSavedSeconds: data.timeSavedSeconds ?? 0,
    });
  } catch (error) {
    return toolFailure("failed", String(error));
  }
}

export async function studioInsertBroll(
  deps: TimelineMacroToolDeps,
  input: StudioInsertBrollInput,
): Promise<ToolResult<StudioInsertBrollResult>> {
  const projectId = deps.getProjectId();
  if (!projectId) {
    return toolFailure("blocked", "No active project is loaded in Studio.");
  }

  try {
    const res = await studioApiFetch(buildProjectApiPath(projectId, "/handoff/macro/insert-broll"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        src: input.src,
        startTime: input.startTime,
        duration: input.duration,
        title: input.title,
      }),
    });

    if (!res || !res.ok) {
      const err = await res?.json().catch(() => ({}));
      return toolFailure(
        "failed",
        (err as { error?: string }).error || "Failed to insert B-roll overlay.",
      );
    }

    const data = (await res.json()) as {
      ok: boolean;
      layerId: string;
      startTime: number;
      duration: number;
    };

    deps.reloadPreview();
    deps.showToast?.(`✓ Inserted B-roll overlay at ${input.startTime}s`, "success");

    return toolOk({
      layerId: data.layerId ?? "broll-overlay",
      startTime: input.startTime,
      duration: input.duration,
    });
  } catch (error) {
    return toolFailure("failed", String(error));
  }
}
