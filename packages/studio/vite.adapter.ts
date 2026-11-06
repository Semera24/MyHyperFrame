import { isValidProjectId } from "./src/utils/projectRouting";
// Vite adapter that wires the shared Studio API to the local filesystem and build tools.

import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  existsSync,
  symlinkSync,
  writeFileSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import type { ViteDevServer } from "vite";
import {
  type ResolvedProject,
  type RenderJobState,
  type StudioApiAdapter,
  type BackgroundRemovalRender,
  createBackgroundRemovalJob,
  createProjectSignature,
  affectsProjectSignature,
  PREVIEW_BUNDLE_OPTIONS,
  DEFAULT_HISTORY_ROOT,
  openProjectHistory,
  historyCache,
} from "@hyperframes/studio-server";
import { encoderJobOptions } from "@hyperframes/studio-server/encoder-options";
import type { RegistryItem } from "@hyperframes/core/registry";
import type { BundleOptions } from "@hyperframes/core/compiler";
import { createRetryingModuleLoader, ensureProducerDist } from "./vite.producer";
import { createStudioDevRenderBodyScripts } from "./vite.studioMotion";
import { generateThumbnail, findSystemChrome } from "./vite.browser";

function isPathWithin(parentDir: string, childPath: string): boolean {
  const childRelativePath = relative(resolve(parentDir), resolve(childPath));
  return (
    childRelativePath === "" ||
    (childRelativePath !== ".." &&
      !childRelativePath.startsWith(`..${sep}`) &&
      !isAbsolute(childRelativePath))
  );
}

export function resolveViteAutoProxy(value: string | undefined): boolean {
  return value !== "false";
}

/**
 * The preview ETag's cache, and the one thing allowed to clear it.
 *
 * The signature walks the whole project directory, so it is memoised per project
 * directory. (The content hash underneath is already gated behind a stat-only
 * fingerprint, so what this memo saves is the walk, not the hashing — worth
 * knowing before deciding how aggressive invalidation is allowed to be.)
 * Getting the invalidation wrong is not a
 * performance bug: the preview answers a revalidation with 304 and the browser
 * keeps serving the pre-edit composition, which is how a thumbnail regenerated
 * after an edit can still show the old frame.
 *
 * `watch` is called the first time a project dir is seen, so whoever owns the
 * watcher can start following it. It must be a watcher that actually sees
 * project writes: Vite's own is configured to ignore them.
 */
export interface ProjectSignatureCache {
  get(projectDir: string): string;
  /** Drop the signature of whichever project contains `changedPath`. */
  invalidate(changedPath: string): void;
  forget(projectDir: string): void;
}

export function createProjectSignatureCache({
  compute = createProjectSignature,
  watch,
}: {
  compute?: (projectDir: string) => string;
  watch?: (projectDir: string) => void;
} = {}): ProjectSignatureCache {
  const signatures = new Map<string, string>();
  const watched = new Set<string>();
  return {
    get(projectDir) {
      const key = resolve(projectDir);
      const cached = signatures.get(key);
      if (cached !== undefined) return cached;
      if (!watched.has(key)) {
        watched.add(key);
        watch?.(key);
      }
      const signature = compute(key);
      signatures.set(key, signature);
      return signature;
    },
    invalidate(changedPath) {
      // Filtered here rather than at the watcher so no caller can wire up a
      // subscription that forgets to: the cache owns what can change its value.
      for (const projectDir of signatures.keys()) {
        if (affectsProjectSignature(projectDir, changedPath)) signatures.delete(projectDir);
      }
    },
    forget(projectDir) {
      signatures.delete(resolve(projectDir));
    },
  };
}

const isServableProjectId = (id: string) =>
  isValidProjectId(id) && !(process.platform === "win32" && id.includes(":"));

function syncProductionStudioEpisodes(dataDir: string): void {
  const prodRoot =
    process.env.PRODUCTION_STUDIO_ROOT || "/Users/yonassayfu/Projects/ProductionStudio";
  const channelsDir = join(prodRoot, "channels");
  if (!existsSync(channelsDir)) return;
  try {
    mkdirSync(dataDir, { recursive: true });
    for (const chEntry of readdirSync(channelsDir, { withFileTypes: true })) {
      if (!chEntry.isDirectory()) continue;
      const episodesDir = join(channelsDir, chEntry.name, "episodes");
      if (!existsSync(episodesDir)) continue;
      for (const epEntry of readdirSync(episodesDir, { withFileTypes: true })) {
        if (!epEntry.isDirectory() || !isServableProjectId(epEntry.name)) continue;
        const sourcesDir = join(episodesDir, epEntry.name, "Sources");
        if (!existsSync(join(sourcesDir, "index.html"))) continue;
        const linkPath = join(dataDir, epEntry.name);
        try {
          const stat = lstatSync(linkPath);
          if (stat.isSymbolicLink()) {
            const currentTarget = realpathSync(linkPath);
            const desiredTarget = realpathSync(sourcesDir);
            if (currentTarget !== desiredTarget) {
              unlinkSync(linkPath);
              symlinkSync(desiredTarget, linkPath, "dir");
            }
          }
        } catch {
          try {
            symlinkSync(realpathSync(sourcesDir), linkPath, "dir");
          } catch {
            /* ignore race condition */
          }
        }
      }
    }
  } catch {
    /* ignore discovery errors */
  }
}

export function createViteAdapter(
  dataDir: string,
  server: ViteDevServer,
  signatureCache: ProjectSignatureCache,
  {
    historyRoot = DEFAULT_HISTORY_ROOT,
    openHistory = openProjectHistory,
    onResolveProject,
  }: {
    historyRoot?: string;
    openHistory?: typeof openProjectHistory;
    onResolveProject?: (project: ResolvedProject) => void;
  } = {},
): StudioApiAdapter {
  const histories = historyCache((projectDir) =>
    openHistory({ projectDir, historyRoot }).catch((error: unknown) => {
      console.warn(`[studio] Project history is off for ${basename(projectDir)}: ${String(error)}`);
      // By name: the dev server's engine is its own module copy, so its error class is not this import's.
      if (error instanceof Error && error.name === "HistoryClosedError")
        histories.forget(projectDir);
      return null;
    }),
  );
  // Commits any open edit when the dev server stops, so it keeps its label.
  server.httpServer?.on("close", () => void histories.closeAll());
  let _bundler: ((dir: string, options?: BundleOptions) => Promise<string>) | null = null;
  let _producerModuleLoader:
    | (() => Promise<{
        createRenderJob: (config: {
          fps: 24 | 30 | 60;
          quality: "draft" | "standard" | "high";
          format: string;
          renderBodyScripts?: string[];
          outputResolution?: "landscape" | "portrait" | "landscape-4k" | "portrait-4k";
          variables?: Record<string, unknown>;
        }) => unknown;
        executeRenderJob: (
          job: unknown,
          projectDir: string,
          outputPath: string,
          onProgress?: (job: { progress: number; currentStage?: string }) => void,
        ) => Promise<void>;
      }>)
    | null = null;

  const getBundler = async () => {
    if (!_bundler) {
      try {
        const mod = await server.ssrLoadModule("@hyperframes/core/compiler");
        _bundler = (dir, options) => mod.bundleToSingleHtml(dir, options);
      } catch (err) {
        console.warn("[Studio] Failed to load compiler, previews will use raw HTML:", err);
        _bundler = null as never;
      }
    }
    return _bundler;
  };

  const getProducerModule = async () => {
    try {
      return (await server.ssrLoadModule(
        resolve(__dirname, "../producer/src/index.ts"),
      )) as Awaited<ReturnType<NonNullable<typeof _producerModuleLoader>>>;
    } catch {
      if (!_producerModuleLoader) {
        _producerModuleLoader = createRetryingModuleLoader(async () => {
          const { built } = ensureProducerDist({
            studioDir: __dirname,
            env: process.env,
          });
          if (built) {
            console.warn(
              "[Studio] @hyperframes/producer dist missing; building producer package for local renders...",
            );
          }
          const producerPkg = "@hyperframes/producer";
          return await import(/* @vite-ignore */ producerPkg);
        });
      }
      return _producerModuleLoader();
    }
  };

  return {
    // The CLI resolves --proxy/--no-proxy against hyperframes.json before it
    // launches Vite. Direct `bun run dev` keeps the historical default-on
    // behavior when the child environment is absent.
    autoProxy: resolveViteAutoProxy(process.env.HYPERFRAMES_AUTO_PROXY),

    // fallow-ignore-next-line complexity
    listProjects() {
      syncProductionStudioEpisodes(dataDir);
      if (!existsSync(dataDir)) return [];
      const sessionsDir = resolve(dataDir, "../sessions");
      const sessionMap = new Map<string, { sessionId: string; title: string }>();
      if (existsSync(sessionsDir)) {
        for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith(".json"))) {
          try {
            const raw = JSON.parse(readFileSync(join(sessionsDir, file), "utf-8"));
            if (raw.projectId) {
              sessionMap.set(raw.projectId, {
                sessionId: file.replace(".json", ""),
                title: raw.title || "Untitled",
              });
            }
          } catch {
            /* skip corrupt */
          }
        }
      }
      return readdirSync(dataDir, { withFileTypes: true })
        .filter(
          (d) =>
            isServableProjectId(d.name) &&
            (d.isDirectory() || d.isSymbolicLink()) &&
            (existsSync(join(dataDir, d.name, "index.html")) ||
              existsSync(join(dataDir, d.name, `${d.name}.html`))),
        )
        .map((d) => {
          const session = sessionMap.get(d.name);
          return {
            id: d.name,
            dir: join(dataDir, d.name),
            title: session?.title ?? d.name,
            sessionId: session?.sessionId,
          } satisfies ResolvedProject;
        })
        .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    },

    // Studio's undo runs on the project's history: opened once per project; a failed open stays off unless the folder
    // changed while it opened.
    history(project: ResolvedProject) {
      return histories.get(project.dir);
    },

    // fallow-ignore-next-line complexity
    resolveProject(id: string) {
      if (!isServableProjectId(id)) return null;
      syncProductionStudioEpisodes(dataDir);
      let projectDir = resolve(dataDir, id);
      if (!isPathWithin(dataDir, projectDir)) return null;
      if (!existsSync(projectDir)) {
        const sessionsDir = resolve(dataDir, "../sessions");
        const sessionFile = resolve(sessionsDir, `${id}.json`);
        if (!isPathWithin(sessionsDir, sessionFile)) return null;
        if (existsSync(sessionFile)) {
          try {
            const session = JSON.parse(readFileSync(sessionFile, "utf-8"));
            if (typeof session.projectId === "string" && isServableProjectId(session.projectId)) {
              projectDir = resolve(dataDir, session.projectId);
              if (!isPathWithin(dataDir, projectDir)) return null;
              if (existsSync(projectDir)) {
                const project = {
                  id: session.projectId,
                  dir: realpathSync(projectDir),
                  title: session.title,
                };
                onResolveProject?.(project);
                return project;
              }
            }
          } catch {
            /* ignore */
          }
        }
        return null;
      }
      const project = { id, dir: realpathSync(projectDir) };
      onResolveProject?.(project);
      return project;
    },

    async bundle(dir, options) {
      const bundler = await getBundler();
      if (!bundler) return null;
      let html = await bundler(dir, { ...PREVIEW_BUNDLE_OPTIONS, ...options });
      html = html.replace(
        'data-hyperframes-preview-runtime="1" src=""',
        `data-hyperframes-preview-runtime="1" src="${this.runtimeUrl}"`,
      );
      return html;
    },

    async transformPreviewHtml({ html }) {
      const fonts = await import("../core/src/fonts/deterministicFonts.js");
      return fonts.injectDeterministicFontFaces(html);
    },

    getProjectSignature(projectDir: string): string {
      return signatureCache.get(projectDir);
    },

    invalidateProjectSignature(projectDir: string): void {
      signatureCache.forget(projectDir);
    },

    async lint(html: string, opts?: { filePath?: string; isSubComposition?: boolean }) {
      const mod = await server.ssrLoadModule("@hyperframes/core/lint");
      return await mod.lintHyperframeHtml(html, { ...opts, host: "studio" });
    },

    async lintProject(projectDir: string) {
      const mod = await server.ssrLoadModule("@hyperframes/core/lint");
      return await mod.lintProject(projectDir, undefined, { host: "studio" });
    },

    runtimeUrl: "/api/runtime.js",

    rendersDir: () => resolve(dataDir, "../renders"),

    startRender(opts): RenderJobState {
      const abortController = new AbortController();
      const state: RenderJobState = {
        id: opts.jobId,
        status: "rendering",
        progress: 0,
        outputPath: opts.outputPath,
        cancel: () => abortController.abort(),
      };

      const startTime = Date.now();
      const removeCancelledOutput = () => {
        // User-initiated cancel: not a failure. Remove any output so the
        // cancelled job doesn't resurrect in the render history.
        state.status = "cancelled";
        for (const fp of [
          opts.outputPath,
          opts.outputPath.replace(/\.(mp4|webm|mov|gif)$/, ".meta.json"),
        ]) {
          try {
            if (existsSync(fp)) unlinkSync(fp);
          } catch {
            /* ignore */
          }
        }
      };
      // fallow-ignore-next-line complexity
      (async () => {
        try {
          if (!process.env.PRODUCER_HEADLESS_SHELL_PATH) {
            const systemChrome = findSystemChrome();
            if (systemChrome) process.env.PRODUCER_HEADLESS_SHELL_PATH = systemChrome;
          }
          const { createRenderJob, executeRenderJob } = await getProducerModule();
          const renderBodyScripts = createStudioDevRenderBodyScripts(opts.project.dir, {
            activeCompositionPath: opts.composition ?? null,
          });
          const job = createRenderJob({
            fps: opts.fps,
            quality: opts.quality as "draft" | "standard" | "high",
            format: opts.format,
            ...(opts.gifLoop !== undefined ? { gifLoop: opts.gifLoop } : {}),
            ...(renderBodyScripts.length > 0 ? { renderBodyScripts } : {}),
            outputResolution: opts.outputResolution,
            ...(opts.composition ? { entryFile: opts.composition } : {}),
            ...(opts.variables ? { variables: opts.variables } : {}),
            ...encoderJobOptions(opts),
            ...(opts.useGpu ? { useGpu: true } : {}),
            ...(opts.pageMotionBlur ? { pageMotionBlur: opts.pageMotionBlur } : {}),
          });
          const onProgress = (j: { progress: number; currentStage?: string }) => {
            state.progress = j.progress;
            if (j.currentStage) state.stage = j.currentStage;
          };
          await executeRenderJob(
            job,
            opts.project.dir,
            opts.outputPath,
            onProgress,
            abortController.signal,
          );
          if (abortController.signal.aborted) {
            // Cancel landed just as the render finished: honor the cancel the
            // route already reported instead of resurrecting a completed job.
            removeCancelledOutput();
            return;
          }
          if (job.audioLoweredDb !== undefined) state.audioLoweredDb = job.audioLoweredDb;
          state.status = "complete";
          state.progress = 100;
          let episodeDraftPath: string | undefined;
          if (opts.format === "mp4" && existsSync(opts.outputPath)) {
            try {
              const realProjectDir = realpathSync(opts.project.dir);
              if (basename(realProjectDir) === "Sources") {
                const epRoot = dirname(realProjectDir);
                const epRendersDir = join(epRoot, "Renders");
                mkdirSync(epRendersDir, { recursive: true });
                const targetDraft = join(epRendersDir, `${opts.project.id}_Draft.mp4`);
                copyFileSync(opts.outputPath, targetDraft);
                const epPreviewsDir = join(epRoot, "Previews");
                mkdirSync(epPreviewsDir, { recursive: true });
                const previewFile = join(epPreviewsDir, `${opts.project.id}_Preview_v1.mp4`);
                copyFileSync(opts.outputPath, previewFile);
                episodeDraftPath = previewFile;
              }
            } catch (copyErr) {
              console.warn("[Studio] Auto-copy to Episode Renders/ failed:", copyErr);
            }
          }
          const metaPath = opts.outputPath.replace(/\.(mp4|webm|mov|gif)$/, ".meta.json");
          writeFileSync(
            metaPath,
            JSON.stringify({
              status: "complete",
              durationMs: Date.now() - startTime,
              ...(job.audioLoweredDb !== undefined ? { audioLoweredDb: job.audioLoweredDb } : {}),
              ...(episodeDraftPath ? { episodeDraftPath } : {}),
            }),
          );
        } catch (err) {
          if (abortController.signal.aborted) {
            removeCancelledOutput();
            return;
          }
          state.status = "failed";
          state.error = err instanceof Error ? err.message : String(err);
          console.error("[Studio] Render job failed:", err);
          try {
            const metaPath = opts.outputPath.replace(/\.(mp4|webm|mov|gif)$/, ".meta.json");
            writeFileSync(metaPath, JSON.stringify({ status: "failed", error: state.error }));
          } catch {
            /* ignore */
          }
        }
      })();

      return state;
    },

    startBackgroundRemoval(opts) {
      return createBackgroundRemovalJob(opts, async (renderOpts) => {
        const mod = await server.ssrLoadModule(
          resolve(__dirname, "../cli/src/background-removal/pipeline.ts"),
        );
        const render = mod.render as BackgroundRemovalRender;
        return render(renderOpts);
      });
    },

    async generateThumbnail(opts) {
      return generateThumbnail(opts);
    },

    async resolveSession(sessionId: string) {
      const sessionsDir = resolve(dataDir, "../sessions");
      const sessionFile = join(sessionsDir, `${sessionId}.json`);
      if (!existsSync(sessionFile)) return null;
      try {
        const raw = JSON.parse(readFileSync(sessionFile, "utf-8"));
        if (raw.projectId) return { projectId: raw.projectId, title: raw.title };
      } catch {
        /* ignore */
      }
      return null;
    },

    // fallow-ignore-next-line complexity
    async listRegistryCatalog(): Promise<RegistryItem[]> {
      const registryRoot = resolve(__dirname, "../../registry");
      const items: RegistryItem[] = [];
      for (const subdir of ["blocks", "components"]) {
        const dir = join(registryRoot, subdir);
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const manifestPath = join(dir, entry.name, "registry-item.json");
          if (!existsSync(manifestPath)) continue;
          try {
            const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as RegistryItem;
            if (manifest.type === "hyperframes:block" || manifest.type === "hyperframes:component")
              items.push(manifest);
          } catch {
            /* skip malformed manifests */
          }
        }
      }
      return items;
    },
  };
}
