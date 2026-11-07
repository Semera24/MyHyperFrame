import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { isInHiddenOrVendorDir, isPrivateProjectPath, walkDir } from "../helpers/safePath.js";
import { isCompositionSource } from "../helpers/hfIdPersist.js";
import { resolveProjectSignature } from "../helpers/projectSignature.js";

function resolveEpisodeQcNotesPath(projectDir: string, projectId: string): string {
  let realDir = projectDir;
  try {
    realDir = realpathSync(projectDir);
  } catch {
    realDir = projectDir;
  }
  const epRoot = basename(realDir) === "Sources" ? dirname(realDir) : realDir;
  const qcDir = resolve(epRoot, "QC");
  if (existsSync(qcDir)) {
    try {
      const existing = readdirSync(qcDir).find((f) => f.endsWith("_Revision_Notes.md"));
      if (existing) return resolve(qcDir, existing);
    } catch {
      // ignore
    }
  }
  return resolve(qcDir, `${projectId}_Revision_Notes.md`);
}

async function filterCompositionFiles(projectDir: string, files: string[]): Promise<string[]> {
  const htmlFiles = files.filter((f) => f.endsWith(".html") && !isInHiddenOrVendorDir(f));
  const checks = await Promise.all(
    htmlFiles.map(async (f) => {
      try {
        const content = await readFile(join(projectDir, f), "utf-8");
        return isCompositionSource(content);
      } catch {
        return false;
      }
    }),
  );
  return htmlFiles.filter((_, i) => checks[i]);
}

export function registerProjectRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // List all projects (enriched with ProductionStudio episode metadata)
  api.get("/projects", async (c) => {
    const rawProjects = await adapter.listProjects();
    const projects = rawProjects
      .map((p) => {
        let realDir = p.dir;
        try {
          realDir = realpathSync(p.dir);
        } catch {
          realDir = p.dir;
        }
        const isAuthoritative =
          realDir.includes("/ProductionStudio/channels/") && !realDir.startsWith("/tmp");
        const channelMatch = realDir.match(/\/ProductionStudio\/channels\/([^/]+)\/episodes\//);
        const channel = channelMatch ? channelMatch[1] : undefined;
        const epRoot = basename(realDir) === "Sources" ? dirname(realDir) : realDir;
        const draftRenderPath = resolve(epRoot, "Renders", `${p.id}_Draft.mp4`);
        const hasDraftRender = existsSync(draftRenderPath);
        let sceneCount = 0;
        const compsDir = join(realDir, "compositions");
        if (existsSync(compsDir)) {
          try {
            sceneCount = readdirSync(compsDir).filter((f) => f.endsWith(".html")).length;
          } catch {
            sceneCount = 0;
          }
        }
        return {
          ...p,
          realDir,
          isAuthoritative,
          channel,
          sceneCount,
          hasDraftRender,
          draftRenderPath: hasDraftRender ? draftRenderPath : undefined,
        };
      })
      .sort((a, b) => {
        if (a.isAuthoritative !== b.isAuthoritative) {
          return a.isAuthoritative ? -1 : 1;
        }
        return a.id.localeCompare(b.id, undefined, { numeric: true });
      });
    return c.json({ projects });
  });

  // Resolve session to project (multi-project mode)
  api.get("/resolve-session/:sessionId", async (c) => {
    if (!adapter.resolveSession) {
      return c.json({ error: "not available" }, 404);
    }
    const { sessionId } = c.req.param();
    const result = await adapter.resolveSession(sessionId);
    if (!result) return c.json({ error: "Session not found" }, 404);
    return c.json(result);
  });

  // Current content signature for a project: a cheap poll target for clients that refresh when files change on disk.
  api.get("/projects/:id/signature", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json({ signature: await resolveProjectSignature(adapter, project.dir) });
  });

  // Project file tree
  api.get("/projects/:id", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    let realDir = project.dir;
    try {
      realDir = realpathSync(project.dir);
    } catch {
      realDir = project.dir;
    }
    const isAuthoritative =
      realDir.includes("/ProductionStudio/channels/") && !realDir.startsWith("/tmp");
    const files = walkDir(project.dir).filter((file) => !isPrivateProjectPath(file));
    const compositions = await filterCompositionFiles(project.dir, files);
    return c.json({
      id: project.id,
      dir: project.dir,
      realDir,
      isAuthoritative,
      title: project.title,
      files,
      compositions,
    });
  });

  // Episode QC Revision Notes (read/append in ../QC/*_Revision_Notes.md)
  api.get("/projects/:id/revision-notes", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const notesPath = resolveEpisodeQcNotesPath(project.dir, project.id);
    let content = "";
    try {
      content = await readFile(notesPath, "utf-8");
    } catch {
      content = "";
    }
    return c.json({ ok: true, notesPath, content });
  });

  api.post("/projects/:id/revision-notes", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as {
      timestampSeconds?: number;
      frame?: number;
      sceneFile?: string;
      elementId?: string;
      note?: string;
      status?: "OPEN" | "RESOLVED";
    } | null;
    if (!body || !body.note || !body.note.trim()) {
      return c.json({ error: "note is required" }, 400);
    }

    const notesPath = resolveEpisodeQcNotesPath(project.dir, project.id);
    await mkdir(dirname(notesPath), { recursive: true });
    let existing = "";
    try {
      existing = await readFile(notesPath, "utf-8");
    } catch {
      existing = `# ${project.id} Revision Notes\n\n`;
    }

    const status = body.status ?? "OPEN";
    const timeStr = `${Number(body.timestampSeconds ?? 0).toFixed(2)}s`;
    const frameStr = `${Math.round(body.frame ?? (body.timestampSeconds ?? 0) * 30)}f`;
    const sceneStr = (body.sceneFile || "index.html").replace(/\|/g, "/");
    const targetStr = (body.elementId || "scene").replace(/\|/g, "/");
    const cleanNote = body.note.trim().replace(/\r?\n/g, " ").replace(/\|/g, "/");
    const row = `| ${status} | ${timeStr} | ${frameStr} | \`${sceneStr}\` | \`${targetStr}\` | ${cleanNote} |`;

    const sectionHeader = "## Studio Pinned Review Notes";
    const tableHeader =
      "| Status | Time (s) | Frame (30fps) | Scene | Target Element | Note |\n| :--- | :--- | :--- | :--- | :--- | :--- |";

    let updated: string;
    if (existing.includes(sectionHeader)) {
      updated = `${existing.trimEnd()}\n${row}\n`;
    } else {
      updated = `${existing.trimEnd()}\n\n${sectionHeader}\n\n${tableHeader}\n${row}\n`;
    }

    await writeFile(notesPath, updated, "utf-8");
    return c.json({ ok: true, notesPath, row, content: updated });
  });

  // Spatial Canvas Comments (`.hyperframes/canvas-comments.json` + `../QC/*_Revision_Notes.md`)
  interface CanvasCommentPinRecord {
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
    targetAgent: "Claude Code" | "Codex" | "Antigravity" | "ChatGPT";
    note: string;
    status: "OPEN" | "RESOLVED";
    createdAt: string;
  }

  async function readCanvasCommentsFile(projectDir: string): Promise<CanvasCommentPinRecord[]> {
    const filePath = join(projectDir, ".hyperframes", "canvas-comments.json");
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as { pins?: CanvasCommentPinRecord[] };
      return Array.isArray(parsed.pins) ? parsed.pins : [];
    } catch {
      return [];
    }
  }

  async function writeCanvasCommentsFile(
    projectDir: string,
    pins: CanvasCommentPinRecord[],
  ): Promise<string> {
    const dirPath = join(projectDir, ".hyperframes");
    await mkdir(dirPath, { recursive: true });
    const filePath = join(dirPath, "canvas-comments.json");
    await writeFile(filePath, `${JSON.stringify({ version: 1, pins }, null, 2)}\n`, "utf-8");
    return filePath;
  }

  api.get("/projects/:id/canvas-comments", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const pins = await readCanvasCommentsFile(project.dir);
    const notesPath = resolveEpisodeQcNotesPath(project.dir, project.id);
    return c.json({ ok: true, pins, notesPath });
  });

  api.post("/projects/:id/canvas-comments", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as Partial<CanvasCommentPinRecord> | null;
    if (!body || !body.note || !body.note.trim()) {
      return c.json({ error: "note is required" }, 400);
    }

    const pins = await readCanvasCommentsFile(project.dir);
    const nextNumber = pins.length > 0 ? Math.max(...pins.map((p) => p.pinNumber || 0)) + 1 : 1;
    const pin: CanvasCommentPinRecord = {
      id: body.id || `pin-${Date.now().toString(36)}`,
      pinNumber: body.pinNumber ?? nextNumber,
      stageX: Math.round(Number(body.stageX ?? 960)),
      stageY: Math.round(Number(body.stageY ?? 540)),
      pctX: Number(body.pctX ?? 50),
      pctY: Number(body.pctY ?? 50),
      timestampSeconds: Number(body.timestampSeconds ?? 0),
      frame: Math.round(Number(body.frame ?? (body.timestampSeconds ?? 0) * 30)),
      sceneFile: body.sceneFile || "index.html",
      elementId: body.elementId || "scene",
      hfId: body.hfId,
      tagName: body.tagName,
      boundingBox: body.boundingBox,
      targetAgent: body.targetAgent || "Claude Code",
      note: body.note.trim(),
      status: body.status ?? "OPEN",
      createdAt: body.createdAt || new Date().toISOString(),
    };

    const existingIdx = pins.findIndex((p) => p.id === pin.id);
    if (existingIdx >= 0) {
      pins[existingIdx] = pin;
    } else {
      pins.push(pin);
    }
    const jsonPath = await writeCanvasCommentsFile(project.dir, pins);

    // Also append to QC/<EP_ID>_Revision_Notes.md
    const notesPath = resolveEpisodeQcNotesPath(project.dir, project.id);
    await mkdir(dirname(notesPath), { recursive: true });
    let existing = "";
    try {
      existing = await readFile(notesPath, "utf-8");
    } catch {
      existing = `# ${project.id} Revision Notes\n\n`;
    }

    const timeStr = `${pin.timestampSeconds.toFixed(2)}s`;
    const frameStr = `${pin.frame}f`;
    const sceneStr = pin.sceneFile.replace(/\|/g, "/");
    const targetStr =
      `${pin.elementId} @ (${pin.stageX}, ${pin.stageY}) [${pin.targetAgent}]`.replace(/\|/g, "/");
    const cleanNote = pin.note.replace(/\r?\n/g, " ").replace(/\|/g, "/");
    const row = `| ${pin.status} (#${pin.pinNumber}) | ${timeStr} | ${frameStr} | \`${sceneStr}\` | \`${targetStr}\` | ${cleanNote} |`;

    const sectionHeader = "## Studio Pinned Review Notes";
    const tableHeader =
      "| Status | Time (s) | Frame (30fps) | Scene | Target Element | Note |\n| :--- | :--- | :--- | :--- | :--- | :--- |";

    const updated = existing.includes(sectionHeader)
      ? `${existing.trimEnd()}\n${row}\n`
      : `${existing.trimEnd()}\n\n${sectionHeader}\n\n${tableHeader}\n${row}\n`;

    await writeFile(notesPath, updated, "utf-8");
    return c.json({ ok: true, pin, pins, jsonPath, notesPath });
  });

  api.patch("/projects/:id/canvas-comments/:pinId", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const pinId = c.req.param("pinId");
    const body = (await c.req.json().catch(() => null)) as Partial<CanvasCommentPinRecord> | null;
    const pins = await readCanvasCommentsFile(project.dir);
    const idx = pins.findIndex((p) => p.id === pinId);
    if (idx < 0) return c.json({ error: "pin not found" }, 404);
    pins[idx] = { ...pins[idx]!, ...body, id: pinId };
    await writeCanvasCommentsFile(project.dir, pins);
    return c.json({ ok: true, pin: pins[idx], pins });
  });

  api.delete("/projects/:id/canvas-comments/:pinId", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const pinId = c.req.param("pinId");
    const pins = (await readCanvasCommentsFile(project.dir)).filter((p) => p.id !== pinId);
    await writeCanvasCommentsFile(project.dir, pins);
    return c.json({ ok: true, pins });
  });

  // POST /api/projects/create-episode — Scaffolds a complete authoritative episode
  api.post("/projects/create-episode", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      channel?: string;
      episodeId?: string;
      title?: string;
      centralQuestion?: string;
    } | null;

    if (!body || !body.episodeId || !body.episodeId.trim()) {
      return c.json({ ok: false, error: "episodeId is required (e.g. EP06_The_Crisis)" }, 400);
    }

    const channel = body.channel || "Turning_Point_Stories";
    const episodeId = body.episodeId.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    const title = body.title?.trim() || episodeId.replace(/_/g, " ");
    const question =
      body.centralQuestion?.trim() || "Which moment turned crisis into a turning point?";

    const baseDir = "/Users/yonassayfu/Projects/ProductionStudio";
    const channelEpisodesDir = join(baseDir, "channels", channel, "episodes");
    const epDir = join(channelEpisodesDir, episodeId);

    if (existsSync(epDir)) {
      return c.json({ ok: false, error: `Episode folder '${episodeId}' already exists!` }, 409);
    }

    const subdirs = [
      "Audio",
      "Backups",
      "Brief",
      "Handoff",
      "Images",
      "Previews",
      "QC",
      "Reference",
      "Research",
      "Sources",
      "Sources/assets",
      "Sources/compositions",
      "Timing",
    ];

    for (const sub of subdirs) {
      await mkdir(join(epDir, sub), { recursive: true });
    }

    // 1. Brief/<EP_ID>_Brief.md
    const briefContent = `# ${episodeId} Brief — ${title}\n\n## Central Question\n${question}\n\n## Status\nSTAGE A — TOPIC AND BRIEF\n`;
    await writeFile(join(epDir, "Brief", `${episodeId}_Brief.md`), briefContent, "utf-8");

    // 2. Brief/<EP_ID>_Script.md
    const scriptContent = `# ${episodeId} Script — ${title}\n\nStatus: Initial Draft\n\n## S01 — The Hook\n\n[Opening narrative voiceover text will be placed here.]\n`;
    await writeFile(join(epDir, "Brief", `${episodeId}_Script.md`), scriptContent, "utf-8");

    // 3. Timing/<EP_ID>_Timing_Map.json
    const timingContent = JSON.stringify(
      {
        episode_id: episodeId,
        fps: 30,
        status: "placeholder_scaffold",
        target_video_duration_seconds: 24.0,
        target_frames: 720,
        scenes: [
          {
            id: "S01",
            title: "The Hook",
            start_frame: 0,
            end_frame_exclusive: 720,
            first_phrase: "In the defining moments of history...",
            last_phrase: "...everything changed.",
            cues: [
              {
                id: "S01_C01",
                supplied_seconds: 0.5,
                frame: 15,
                visual_intent: "Reveal title card",
              },
            ],
          },
        ],
      },
      null,
      2,
    );
    await writeFile(join(epDir, "Timing", `${episodeId}_Timing_Map.json`), timingContent, "utf-8");

    // 4. Sources/assets/gsap.min.js (vendor runtime copy)
    const gsapVendorSources = [
      "/Users/yonassayfu/Projects/HyperFrames_Custom_Studio/hyperframes/node_modules/.bun/gsap@3.15.0/node_modules/gsap/dist/gsap.min.js",
      "/Users/yonassayfu/Projects/ProductionStudio/channels/Turning_Point_Stories/episodes/EP04_Suez_Hormuz_Waterways/Sources/assets/gsap.min.js",
    ];
    for (const vSrc of gsapVendorSources) {
      if (existsSync(vSrc)) {
        try {
          await copyFile(vSrc, join(epDir, "Sources", "assets", "gsap.min.js"));
          break;
        } catch {
          /* ignore */
        }
      }
    }

    // 5. Sources/index.html (Fully compliant with Agent_Editing_Contract.md & Studio reader)
    const sourcesIndex = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1920, height=1080">
  <title>${title} (${episodeId})</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body, html, #root, #master-stage { width: 1920px; height: 1080px; overflow: hidden; background: #0B141C; margin: 0; padding: 0; }
    .scene-mount { position: absolute; inset: 0; width: 1920px; height: 1080px; }
  </style>
  <script src="assets/gsap.min.js"></script>
</head>
<body>
  <div data-hf-id="hf-root" id="root" data-composition-id="main" data-start="0" data-duration="24.000" data-fps="30" data-width="1920" data-height="1080">
    <audio data-hf-id="hf-narration" id="narration" data-start="0" data-duration="24.000" data-track-index="0" data-volume="1" src="assets/narration.mp3"></audio>
    <div data-hf-id="hf-s01-mount" id="s01" class="scene-mount"
         data-composition-id="s01" data-composition-src="compositions/s01.html"
         data-composition="s01" data-src="compositions/s01.html"
         data-start="0.000" data-duration="24.000" data-track-index="1"
         data-width="1920" data-height="1080"></div>
  </div>
</body>
</html>`;
    await writeFile(join(epDir, "Sources", "index.html"), sourcesIndex, "utf-8");

    // 6. Sources/hyperframes.json
    const metaJson = JSON.stringify(
      {
        id: episodeId,
        title,
        fps: 30,
        width: 1920,
        height: 1080,
        compositions: ["compositions/s01.html"],
      },
      null,
      2,
    );
    await writeFile(join(epDir, "Sources", "hyperframes.json"), metaJson, "utf-8");

    // 7. Sources/compositions/s01.html
    const s01Html = `<template>
  <div data-hf-id="hf-s01-root" id="root" data-composition-id="s01" data-width="1920" data-height="1080">
    <style>
      #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #0B141C; font-family: Inter, sans-serif; }
      #s01-vignette { position: absolute; inset: 0; background: linear-gradient(to right, rgba(11,20,28,0.92) 0%, rgba(11,20,28,0.6) 100%); z-index: 2; }
      #s01-headline-card { position: absolute; left: 90px; top: 120px; width: 840px; z-index: 10; opacity: 0; }
      #s01-kicker { font-size: 20px; font-weight: 700; letter-spacing: 0.16em; color: #C49A44; text-transform: uppercase; margin-bottom: 12px; }
      #s01-headline-text { font-size: 52px; font-weight: 900; line-height: 1.15; color: #FFFFFF; }
      #s01-central-q { margin-top: 24px; font-size: 22px; color: #C8D6DF; line-height: 1.4; border-left: 4px solid #357F83; padding-left: 16px; }
    </style>
    <div data-hf-id="hf-s01-vignette" id="s01-vignette" class="clip" data-start="0.00" data-duration="24.00"></div>
    <div data-hf-id="hf-s01-headline-card" id="s01-headline-card" class="clip" data-start="0.40" data-duration="23.60" data-motion-in="rise-up">
      <div data-hf-id="hf-s01-kicker" id="s01-kicker">${episodeId.replace(/_/g, " ")}</div>
      <div data-hf-id="hf-s01-headline-text" id="s01-headline-text">${title}</div>
      <div data-hf-id="hf-s01-central-q" id="s01-central-q">${question}</div>
    </div>
    <script>
      (() => {
        const t = gsap.timeline({ paused: true });
        t.fromTo('#s01-headline-card', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1.0, ease: 'power2.out' }, 0.5);
        t.set({}, {}, 24.0);
        window.__timelines = window.__timelines || {};
        window.__timelines.s01 = t;
      })();
    </script>
  </div>
</template>`;
    await writeFile(join(epDir, "Sources", "compositions", "s01.html"), s01Html, "utf-8");

    return c.json({
      ok: true,
      episodeId,
      title,
      channel,
      epDir,
      sourcesDir: join(epDir, "Sources"),
    });
  });
}
