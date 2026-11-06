const runs = (text) =>
  text
    .toLowerCase()
    .normalize("NFC")
    .match(/[\p{L}\p{M}\p{N}%$]+/gu) || [];
const dictionary = new Intl.Segmenter("ja", { granularity: "word" });

// Chinese and Japanese have no spaces: each character is a word, however the video splits a line into elements.
export const words = (text) =>
  runs(text).flatMap((run) =>
    run.match(
      /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}]\p{M}*|[^\p{scx=Han}\p{scx=Hira}\p{scx=Kana}]+/gu,
    ),
  );

// Reading time and line length count dictionary words, so a Chinese line reads like its English version.
export const readWords = (text) =>
  runs(text).reduce(
    (n, run) => n + Math.max(1, [...dictionary.segment(run)].filter((s) => s.isWordLike).length),
    0,
  );

// An element belongs to a line when it has words, all of them the line's,
// and its Chinese or Japanese runs sit together in the line.
const pieces = (text) =>
  runs(text).flatMap(
    (run) => run.match(/(?:[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}]\p{M}*)+/gu) || [],
  );
export const partOf = (text, line) => {
  const ws = words(text),
    set = new Set(words(line)),
    inLine = pieces(line).join("\n");
  return (
    ws.length > 0 && ws.every((w) => set.has(w)) && pieces(text).every((p) => inLine.includes(p))
  );
};
