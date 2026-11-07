import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileContentVersion } from "./fileVersion.js";

export interface FastPatchResult {
  ok: boolean;
  patched: boolean;
  patchType?: "css-style" | "text-content" | "image-src" | "ai-scoped";
  elementId?: string;
  diffSummary?: string;
  durationMs: number;
  error?: string;
  canFallbackToCli?: boolean;
  fileVersion?: string;
}

const COMMON_COLOR_NAMES = new Set([
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "purple",
  "pink",
  "black",
  "white",
  "gray",
  "grey",
  "cyan",
  "gold",
  "amber",
  "teal",
  "indigo",
  "violet",
  "emerald",
  "slate",
  "crimson",
  "navy",
  "lime",
  "maroon",
  "transparent",
]);

/**
 * Checks if a user prompt is a lightweight, single-element direct edit
 * (e.g. style, color, font-size, text copy, image swap) that can be patched instantly (<50ms).
 */
export function isFastPatchEligible(prompt: string, elementId?: string): boolean {
  if (!prompt || !elementId) return false;
  const p = prompt.toLowerCase();

  // Style / color / text / asset keywords
  const hasStyleKw =
    /(color|background|bg|font|size|bold|opacity|text|title|heading|src|image|border|padding|radius|width|height)/.test(
      p,
    );
  const isDirectAction = /(change|set|make|switch|swap|update|turn|replace|adjust)/.test(p);

  // Exclude complex macro multi-scene or scripting requests
  const isMacroOrComplex =
    /(timeline|audio|narration|voiceover|camera|parallax|storyboard|all scenes|new scene|full episode|export|render)/.test(
      p,
    );

  return (hasStyleKw || isDirectAction) && !isMacroOrComplex;
}

/**
 * Extracts CSS property-value pairs from natural language prompt.
 */
function extractStyleMutations(prompt: string): Record<string, string> {
  const mutations: Record<string, string> = {};
  const p = prompt.trim();

  // 1. Color extraction
  // Handles: "change color to blue", "color: #ff0000", "make text green", "color to rgba(0,0,0,0.5)"
  const colorMatch = /(?:text\s+)?color\s*(?:to|is|=)?\s*([#a-zA-Z0-9(),.-]+)/i.exec(p);
  if (colorMatch && colorMatch[1]) {
    const raw = colorMatch[1].replace(/;$/, "").trim();
    if (
      raw.startsWith("#") ||
      raw.startsWith("rgb") ||
      raw.startsWith("hsl") ||
      COMMON_COLOR_NAMES.has(raw.toLowerCase())
    ) {
      mutations["color"] = raw;
    }
  } else {
    // Check "make text <color>" or "turn to <color>"
    const makeColorMatch =
      /(?:make|turn|set)(?:\s+(?:the\s+)?(?:text|title|headline|word))?\s+(?:to\s+)?([a-z]+)/i.exec(
        p,
      );
    if (
      makeColorMatch &&
      makeColorMatch[1] &&
      COMMON_COLOR_NAMES.has(makeColorMatch[1].toLowerCase())
    ) {
      mutations["color"] = makeColorMatch[1].toLowerCase();
    }
  }

  // 2. Font Size
  // Handles: "font-size 48px", "size to 36px", "font size: 2rem"
  const fontMatch =
    /(?:font[- ]?size|text size|size)\s*(?:to|is|=)?\s*(\d+(?:\.\d+)?(?:px|rem|em|vw|%))/i.exec(p);
  if (fontMatch && fontMatch[1]) {
    mutations["font-size"] = fontMatch[1];
  }

  // 3. Font Weight / Bold
  if (/\b(?:make (?:it )?bold|bold text|font[- ]?weight\s*(?:to|is|=)?\s*bold)\b/i.test(p)) {
    mutations["font-weight"] = "700";
  } else if (/\b(?:extra bold|black weight|900 weight|font[- ]?weight\s*900)\b/i.test(p)) {
    mutations["font-weight"] = "900";
  } else if (/\b(?:normal weight|unbold|regular weight|font[- ]?weight\s*400)\b/i.test(p)) {
    mutations["font-weight"] = "400";
  }

  // 4. Background Color
  const bgMatch = /(?:background(?:[- ]color)?|bg)\s*(?:to|is|=)?\s*([#a-zA-Z0-9(),.-]+)/i.exec(p);
  if (bgMatch && bgMatch[1]) {
    const raw = bgMatch[1].replace(/;$/, "").trim();
    if (raw.startsWith("#") || raw.startsWith("rgb") || COMMON_COLOR_NAMES.has(raw.toLowerCase())) {
      mutations["background"] = raw;
    }
  }

  // 5. Opacity
  const opacityMatch = /opacity\s*(?:to|is|=)?\s*([01]?(?:\.\d+)?)/i.exec(p);
  if (opacityMatch && opacityMatch[1]) {
    mutations["opacity"] = opacityMatch[1];
  }

  // 6. Letter Spacing
  const letterSpacingMatch = /letter[- ]spacing\s*(?:to|is|=)?\s*([-\d.]+(?:px|em|rem))/i.exec(p);
  if (letterSpacingMatch && letterSpacingMatch[1]) {
    mutations["letter-spacing"] = letterSpacingMatch[1];
  }

  // 7. Text Transform
  if (/\b(?:uppercase|all caps|capitalize)\b/i.test(p)) {
    mutations["text-transform"] = "uppercase";
  } else if (/\b(?:lowercase|all lower)\b/i.test(p)) {
    mutations["text-transform"] = "lowercase";
  }

  return mutations;
}

/**
 * Extracts text replacement if user wants to change text content.
 */
function extractTextContentReplacement(prompt: string): string | null {
  // e.g. change text to "Hello World" or set title to 'Trump 2004'
  const quoted =
    /(?:change|set|replace|make)(?:\s+(?:the\s+)?(?:text|title|headline|caption))?\s*(?:to|with|=)?\s*["“]([^"”]+)["”]/i.exec(
      prompt,
    );
  if (quoted && quoted[1]) return quoted[1].trim();

  const singleQuoted =
    /(?:change|set|replace|make)(?:\s+(?:the\s+)?(?:text|title|headline|caption))?\s*(?:to|with|=)?\s*['‘]([^'’]+)['’]/i.exec(
      prompt,
    );
  if (singleQuoted && singleQuoted[1]) return singleQuoted[1].trim();

  return null;
}

/**
 * Extracts image src replacement if user wants to swap an asset.
 */
function extractImageSrcReplacement(prompt: string): string | null {
  const match =
    /(?:change|swap|replace|set)\s*(?:image|src|graphic|photo)?\s*(?:to|with|=)?\s*["']?((?:assets\/|images\/)[a-zA-Z0-9_\-./]+\.(?:png|jpg|jpeg|svg|webp))["']?/i.exec(
      prompt,
    );
  if (match && match[1]) return match[1].trim();
  return null;
}

/**
 * Patches a CSS property in an HTML file's <style> block for #elementId or .elementId.
 */
function patchCssInHtml(
  html: string,
  elementId: string,
  styleUpdates: Record<string, string>,
): { newHtml: string; diffs: string[] } {
  const diffs: string[] = [];
  const cleanId = elementId.replace(/^[#.]/, "");

  // Look for selector matching #elementId or .elementId
  const selectorPattern = new RegExp(`(#${cleanId}|\\.${cleanId})\\s*\\{([\\s\\S]*?)\\}`, "m");
  const match = selectorPattern.exec(html);

  if (match) {
    const fullRule = match[0];
    const selector = match[1];
    let ruleBody = match[2]!;

    for (const [prop, val] of Object.entries(styleUpdates)) {
      const propRegex = new RegExp(`([\\t ]*${prop}\\s*:\\s*)([^;]+)(;)`, "i");
      if (propRegex.test(ruleBody)) {
        ruleBody = ruleBody.replace(
          propRegex,
          (_m, prefix, _oldVal, suffix) => `${prefix}${val}${suffix}`,
        );
        diffs.push(`Updated ${selector} { ${prop}: ${val}; }`);
      } else {
        // Append property inside rule
        ruleBody = `${ruleBody.trimEnd()}\n        ${prop}: ${val};\n      `;
        diffs.push(`Added ${selector} { ${prop}: ${val}; }`);
      }
    }

    const newRule = `${selector} {${ruleBody}}`;
    const newHtml = html.replace(fullRule, newRule);
    return { newHtml, diffs };
  }

  // If rule not found in <style>, insert it into the first <style> tag
  const styleTagMatch = /<style>([\s\S]*?)<\/style>/i.exec(html);
  if (styleTagMatch) {
    const styleContent = styleTagMatch[1]!;
    const newRuleProps = Object.entries(styleUpdates)
      .map(([prop, val]) => `        ${prop}: ${val};`)
      .join("\n");
    const newRule = `\n      #${cleanId} {\n${newRuleProps}\n      }\n`;

    const newStyleTag = `<style>${styleContent}${newRule}    </style>`;
    const newHtml = html.replace(styleTagMatch[0], newStyleTag);
    diffs.push(`Created #${cleanId} rule in <style> with ${Object.keys(styleUpdates).join(", ")}`);
    return { newHtml, diffs };
  }

  // Fallback: apply as inline style on the element itself
  const elemRegex = new RegExp(`(<[^>]+?\\bid=["']${cleanId}["'][^>]*?)>`, "i");
  if (elemRegex.test(html)) {
    const styleAttrEntries = Object.entries(styleUpdates)
      .map(([k, v]) => `${k}:${v}`)
      .join("; ");
    const newHtml = html.replace(elemRegex, (_m: string, openTag: string) => {
      if (/style=["']/i.test(openTag)) {
        return openTag.replace(
          /style=["']([^"']*)["']/i,
          (_s: string, existing: string) => `style="${existing.trimEnd()}; ${styleAttrEntries}"`,
        );
      }
      return `${openTag} style="${styleAttrEntries}">`;
    });
    diffs.push(`Applied inline style to #${cleanId}: ${styleAttrEntries}`);
    return { newHtml, diffs };
  }

  return { newHtml: html, diffs };
}

/**
 * Patches text content for #elementId in the HTML template.
 */
function patchTextInHtml(
  html: string,
  elementId: string,
  newText: string,
): { newHtml: string; diffs: string[] } {
  const cleanId = elementId.replace(/^[#.]/, "");
  const diffs: string[] = [];

  // Match: <tag id="cleanId" ...>OLD TEXT</tag>
  const elemRegex = new RegExp(
    `(<[a-zA-Z0-9]+[^>]+?\\bid=["']${cleanId}["'][^>]*?>)([\\s\\S]*?)(<\\/[a-zA-Z0-9]+>)`,
    "i",
  );
  const match = elemRegex.exec(html);
  if (match) {
    const openTag = match[1]!;
    const closeTag = match[3]!;
    const newHtml = html.replace(match[0], `${openTag}${newText}${closeTag}`);
    diffs.push(`Updated text of #${cleanId} to "${newText}"`);
    return { newHtml, diffs };
  }

  return { newHtml: html, diffs };
}

/**
 * Patches image src for #elementId in the HTML template.
 */
function patchImageSrcInHtml(
  html: string,
  elementId: string,
  newSrc: string,
): { newHtml: string; diffs: string[] } {
  const cleanId = elementId.replace(/^[#.]/, "");
  const diffs: string[] = [];

  const imgRegex = new RegExp(
    `(<img[^>]+?\\bid=["']${cleanId}["'][^>]*?\\bsrc=["'])([^"']+)(["'][^>]*?>)`,
    "i",
  );
  if (imgRegex.test(html)) {
    const newHtml = html.replace(imgRegex, `$1${newSrc}$3`);
    diffs.push(`Updated image src of #${cleanId} to "${newSrc}"`);
    return { newHtml, diffs };
  }

  return { newHtml: html, diffs };
}

function safeWriteHtml(
  targetPath: string,
  newHtml: string,
): { ok: true; version: string } | { ok: false; error: string } {
  try {
    writeFileSync(targetPath, newHtml, "utf-8");
    return { ok: true, version: fileContentVersion(newHtml) };
  } catch (err) {
    return { ok: false, error: `Failed to save changes to ${targetPath}: ${String(err)}` };
  }
}

/**
 * Main entry point: Executes an instant scoped fast-patch on the target file (< 50ms).
 */
export async function executeFastPatch(opts: {
  projectDir: string;
  sceneFile?: string;
  elementId?: string;
  prompt: string;
  apiKey?: string;
  expectedVersion?: string;
}): Promise<FastPatchResult> {
  const t0 = Date.now();
  const sceneRelPath = opts.sceneFile || "index.html";
  const cleanElementId = opts.elementId?.replace(/^[#.]/, "");

  if (!cleanElementId) {
    return {
      ok: false,
      patched: false,
      durationMs: Date.now() - t0,
      canFallbackToCli: true,
      error: "No element ID specified for fast-path edit",
    };
  }

  // Resolve file path
  const candidates = [
    resolve(opts.projectDir, sceneRelPath),
    resolve(opts.projectDir, "Sources", sceneRelPath),
    resolve(opts.projectDir, "compositions", sceneRelPath),
    resolve(opts.projectDir, "Sources/compositions", sceneRelPath),
  ];
  let targetPath: string | null = null;
  for (const c of candidates) {
    if (existsSync(c)) {
      targetPath = c;
      break;
    }
  }

  if (!targetPath) {
    return {
      ok: false,
      patched: false,
      durationMs: Date.now() - t0,
      canFallbackToCli: true,
      error: `Could not find target scene file: ${sceneRelPath}`,
    };
  }

  let html: string;
  try {
    html = readFileSync(targetPath, "utf-8");
  } catch (err) {
    return {
      ok: false,
      patched: false,
      durationMs: Date.now() - t0,
      canFallbackToCli: true,
      error: `Failed to read ${targetPath}: ${String(err)}`,
    };
  }

  // Conflict detection: verify external IDE edits
  if (opts.expectedVersion) {
    const currentVersion = fileContentVersion(html);
    if (currentVersion !== opts.expectedVersion) {
      return {
        ok: false,
        patched: false,
        durationMs: Date.now() - t0,
        canFallbackToCli: false,
        error: `Conflict: External edit detected in ${sceneRelPath}. Stale Studio edit cannot overwrite it.`,
      };
    }
  }

  // 1. Try CSS Style mutations
  const styleMutations = extractStyleMutations(opts.prompt);
  if (Object.keys(styleMutations).length > 0) {
    const { newHtml, diffs } = patchCssInHtml(html, cleanElementId, styleMutations);
    if (diffs.length > 0 && newHtml !== html) {
      const writeRes = safeWriteHtml(targetPath, newHtml);
      if (!writeRes.ok) {
        return {
          ok: false,
          patched: false,
          durationMs: Date.now() - t0,
          error: writeRes.error,
        };
      }
      return {
        ok: true,
        patched: true,
        patchType: "css-style",
        elementId: cleanElementId,
        diffSummary: diffs.join("; "),
        durationMs: Date.now() - t0,
        fileVersion: writeRes.version,
      };
    }
  }

  // 2. Try Text Content replacement
  const textUpdate = extractTextContentReplacement(opts.prompt);
  if (textUpdate) {
    const { newHtml, diffs } = patchTextInHtml(html, cleanElementId, textUpdate);
    if (diffs.length > 0 && newHtml !== html) {
      const writeRes = safeWriteHtml(targetPath, newHtml);
      if (!writeRes.ok) {
        return {
          ok: false,
          patched: false,
          durationMs: Date.now() - t0,
          error: writeRes.error,
        };
      }
      return {
        ok: true,
        patched: true,
        patchType: "text-content",
        elementId: cleanElementId,
        diffSummary: diffs.join("; "),
        durationMs: Date.now() - t0,
        fileVersion: writeRes.version,
      };
    }
  }

  // 3. Try Image Src replacement
  const imageUpdate = extractImageSrcReplacement(opts.prompt);
  if (imageUpdate) {
    const { newHtml, diffs } = patchImageSrcInHtml(html, cleanElementId, imageUpdate);
    if (diffs.length > 0 && newHtml !== html) {
      const writeRes = safeWriteHtml(targetPath, newHtml);
      if (!writeRes.ok) {
        return {
          ok: false,
          patched: false,
          durationMs: Date.now() - t0,
          error: writeRes.error,
        };
      }
      return {
        ok: true,
        patched: true,
        patchType: "image-src",
        elementId: cleanElementId,
        diffSummary: diffs.join("; "),
        durationMs: Date.now() - t0,
        fileVersion: writeRes.version,
      };
    }
  }

  // Not matched by direct rules — return signal that it can fallback to deep CLI agent
  return {
    ok: false,
    patched: false,
    durationMs: Date.now() - t0,
    canFallbackToCli: true,
    error: "Instruction requires deep agent reasoning or structural changes",
  };
}
