#!/usr/bin/env node
// Lists a captured site's products and features, newest first: node features.mjs <capture-dir> [--json]
// Reads extracted/page.html and tokens.json; a "New" badge ranks first, then menu entries with a description.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir || !existsSync(join(dir, "extracted", "page.html"))) {
  console.error("usage: features.mjs <capture-dir>   (a `hyperframes capture` output folder)");
  process.exit(2);
}
const html = readFileSync(join(dir, "extracted", "page.html"), "utf8");
const tokens = existsSync(join(dir, "extracted", "tokens.json"))
  ? JSON.parse(readFileSync(join(dir, "extracted", "tokens.json"), "utf8"))
  : {};

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const chunks = (inner) =>
  decode(inner)
    .split(/<[^>]+>/)
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean);

let origin = "";
try {
  origin = new URL(tokens.page?.url || tokens.url || "").origin;
} catch {}
const SKIP =
  /privacy|terms|legal|cookie|login|log in|sign ?in|sign ?up|get started|pricing|contact|careers|jobs|help|support|status|blog|press|security|trust|download|cart|account|language|sitemap|investor|about us|^about$|^home$/i;

const seen = new Map();
let order = 0;
for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
  const [, href, inner] = m;
  if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
  let url;
  try {
    url = new URL(decode(href), origin || "https://example.com");
  } catch {
    continue;
  }
  const sameSite =
    !origin ||
    url.hostname === new URL(origin).hostname ||
    url.hostname.endsWith("." + new URL(origin).hostname.replace(/^www\./, ""));
  if (!sameSite) continue;
  const parts = chunks(inner);
  if (!parts.length) continue;
  const isNew =
    parts.some((p) => /^(new|beta|preview|just launched)$/i.test(p)) ||
    /\bnew\b/i.test(parts[0].replace(/^.*\S(New)$/, "New"));
  const name = parts.filter((p) => !/^(new|beta|preview|just launched)$/i.test(p))[0] || parts[0];
  const desc = parts
    .filter((p) => p !== name && !/^(new|beta|preview|just launched)$/i.test(p))
    .join(" ")
    .slice(0, 80);
  if (name.length > 48 || SKIP.test(name) || SKIP.test(url.pathname)) continue;
  const key = url.origin + url.pathname.replace(/\/$/, "");
  if (seen.has(key)) {
    const f = seen.get(key);
    f.isNew ||= isNew;
    f.desc ||= desc;
    continue;
  }
  seen.set(key, { name, desc, isNew, url: key, order: order++ });
}

const score = (f) => (f.isNew ? 0 : f.desc ? 1 : 2) * 10000 + f.order;
const features = [...seen.values()].sort((a, b) => score(a) - score(b)).slice(0, 40);
const headings = (tokens.headings || [])
  .filter((h) => h.level <= 3)
  .map((h) => h.text)
  .slice(0, 12);

if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify(
      { title: tokens.title, description: tokens.description, features, headings },
      null,
      2,
    ),
  );
} else {
  console.log(
    `${tokens.title || ""}\n${tokens.description || ""}\n\nProducts and features (newest first):`,
  );
  for (const f of features)
    console.log(`  ${f.isNew ? "NEW " : "    "}${f.name}${f.desc ? ` - ${f.desc}` : ""}  ${f.url}`);
  console.log("\nHomepage sections:");
  for (const h of headings) console.log(`  ${h}`);
}
