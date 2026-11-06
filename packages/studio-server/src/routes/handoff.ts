import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";

export interface EpisodeHandoffData {
  episodeId: string;
  channel: string;
  authoritativeDir: string;
  stage: string;
  script: {
    fileName?: string;
    exists: boolean;
    wordCount?: number;
    title?: string;
    firstLines?: string;
  };
  audio: {
    fileName?: string;
    exists: boolean;
    sizeBytes?: number;
    durationSeconds?: number;
  };
  timing: {
    fileName?: string;
    exists: boolean;
    provenance?: string;
    fps?: number;
    targetFrames?: number;
    cueCount?: number;
    sceneCount?: number;
  };
  assets: {
    totalImages: number;
    characters: number;
    backgrounds: number;
    maps: number;
  };
  revisions: {
    revisionNotesFile?: string;
    recentRevisions: Array<{
      date?: string;
      title?: string;
      rawSummary?: string;
    }>;
  };
  delivery: {
    hasDraftRender: boolean;
    draftRenderPath?: string;
    hasFinalMaster: boolean;
    finalMasterPath?: string;
  };
}

function resolveEpisodeRoot(projectDir: string): string {
  const clean = projectDir.replace(/\/+$/, "");
  return basename(clean) === "Sources" ? dirname(clean) : clean;
}

export function registerHandoffRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // 1. GET /api/projects/:id/handoff — Return persistent production health & handoff status
  api.get("/projects/:id/handoff", async (c) => {
    const projectId = c.req.param("id");
    let project = await adapter.resolveProject(projectId);
    if (!project) {
      const all = await adapter.listProjects();
      project = all.find((p) => p.id === projectId) ?? null;
    }

    const rawDir = project?.dir || process.cwd();
    const epRoot = resolveEpisodeRoot(rawDir);
    const episodeId = basename(epRoot);

    // Channel name detection
    const channelMatch = epRoot.match(/\/ProductionStudio\/channels\/([^/]+)\/episodes\//);
    const channel = channelMatch ? channelMatch[1] : "Turning_Point_Stories";

    const data: EpisodeHandoffData = {
      episodeId,
      channel,
      authoritativeDir: epRoot,
      stage: "Production Active",
      script: { exists: false },
      audio: { exists: false },
      timing: { exists: false },
      assets: { totalImages: 0, characters: 0, backgrounds: 0, maps: 0 },
      revisions: { recentRevisions: [] },
      delivery: { hasDraftRender: false, hasFinalMaster: false },
    };

    // 1. Script Inspection in Brief/
    const briefDir = join(epRoot, "Brief");
    if (existsSync(briefDir)) {
      try {
        const files = readdirSync(briefDir);
        const scriptFile = files.find((f) => /script/i.test(f) && f.endsWith(".md"));
        if (scriptFile) {
          const content = readFileSync(join(briefDir, scriptFile), "utf-8");
          const words = content.replace(/[#*`>-]/g, "").trim().split(/\s+/).filter(Boolean).length;
          const firstH1 = /^#\s+(.+)$/m.exec(content)?.[1];
          data.script = {
            fileName: scriptFile,
            exists: true,
            wordCount: words,
            title: firstH1,
            firstLines: content.slice(0, 300),
          };
        }
      } catch {
        /* ignore */
      }
    }

    // 2. Audio Inspection in Audio/
    const audioDir = join(epRoot, "Audio");
    if (existsSync(audioDir)) {
      try {
        const files = readdirSync(audioDir);
        const audioFile = files.find((f) => /\.(mp3|wav|m4a|aac)$/i.test(f));
        if (audioFile) {
          const stat = statSync(join(audioDir, audioFile));
          data.audio = {
            fileName: audioFile,
            exists: true,
            sizeBytes: stat.size,
          };
        }
      } catch {
        /* ignore */
      }
    }

    // 3. Timing Map Inspection in Timing/
    const timingDir = join(epRoot, "Timing");
    if (existsSync(timingDir)) {
      try {
        const files = readdirSync(timingDir);
        const timingFile = files.find((f) => f.endsWith(".json"));
        if (timingFile) {
          const content = JSON.parse(readFileSync(join(timingDir, timingFile), "utf-8")) as {
            timing_provenance?: string;
            fps?: number;
            target_frames?: number;
            target_video_duration_seconds?: number;
            scenes?: Array<{ id?: string; cues?: unknown[] }>;
          };
          let totalCues = 0;
          if (Array.isArray(content.scenes)) {
            for (const sc of content.scenes) {
              if (Array.isArray(sc.cues)) totalCues += sc.cues.length;
            }
          }
          data.timing = {
            fileName: timingFile,
            exists: true,
            provenance: content.timing_provenance || "Standard Timing Map",
            fps: content.fps || 30,
            targetFrames: content.target_frames,
            cueCount: totalCues,
            sceneCount: Array.isArray(content.scenes) ? content.scenes.length : 0,
          };
          if (content.target_video_duration_seconds && !data.audio.durationSeconds) {
            data.audio.durationSeconds = content.target_video_duration_seconds;
          }
        }
      } catch {
        /* ignore */
      }
    }

    // 4. Asset Manifest in Images/
    const imagesDir = join(epRoot, "Images");
    if (existsSync(imagesDir)) {
      try {
        const files = readdirSync(imagesDir);
        for (const file of files) {
          if (!/\.(png|jpe?g|svg|webp)$/i.test(file)) continue;
          data.assets.totalImages++;
          const lower = file.toLowerCase();
          if (lower.includes("_char_") || lower.includes("character")) data.assets.characters++;
          else if (lower.includes("_bg_") || lower.includes("background")) data.assets.backgrounds++;
          else if (lower.includes("_map_") || lower.includes("route")) data.assets.maps++;
        }
      } catch {
        /* ignore */
      }
    }

    // 5. Revision Notes in QC/ or Brief/
    const qcDir = join(epRoot, "QC");
    const revFile =
      (existsSync(qcDir) && readdirSync(qcDir).find((f) => f.endsWith("_Revision_Notes.md"))) ||
      (existsSync(briefDir) && readdirSync(briefDir).find((f) => f.endsWith("_Revision_Notes.md")));

    if (revFile) {
      const p = existsSync(join(qcDir, revFile)) ? join(qcDir, revFile) : join(briefDir, revFile);
      data.revisions.revisionNotesFile = revFile;
      try {
        const revContent = readFileSync(p, "utf-8");
        // Split by "## " headers to get recent revision entries
        const sections = revContent.split(/\n(?=##\s+)/).slice(1, 6);
        data.revisions.recentRevisions = sections.map((sec) => {
          const firstLine = sec.split("\n")[0]!.replace(/^##\s+/, "").trim();
          return {
            title: firstLine,
            rawSummary: sec.slice(0, 400).trim(),
          };
        });
      } catch {
        /* ignore */
      }
    }

    // 6. Delivery & Renders Check
    const draftPath = join(epRoot, "Renders", `${episodeId}_Draft.mp4`);
    if (existsSync(draftPath)) {
      data.delivery.hasDraftRender = true;
      data.delivery.draftRenderPath = draftPath;
    }
    const exportsDir = resolve(epRoot, "../../../exports", channel, episodeId);
    if (existsSync(exportsDir)) {
      try {
        const exportedFiles = readdirSync(exportsDir).filter((f) => f.endsWith(".mp4"));
        if (exportedFiles.length > 0) {
          data.delivery.hasFinalMaster = true;
          data.delivery.finalMasterPath = join(exportsDir, exportedFiles[0]!);
        }
      } catch {
        /* ignore */
      }
    }

    return c.json({ ok: true, handoff: data });
  });

  // 2. POST /api/projects/:id/handoff/approve — Record an owner approval note in Revision_Notes.md
  api.post("/projects/:id/handoff/approve", async (c) => {
    const projectId = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as {
      type?: "script" | "audio" | "revisions" | "master";
      note?: string;
    } | null;

    if (!body || !body.type) {
      return c.json({ ok: false, error: "type is required" }, 400);
    }

    let project = await adapter.resolveProject(projectId);
    if (!project) {
      const all = await adapter.listProjects();
      project = all.find((p) => p.id === projectId) ?? null;
    }
    const rawDir = project?.dir || process.cwd();
    const epRoot = resolveEpisodeRoot(rawDir);
    const episodeId = basename(epRoot);

    const qcDir = join(epRoot, "QC");
    if (!existsSync(qcDir)) {
      await mkdir(qcDir, { recursive: true });
    }
    const targetFile = join(qcDir, `${episodeId}_Revision_Notes.md`);

    const dateStr = new Date().toISOString().slice(0, 10);
    const entryHeader = `\n## ${dateStr} — Owner Approval: ${body.type.toUpperCase()}\n`;
    const entryBody = `- Approved by: Owner via HyperFrames Studio\n- Note: ${body.note || "Approved as authoritative."}\n- Timestamp: ${new Date().toLocaleTimeString()}\n`;

    try {
      await appendFile(targetFile, `${entryHeader}${entryBody}`, "utf-8");
      return c.json({ ok: true, recordedIn: targetFile });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });
}
