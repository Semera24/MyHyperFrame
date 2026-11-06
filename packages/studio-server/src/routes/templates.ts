import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";

export interface MasterTemplateMetadata {
  id: string;
  name: string;
  archetype: string;
  description: string;
  bestFor: string;
  templateFile: string;
  defaultParams: Record<string, string>;
}

function resolveTemplatesRoot(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(currentDir, "../../../../templates"),
    resolve(currentDir, "../../../templates"),
    resolve(process.cwd(), "templates"),
    resolve(process.cwd(), "../templates"),
    "/Users/yonassayfu/Projects/HyperFrames_Custom_Studio/hyperframes/templates",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]!;
}

export function registerTemplateRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // 1. GET /api/templates — List the 3 Master Archetypes
  api.get("/templates", (c) => {
    const root = resolveTemplatesRoot();
    const manifestPath = join(root, "templates.json");
    if (!existsSync(manifestPath)) {
      return c.json({ ok: false, error: "Templates manifest not found" }, 404);
    }

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        version: string;
        archetypes: MasterTemplateMetadata[];
      };
      return c.json({
        ok: true,
        version: manifest.version,
        templates: manifest.archetypes,
      });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // 2. POST /api/templates/instantiate — 1-Click instantiate template into active episode
  api.post("/templates/instantiate", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      projectId?: string;
      templateId?: string;
      sceneId?: string; // e.g. "s10" or "s05"
      params?: Record<string, string>;
    } | null;

    if (!body || !body.templateId || !body.sceneId) {
      return c.json({ ok: false, error: "templateId and sceneId are required" }, 400);
    }

    const root = resolveTemplatesRoot();
    const manifestPath = join(root, "templates.json");
    if (!existsSync(manifestPath)) {
      return c.json({ ok: false, error: "Templates manifest not found" }, 404);
    }

    let manifest: { archetypes: MasterTemplateMetadata[] };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        archetypes: MasterTemplateMetadata[];
      };
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }

    const tpl = manifest.archetypes.find((a) => a.id === body.templateId);
    if (!tpl) {
      return c.json({ ok: false, error: `Template '${body.templateId}' not found` }, 404);
    }

    const tplFilePath = join(root, tpl.templateFile);
    if (!existsSync(tplFilePath)) {
      return c.json({ ok: false, error: `Template file '${tpl.templateFile}' not found` }, 404);
    }

    const rawTemplate = readFileSync(tplFilePath, "utf-8");

    // Merge user params with template defaults
    const cleanSceneId = body.sceneId.toLowerCase().replace(/[^a-z0-9_]/g, "");
    const mergedParams: Record<string, string> = {
      SCENE_ID: cleanSceneId,
      ...tpl.defaultParams,
      ...(body.params || {}),
    };

    // Replace placeholders: {{KEY}}
    let rendered = rawTemplate;
    for (const [key, val] of Object.entries(mergedParams)) {
      const ph = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      rendered = rendered.replace(ph, val);
    }

    // Resolve target project directory
    let project = body.projectId ? await adapter.resolveProject(body.projectId) : null;
    if (!project) {
      const all = await adapter.listProjects();
      project = all[0] ?? null;
    }
    const projectDir = project?.dir || process.cwd();

    // Target scene file in compositions/
    const compositionsDir = existsSync(join(projectDir, "compositions"))
      ? join(projectDir, "compositions")
      : existsSync(join(projectDir, "Sources", "compositions"))
        ? join(projectDir, "Sources", "compositions")
        : join(projectDir, "compositions");

    const targetSceneFile = join(compositionsDir, `${cleanSceneId}.html`);
    try {
      writeFileSync(targetSceneFile, rendered, "utf-8");
      if (project) {
        adapter.invalidateProjectSignature?.(project.dir);
      }
      return c.json({
        ok: true,
        sceneId: cleanSceneId,
        scenePath: `compositions/${cleanSceneId}.html`,
        fullPath: targetSceneFile,
        templateUsed: tpl.name,
      });
    } catch (err) {
      return c.json({ ok: false, error: `Failed to write scene file: ${String(err)}` }, 500);
    }
  });
}
