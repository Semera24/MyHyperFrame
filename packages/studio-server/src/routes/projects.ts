import { readFile, writeFile, mkdir } from "node:fs/promises";
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
}
