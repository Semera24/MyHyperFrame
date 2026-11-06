import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { StudioApiAdapter } from "../types.js";
import { executeFastPatch, isFastPatchEligible } from "../helpers/fastPatcher.js";
import { loadEpisodeBrainContext, formatEpisodeBrainPrompt } from "../helpers/episodeBrain.js";

export type AgentEngineId = "claude" | "codex" | "agy" | "grok" | "opencode";

export interface SkillEntry {
  id: string;
  name: string;
  title: string;
  description: string;
  category:
    | "Studio"
    | "Documentary/Moments"
    | "Planning"
    | "Viral Clone"
    | "Podcast"
    | "Talking Head";
  relativePath: string;
  fullPath: string;
  references: string[];
}

export interface AgentCliInfo {
  id: AgentEngineId;
  label: string;
  binary: string;
  binaryPath: string | null;
  installed: boolean;
  version: string | null;
  defaultModel: string;
  efforts: string[];
  defaultEffort: string;
}

export interface AgentModelOption {
  id: string;
  name: string;
  note?: string;
  isDefault?: boolean;
  effortOptions: string[];
  defaultEffort: string;
}

interface ActiveAgentRun {
  runId: string;
  engine: AgentEngineId;
  model: string;
  proc: ChildProcess;
  startedAt: number;
  projectDir: string;
  cancelled: boolean;
}

const activeRuns = new Map<string, ActiveAgentRun>();

function resolveSkillsRoot(): string {
  if (process.env.HYPERFRAMES_SKILLS_DIR && existsSync(process.env.HYPERFRAMES_SKILLS_DIR)) {
    return resolve(process.env.HYPERFRAMES_SKILLS_DIR);
  }
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(currentDir, "../../../../skills"),
    resolve(currentDir, "../../../skills"),
    resolve(process.cwd(), "skills"),
    resolve(process.cwd(), "../../skills"),
    "/Users/yonassayfu/Projects/HyperFrames_Custom_Studio/hyperframes/skills",
    "/Users/yonassayfu/Projects/HyperFrames_Custom_Studio/desktop-app-extracted/skills",
  ];
  for (const cand of candidates) {
    if (existsSync(cand)) return cand;
  }
  return candidates[0]!;
}

function parseSkillMetadata(
  markdown: string,
  fallbackName: string,
): {
  name: string;
  title: string;
  description: string;
} {
  let name = fallbackName;
  let description = "";
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (fmMatch && fmMatch[1]) {
    const fm = fmMatch[1];
    const nameMatch = /^name:[ \t]*["']?([^"'\r\n]+?)["']?[ \t]*$/m.exec(fm);
    if (nameMatch?.[1]) name = nameMatch[1].trim();
    const descMatch = /^description:[ \t]*(.*)$((?:\r?\n[ \t]+.*)*)/m.exec(fm);
    if (descMatch) {
      const firstLine = (descMatch[1] ?? "").trim();
      const restLines = (descMatch[2] ?? "").trim();
      const rawDesc = /^[>|][-+]?$/.test(firstLine) ? restLines : `${firstLine} ${restLines}`;
      description = rawDesc
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  }
  const body = fmMatch ? markdown.slice(fmMatch[0].length).trim() : markdown.trim();
  const h1Match = /^#\s+(.+)$/m.exec(body);
  const title = h1Match?.[1]?.trim() || name;
  if (!description) {
    const firstPara = body
      .split(/\r?\n\r?\n/)
      .map((p) => p.replace(/^#+\s+.*$/gm, "").trim())
      .find((p) => p.length > 10);
    description = firstPara ? firstPara.replace(/\s+/g, " ").slice(0, 220) : title;
  }
  return { name, title, description };
}

function categorizeSkillPath(relPath: string): SkillEntry["category"] {
  if (relPath.startsWith("studio/")) return "Studio";
  if (relPath.startsWith("moments/") || relPath.startsWith("moment-film")) {
    return "Documentary/Moments";
  }
  if (relPath.startsWith("planning/")) return "Planning";
  if (relPath.startsWith("viral-clone")) return "Viral Clone";
  if (relPath.startsWith("podcast/")) return "Podcast";
  if (relPath.startsWith("talking-head/")) return "Talking Head";
  return "Studio";
}

function discoverAllSkills(): {
  skillsDir: string;
  skills: SkillEntry[];
  categories: Record<SkillEntry["category"], SkillEntry[]>;
} {
  const skillsDir = resolveSkillsRoot();
  const skills: SkillEntry[] = [];
  const categories: Record<SkillEntry["category"], SkillEntry[]> = {
    Studio: [],
    "Documentary/Moments": [],
    Planning: [],
    "Viral Clone": [],
    Podcast: [],
    "Talking Head": [],
  };

  if (!existsSync(skillsDir)) {
    return { skillsDir, skills, categories };
  }

  const walkForSkillMd = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const hasSkillMd = entries.some((e) => e.isFile() && e.name === "SKILL.md");
    if (hasSkillMd) {
      const skillMdPath = join(dir, "SKILL.md");
      const relDir = relative(skillsDir, dir).replace(/\\/g, "/");
      const folderSlug = relDir.split("/").pop() || relDir;
      try {
        const raw = readFileSync(skillMdPath, "utf-8");
        const meta = parseSkillMetadata(raw, folderSlug);
        const refsDir = join(dir, "references");
        const references: string[] = [];
        if (existsSync(refsDir)) {
          try {
            for (const refFile of readdirSync(refsDir)) {
              if (refFile.endsWith(".md")) {
                references.push(relative(skillsDir, join(refsDir, refFile)).replace(/\\/g, "/"));
              }
            }
          } catch {
            /* ignore */
          }
        }
        const category = categorizeSkillPath(relDir);
        const baseId = meta.name || folderSlug;
        const uniqueId = skills.some((s) => s.id === baseId) ? folderSlug : baseId;
        const entry: SkillEntry = {
          id: uniqueId,
          name: uniqueId,
          title: meta.title,
          description: meta.description,
          category,
          relativePath: relative(skillsDir, skillMdPath).replace(/\\/g, "/"),
          fullPath: skillMdPath,
          references,
        };
        skills.push(entry);
        categories[category].push(entry);
      } catch {
        /* ignore unreadable skill */
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        walkForSkillMd(join(dir, entry.name));
      }
    }
  };

  walkForSkillMd(skillsDir);

  // Also expose motion-graphics reference guide as a first-class selectable skill if present
  const motionGraphicsRef = join(skillsDir, "viral-clone-harness/references/motion-graphics.md");
  if (existsSync(motionGraphicsRef) && !skills.some((s) => s.id === "motion-graphics")) {
    try {
      const raw = readFileSync(motionGraphicsRef, "utf-8");
      const meta = parseSkillMetadata(raw, "motion-graphics");
      const entry: SkillEntry = {
        id: "motion-graphics",
        name: "motion-graphics",
        title: "Motion Graphics & Kinetic Typography",
        description:
          meta.description ||
          "GSAP choreography, kinetic typography, documentary map callouts, and frame-accurate motion design.",
        category: "Studio",
        relativePath: "viral-clone-harness/references/motion-graphics.md",
        fullPath: motionGraphicsRef,
        references: [],
      };
      skills.push(entry);
      categories.Studio.push(entry);
    } catch {
      /* ignore */
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  for (const key of Object.keys(categories) as Array<SkillEntry["category"]>) {
    categories[key].sort((a, b) => a.name.localeCompare(b.name));
  }

  return { skillsDir, skills, categories };
}

function getExtraSearchPaths(): string[] {
  const home = homedir();
  const envPaths = (process.env.PATH || "").split(":").filter(Boolean);
  const extra = [
    join(home, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".bun/bin"),
    join(home, ".npm-global/bin"),
    join(home, ".nvm/versions/node"),
    "/Applications/Antigravity.app/Contents/Resources/app/bin",
  ];
  return [...new Set([...envPaths, ...extra])];
}

function findCliBinary(binaryName: string): string | null {
  for (const dir of getExtraSearchPaths()) {
    const candidate = join(dir, binaryName);
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      /* ignore */
    }
  }
  try {
    const out = execFileSync("/usr/bin/which", [binaryName], {
      encoding: "utf-8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out && existsSync(out)) return out;
  } catch {
    /* not found */
  }
  return null;
}

function probeBinaryVersion(binaryPath: string | null): string | null {
  if (!binaryPath) return null;
  try {
    const out = execFileSync(binaryPath, ["--version"], {
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const firstLine = out.split(/\r?\n/)[0]?.trim();
    return firstLine ? firstLine.slice(0, 80) : "installed";
  } catch {
    return "installed";
  }
}

const ENGINE_CATALOG: Record<
  AgentEngineId,
  {
    label: string;
    binary: string;
    defaultModel: string;
    efforts: string[];
    defaultEffort: string;
    models: AgentModelOption[];
  }
> = {
  claude: {
    label: "Claude Code",
    binary: "claude",
    defaultModel: "claude-opus-5-5",
    efforts: ["low", "medium", "high", "max"],
    defaultEffort: "high",
    models: [
      {
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        note: "Best",
        isDefault: true,
        effortOptions: ["low", "medium", "high", "max"],
        defaultEffort: "high",
      },
      {
        id: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        note: "Balanced",
        effortOptions: ["low", "medium", "high", "max"],
        defaultEffort: "high",
      },
      {
        id: "claude-3-7-sonnet",
        name: "Claude 3.7 Sonnet",
        effortOptions: ["low", "medium", "high", "max"],
        defaultEffort: "medium",
      },
      {
        id: "claude-fable-5-1",
        name: "Claude Fable 5.1",
        effortOptions: ["low", "medium", "high", "max"],
        defaultEffort: "high",
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        note: "Fast",
        effortOptions: ["low", "medium", "high"],
        defaultEffort: "medium",
      },
    ],
  },
  codex: {
    label: "Codex",
    binary: "codex",
    defaultModel: "gpt-5.6-luna",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
    models: [
      {
        id: "gpt-5.6-luna",
        name: "GPT-5.6-Luna",
        note: "Default",
        isDefault: true,
        effortOptions: ["low", "medium", "high", "xhigh", "max"],
        defaultEffort: "medium",
      },
      {
        id: "gpt-6-astra",
        name: "GPT-6 Astra",
        note: "Best",
        effortOptions: ["low", "medium", "high", "xhigh", "max"],
        defaultEffort: "medium",
      },
      {
        id: "gpt-6.1-sol",
        name: "GPT-6.1 Sol",
        effortOptions: ["low", "medium", "high", "xhigh", "max"],
        defaultEffort: "medium",
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        note: "Fast",
        effortOptions: ["low", "medium", "high"],
        defaultEffort: "medium",
      },
    ],
  },
  agy: {
    label: "Antigravity (AGY)",
    binary: "agy",
    defaultModel: "gemini-4-argon-medium",
    efforts: ["low", "medium", "high", "max"],
    defaultEffort: "medium",
    models: [
      {
        id: "gemini-4-argon-medium",
        name: "Gemini 4 Argon (Medium)",
        note: "Default",
        isDefault: true,
        effortOptions: ["low", "medium", "high"],
        defaultEffort: "medium",
      },
      {
        id: "gemini-3.8-flash-high",
        name: "Gemini 3.8 Flash (High)",
        note: "Fast",
        effortOptions: ["low", "medium", "high"],
        defaultEffort: "high",
      },
      {
        id: "claude-sonnet-5-5-high",
        name: "Claude Sonnet 5.5 (AGY)",
        note: "Balanced",
        effortOptions: ["low", "medium", "high"],
        defaultEffort: "high",
      },
      {
        id: "claude-opus-5-5-high",
        name: "Claude Opus 5.5 (AGY)",
        note: "Best",
        effortOptions: ["low", "medium", "high"],
        defaultEffort: "high",
      },
      {
        id: "gpt-oss-120b-medium",
        name: "GPT-OSS 120B",
        effortOptions: ["low", "medium", "high"],
        defaultEffort: "medium",
      },
    ],
  },
  grok: {
    label: "Grok CLI",
    binary: "grok",
    defaultModel: "grok-4",
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    models: [
      {
        id: "grok-4",
        name: "Grok 4",
        note: "Default",
        isDefault: true,
        effortOptions: ["low", "medium", "high"],
        defaultEffort: "medium",
      },
      {
        id: "grok-3-mini",
        name: "Grok 3 Mini",
        note: "Fast",
        effortOptions: ["low", "medium", "high"],
        defaultEffort: "low",
      },
    ],
  },
  opencode: {
    label: "OpenCode",
    binary: "opencode",
    defaultModel: "anthropic/claude-sonnet-4-5",
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    models: [
      {
        id: "anthropic/claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        isDefault: true,
        effortOptions: ["low", "medium", "high"],
        defaultEffort: "medium",
      },
      {
        id: "openai/gpt-5",
        name: "OpenAI GPT-5",
        effortOptions: ["low", "medium", "high"],
        defaultEffort: "medium",
      },
    ],
  },
};

function discoverCodexCachedModels(): AgentModelOption[] {
  const cacheFile = join(homedir(), ".codex", "models_cache.json");
  if (!existsSync(cacheFile)) return [];
  try {
    const parsed = JSON.parse(readFileSync(cacheFile, "utf-8")) as {
      models?: Array<{
        slug?: string;
        display_name?: string;
        visibility?: string;
        default_reasoning_level?: string;
        supported_reasoning_levels?: Array<{ effort?: string }>;
      }>;
    };
    if (!Array.isArray(parsed.models)) return [];
    return parsed.models
      .filter((m) => m && typeof m.slug === "string" && m.visibility === "list")
      .map((m) => {
        const efforts = (m.supported_reasoning_levels ?? [])
          .map((lvl) => lvl.effort)
          .filter((e): e is string => typeof e === "string");
        return {
          id: m.slug!,
          name: m.display_name || m.slug!,
          effortOptions: efforts.length > 0 ? efforts : ["low", "medium", "high"],
          defaultEffort: m.default_reasoning_level || "medium",
        };
      });
  } catch {
    return [];
  }
}

function getModelsForEngine(engine: AgentEngineId): AgentModelOption[] {
  const base = ENGINE_CATALOG[engine]?.models ?? [];
  if (engine === "codex") {
    const cached = discoverCodexCachedModels();
    const seen = new Set(base.map((m) => m.id));
    for (const cm of cached) {
      if (!seen.has(cm.id)) {
        base.push(cm);
        seen.add(cm.id);
      }
    }
  }
  return base;
}

function buildCompiledPrompt(opts: {
  projectDir: string;
  projectId: string;
  sceneFile?: string;
  elementId?: string;
  timestampSeconds?: number;
  prompt: string;
  skillIds: string[];
  attachments?: string[];
}): { compiledPrompt: string; loadedSkills: string[] } {
  const { skills } = discoverAllSkills();
  const loadedSkills: string[] = [];
  const skillBlocks: string[] = [];

  for (const requestedId of opts.skillIds) {
    const found = skills.find(
      (s) => s.id === requestedId || s.name === requestedId || s.relativePath === requestedId,
    );
    if (found && existsSync(found.fullPath)) {
      try {
        const content = readFileSync(found.fullPath, "utf-8");
        loadedSkills.push(found.id);
        skillBlocks.push(
          `<skill name="${found.id}" category="${found.category}" path="${found.relativePath}">\n${content.trim()}\n</skill>`,
        );
      } catch {
        /* ignore */
      }
    }
  }

  const lines: string[] = [
    `# HyperFrames Studio Agent Task (${opts.projectId})`,
    `- **Authoritative Sources Directory**: \`${opts.projectDir}\``,
    `- **Target Scene File**: \`${opts.sceneFile || "index.html"}\``,
  ];
  if (opts.elementId) {
    lines.push(`- **Target Element**: \`#${opts.elementId}\``);
  }
  if (typeof opts.timestampSeconds === "number" && Number.isFinite(opts.timestampSeconds)) {
    const frame = Math.round(opts.timestampSeconds * 30);
    lines.push(
      `- **Playhead Timestamp**: \`${opts.timestampSeconds.toFixed(2)}s\` (Frame \`${frame}\` @ 30fps)`,
    );
  }
  if (opts.attachments && opts.attachments.length > 0) {
    lines.push(`- **Attached Files**: ${opts.attachments.map((a) => `\`${a}\``).join(", ")}`);
  }

  // Inject Episode Brain Context (Audio Cues, Script, Assets) if available
  const brain = loadEpisodeBrainContext(opts.projectDir, opts.sceneFile);
  if (brain) {
    lines.push("", formatEpisodeBrainPrompt(brain));
  }

  lines.push(
    "",
    "## Documentary & HyperFrames Editing Rules",
    "- Edit the HTML/CSS/GSAP files directly in-place inside the Authoritative Sources Directory.",
    "- Preserve deterministic `data-hf-id`, `data-start`, and `data-duration` attributes on all elements.",
    "- Keep scene compositions (`compositions/sXX.html`) and `index.html` durations frame-aligned at 30fps.",
    "",
    "## User Request",
    opts.prompt.trim(),
  );

  if (skillBlocks.length > 0) {
    lines.push("", "## Active HyperFrames Skills Library", ...skillBlocks);
  }

  return {
    compiledPrompt: lines.join("\n"),
    loadedSkills,
  };
}

function buildCliCommandArgs(
  engine: AgentEngineId,
  opts: {
    model?: string;
    effort?: string;
    cwd: string;
    compiledPrompt: string;
  },
): { args: string[]; stdinPrompt?: string } {
  const model = opts.model || ENGINE_CATALOG[engine].defaultModel;
  const effort = opts.effort || ENGINE_CATALOG[engine].defaultEffort;

  switch (engine) {
    case "claude": {
      const args = [
        "-p",
        opts.compiledPrompt,
        "--dangerously-skip-permissions",
        "--add-dir",
        opts.cwd,
      ];
      if (model) args.push("--model", model);
      if (effort) args.push("--effort", effort);
      return { args };
    }
    case "codex": {
      const args = [
        "exec",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "-C",
        opts.cwd,
      ];
      if (model) args.push("-m", model);
      if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
      args.push(opts.compiledPrompt);
      return { args };
    }
    case "agy": {
      const args = ["--dangerously-skip-permissions"];
      const validAgyModels = new Set([
        "gemini-4-argon-medium",
        "gemini-4-argon-high",
        "gemini-4-argon-low",
        "gemini-3.8-flash-high",
        "gemini-3.8-flash-medium",
        "gemini-3.8-flash-low",
        "claude-opus-5-5-low",
        "claude-opus-5-5-medium",
        "claude-opus-5-5-high",
        "claude-sonnet-5-5-low",
        "claude-sonnet-5-5-medium",
        "claude-sonnet-5-5-high",
        "gpt-oss-120b-medium",
      ]);
      if (model && validAgyModels.has(model)) {
        args.push("--model", model);
      } else {
        // Fallback to valid default model so stale client state never causes exit code 2
        args.push("--model", "gemini-4-argon-medium");
      }
      args.push("--print", opts.compiledPrompt);
      return { args };
    }
    case "grok": {
      const args = ["--cwd", opts.cwd, "--permission-mode", "auto"];
      if (model) args.push("-m", model);
      if (effort) args.push("--reasoning-effort", effort);
      args.push(opts.compiledPrompt);
      return { args };
    }
    case "opencode": {
      const args = ["run", "--dir", opts.cwd];
      if (model) args.push("-m", model);
      args.push(opts.compiledPrompt);
      return { args };
    }
  }
}

export function registerAgentRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // 1. GET /api/agent/skills — List all 22+ skills organized by category
  api.get("/agent/skills", (c) => {
    const { skillsDir, skills, categories } = discoverAllSkills();
    return c.json({
      ok: true,
      skillsDir,
      total: skills.length,
      categories,
      skills,
    });
  });

  // Read individual skill instructions
  api.get("/agent/skills/:skillId", (c) => {
    const skillId = c.req.param("skillId");
    const { skills } = discoverAllSkills();
    const found = skills.find((s) => s.id === skillId || s.name === skillId);
    if (!found || !existsSync(found.fullPath)) {
      return c.json({ error: `Skill '${skillId}' not found` }, 404);
    }
    const content = readFileSync(found.fullPath, "utf-8");
    return c.json({
      ok: true,
      skill: found,
      content,
    });
  });

  // 2. GET /api/agents — Probe locally installed agent CLIs
  api.get("/agents", (c) => {
    const engines: AgentEngineId[] = ["claude", "codex", "agy", "grok", "opencode"];
    const agents: AgentCliInfo[] = engines.map((id) => {
      const spec = ENGINE_CATALOG[id];
      const binaryPath = findCliBinary(spec.binary);
      const installed = binaryPath !== null;
      const version = installed ? probeBinaryVersion(binaryPath) : null;
      return {
        id,
        label: spec.label,
        binary: spec.binary,
        binaryPath,
        installed,
        version,
        defaultModel: spec.defaultModel,
        efforts: spec.efforts,
        defaultEffort: spec.defaultEffort,
      };
    });
    return c.json({
      ok: true,
      agents,
      activeRuns: [...activeRuns.values()].map((r) => ({
        runId: r.runId,
        engine: r.engine,
        model: r.model,
        startedAt: r.startedAt,
      })),
    });
  });

  // 3. GET /api/agents/:engine/models — Models and effort levels for an engine
  api.get("/agents/:engine/models", (c) => {
    const engine = c.req.param("engine") as AgentEngineId;
    if (!ENGINE_CATALOG[engine]) {
      return c.json({ error: `Unknown agent engine: ${engine}` }, 404);
    }
    const spec = ENGINE_CATALOG[engine];
    const models = getModelsForEngine(engine);
    return c.json({
      ok: true,
      engine,
      label: spec.label,
      defaultModel: spec.defaultModel,
      efforts: spec.efforts,
      defaultEffort: spec.defaultEffort,
      models,
    });
  });

  // 3b. POST /api/agents/fast-patch — Instant direct scoped patch (< 50ms) for targeted element edits
  api.post("/agents/fast-patch", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      projectId?: string;
      sceneFile?: string;
      elementId?: string;
      prompt?: string;
      apiKey?: string;
      expectedVersion?: string;
    } | null;

    if (!body || !body.prompt || !body.prompt.trim()) {
      return c.json({ ok: false, error: "prompt is required" }, 400);
    }

    let project = null;
    if (body.projectId) {
      project = await adapter.resolveProject(body.projectId);
      if (!project) {
        return c.json(
          { ok: false, error: `Project '${body.projectId}' not found or no longer active` },
          404,
        );
      }
    } else {
      const all = await adapter.listProjects();
      project = all[0] ?? null;
    }
    const rawProjectDir =
      project?.dir || process.env.HYPERFRAMES_PREVIEW_PROJECT_DIR || process.cwd();
    let realProjectDir = rawProjectDir;
    try {
      realProjectDir = realpathSync(rawProjectDir);
    } catch {
      realProjectDir = rawProjectDir;
    }

    const result = await executeFastPatch({
      projectDir: realProjectDir,
      sceneFile: body.sceneFile,
      elementId: body.elementId,
      prompt: body.prompt,
      apiKey: body.apiKey,
      expectedVersion: body.expectedVersion,
    });

    if (result.patched && project) {
      adapter.invalidateProjectSignature?.(project.dir);
    }

    return c.json(result);
  });

  // 4. POST /api/agents/run — Spawn CLI agent in project directory and stream output via SSE
  api.post("/agents/run", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      projectId?: string;
      engine?: AgentEngineId;
      model?: string;
      effort?: string;
      prompt?: string;
      sceneFile?: string;
      elementId?: string;
      timestampSeconds?: number;
      skills?: string[];
      attachments?: string[];
      apiKey?: string;
    } | null;

    if (!body || !body.prompt || !body.prompt.trim()) {
      return c.json({ error: "prompt is required" }, 400);
    }

    const engine: AgentEngineId =
      body.engine && ENGINE_CATALOG[body.engine] ? body.engine : "claude";
    const spec = ENGINE_CATALOG[engine];

    let project = body.projectId ? await adapter.resolveProject(body.projectId) : null;
    if (!project) {
      const all = await adapter.listProjects();
      project = all[0] ?? null;
    }
    const rawProjectDir =
      project?.dir || process.env.HYPERFRAMES_PREVIEW_PROJECT_DIR || process.cwd();
    let realProjectDir = rawProjectDir;
    try {
      realProjectDir = realpathSync(rawProjectDir);
    } catch {
      realProjectDir = rawProjectDir;
    }
    const projectId = project?.id || body.projectId || "episode";

    const { compiledPrompt, loadedSkills } = buildCompiledPrompt({
      projectDir: realProjectDir,
      projectId,
      sceneFile: body.sceneFile,
      elementId: body.elementId,
      timestampSeconds: body.timestampSeconds,
      prompt: body.prompt,
      skillIds: Array.isArray(body.skills) ? body.skills : [],
      attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
    });

    const binaryPath = findCliBinary(spec.binary);
    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const model = body.model || spec.defaultModel;
    const effort = body.effort || spec.defaultEffort;

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: "start",
        data: JSON.stringify({
          runId,
          engine,
          label: spec.label,
          model,
          effort,
          cwd: realProjectDir,
          binaryPath,
          skills: loadedSkills,
          compiledPrompt,
        }),
      });

      if (!binaryPath) {
        await stream.writeSSE({
          event: "output",
          data: JSON.stringify({
            runId,
            stream: "stderr",
            text: `[Studio Agent Runner] '${spec.binary}' CLI was not found on PATH.\nCompiled prompt with ${loadedSkills.length} skill(s) is ready — use 'Copy Prompt' or install '${spec.binary}' CLI.\n`,
            timestamp: Date.now(),
          }),
        });
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            runId,
            exitCode: 127,
            status: "failed",
            durationMs: 0,
          }),
        });
        return;
      }

      const { args } = buildCliCommandArgs(engine, {
        model,
        effort,
        cwd: realProjectDir,
        compiledPrompt,
      });

      const envPath = getExtraSearchPaths().join(":");
      const trimmedApiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      const apiKeyEnv: Record<string, string> = {};
      if (trimmedApiKey) {
        if (engine === "claude" || trimmedApiKey.startsWith("sk-ant-")) {
          apiKeyEnv.ANTHROPIC_API_KEY = trimmedApiKey;
        } else if (engine === "codex") {
          apiKeyEnv.OPENAI_API_KEY = trimmedApiKey;
        } else if (engine === "agy" || trimmedApiKey.startsWith("AIza")) {
          apiKeyEnv.GEMINI_API_KEY = trimmedApiKey;
          apiKeyEnv.GOOGLE_API_KEY = trimmedApiKey;
        } else {
          apiKeyEnv.ANTHROPIC_API_KEY = trimmedApiKey;
          apiKeyEnv.OPENAI_API_KEY = trimmedApiKey;
          apiKeyEnv.GEMINI_API_KEY = trimmedApiKey;
        }
      }

      const proc = spawn(binaryPath, args, {
        cwd: realProjectDir,
        env: {
          ...process.env,
          ...apiKeyEnv,
          PATH: `${envPath}:${process.env.PATH || ""}`,
          FORCE_COLOR: "0",
          NO_COLOR: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const runState: ActiveAgentRun = {
        runId,
        engine,
        model,
        proc,
        startedAt: Date.now(),
        projectDir: rawProjectDir,
        cancelled: false,
      };
      activeRuns.set(runId, runState);

      await new Promise<void>((resolveRun) => {
        const sendChunk = (streamType: "stdout" | "stderr", chunk: Buffer) => {
          const text = chunk.toString("utf-8");
          void stream
            .writeSSE({
              event: "output",
              data: JSON.stringify({
                runId,
                stream: streamType,
                text,
                timestamp: Date.now(),
              }),
            })
            .catch(() => {});
        };

        proc.stdout?.on("data", (chunk: Buffer) => sendChunk("stdout", chunk));
        proc.stderr?.on("data", (chunk: Buffer) => sendChunk("stderr", chunk));

        proc.on("error", (err) => {
          void stream
            .writeSSE({
              event: "output",
              data: JSON.stringify({
                runId,
                stream: "stderr",
                text: `\n[Spawn Error] ${err.message}\n`,
                timestamp: Date.now(),
              }),
            })
            .catch(() => {});
        });

        proc.on("close", (code) => {
          activeRuns.delete(runId);
          adapter.invalidateProjectSignature?.(rawProjectDir);
          const status = runState.cancelled ? "cancelled" : code === 0 ? "completed" : "failed";
          void stream
            .writeSSE({
              event: "done",
              data: JSON.stringify({
                runId,
                exitCode: code ?? -1,
                status,
                durationMs: Date.now() - runState.startedAt,
              }),
            })
            .finally(() => resolveRun());
        });
      });
    });
  });

  // 5. POST /api/agents/cancel — Abort an active agent subprocess cleanly
  api.post("/agents/cancel", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { runId?: string };
    const targets = body.runId
      ? [activeRuns.get(body.runId)].filter((r): r is ActiveAgentRun => Boolean(r))
      : [...activeRuns.values()];

    const cancelledIds: string[] = [];
    for (const run of targets) {
      run.cancelled = true;
      cancelledIds.push(run.runId);
      try {
        run.proc.kill("SIGINT");
        setTimeout(() => {
          try {
            if (!run.proc.killed) run.proc.kill("SIGTERM");
          } catch {
            /* ignore */
          }
        }, 1500);
      } catch {
        /* ignore */
      }
      activeRuns.delete(run.runId);
    }

    return c.json({
      ok: true,
      cancelledRunIds: cancelledIds,
    });
  });
}
