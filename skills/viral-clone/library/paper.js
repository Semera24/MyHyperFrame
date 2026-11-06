// Creator-edit lettering a viral clone keeps rebuilding: ransom-note paper scraps, the boil that keeps hand-made
// graphics alive, and type-on. Load it in a composition with <script src="lib/paper.js"></script> after GSAP, then
// call window.vcPaper.*. Seeded, so the same call renders the same frames every time.
(function (root) {
  /** A seeded random in [0, 1). @param {number} seed */
  function random(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Splits text into runs of `min`..`max` letters within a word, each space riding on the scrap before it, as
   * ransom notes cut them. Leading spaces have no scrap to ride and are dropped. @param {string} text
   * @param {number} min @param {number} max @param {() => number} rnd */
  function chunks(text, min, max, rnd) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      if (/\s/.test(text[i])) {
        if (out.length) out[out.length - 1] += text[i];
        i += 1;
        continue;
      }
      const n = min + Math.floor(rnd() * (max - min + 1));
      let end = i + 1;
      while (end < text.length && end - i < n && !/\s/.test(text[end])) end += 1;
      out.push(text.slice(i, end));
      i = end;
    }
    return out;
  }

  /** A torn edge: a polygon whose sides wander `depth` percent in, `steps` points a side. */
  function torn(rnd, depth, steps) {
    const pts = [];
    const j = () => (rnd() * depth).toFixed(1);
    for (let s = 0; s <= steps; s++) pts.push(`${((s / steps) * 100).toFixed(1)}% ${j()}%`);
    for (let s = 1; s < steps; s++) pts.push(`${100 - j()}% ${((s / steps) * 100).toFixed(1)}%`);
    for (let s = steps; s >= 0; s--) pts.push(`${((s / steps) * 100).toFixed(1)}% ${100 - j()}%`);
    for (let s = steps - 1; s > 0; s--) pts.push(`${j()}% ${((s / steps) * 100).toFixed(1)}%`);
    return `polygon(${pts.join(",")})`;
  }

  /** Fills `el` with `text` as overlapping paper scraps, each `perScrap` letters, tilted, torn and shadowed, its
   * letters varied in size the way cut-out type is. Returns the scraps, for boil().
   * @param {HTMLElement} el @param {string} text @param {object} [o] */
  function ransom(el, text, o = {}) {
    const rnd = random(o.seed ?? 7);
    const [min, max] = o.perScrap ?? [1, 2];
    const tilt = o.tilt ?? 3;
    el.style.display = "flex";
    el.style.justifyContent = o.align ?? "center";
    el.style.alignItems = "center";
    el.textContent = "";
    return chunks(text, min, max, rnd).map((piece, i) => {
      const wrap = document.createElement("span");
      const paper = document.createElement("span");
      paper.textContent = piece;
      const lift = o.sizeJitter ?? 0.06;
      Object.assign(wrap.style, {
        display: "inline-block",
        position: "relative",
        margin: `0 ${-(o.overlap ?? 0.06)}em`,
        zIndex: String(Math.floor(rnd() * 5)),
        filter: o.shadow ?? "drop-shadow(0 1.5px 1.2px rgba(0,0,0,.42))",
      });
      Object.assign(paper.style, {
        display: "inline-block",
        whiteSpace: "pre",
        background: o.paper ?? "linear-gradient(170deg,#f6f3f4 0%,#efecec 60%,#e9e6e7 100%)",
        color: o.ink ?? "#151313",
        fontFamily: o.font ?? "serif",
        fontWeight: String(o.weight ?? 900),
        fontSize: `${(1 + (rnd() * 2 - 1) * lift).toFixed(3)}em`,
        lineHeight: "1",
        padding: o.padding ?? "0.12em 0.08em 0.2em",
        clipPath: torn(rnd, o.tear ?? 5, 4),
      });
      wrap.appendChild(paper);
      const base = (rnd() * 2 - 1) * tilt;
      wrap.dataset.tilt = base.toFixed(2);
      wrap.dataset.dy = ((rnd() * 2 - 1) * (o.jitterY ?? 2)).toFixed(1);
      wrap.style.transform = `translateY(${wrap.dataset.dy}px) rotate(${wrap.dataset.tilt}deg)`;
      wrap.dataset.i = String(i);
      el.appendChild(wrap);
      return wrap;
    });
  }

  /** Keeps hand-made pieces alive: each element jumps between `poses` small offsets, a new pose every `every` frames,
   * from `from` to `to` seconds. Rotation adds to a scrap's own tilt. @param {any} tl a paused GSAP timeline
   * @param {Element[]} els @param {object} o */
  function boil(tl, els, o) {
    const fps = o.fps ?? 30;
    const every = o.every ?? 7.5;
    const rnd = random(o.seed ?? 11);
    els.forEach((el) => {
      const tilt = Number(el.dataset?.tilt ?? 0);
      const dy = Number(el.dataset?.dy ?? 0);
      const poses = Array.from({ length: o.poses ?? 3 }, () => ({
        rotation: tilt + (rnd() * 2 - 1) * (o.rotate ?? 1),
        x: (rnd() * 2 - 1) * (o.move ?? 1.2),
        y: dy + (rnd() * 2 - 1) * (o.move ?? 1.2),
      }));
      let k = 0;
      for (let f = 0; o.from + f / fps < o.to; f += every, k++)
        tl.set(el, poses[k % poses.length], o.from + Math.round(f) / fps);
    });
  }

  /** Types `el`'s text on, `perFrame` characters a frame from `at` seconds, with a caret that goes at `caretOff`.
   * @param {any} tl @param {HTMLElement} el @param {object} [o] */
  function typeOn(tl, el, o = {}) {
    const fps = o.fps ?? 30;
    const at = o.at ?? 0;
    const text = el.textContent ?? "";
    el.textContent = "";
    const chars = [...text].map((c) => {
      const s = document.createElement("span");
      s.textContent = c === " " ? " " : c;
      s.style.visibility = "hidden";
      el.appendChild(s);
      return s;
    });
    const caret = document.createElement("span");
    Object.assign(caret.style, {
      display: "inline-block",
      width: o.caretWidth ?? "3px",
      height: "1em",
      background: o.caretColor ?? "currentColor",
      marginLeft: "2px",
      verticalAlign: "-0.1em",
    });
    el.appendChild(caret);
    chars.forEach((c, i) =>
      tl.set(c, { visibility: "visible" }, at + Math.floor(i / (o.perFrame ?? 1)) / fps),
    );
    tl.set(
      caret,
      { visibility: "hidden" },
      o.caretOff ?? at + Math.ceil(chars.length / (o.perFrame ?? 1)) / fps,
    );
    return chars;
  }

  root.vcPaper = { random, chunks, torn, ransom, boil, typeOn };
  if (typeof module === "object" && module.exports) module.exports = root.vcPaper;
})(typeof window === "undefined" ? globalThis : window);
