import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { StudioApiAdapter, RenderJobState } from "../types.js";
import { VALID_CANVAS_RESOLUTIONS, type CanvasResolution } from "@hyperframes/parsers";
import { formatRenderOutputTimestamp, parseFps, fpsToNumber } from "@hyperframes/core";
import {
  folderGone,
  isPrivateProjectFile,
  mkdirWithinProject,
  resolveWithinProject,
} from "../helpers/safePath.js";
import { projectDirMissing } from "../helpers/projectDirMissing.js";
import { isVariablesPayload, VARIABLES_PAYLOAD_ERROR } from "../helpers/variablesPayload.js";
import { parseEncoderOptions, type EncoderOptionsBody } from "../helpers/encoderOptions.js";
import { forgetJobsFinishedLongerThan } from "../helpers/finishedJobs.js";

const VALID_RESOLUTIONS = new Set<string>(VALID_CANVAS_RESOLUTIONS);
const RENDER_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".gif": "image/gif",
};
const RENDER_EXTENSIONS = Object.keys(RENDER_MIME);
const RENDER_ARTIFACT_EXTENSIONS = [...RENDER_EXTENSIONS, ".meta.json"];

function resolveRenderArtifacts(directories: readonly string[], jobId: string): string[] | null {
  const artifacts = [...new Set(directories)]
    .filter(existsSync)
    .flatMap((directory) =>
      RENDER_ARTIFACT_EXTENSIONS.map((extension) =>
        resolveWithinProject(directory, `${jobId}${extension}`),
      ),
    );
  return artifacts.every((path) => path !== null) ? artifacts : null;
}

function contentDispositionHeader(disposition: "inline" | "attachment", filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function registerRenderRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Scoped job store — not shared across createStudioApi() calls
  const renderJobs = new Map<string, RenderJobState>();
  const CANCEL_SETTLE_MS = 45_000;

  const nextFreeRenderJobId = (baseId: string, ext: string, rendersDir: string): string => {
    let jobId = baseId;
    for (let n = 2; renderJobs.has(jobId) || existsSync(join(rendersDir, `${jobId}${ext}`)); n++) {
      jobId = `${baseId}-${n}`;
    }
    return jobId;
  };

  // A finished job stays readable for 5 minutes after it finishes
  const TTL_MS = 300_000;
  const CLEANUP_INTERVAL_MS = 60_000;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  const cleanupEnabled = () =>
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    !process.argv.includes("build");

  const cleanupFinishedJobs = () => {
    forgetJobsFinishedLongerThan(TTL_MS, renderJobs, (job) => job.status !== "rendering");
    if (renderJobs.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  };

  const ensureCleanupTimer = () => {
    if (cleanupTimer || !cleanupEnabled()) return;
    cleanupTimer = setInterval(cleanupFinishedJobs, CLEANUP_INTERVAL_MS);
    if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
      cleanupTimer.unref();
    }
  };

  ensureCleanupTimer();

  // Start a render
  api.post("/projects/:id/render", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const body = (await c.req.json().catch(() => ({}))) as EncoderOptionsBody & {
      // Polymorphic per design note in core.types.Fps:
      //   number → integer fps (e.g. 30)
      //   string → rational fps (e.g. "30000/1001" for NTSC 29.97)
      // Decimals are rejected on purpose so the exact denominator stays
      // unambiguous (29.97 ≠ 30000/1001 when ffmpeg consumes them).
      fps?: number | string;
      quality?: string;
      format?: string;
      resolution?: string;
      composition?: string;
      // Browser telemetry id, so the server-emitted render outcome is
      // attributed to the user who triggered the render (joinable funnel).
      telemetryDistinctId?: string;
      // Explicit "this browser profile opted out" flag. Distinct from simply
      // omitting the id: an OLD client omits it too, and that case falls back
      // to the install anonymousId. Only an explicit `true` suppresses.
      telemetryOptOut?: boolean;
      // Composition-variable overrides ({variableId: value}), injected as
      // window.__hfVariables — same channel as `hyperframes render --variables`.
      variables?: Record<string, unknown>;
      gpu?: boolean;
      previewMotionBlur?: boolean;
      pageMotionBlur?: unknown;
    };
    const VALID_FORMATS = ["mp4", "webm", "mov", "gif"] as const;
    const FORMAT_EXT: Record<string, string> = {
      mp4: ".mp4",
      webm: ".webm",
      mov: ".mov",
      gif: ".gif",
    };
    const format = VALID_FORMATS.find((value) => value === body.format) ?? "mp4";

    // Default to 30 fps when unset or unparseable. The route stays lenient on
    // invalid fps values (matching the lenient handling of `resolution` and
    // `quality` already in this file) — the producer surfaces a clearer error
    // message if the caller really did mean to fail loudly.
    const fpsParse = body.fps === undefined ? null : parseFps(body.fps);
    const requestedFps = fpsParse && fpsParse.ok ? fpsParse.value : { num: 30, den: 1 };
    const fps =
      format === "gif" && fpsToNumber(requestedFps) > 30 ? { num: 30, den: 1 } : requestedFps;
    const quality = ["draft", "standard", "high"].includes(body.quality ?? "")
      ? (body.quality as string)
      : "standard";
    const outputResolution = VALID_RESOLUTIONS.has(body.resolution ?? "")
      ? (body.resolution as CanvasResolution)
      : undefined;
    let composition: string | undefined;
    if (typeof body.composition === "string" && body.composition.length > 0) {
      // `body.composition` is attacker-controlled (from c.req.json()).
      // resolveWithinProject dereferences symlinks, so an in-project symlink
      // pointing outside the root can't smuggle the render target out.
      if (!resolveWithinProject(project.dir, body.composition)) {
        if (folderGone(project.dir)) return projectDirMissing(c);
        return c.json({ error: "composition path must be within the project directory" }, 400);
      }
      composition = body.composition;
    }

    // Unlike fps/quality (lenient with safe fallbacks), a malformed variables
    // payload means the user's values would be silently dropped — fail loudly.
    let variables: Record<string, unknown> | undefined;
    if (body.variables !== undefined) {
      if (!isVariablesPayload(body.variables)) {
        return c.json({ error: VARIABLES_PAYLOAD_ERROR }, 400);
      }
      variables = body.variables;
    }

    const encoder = parseEncoderOptions(body, format);
    if (!encoder.ok) return c.json({ error: encoder.error }, 400);

    const requestedPageMotionBlur = body.pageMotionBlur;
    if (requestedPageMotionBlur !== undefined && requestedPageMotionBlur !== "off") {
      return c.json({ error: "pageMotionBlur must be off when supplied" }, 400);
    }
    const pageMotionBlur =
      requestedPageMotionBlur === undefined && body.previewMotionBlur === false
        ? "off"
        : requestedPageMotionBlur;

    const rendersDir = adapter.rendersDir(project);
    mkdirWithinProject(project.dir, rendersDir);
    const ext = FORMAT_EXT[format] ?? ".mp4";
    const jobId = nextFreeRenderJobId(
      `${project.id}_${formatRenderOutputTimestamp(new Date())}`,
      ext,
      rendersDir,
    );
    const outputPath = join(rendersDir, `${jobId}${ext}`);

    const jobState = adapter.startRender({
      project,
      outputPath,
      format,
      fps,
      quality,
      jobId,
      outputResolution,
      composition,
      variables,
      ...encoder.options,
      useGpu: body.gpu === true && format === "mp4",
      distinctId:
        typeof body.telemetryDistinctId === "string" ? body.telemetryDistinctId : undefined,
      telemetryOptOut: body.telemetryOptOut === true,
      ...(pageMotionBlur === undefined ? {} : { pageMotionBlur }),
    });
    renderJobs.set(jobId, jobState);

    ensureCleanupTimer();

    return c.json({ jobId, status: "rendering" });
  });

  // SSE progress stream
  api.get("/render/:jobId/progress", (c) => {
    const { jobId } = c.req.param();
    const job = renderJobs.get(jobId);
    if (!job) return c.json({ error: "not found" }, 404);

    return streamSSE(c, async (stream) => {
      while (true) {
        const current = renderJobs.get(jobId);
        if (!current) break;
        await stream.writeSSE({
          event: "progress",
          data: JSON.stringify({
            progress: current.progress,
            status: current.status,
            stage: current.stage,
            error: current.error,
            ...(current.status === "complete" && current.audioLoweredDb !== undefined
              ? { audioLoweredDb: current.audioLoweredDb }
              : {}),
          }),
        });
        if (current.status !== "rendering") break;
        await stream.sleep(500);
      }
    });
  });

  // Cancel an in-flight render. Marks the job cancelled immediately (so the
  // SSE stream terminates) and invokes the adapter's abort hook when present.
  api.post("/render/:jobId/cancel", async (c) => {
    const { jobId } = c.req.param();
    const job = renderJobs.get(jobId);
    if (!job) return c.json({ error: "not found" }, 404);
    if (job.status === "rendering") {
      job.status = "cancelled";
      let giveUp: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise((done) => (giveUp = setTimeout(done, CANCEL_SETTLE_MS)));
      try {
        await Promise.race([job.cancel?.(), late]);
      } finally {
        clearTimeout(giveUp);
      }
    }
    return c.json({ status: job.status });
  });

  const isPlainFile = (path: string): boolean => {
    try {
      return lstatSync(path).isFile();
    } catch {
      return false;
    }
  };

  function renderContentType(filePath: string): string {
    const ext = RENDER_EXTENSIONS.find((e) => filePath.endsWith(e));
    return (ext && RENDER_MIME[ext]) ?? "video/mp4";
  }

  function renderFileResponse(
    filePath: string,
    disposition: "inline" | "attachment",
    filename: string,
    method: string,
  ): Response {
    const headers = {
      "Content-Type": renderContentType(filePath),
      "Content-Disposition": contentDispositionHeader(disposition, filename),
      ...(disposition === "inline" ? { "Accept-Ranges": "bytes" } : {}),
      "Content-Length": String(statSync(filePath).size),
    };
    if (method === "HEAD") return new Response(null, { headers });
    // Node and DOM stream declarations differ; the response receives a web byte stream.
    const body = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;
    return new Response(body, { headers });
  }

  api.get("/render/:jobId/view", (c) => {
    const { jobId } = c.req.param();
    const job = renderJobs.get(jobId);
    if (!job?.outputPath || !isPlainFile(job.outputPath)) {
      return c.json({ error: "not found" }, 404);
    }
    const filename = job.outputPath.split("/").pop() ?? `render.mp4`;
    return renderFileResponse(job.outputPath, "inline", filename, c.req.method);
  });

  api.get("/render/:jobId/download", (c) => {
    const { jobId } = c.req.param();
    const job = renderJobs.get(jobId);
    if (!job?.outputPath || !isPlainFile(job.outputPath)) {
      return c.json({ error: "not found" }, 404);
    }
    const filename = job.outputPath.split("/").pop() ?? `render.mp4`;
    return renderFileResponse(job.outputPath, "attachment", filename, c.req.method);
  });

  async function renderDirectories(jobId: string): Promise<string[]> {
    const outputPath = renderJobs.get(jobId)?.outputPath;
    if (outputPath) return [dirname(outputPath)];

    const projects = await adapter.listProjects();
    return projects.map((project) => adapter.rendersDir(project));
  }

  // Delete render
  api.delete("/render/:jobId", async (c) => {
    const { jobId } = c.req.param();
    if (jobId.includes("/") || jobId.includes("\\") || jobId.includes("\0")) {
      return c.json({ error: "forbidden" }, 403);
    }
    const directories = await renderDirectories(jobId);
    const artifacts = resolveRenderArtifacts(directories, jobId);
    if (!artifacts) return c.json({ error: "forbidden" }, 403);

    for (const path of artifacts) {
      if (existsSync(path)) unlinkSync(path);
    }
    renderJobs.delete(jobId);
    return c.json({ deleted: true });
  });

  // Serve render file directly from disk (no in-memory map dependency)
  api.get("/projects/:id/renders/file/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const filename = c.req.path.split("/renders/file/")[1];
    if (!filename) return c.json({ error: "missing filename" }, 400);
    const rendersDir = adapter.rendersDir(project);
    // Containment guard: the filename is attacker-controlled wildcard input, so
    // route it through the same chokepoint every other project-scoped path uses.
    // Literal `..` is collapsed upstream by the URL parser, but a bare join() +
    // readFileSync still followed an in-rendersDir symlink pointing outside the
    // dir; resolveWithinProject canonicalizes with realpath before serving.
    const fp = resolveWithinProject(rendersDir, filename);
    if (!fp || isPrivateProjectFile(project.dir, fp)) return c.json({ error: "forbidden" }, 403);
    if (!existsSync(fp)) return c.json({ error: "not found" }, 404);
    return renderFileResponse(fp, "inline", filename, c.req.method);
  });

  // List renders
  api.get("/projects/:id/renders", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const rendersDir = adapter.rendersDir(project);
    let realProjectDir = project.dir;
    try {
      realProjectDir = realpathSync(project.dir);
    } catch {
      realProjectDir = project.dir;
    }
    const epRoot =
      basename(realProjectDir) === "Sources" ? dirname(realProjectDir) : realProjectDir;
    const draftPath = resolve(epRoot, "Renders", `${project.id}_Draft.mp4`);
    const episodeDraft = existsSync(draftPath)
      ? {
          exists: true,
          path: draftPath,
          relativePath: `Renders/${project.id}_Draft.mp4`,
          sizeBytes: statSync(draftPath).size,
          updatedAt: statSync(draftPath).mtimeMs,
        }
      : {
          exists: false,
          path: draftPath,
          relativePath: `Renders/${project.id}_Draft.mp4`,
        };

    if (!existsSync(rendersDir)) return c.json({ renders: [], episodeDraft });
    const files = readdirSync(rendersDir)
      .filter((f) => RENDER_EXTENSIONS.some((extension) => f.endsWith(extension)))
      .flatMap((f) => {
        const fp = resolveWithinProject(rendersDir, f);
        return fp && !isPrivateProjectFile(project.dir, fp) ? [{ f, fp }] : [];
      })
      .map(({ f, fp }) => {
        const stat = statSync(fp);
        const rid = f.replace(/\.(mp4|webm|mov|gif)$/, "");
        const metaPath = join(rendersDir, `${rid}.meta.json`);
        let status: "complete" | "failed" = "complete";
        let durationMs: number | undefined;
        let audioLoweredDb: number | undefined;
        let episodeDraftPath: string | undefined;
        if (existsSync(metaPath)) {
          try {
            const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
            // A stale failed sidecar can remain after a retry succeeds. An
            // existing output artifact is authoritative for the list view;
            // don't present a downloadable render as failed solely because
            // an earlier attempt left behind failed metadata.
            if (meta.status === "failed" && !existsSync(fp)) status = "failed";
            if (meta.durationMs) durationMs = meta.durationMs;
            if (typeof meta.audioLoweredDb === "number") audioLoweredDb = meta.audioLoweredDb;
            if (typeof meta.episodeDraftPath === "string") episodeDraftPath = meta.episodeDraftPath;
          } catch {
            /* ignore */
          }
        }
        return {
          id: rid,
          filename: f,
          path: fp,
          size: stat.size,
          createdAt: stat.mtimeMs,
          status,
          durationMs,
          ...(audioLoweredDb !== undefined ? { audioLoweredDb } : {}),
          ...(episodeDraftPath ? { episodeDraftPath } : {}),
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    // Register on-disk renders that aren't in the current session's job map
    // so they remain downloadable after a server restart.
    for (const file of files) {
      if (!renderJobs.has(file.id)) {
        renderJobs.set(file.id, {
          id: file.id,
          status: file.status,
          progress: 100,
          outputPath: file.path,
        });
      }
    }
    return c.json({ renders: files.map(({ path: _path, ...render }) => render), episodeDraft });
  });

  // 1-Click Export / Copy Rendered MP4 to Episode `Renders/<EP_ID>_Draft.mp4`
  api.post("/projects/:id/renders/export-to-episode", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const body = (await c.req.json().catch(() => ({}))) as {
      jobId?: string;
      filename?: string;
    };

    const rendersDir = adapter.rendersDir(project);
    let sourcePath: string | null = null;
    let sourceFilename = "";

    if (body.filename && existsSync(rendersDir)) {
      const candidate = resolveWithinProject(rendersDir, body.filename);
      if (candidate && existsSync(candidate)) {
        sourcePath = candidate;
        sourceFilename = body.filename;
      }
    } else if (body.jobId) {
      const job = renderJobs.get(body.jobId);
      if (job?.outputPath && existsSync(job.outputPath)) {
        sourcePath = job.outputPath;
        sourceFilename = basename(job.outputPath);
      } else if (existsSync(rendersDir)) {
        const candidate = resolveWithinProject(rendersDir, `${body.jobId}.mp4`);
        if (candidate && existsSync(candidate)) {
          sourcePath = candidate;
          sourceFilename = `${body.jobId}.mp4`;
        }
      }
    }

    // If no specific jobId/filename was passed, find the most recent .mp4 render for this project
    if (!sourcePath && existsSync(rendersDir)) {
      const mp4Files = readdirSync(rendersDir)
        .filter((f) => f.endsWith(".mp4"))
        .map((f) => {
          const fp = resolveWithinProject(rendersDir, f);
          return fp && existsSync(fp) ? { f, fp, mtime: statSync(fp).mtimeMs } : null;
        })
        .filter((item): item is { f: string; fp: string; mtime: number } => item !== null)
        .sort((a, b) => b.mtime - a.mtime);

      const projectMp4 = mp4Files.find((item) => item.f.startsWith(`${project.id}_`));
      const chosen = projectMp4 ?? mp4Files[0];
      if (chosen) {
        sourcePath = chosen.fp;
        sourceFilename = chosen.f;
      }
    }

    let realProjectDir = project.dir;
    try {
      realProjectDir = realpathSync(project.dir);
    } catch {
      realProjectDir = project.dir;
    }
    const epRoot =
      basename(realProjectDir) === "Sources" ? dirname(realProjectDir) : realProjectDir;

    // Fallback: if no Studio render exists yet, check Previews/*.mp4 in the episode folder
    if (!sourcePath) {
      const previewsDir = resolve(epRoot, "Previews");
      if (existsSync(previewsDir)) {
        const previewMp4s = readdirSync(previewsDir)
          .filter((f) => f.endsWith(".mp4"))
          .map((f) => {
            const fp = resolve(previewsDir, f);
            return { f, fp, mtime: statSync(fp).mtimeMs };
          })
          .sort((a, b) => b.mtime - a.mtime);
        if (previewMp4s[0]) {
          sourcePath = previewMp4s[0].fp;
          sourceFilename = `Previews/${previewMp4s[0].f}`;
        }
      }
    }

    if (!sourcePath || !existsSync(sourcePath)) {
      return c.json(
        {
          error: "No completed .mp4 render found yet. Click 'Export' to render this episode first.",
        },
        404,
      );
    }

    const epRendersDir = resolve(epRoot, "Renders");
    mkdirSync(epRendersDir, { recursive: true });
    const draftFilename = `${project.id}_Draft.mp4`;
    const draftPath = resolve(epRendersDir, draftFilename);
    copyFileSync(sourcePath, draftPath);
    const stat = statSync(draftPath);

    // Update .meta.json sidecar if the source came from rendersDir
    if (sourcePath.startsWith(rendersDir)) {
      const metaPath = sourcePath.replace(/\.(mp4|webm|mov|gif)$/, ".meta.json");
      try {
        const existingMeta = existsSync(metaPath)
          ? JSON.parse(readFileSync(metaPath, "utf-8"))
          : { status: "complete" };
        writeFileSync(
          metaPath,
          JSON.stringify({
            ...existingMeta,
            episodeDraftPath: draftPath,
            exportedToEpisodeAt: Date.now(),
          }),
        );
      } catch {
        /* ignore sidecar error */
      }
    }

    return c.json({
      ok: true,
      episodeId: project.id,
      sourceFilename,
      draftFilename,
      draftPath,
      relativeDraftPath: `Renders/${draftFilename}`,
      sizeBytes: stat.size,
      exportedAt: stat.mtimeMs,
    });
  });
}
