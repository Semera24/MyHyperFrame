#!/usr/bin/env node
// A script's measurable fingerprint, so G1 can compare a new script with the creator's own on numbers rather than by
// feel: per 100 units (characters for Chinese and Japanese, words otherwise) the numbers, questions, I / you / we
// pronouns and everyday-example markers, and the mean phrase length between punctuation. Reference files give a
// median and range; --draft marks each value inside or outside it.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { round } from "./media.mjs";

const USAGE = `usage: node fingerprint.mjs <ref-transcript>... [--draft <draft>]
  Each file is .txt, or .json with timed words (voice.transcribeAudio or voice.generateVoiceover JSON: words or segments with
  {word|text, start, end}); timed words add units per second of speech and numbers and questions per minute.`;
const CJK = /[぀-ヿ㐀-鿿]/;
const NUMBER =
  /[0-9０-９]+(?:[.,][0-9]+)?%?|[零一二两三四五六七八九十百千万亿]{2,}|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|trillion)\b/gi;
const PRONOUNS = {
  zh: { i: /我(?!们)/g, you: /你(?!们)|你们|您/g, we: /我们|咱们|咱/g },
  en: {
    i: /\b(?:i|me|my|mine)\b/gi,
    you: /\b(?:you|your|yours)\b/gi,
    we: /\b(?:we|us|our|ours)\b/gi,
  },
};
const EXAMPLE = {
  zh: /比如|比方|举个例子|就好像|相当于|打个比方|你想想|想象一下/g,
  en: /\bfor example\b|\bfor instance\b|\blike a\b|\bimagine\b|\bpicture this\b|\bthink of\b|\bit's like\b/gi,
};

function load(path) {
  const raw = readFileSync(path, "utf8");
  if (!path.endsWith(".json")) return { text: raw, words: null };
  const j = JSON.parse(raw);
  const segs = j.segments ?? [];
  const timed = Array.isArray(j)
    ? j
    : (j.words ?? (segs.some((s) => s.words?.length) ? segs.flatMap((s) => s.words ?? []) : segs));
  const words = timed.map((w) => ({
    t: String(w.word ?? w.text ?? ""),
    start: Number(w.start),
    end: Number(w.end),
  }));
  const zh = CJK.test(words.map((w) => w.t).join(""));
  return { text: words.map((w) => w.t).join(zh ? "" : " "), words };
}

export function fingerprint(path) {
  const { text, words } = load(path);
  const zh = CJK.test(text);
  const units = zh
    ? [...text.replace(/[^぀-ヿ㐀-鿿A-Za-z0-9]/g, "")].length
    : (text.match(/[A-Za-z0-9'’]+/g) ?? []).length;
  const per100 = (n) => round((n / Math.max(1, units)) * 100, 2);
  const count = (re) => (text.match(re) ?? []).length;
  const p = PRONOUNS[zh ? "zh" : "en"];
  const phrases = text
    .split(/[，。！？；、,.!?;:：…\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const phraseLen = phrases.map((s) =>
    zh ? [...s.replace(/\s/g, "")].length : s.split(/\s+/).length,
  );
  const out = {
    path,
    language: zh ? "zh" : "en",
    units,
    numbers_per_100: per100(count(NUMBER)),
    questions_per_100: per100(count(/[?？]/g)),
    i_per_100: per100(count(p.i)),
    you_per_100: per100(count(p.you)),
    we_per_100: per100(count(p.we)),
    examples_per_100: per100(count(EXAMPLE[zh ? "zh" : "en"])),
    mean_phrase_units: round(
      phraseLen.reduce((a, v) => a + v, 0) / Math.max(1, phraseLen.length),
      1,
    ),
  };
  if (words?.length) {
    const minutes = (words.at(-1).end - words[0].start) / 60;
    let speech = 0;
    const cap = minutes * 60 > words.length * 1.5 ? Infinity : 1.5; // sentence-timed segments are not capped like words
    for (let i = 0; i < words.length; i++)
      speech +=
        Math.min(words[i].end - words[i].start, cap) +
        Math.min(Math.max(0, (words[i + 1]?.start ?? words[i].end) - words[i].end), 0.3);
    Object.assign(out, {
      units_per_s: round(units / Math.max(1e-6, speech), 2),
      numbers_per_min: round(count(NUMBER) / Math.max(1e-6, minutes), 1),
      questions_per_min: round(count(/[?？]/g) / Math.max(1e-6, minutes), 1),
    });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const di = args.indexOf("--draft");
  const draft = di >= 0 ? args.splice(di, 2)[1] : null;
  if (!args.length || args.includes("--help")) {
    console.error(USAGE);
    process.exit(2);
  }
  const refs = args.map(fingerprint);
  const keys = Object.keys(refs[0]).filter((k) => typeof refs[0][k] === "number" && k !== "units");
  const stats = Object.fromEntries(
    keys.map((k) => {
      const v = refs
        .map((r) => r[k])
        .filter((x) => x !== undefined)
        .sort((a, b) => a - b);
      return [k, { median: v[Math.floor(v.length / 2)], min: v[0], max: v.at(-1) }];
    }),
  );
  const result = { refs: refs.length, ref_range: stats };
  if (draft) {
    const d = fingerprint(draft);
    result.draft = Object.fromEntries(
      keys
        .filter((k) => d[k] !== undefined)
        .map((k) => {
          const { min, max } = stats[k];
          // one reference has no range: allow ±30% around it
          const lo = refs.length > 1 ? min : min * 0.7,
            hi = refs.length > 1 ? max : max * 1.3;
          return [k, { value: d[k], inside: d[k] >= lo && d[k] <= hi }];
        }),
    );
  } else result.each = refs;
  console.log(JSON.stringify(result, null, 1));
}
