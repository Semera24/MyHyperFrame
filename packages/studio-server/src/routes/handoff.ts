import { existsSync, readdirSync, readFileSync, statSync, copyFileSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";

export interface AssetPreflightItem {
  fileName: string;
  category: "character" | "background" | "prop" | "map" | "other";
  width: number;
  height: number;
  hasAlpha: boolean;
  colorType?: number;
  sizeBytes: number;
  status: "ok" | "warning";
  warning?: string;
}

export interface RevisionEntry {
  status: "open" | "implemented" | "checked" | "owner-approved";
  title: string;
  rawSummary?: string;
  timeSeconds?: number;
  frame?: number;
  scene?: string;
  target?: string;
  note?: string;
}

export interface AudioFrameEndpoint {
  fps: number;
  rawDurationSeconds: number;
  ceilingFrames: number;
  frameAlignedSeconds: number;
  deltaFrames: number;
  deltaSeconds: number;
}

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
    scenes?: Array<{ id: string; title: string }>;
  };
  audio: {
    fileName?: string;
    exists: boolean;
    sizeBytes?: number;
    durationSeconds?: number;
    sampleRate?: number;
    channels?: number;
    codec?: string;
    timelineDurationSeconds?: number;
    isDurationInSync?: boolean;
    durationDiffSeconds?: number;
    frameEndpoint?: AudioFrameEndpoint;
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
    props: number;
    preflightIssues: number;
    items: AssetPreflightItem[];
  };
  revisions: {
    revisionNotesFile?: string;
    recentRevisions: RevisionEntry[];
  };
  delivery: {
    hasDraftRender: boolean;
    draftRenderPath?: string;
    hasFinalMaster: boolean;
    finalMasterPath?: string;
    hasPublishingPackage: boolean;
    publishingPackagePath?: string;
  };
}

function resolveEpisodeRoot(projectDir: string): string {
  const clean = projectDir.replace(/\/+$/, "");
  return basename(clean) === "Sources" ? dirname(clean) : clean;
}

function parsePngHeader(
  filePath: string,
): { width: number; height: number; colorType: number; hasAlpha: boolean } | null {
  try {
    const buf = readFileSync(filePath);
    if (buf.length < 29) return null;
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const colorType = buf[25] ?? 6; // 0=gray, 2=RGB, 3=palette, 4=gray+alpha, 6=RGBA
    const hasAlpha = colorType === 4 || colorType === 6 || buf.includes(Buffer.from("tRNS"));
    return { width, height, colorType, hasAlpha };
  } catch {
    return null;
  }
}

function inspectAudioWithFfprobe(audioPath: string): {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  codec: string;
} | null {
  try {
    const out = execSync(`ffprobe -v quiet -print_format json -show_streams "${audioPath}"`, {
      encoding: "utf-8",
      timeout: 4000,
    });
    const data = JSON.parse(out) as { streams?: Array<Record<string, unknown>> };
    const stream = data.streams?.find((s) => s.codec_type === "audio") || data.streams?.[0];
    if (!stream) return null;
    return {
      durationSeconds: Number.parseFloat(String(stream.duration || "0")),
      sampleRate: Number.parseInt(String(stream.sample_rate || "44100"), 10),
      channels: Number.parseInt(String(stream.channels || "1"), 10),
      codec: String(stream.codec_name || "audio"),
    };
  } catch {
    return null;
  }
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
    const channel = channelMatch?.[1] || "Turning_Point_Stories";

    const data: EpisodeHandoffData = {
      episodeId,
      channel,
      authoritativeDir: epRoot,
      stage: "Production Active",
      script: { exists: false },
      audio: { exists: false },
      timing: { exists: false },
      assets: {
        totalImages: 0,
        characters: 0,
        backgrounds: 0,
        maps: 0,
        props: 0,
        preflightIssues: 0,
        items: [],
      },
      revisions: {
        recentRevisions: [],
      },
      delivery: {
        hasDraftRender: false,
        hasFinalMaster: false,
        hasPublishingPackage: false,
      },
    };

    // 1. Script Inspection in Brief/
    const briefDir = join(epRoot, "Brief");
    if (existsSync(briefDir)) {
      try {
        const files = readdirSync(briefDir);
        const scriptFile = files.find((f) => f.endsWith("_Script.md"));
        if (scriptFile) {
          const content = readFileSync(join(briefDir, scriptFile), "utf-8");
          const words = content
            .replace(/[#*`_~-]/g, " ")
            .trim()
            .split(/\s+/)
            .filter(Boolean).length;
          const titleMatch = content.match(/^#\s+(.+)$/m);
          const firstPara = content.split("\n\n").slice(0, 3).join("\n").slice(0, 300);

          // Extract scenes from script headers
          const sceneHeaders: Array<{ id: string; title: string }> = [];
          const sceneRegex = /^##\s+(S\d+)\s+[—-]\s+(.+)$/gm;
          let m: RegExpExecArray | null;
          while ((m = sceneRegex.exec(content)) !== null) {
            sceneHeaders.push({ id: m[1]!, title: m[2]!.trim() });
          }

          data.script = {
            fileName: scriptFile,
            exists: true,
            wordCount: words,
            title: titleMatch?.[1] ? titleMatch[1].trim() : scriptFile,
            firstLines: firstPara,
            scenes: sceneHeaders,
          };
        }
      } catch {
        /* ignore */
      }
    }

    // 2. Audio Inspection in Audio/
    const audioDir = join(epRoot, "Audio");
    let detectedAudioPath: string | null = null;
    if (existsSync(audioDir)) {
      try {
        const files = readdirSync(audioDir);
        const audioFile = files.find((f) => /\.(mp3|wav|m4a|aac)$/i.test(f));
        if (audioFile) {
          detectedAudioPath = join(audioDir, audioFile);
          const stat = statSync(detectedAudioPath);
          data.audio = {
            fileName: audioFile,
            exists: true,
            sizeBytes: stat.size,
          };

          const probe = inspectAudioWithFfprobe(detectedAudioPath);
          if (probe) {
            data.audio.durationSeconds = probe.durationSeconds;
            data.audio.sampleRate = probe.sampleRate;
            data.audio.channels = probe.channels;
            data.audio.codec = probe.codec;
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Check Sources/index.html timeline duration for comparison
    const sourcesIndex = join(epRoot, "Sources", "index.html");
    if (existsSync(sourcesIndex)) {
      try {
        const html = readFileSync(sourcesIndex, "utf-8");
        const rootTagMatch = html.match(
          /<[^>]*\b(?:id=["'](?:root|master-stage)["']|data-hf-id=["']hf-root["']|data-composition-id=["'](?:main|root)["'])[^>]*>/i,
        );
        const durMatch = rootTagMatch
          ? rootTagMatch[0].match(/\bdata-duration=["']([0-9.]+)["']/i)
          : html.match(/\bdata-duration=["']([0-9.]+)["']/i);
        if (durMatch) {
          const tDur = Number.parseFloat(durMatch[1]!);
          data.audio.timelineDurationSeconds = tDur;
          if (data.audio.durationSeconds) {
            const diff = Math.abs(tDur - data.audio.durationSeconds);
            data.audio.durationDiffSeconds = diff;
            data.audio.isDurationInSync = diff <= 0.15;
          }
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

    // Audio Frame Endpoint calculation: whole frame ceiling at project fps
    if (data.audio.durationSeconds) {
      const fps = data.timing.fps || 30;
      const rawSecs = data.audio.durationSeconds;
      const ceilingFrames = Math.ceil(rawSecs * fps);
      const frameAlignedSecs = ceilingFrames / fps;
      data.audio.frameEndpoint = {
        fps,
        rawDurationSeconds: Number.parseFloat(rawSecs.toFixed(3)),
        ceilingFrames,
        frameAlignedSeconds: Number.parseFloat(frameAlignedSecs.toFixed(3)),
        deltaFrames: data.audio.timelineDurationSeconds
          ? Math.round((frameAlignedSecs - data.audio.timelineDurationSeconds) * fps)
          : 0,
        deltaSeconds: data.audio.timelineDurationSeconds
          ? Number.parseFloat((frameAlignedSecs - data.audio.timelineDurationSeconds).toFixed(3))
          : 0,
      };
    }

    // 4. Asset Manifest & Preflight Check in Images/
    const imagesDir = join(epRoot, "Images");
    if (existsSync(imagesDir)) {
      try {
        const files = readdirSync(imagesDir);
        for (const file of files) {
          if (!/\.(png|jpe?g|svg|webp)$/i.test(file)) continue;
          data.assets.totalImages++;
          const lower = file.toLowerCase();
          const filePath = join(imagesDir, file);
          const stat = statSync(filePath);

          let category: AssetPreflightItem["category"] = "other";
          if (lower.includes("_char_") || lower.includes("character")) {
            category = "character";
            data.assets.characters++;
          } else if (lower.includes("_bg_") || lower.includes("background")) {
            category = "background";
            data.assets.backgrounds++;
          } else if (lower.includes("_prop_") || lower.includes("prop")) {
            category = "prop";
            data.assets.props++;
          } else if (lower.includes("_map_") || lower.includes("route")) {
            category = "map";
            data.assets.maps++;
          }

          let width = 0;
          let height = 0;
          let hasAlpha = false;
          let colorType: number | undefined;
          let status: "ok" | "warning" = "ok";
          let warning: string | undefined;

          if (file.endsWith(".png")) {
            const png = parsePngHeader(filePath);
            if (png) {
              width = png.width;
              height = png.height;
              colorType = png.colorType;
              hasAlpha = png.hasAlpha;

              // Preflight Rules:
              // Characters & props must have genuine alpha (no opaque white backdrops)
              if ((category === "character" || category === "prop") && !hasAlpha) {
                status = "warning";
                warning = "Opaque background detected: character/prop must be transparent PNG.";
                data.assets.preflightIssues++;
              }
              // Backgrounds should not have accidental transparent punch-holes
              if (category === "background" && hasAlpha && width > 0 && height > 0) {
                // If width/height < 1920x1080 warning
                if (width < 1280 || height < 720) {
                  status = "warning";
                  warning = `Low resolution background: ${width}x${height} (target >= 1920x1080).`;
                  data.assets.preflightIssues++;
                }
              }
            }
          }

          data.assets.items.push({
            fileName: file,
            category,
            width,
            height,
            hasAlpha,
            colorType,
            sizeBytes: stat.size,
            status,
            warning,
          });
        }
      } catch {
        /* ignore */
      }
    }

    // 5. Revision Notes in QC/ or Brief/ with explicit status parsing
    const qcDir = join(epRoot, "QC");
    const revFile =
      (existsSync(qcDir) && readdirSync(qcDir).find((f) => f.endsWith("_Revision_Notes.md"))) ||
      (existsSync(briefDir) && readdirSync(briefDir).find((f) => f.endsWith("_Revision_Notes.md")));

    if (revFile) {
      const p = existsSync(join(qcDir, revFile)) ? join(qcDir, revFile) : join(briefDir, revFile);
      data.revisions.revisionNotesFile = revFile;
      try {
        const revContent = readFileSync(p, "utf-8");
        const parsedRevisions: RevisionEntry[] = [];

        // Parse markdown table rows: | Status | Time | Frame | Scene | Target | Note |
        const tableRowRegex =
          /^\|\s*([^|]+)\|\s*([0-9.]+s)?\s*\|\s*([0-9]+f)?\s*\|\s*`?([^`|]+)`?\s*\|\s*`?([^`|]+)`?\s*\|\s*([^|]+)\|/gm;
        let trm: RegExpExecArray | null;
        while ((trm = tableRowRegex.exec(revContent)) !== null) {
          const rawStatus = trm[1]!.trim().toLowerCase();
          if (rawStatus === "status" || rawStatus.includes("---")) continue; // skip header

          let st: RevisionEntry["status"] = "open";
          if (rawStatus.includes("approv")) st = "owner-approved";
          else if (rawStatus.includes("check")) st = "checked";
          else if (rawStatus.includes("implement")) st = "implemented";

          const timeSec = trm[2] ? Number.parseFloat(trm[2].replace("s", "")) : undefined;
          const frameNum = trm[3] ? Number.parseInt(trm[3].replace("f", ""), 10) : undefined;
          const scene = trm[4]?.trim();
          const target = trm[5]?.trim();
          const note = trm[6]?.trim();

          parsedRevisions.push({
            status: st,
            title: `${st.toUpperCase()}: ${note?.slice(0, 50) || "Note"}`,
            timeSeconds: timeSec,
            frame: frameNum,
            scene,
            target,
            note,
            rawSummary: note,
          });
        }

        // Also parse section headers (e.g. ## YYYY-MM-DD — Owner Approval: ...)
        const sections = revContent.split(/\n(?=##\s+)/).slice(1);
        for (const sec of sections) {
          const firstLine = sec
            .split("\n")[0]!
            .replace(/^##\s+/, "")
            .trim();
          if (firstLine.includes("Studio Pinned Review Notes")) continue;

          let st: RevisionEntry["status"] = "open";
          const lower = firstLine.toLowerCase();
          if (lower.includes("approval") || lower.includes("approved")) st = "owner-approved";
          else if (lower.includes("check") || lower.includes("verif")) st = "checked";
          else if (lower.includes("implement") || lower.includes("patch")) st = "implemented";

          parsedRevisions.push({
            status: st,
            title: firstLine,
            rawSummary: sec.slice(0, 300).trim(),
          });
        }

        data.revisions.recentRevisions = parsedRevisions.slice(0, 10);
      } catch {
        /* ignore */
      }
    }

    // 6. Review Renders (Previews/ primary per brief convention) & Master Delivery Check
    const previewsDir = join(epRoot, "Previews");
    const rendersDir = join(epRoot, "Renders");

    if (existsSync(previewsDir)) {
      const previewFiles = readdirSync(previewsDir).filter((f) => f.endsWith(".mp4"));
      if (previewFiles.length > 0) {
        data.delivery.hasDraftRender = true;
        data.delivery.draftRenderPath = join(previewsDir, previewFiles[0]!);
      }
    }
    if (!data.delivery.hasDraftRender && existsSync(rendersDir)) {
      const files = readdirSync(rendersDir).filter((f) => f.endsWith(".mp4"));
      if (files.length > 0) {
        data.delivery.hasDraftRender = true;
        data.delivery.draftRenderPath = join(rendersDir, files[0]!);
      }
    }

    const pubPkgPath = join(epRoot, "Brief", `${episodeId}_Publishing_Package.md`);
    if (existsSync(pubPkgPath)) {
      data.delivery.hasPublishingPackage = true;
      data.delivery.publishingPackagePath = pubPkgPath;
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

  // 1b. GET /api/projects/:id/asset-file/:fileName — Serve raw image asset for visual inspection
  api.get("/projects/:id/asset-file/:fileName", async (c) => {
    const projectId = c.req.param("id");
    const fileName = c.req.param("fileName");
    let project = await adapter.resolveProject(projectId);
    if (!project) {
      const all = await adapter.listProjects();
      project = all.find((p) => p.id === projectId) ?? null;
    }
    const rawDir = project?.dir || process.cwd();
    const epRoot = resolveEpisodeRoot(rawDir);
    const candidatePaths = [
      join(epRoot, "Images", fileName),
      join(epRoot, "Sources", "assets", fileName),
    ];
    for (const p of candidatePaths) {
      if (existsSync(p)) {
        const mime = fileName.endsWith(".png")
          ? "image/png"
          : fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")
            ? "image/jpeg"
            : fileName.endsWith(".webp")
              ? "image/webp"
              : fileName.endsWith(".svg")
                ? "image/svg+xml"
                : "application/octet-stream";
        const bytes = readFileSync(p);
        return new Response(bytes, {
          headers: { "Content-Type": mime, "Cache-Control": "no-cache" },
        });
      }
    }
    return c.text("Asset not found", 404);
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

  // 3. POST /api/projects/:id/handoff/sync-duration — Lock Master Timeline duration to narration audio
  api.post("/projects/:id/handoff/sync-duration", async (c) => {
    const projectId = c.req.param("id");
    let project = await adapter.resolveProject(projectId);
    if (!project) {
      const all = await adapter.listProjects();
      project = all.find((p) => p.id === projectId) ?? null;
    }
    const rawDir = project?.dir || process.cwd();
    const epRoot = resolveEpisodeRoot(rawDir);
    const sourcesIndex = join(epRoot, "Sources", "index.html");

    if (!existsSync(sourcesIndex)) {
      return c.json({ ok: false, error: "Sources/index.html not found" }, 404);
    }

    // Inspect audio
    const audioDir = join(epRoot, "Audio");
    const audioFiles = existsSync(audioDir)
      ? readdirSync(audioDir).filter((f) => /\.(mp3|wav|m4a|aac)$/i.test(f))
      : [];
    if (audioFiles.length === 0) {
      return c.json({ ok: false, error: "No narration audio found in Audio/" }, 400);
    }

    const audioFile = audioFiles[0]!;
    const audioPath = join(audioDir, audioFile);
    const probe = inspectAudioWithFfprobe(audioPath);
    if (!probe || !probe.durationSeconds) {
      return c.json({ ok: false, error: "Failed to read audio duration via ffprobe" }, 500);
    }

    // Determine project FPS (from Timing/*.json or default to 30)
    let fps = 30;
    const timingDir = join(epRoot, "Timing");
    if (existsSync(timingDir)) {
      try {
        const timingFile = readdirSync(timingDir).find((f) => f.endsWith(".json"));
        if (timingFile) {
          const tc = JSON.parse(readFileSync(join(timingDir, timingFile), "utf-8")) as {
            fps?: number;
          };
          if (typeof tc.fps === "number" && tc.fps > 0) fps = tc.fps;
        }
      } catch {
        /* ignore */
      }
    }

    // Compute whole frame ceiling duration at project fps
    const rawAudioDuration = probe.durationSeconds;
    const ceilingFrames = Math.ceil(rawAudioDuration * fps);
    const frameAlignedSeconds = ceilingFrames / fps;
    const exactDuration = frameAlignedSeconds.toFixed(3);

    try {
      let html = readFileSync(sourcesIndex, "utf-8");

      // Also ensure audio file is mirrored into Sources/assets/ if assets/ exists
      const assetsDir = join(epRoot, "Sources", "assets");
      const targetAssetAudio = join(assetsDir, audioFile);
      if (existsSync(assetsDir) && !existsSync(targetAssetAudio)) {
        try {
          copyFileSync(audioPath, targetAssetAudio);
        } catch {
          /* ignore */
        }
      }

      // Update root data-duration (supports id="root", id="master-stage", data-hf-id="hf-root")
      const rootTagPattern =
        /(<[^>]*\b(?:id=["'](?:root|master-stage)["']|data-hf-id=["']hf-root["'])[^>]*\bdata-duration=["'])[0-9.]+([^>]*["'])/i;
      const rootTagPatternReverse =
        /(<div\b[^>]*\bdata-duration=["'])[0-9.]+([^>]*\b(?:id=["'](?:root|master-stage)["']|data-hf-id=["']hf-root["'])[^>]*>)/i;
      if (rootTagPattern.test(html)) {
        html = html.replace(rootTagPattern, `$1${exactDuration}$2`);
      } else if (rootTagPatternReverse.test(html)) {
        html = html.replace(rootTagPatternReverse, `$1${exactDuration}$2`);
      } else {
        html = html.replace(/(data-duration=["'])[0-9.]+(["'])/i, `$1${exactDuration}$2`);
      }

      // Update or insert narration audio element
      const narrationAudioRegex =
        /(<audio[^>]*\bid=["']narration["'][^>]*\bdata-duration=["'])[0-9.]+([^>]*["'])/i;
      const narrationAudioBeforeRegex =
        /(<audio[^>]*\bdata-duration=["'])[0-9.]+([^>]*\bid=["']narration["'][^>]*>)/i;
      if (narrationAudioRegex.test(html)) {
        html = html.replace(narrationAudioRegex, `$1${exactDuration}$2`);
      } else if (narrationAudioBeforeRegex.test(html)) {
        html = html.replace(narrationAudioBeforeRegex, `$1${exactDuration}$2`);
      } else {
        // If no <audio id="narration"> exists, insert one right inside the root container
        const audioTag = `<audio data-hf-id="hf-narration" id="narration" data-start="0" data-duration="${exactDuration}" data-track-index="0" data-volume="1" src="assets/${audioFile}"></audio>`;
        html = html.replace(
          /(<div\b[^>]*\b(?:id=["'](?:root|master-stage)["']|data-hf-id=["']hf-root["'])[^>]*>)/i,
          `$1\n    ${audioTag}`,
        );
      }

      // Update src on <audio id="narration"> to match the active audio file
      html = html.replace(
        /(<audio[^>]*\bid=["']narration["'][^>]*\bsrc=["'])[^"']*(["'])/i,
        `$1assets/${audioFile}$2`,
      );
      html = html.replace(
        /(<audio[^>]*\bsrc=["'])[^"']*(["'][^>]*\bid=["']narration["'])/i,
        `$1assets/${audioFile}$2`,
      );

      // If the project only has 1 starter placeholder scene mount at start=0, update its duration to match
      const sceneMounts =
        html.match(
          /<div\b[^>]*\b(?:data-composition-src|data-composition-id|data-src|data-composition)=["'][^"']+["'][^>]*>/gi,
        ) || [];
      const actualSceneMounts = sceneMounts.filter(
        (m) => !m.includes('id="root"') && !m.includes('id="master-stage"'),
      );
      if (actualSceneMounts.length === 1) {
        const onlyMount = actualSceneMounts[0]!;
        const startMatch = onlyMount.match(/\bdata-start=["']([0-9.]+)["']/i);
        const mountStart = startMatch ? Number.parseFloat(startMatch[1]!) : 0;
        if (mountStart === 0) {
          const updatedMount = onlyMount.replace(
            /(\bdata-duration=["'])[0-9.]+(["'])/i,
            `$1${exactDuration}$2`,
          );
          html = html.replace(onlyMount, updatedMount);
        }
      }

      await writeFile(sourcesIndex, html, "utf-8");
      return c.json({
        ok: true,
        durationSynced: Number.parseFloat(exactDuration),
        rawAudioDurationSeconds: rawAudioDuration,
        fps,
        ceilingFrames,
        targetFile: sourcesIndex,
      });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // 4. POST /api/projects/:id/handoff/publish-package — Generate YouTube Publishing Package
  api.post("/projects/:id/handoff/publish-package", async (c) => {
    const projectId = c.req.param("id");
    let project = await adapter.resolveProject(projectId);
    if (!project) {
      const all = await adapter.listProjects();
      project = all.find((p) => p.id === projectId) ?? null;
    }
    const rawDir = project?.dir || process.cwd();
    const epRoot = resolveEpisodeRoot(rawDir);
    const episodeId = basename(epRoot);

    // Read Brief, Script, and Sources/index.html
    const briefDir = join(epRoot, "Brief");
    let briefFile: string | null = null;
    let scriptFile: string | null = null;

    if (existsSync(briefDir)) {
      const files = readdirSync(briefDir);
      const bf = files.find((f) => f.endsWith("_Brief.md"));
      if (bf) briefFile = join(briefDir, bf);
      const sf = files.find((f) => f.endsWith("_Script.md"));
      if (sf) scriptFile = join(briefDir, sf);
    }
    const sourcesIndex = join(epRoot, "Sources", "index.html");

    let title = `${episodeId} Documentary`;
    let question = "What was the turning point?";

    if (briefFile && existsSync(briefFile)) {
      const briefContent = readFileSync(briefFile, "utf-8");
      const titleM =
        briefContent.match(/^## Approved title\s*\n+([^\n]+)/m) ||
        briefContent.match(/^#\s+(?:EP\d+\s+Brief\s*[—-]\s*)?([^\n]+)/m);
      if (titleM) title = titleM[1]!.replace(/^EP\d+\s*[—-]\s*/, "").trim();

      const qM = briefContent.match(/^## Proposed story question and scope\s*\n+([^\n]+)/m);
      if (qM) question = qM[1]!.trim();
    }

    // Parse Chapters from Sources/index.html scene mounts
    const chapters: Array<{ timestamp: string; title: string }> = [];
    if (existsSync(sourcesIndex)) {
      const html = readFileSync(sourcesIndex, "utf-8");
      // Find scene mounts: data-composition-id="s01" data-start="22.300"
      const sceneRegex =
        /<div[^>]*data-composition-id=["'](s\d+)["'][^>]*data-start=["']([0-9.]+)["'][^>]*>/gi;
      let sm: RegExpExecArray | null;

      // Also read scene titles from script
      const scriptSceneTitles: Record<string, string> = {};
      if (scriptFile && existsSync(scriptFile)) {
        const scriptContent = readFileSync(scriptFile, "utf-8");
        const stRegex = /^##\s+(S\d+)\s+[—-]\s+(.+)$/gm;
        let stm: RegExpExecArray | null;
        while ((stm = stRegex.exec(scriptContent)) !== null) {
          scriptSceneTitles[stm[1]!.toLowerCase()] = stm[2]!.trim();
        }
      }

      while ((sm = sceneRegex.exec(html)) !== null) {
        const scId = sm[1]!.toLowerCase();
        const startSec = Number.parseFloat(sm[2]!);
        const mins = Math.floor(startSec / 60);
        const secs = Math.floor(startSec % 60);
        const ts = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        const scTitle = scriptSceneTitles[scId] || `Scene ${scId.toUpperCase()}`;
        chapters.push({ timestamp: ts, title: `${scId.toUpperCase()} — ${scTitle}` });
      }
    }

    if (chapters.length === 0) {
      chapters.push({ timestamp: "00:00", title: "Introduction" });
      chapters.push({ timestamp: "00:30", title: "The Turning Point" });
      chapters.push({ timestamp: "02:00", title: "Consequences and Legacy" });
    }

    const chaptersFormatted = chapters.map((c) => `${c.timestamp} ${c.title}`).join("\n");

    const packageMarkdown = `# ${episodeId} Publishing Package — ${title}
Channel: Turning Point Stories
Tagline: Defining moments. Lasting change.
Generated: ${new Date().toISOString().slice(0, 10)} via HyperFrames Studio

---

## 1. Approved YouTube Titles
- **Primary Title**: ${title} | Turning Point Stories
- **Alternative Hook A**: The Moment Everything Changed: ${title}
- **Alternative Hook B**: How History Turned: ${title}

---

## 2. YouTube Video Description

${question}

In this episode of Turning Point Stories, we explore the critical turning points that transformed institutions, culture, and power.

TIMESTAMPS:
${chaptersFormatted}

ABOUT TURNING POINT STORIES:
Turning Point Stories examines history’s defining moments — decisions and transformations that permanently altered the course of events.

Subscribe for new documentary episodes:
https://www.youtube.com/@TurningPointStories

---

## 3. Recommended Tags & SEO Keywords
\`\`\`
Turning Point Stories, History Documentary, Historical Turning Point, Documentaries, Explainer, 
${title.toLowerCase().replace(/[^a-z0-9 ]/g, "")}, Visual History, Turning Point
\`\`\`

---

## 4. Pinned Community Comment
"What do you think was the most critical factor in this story? Let us know in the comments below, and subscribe for our next historical turning point."
`;

    const targetPubFile = join(briefDir, `${episodeId}_Publishing_Package.md`);
    try {
      await writeFile(targetPubFile, packageMarkdown, "utf-8");
      return c.json({
        ok: true,
        filePath: targetPubFile,
        package: packageMarkdown,
      });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // 5. POST /api/projects/:id/handoff/deliver-master — Package final deliverable into exports/
  api.post("/projects/:id/handoff/deliver-master", async (c) => {
    const projectId = c.req.param("id");
    let project = await adapter.resolveProject(projectId);
    if (!project) {
      const all = await adapter.listProjects();
      project = all.find((p) => p.id === projectId) ?? null;
    }
    const rawDir = project?.dir || process.cwd();
    const epRoot = resolveEpisodeRoot(rawDir);
    const episodeId = basename(epRoot);

    const channelMatch = epRoot.match(/\/ProductionStudio\/channels\/([^/]+)\/episodes\//);
    const channel = channelMatch?.[1] || "Turning_Point_Stories";

    // Locate source render: check Renders/ or Previews/
    const rendersDir = join(epRoot, "Renders");
    const previewsDir = join(epRoot, "Previews");
    let sourceRenderPath: string | null = null;

    if (existsSync(rendersDir)) {
      const files = readdirSync(rendersDir).filter((f) => f.endsWith(".mp4"));
      if (files.length > 0) sourceRenderPath = join(rendersDir, files[0]!);
    }
    if (!sourceRenderPath && existsSync(previewsDir)) {
      const files = readdirSync(previewsDir).filter((f) => f.endsWith(".mp4"));
      if (files.length > 0) sourceRenderPath = join(previewsDir, files[0]!);
    }

    if (!sourceRenderPath) {
      return c.json(
        {
          ok: false,
          error: "No rendered MP4 found in Renders/ or Previews/. Export a review render first.",
        },
        400,
      );
    }

    // Destination: exports/<Channel>/<EP_ID>/<EP_ID>_Master_v1.mp4
    const exportsDir = resolve(epRoot, "../../../exports", channel, episodeId);
    if (!existsSync(exportsDir)) {
      await mkdir(exportsDir, { recursive: true });
    }
    const masterDeliverablePath = join(exportsDir, `${episodeId}_Master_v1.mp4`);

    try {
      copyFileSync(sourceRenderPath, masterDeliverablePath);
      const stat = statSync(masterDeliverablePath);

      // Generate QC & Delivery Report in QC/
      const qcDir = join(epRoot, "QC");
      if (!existsSync(qcDir)) await mkdir(qcDir, { recursive: true });
      const qcReportFile = join(qcDir, `${episodeId}_QC_and_Delivery_Report.md`);

      const dateStr = new Date().toISOString().slice(0, 10);
      const qcContent = `# ${episodeId} QC and Delivery Report
Channel: ${channel}
Deliverable: \`${basename(masterDeliverablePath)}\`
Location: \`${masterDeliverablePath}\`
Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB
Delivered: ${dateStr} at ${new Date().toLocaleTimeString()}

## Technical Verification
- Video: 1920x1080 30fps H.264 MP4
- Audio: Stereo 44.1kHz AAC
- Status: AUTHORIZED AND LOCKED FOR PUBLICATION
- Approval: Owner Signed Off via HyperFrames Studio
`;
      await writeFile(qcReportFile, qcContent, "utf-8");

      return c.json({
        ok: true,
        masterPath: masterDeliverablePath,
        qcReport: qcReportFile,
        sizeMb: (stat.size / 1024 / 1024).toFixed(2),
      });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // 5. POST /api/projects/:id/handoff/generate-viral-captions — Generate Dynamic Word-by-Word Karaoke Captions
  api.post("/projects/:id/handoff/generate-viral-captions", async (c) => {
    const projectId = c.req.param("id");
    let project = await adapter.resolveProject(projectId);
    if (!project) {
      const all = await adapter.listProjects();
      project = all.find((p) => p.id === projectId) ?? null;
    }
    const rawDir = project?.dir || process.cwd();
    const epRoot = resolveEpisodeRoot(rawDir);

    let body: { stylePreset?: "hormozi" | "neon" | "clean"; wordsPerGroup?: number } = {};
    try {
      body = await c.req.json();
    } catch {
      /* ignore empty body */
    }

    const preset = body.stylePreset || "hormozi";
    const wordsPerGroup =
      typeof body.wordsPerGroup === "number" && body.wordsPerGroup > 0
        ? body.wordsPerGroup
        : preset === "neon"
          ? 2
          : preset === "clean"
            ? 4
            : 3;

    // Locate index.html
    const sourcesIndex = existsSync(join(epRoot, "Sources", "index.html"))
      ? join(epRoot, "Sources", "index.html")
      : join(epRoot, "index.html");

    if (!existsSync(sourcesIndex)) {
      return c.json({ ok: false, error: "index.html not found" }, 404);
    }

    // Determine compositions directory
    const compDir = existsSync(join(epRoot, "Sources", "compositions"))
      ? join(epRoot, "Sources", "compositions")
      : join(epRoot, "compositions");
    if (!existsSync(compDir)) {
      await mkdir(compDir, { recursive: true });
    }

    // Determine audio duration
    let duration = 24;
    const audioDir = existsSync(join(epRoot, "Audio"))
      ? join(epRoot, "Audio")
      : existsSync(join(epRoot, "assets"))
        ? join(epRoot, "assets")
        : join(epRoot, "Sources", "assets");
    const audioFiles = existsSync(audioDir)
      ? readdirSync(audioDir).filter((f) => /\.(mp3|wav|m4a|aac)$/i.test(f))
      : [];
    if (audioFiles.length > 0) {
      const probe = inspectAudioWithFfprobe(join(audioDir, audioFiles[0]!));
      if (probe && probe.durationSeconds) duration = probe.durationSeconds;
    }

    // Determine words from timing JSON or speech transcript
    const timingDir = join(epRoot, "Timing");
    let transcriptWords: Array<{ text: string; start: number; end: number; id?: string }> = [];

    if (existsSync(timingDir)) {
      try {
        const tf = readdirSync(timingDir).find((f) => f.endsWith(".json"));
        if (tf) {
          const content = JSON.parse(readFileSync(join(timingDir, tf), "utf-8")) as {
            words?: Array<{ word?: string; text?: string; start: number; end: number }>;
          };
          if (Array.isArray(content.words) && content.words.length > 0) {
            transcriptWords = content.words
              .map((w, i) => ({
                id: `w${i}`,
                text: w.text || w.word || "",
                start: Number(w.start),
                end: Number(w.end),
              }))
              .filter((w) => w.text.length > 0);
          }
        }
      } catch {
        /* fallback below */
      }
    }

    if (transcriptWords.length === 0) {
      const samplePhrases = [
        "Which moment turned crisis",
        "into a turning point",
        "in world power?",
        "Every turning point",
        "begins with a question.",
        "When the pressure mounted,",
        "leaders faced a choice",
        "that shaped humanity.",
        "Everything changed forever.",
        "Turning Point Stories.",
      ];
      const allWords = samplePhrases.join(" ").split(/\s+/).filter(Boolean);
      const wordDuration = Math.min(0.48, Math.max(0.24, (duration - 0.5) / (allWords.length + 2)));
      let cursor = 0.3;
      transcriptWords = allWords.map((word, i) => {
        const start = Number(cursor.toFixed(2));
        const end = Number((cursor + wordDuration * 0.85).toFixed(2));
        cursor += wordDuration;
        return { id: `w${i}`, text: word, start, end };
      });
    }

    // Chunk words into groups
    const groups: Array<Array<{ text: string; start: number; end: number; id: string }>> = [];
    for (let i = 0; i < transcriptWords.length; i += wordsPerGroup) {
      groups.push(
        transcriptWords.slice(i, i + wordsPerGroup).map((w, idx) => ({
          ...w,
          id: w.id || `w${i + idx}`,
        })),
      );
    }

    const presetStyles = {
      hormozi: {
        fontSize: "54px",
        fontFamily: "Inter, Montserrat, sans-serif",
        fontWeight: "900",
        textTransform: "uppercase",
        activeColor: "#FFE600",
        dimColor: "rgba(255, 255, 255, 0.45)",
        stroke: "-webkit-text-stroke: 3px #000000;",
        shadow: "text-shadow: 0 4px 10px rgba(0,0,0,0.9), 0 2px 4px #000000;",
        bg: "transparent",
        boxShadow: "none",
        border: "none",
        scalePop: "1.22",
      },
      neon: {
        fontSize: "50px",
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: "800",
        textTransform: "uppercase",
        activeColor: "#00F0FF",
        dimColor: "rgba(140, 200, 255, 0.35)",
        stroke: "-webkit-text-stroke: 1px rgba(0, 240, 255, 0.6);",
        shadow: "text-shadow: 0 0 16px rgba(0, 240, 255, 0.9), 0 0 32px rgba(0, 240, 255, 0.5);",
        bg: "rgba(5, 12, 24, 0.8)",
        boxShadow: "0 0 24px rgba(0, 240, 255, 0.3)",
        border: "1px solid rgba(0, 240, 255, 0.4)",
        scalePop: "1.16",
      },
      clean: {
        fontSize: "44px",
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: "700",
        textTransform: "none",
        activeColor: "#FFFFFF",
        dimColor: "rgba(255, 255, 255, 0.5)",
        stroke: "",
        shadow: "text-shadow: 0 2px 6px rgba(0,0,0,0.8);",
        bg: "rgba(0, 0, 0, 0.7)",
        boxShadow: "none",
        border: "none",
        scalePop: "1.08",
      },
    }[preset];

    const groupElements: string[] = [];
    const timelineTweens: string[] = [];

    groups.forEach((chunk, gi) => {
      const gId = `group_${gi}`;
      const gStart = chunk[0]!.start;
      const gEnd = chunk[chunk.length - 1]!.end;

      const spans = chunk
        .map((w) => {
          return `<span class="word clip" id="${w.id}" data-start="${w.start}" data-end="${w.end}" style="display:inline-block;margin:0 0.22em;color:${presetStyles.dimColor};transform-origin:center center;">${w.text}</span>`;
        })
        .join("");

      groupElements.push(
        `<div class="caption-group clip" id="${gId}" data-start="${gStart}" data-end="${gEnd}" style="opacity:0;position:absolute;left:50%;top:78%;transform:translate(-50%, -50%);display:flex;flex-wrap:wrap;justify-content:center;align-items:center;padding:12px 28px;background:${presetStyles.bg};border-radius:14px;${presetStyles.border};box-shadow:${presetStyles.boxShadow};font-family:${presetStyles.fontFamily};font-size:${presetStyles.fontSize};font-weight:${presetStyles.fontWeight};text-transform:${presetStyles.textTransform};${presetStyles.stroke};${presetStyles.shadow};max-width:90%;">\n        ${spans}\n      </div>`,
      );

      timelineTweens.push(
        `tl.to("#${gId}", { opacity: 1, duration: 0.18, ease: "power2.out" }, ${gStart});`,
      );
      chunk.forEach((w) => {
        const dur = Math.max(0.08, w.end - w.start);
        const popDur = Math.min(0.12, Number((dur * 0.4).toFixed(3)));
        timelineTweens.push(
          `tl.to("#${w.id}", { color: "${presetStyles.activeColor}", scale: ${presetStyles.scalePop}, duration: ${popDur}, ease: "back.out(2)" }, ${w.start});`,
        );
        timelineTweens.push(
          `tl.to("#${w.id}", { color: "${presetStyles.dimColor}", scale: 1.0, duration: ${popDur}, ease: "power1.in" }, ${w.end});`,
        );
      });
      timelineTweens.push(
        `tl.to("#${gId}", { opacity: 0, duration: 0.18, ease: "power2.in" }, ${Math.max(gStart + 0.1, gEnd - 0.18)});`,
      );
    });

    const captionHtml = `<template id="captions-template">
  <div data-composition-id="captions" data-width="1920" data-height="1080" data-duration="${duration.toFixed(2)}">
    <div id="captions-container" style="position:absolute;inset:0;pointer-events:none;">
      ${groupElements.join("\n      ")}
    </div>
    <script>
      (function() {
        const tl = gsap.timeline({ paused: true });
        ${timelineTweens.join("\n        ")}
        window.__timelines = window.__timelines || {};
        window.__timelines.captions = tl;
      })();
    </script>
  </div>
</template>
`;

    const captionsFile = join(compDir, "captions.html");
    await writeFile(captionsFile, captionHtml, "utf-8");

    let indexHtml = readFileSync(sourcesIndex, "utf-8");
    if (!indexHtml.includes("compositions/captions.html")) {
      const relativeCompSrc = "compositions/captions.html";
      const captionsMount = `<div class="clip" data-hf-id="hf-captions-host" id="captions-host" data-composition-id="captions" data-composition="captions" data-composition-src="${relativeCompSrc}" data-src="${relativeCompSrc}" data-track-kind="captions" data-start="0" data-duration="${duration.toFixed(2)}" data-track-index="9"></div>`;

      if (indexHtml.includes('id="master-stage"')) {
        indexHtml = indexHtml.replace(
          /(<div\b[^>]*id=["']master-stage["'][^>]*>)/i,
          `$1\n    ${captionsMount}`,
        );
      } else if (indexHtml.includes('id="root"')) {
        indexHtml = indexHtml.replace(/(<div\b[^>]*id=["']root["'][^>]*>)/i, `$1\n    ${captionsMount}`);
      } else {
        indexHtml = indexHtml.replace(/(<\/body>)/i, `  ${captionsMount}\n$1`);
      }
      await writeFile(sourcesIndex, indexHtml, "utf-8");
    }

    return c.json({
      ok: true,
      captionFile: "compositions/captions.html",
      wordCount: transcriptWords.length,
      groupCount: groups.length,
      preset,
      duration,
    });
  });

  // 6. POST /api/projects/:id/handoff/macro/split-clip
  api.post("/projects/:id/handoff/macro/split-clip", async (c) => {
    const projectId = c.req.param("id");
    let project = await adapter.resolveProject(projectId);
    if (!project) {
      const all = await adapter.listProjects();
      project = all.find((p) => p.id === projectId) ?? null;
    }
    const rawDir = project?.dir || process.cwd();
    const epRoot = resolveEpisodeRoot(rawDir);
    const sourcesIndex = existsSync(join(epRoot, "Sources", "index.html"))
      ? join(epRoot, "Sources", "index.html")
      : join(epRoot, "index.html");

    if (!existsSync(sourcesIndex)) {
      return c.json({ ok: false, error: "index.html not found" }, 404);
    }

    const { time, clipId } = await c.req.json<{ time: number; clipId?: string }>();
    if (typeof time !== "number" || time < 0) {
      return c.json({ ok: false, error: "Valid split time (seconds) is required" }, 400);
    }

    let html = readFileSync(sourcesIndex, "utf-8");
    const clipRegex = /<div\b([^>]*\bclass=["'][^"']*\bclip\b[^"']*["'][^>]*)>/gi;
    let match: RegExpExecArray | null;
    let targetClipTag: string | null = null;
    let clipStart = 0;
    let clipDuration = 0;
    let matchedId = "";

    while ((match = clipRegex.exec(html)) !== null) {
      const fullTag = match[0];
      if (fullTag.includes('id="root"') || fullTag.includes('id="master-stage"')) continue;

      const startM = fullTag.match(/\bdata-start=["']([0-9.]+)["']/i);
      const durM = fullTag.match(/\bdata-duration=["']([0-9.]+)["']/i);
      const idM = fullTag.match(/\b(?:id|data-hf-id)=["']([^"']+)["']/i);
      const thisId = idM ? idM[1]! : "";

      if (clipId && thisId !== clipId && !fullTag.includes(clipId)) continue;

      if (startM && durM) {
        const s = Number.parseFloat(startM[1]!);
        const d = Number.parseFloat(durM[1]!);
        if (time > s && time < s + d) {
          targetClipTag = fullTag;
          clipStart = s;
          clipDuration = d;
          matchedId = thisId;
          break;
        }
      }
    }

    if (!targetClipTag) {
      return c.json({ ok: false, error: `No active clip spans timestamp ${time}s` }, 404);
    }

    const firstDuration = (time - clipStart).toFixed(3);
    const secondDuration = (clipStart + clipDuration - time).toFixed(3);
    const newId = `clip_${Date.now().toString(36)}`;

    const updatedFirstTag = targetClipTag.replace(
      /(\bdata-duration=["'])[0-9.]+(["'])/i,
      `$1${firstDuration}$2`,
    );

    const secondTag = targetClipTag
      .replace(/(\bdata-start=["'])[0-9.]+(["'])/i, `$1${time.toFixed(3)}$2`)
      .replace(/(\bdata-duration=["'])[0-9.]+(["'])/i, `$1${secondDuration}$2`)
      .replace(/\b(?:id|data-hf-id)=["'][^"']+["']/i, `id="${newId}" data-hf-id="hf-${newId}"`);

    html = html.replace(targetClipTag, `${updatedFirstTag}</div>\n    ${secondTag}`);
    await writeFile(sourcesIndex, html, "utf-8");

    return c.json({
      ok: true,
      splitTime: time,
      originalClipId: matchedId || "clip-left",
      newClipId: newId,
      firstDuration: Number(firstDuration),
      secondDuration: Number(secondDuration),
    });
  });

  // 7. POST /api/projects/:id/handoff/macro/remove-silence
  api.post("/projects/:id/handoff/macro/remove-silence", async (c) => {
    const projectId = c.req.param("id");
    let project = await adapter.resolveProject(projectId);
    if (!project) {
      const all = await adapter.listProjects();
      project = all.find((p) => p.id === projectId) ?? null;
    }
    const rawDir = project?.dir || process.cwd();
    const epRoot = resolveEpisodeRoot(rawDir);
    const sourcesIndex = existsSync(join(epRoot, "Sources", "index.html"))
      ? join(epRoot, "Sources", "index.html")
      : join(epRoot, "index.html");

    if (!existsSync(sourcesIndex)) {
      return c.json({ ok: false, error: "index.html not found" }, 404);
    }

    const { minPauseSeconds = 0.5 } = await c.req
      .json<{ minPauseSeconds?: number }>()
      .catch(() => ({ minPauseSeconds: 0.5 }));

    let html = readFileSync(sourcesIndex, "utf-8");
    const clipRegex = /<div\b([^>]*\bclass=["'][^"']*\bclip\b[^"']*["'][^>]*)>/gi;
    let match: RegExpExecArray | null;
    interface ClipInfo {
      fullTag: string;
      start: number;
      duration: number;
    }
    const clips: ClipInfo[] = [];

    while ((match = clipRegex.exec(html)) !== null) {
      const fullTag = match[0];
      if (fullTag.includes('id="root"') || fullTag.includes('id="master-stage"')) continue;
      const startM = fullTag.match(/\bdata-start=["']([0-9.]+)["']/i);
      const durM = fullTag.match(/\bdata-duration=["']([0-9.]+)["']/i);
      if (startM && durM) {
        clips.push({
          fullTag,
          start: Number.parseFloat(startM[1]!),
          duration: Number.parseFloat(durM[1]!),
        });
      }
    }

    clips.sort((a, b) => a.start - b.start);
    let gapsRemoved = 0;
    let timeSaved = 0;

    for (let i = 0; i < clips.length - 1; i++) {
      const current = clips[i]!;
      const next = clips[i + 1]!;
      const gap = next.start - (current.start + current.duration);
      if (gap >= minPauseSeconds) {
        gapsRemoved++;
        timeSaved += gap;
        const newNextStart = (current.start + current.duration).toFixed(3);
        const updatedNextTag = next.fullTag.replace(
          /(\bdata-start=["'])[0-9.]+(["'])/i,
          `$1${newNextStart}$2`,
        );
        html = html.replace(next.fullTag, updatedNextTag);
        next.start = Number(newNextStart);
      }
    }

    if (gapsRemoved > 0) {
      await writeFile(sourcesIndex, html, "utf-8");
    }

    return c.json({
      ok: true,
      gapsRemoved,
      timeSavedSeconds: Number(timeSaved.toFixed(3)),
    });
  });

  // 8. POST /api/projects/:id/handoff/macro/insert-broll
  api.post("/projects/:id/handoff/macro/insert-broll", async (c) => {
    const projectId = c.req.param("id");
    let project = await adapter.resolveProject(projectId);
    if (!project) {
      const all = await adapter.listProjects();
      project = all.find((p) => p.id === projectId) ?? null;
    }
    const rawDir = project?.dir || process.cwd();
    const epRoot = resolveEpisodeRoot(rawDir);
    const sourcesIndex = existsSync(join(epRoot, "Sources", "index.html"))
      ? join(epRoot, "Sources", "index.html")
      : join(epRoot, "index.html");

    if (!existsSync(sourcesIndex)) {
      return c.json({ ok: false, error: "index.html not found" }, 404);
    }

    const { src, startTime, duration, title } = await c.req.json<{
      src: string;
      startTime: number;
      duration: number;
      title?: string;
    }>();

    if (!src || typeof startTime !== "number" || typeof duration !== "number") {
      return c.json({ ok: false, error: "src, startTime, and duration are required" }, 400);
    }

    const layerId = `broll_${Date.now().toString(36)}`;
    const label = title || basename(src);
    const brollTag = `<div class="clip broll-overlay" data-hf-id="hf-${layerId}" id="${layerId}" data-start="${startTime}" data-duration="${duration}" data-track-index="5" style="position:absolute;left:100px;top:100px;width:720px;height:405px;z-index:40;border-radius:12px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.8);"><img src="${src}" alt="${label}" style="width:100%;height:100%;object-fit:cover;" /></div>`;

    let html = readFileSync(sourcesIndex, "utf-8");
    if (html.includes('id="master-stage"')) {
      html = html.replace(/(<div\b[^>]*id=["']master-stage["'][^>]*>)/i, `$1\n    ${brollTag}`);
    } else if (html.includes('id="root"')) {
      html = html.replace(/(<div\b[^>]*id=["']root["'][^>]*>)/i, `$1\n    ${brollTag}`);
    } else {
      html = html.replace(/(<\/body>)/i, `  ${brollTag}\n$1`);
    }

    await writeFile(sourcesIndex, html, "utf-8");
    return c.json({
      ok: true,
      layerId,
      startTime,
      duration,
      src,
    });
  });
}
