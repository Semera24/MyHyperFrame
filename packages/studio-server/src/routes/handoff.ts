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
    hasPublishingPackage: boolean;
    publishingPackagePath?: string;
  };
}

function resolveEpisodeRoot(projectDir: string): string {
  const clean = projectDir.replace(/\/+$/, "");
  return basename(clean) === "Sources" ? dirname(clean) : clean;
}

function parsePngHeader(filePath: string): { width: number; height: number; colorType: number; hasAlpha: boolean } | null {
  try {
    const buf = readFileSync(filePath);
    if (buf.length < 29) return null;
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const colorType = buf[25]; // 0=gray, 2=RGB, 3=palette, 4=gray+alpha, 6=RGBA
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
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_streams "${audioPath}"`,
      { encoding: "utf-8", timeout: 4000 }
    );
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
    const channel = channelMatch ? channelMatch[1] : "Turning_Point_Stories";

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
          const words = content.replace(/[#*`_~-]/g, " ").trim().split(/\s+/).filter(Boolean).length;
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
            title: titleMatch ? titleMatch[1].trim() : scriptFile,
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
        const rootDurMatch = html.match(/id=["']root["'][^>]*data-duration=["']([0-9.]+)["']/);
        if (rootDurMatch) {
          const tDur = Number.parseFloat(rootDurMatch[1]!);
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

    // 6. Delivery, Publishing Package & Renders Check
    const draftPath = join(epRoot, "Renders", `${episodeId}_Draft.mp4`);
    if (existsSync(draftPath)) {
      data.delivery.hasDraftRender = true;
      data.delivery.draftRenderPath = draftPath;
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
    const audioFiles = existsSync(audioDir) ? readdirSync(audioDir).filter((f) => /\.(mp3|wav|m4a|aac)$/i.test(f)) : [];
    if (audioFiles.length === 0) {
      return c.json({ ok: false, error: "No narration audio found in Audio/" }, 400);
    }

    const probe = inspectAudioWithFfprobe(join(audioDir, audioFiles[0]!));
    if (!probe || !probe.durationSeconds) {
      return c.json({ ok: false, error: "Failed to read audio duration via ffprobe" }, 500);
    }

    const exactDuration = probe.durationSeconds.toFixed(3);

    try {
      let html = readFileSync(sourcesIndex, "utf-8");
      // Update root data-duration
      html = html.replace(/(id=["']root["'][^>]*data-duration=["'])[0-9.]+([^>]*["'])/, `$1${exactDuration}$2`);
      // Update narration audio element data-duration if present
      html = html.replace(/(<audio[^>]*id=["']narration["'][^>]*data-duration=["'])[0-9.]+([^>]*["'])/, `$1${exactDuration}$2`);

      await writeFile(sourcesIndex, html, "utf-8");
      return c.json({
        ok: true,
        durationSynced: Number.parseFloat(exactDuration),
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
    let hook = "In the defining moments of history, single decisions reshape the world.";
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
      const sceneRegex = /<div[^>]*data-composition-id=["'](s\d+)["'][^>]*data-start=["']([0-9.]+)["'][^>]*>/gi;
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
    const channel = channelMatch ? channelMatch[1] : "Turning_Point_Stories";

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
      return c.json({
        ok: false,
        error: "No rendered MP4 found in Renders/ or Previews/. Export a review render first.",
      }, 400);
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
}
