import type { PatchOperation } from "../../utils/sourcePatcher";
import { LAYER_REVEAL_PRIOR_POSITION_ATTR } from "../../player/lib/timelineElementHelpers";
import { roundTo3 } from "../../utils/rounding";

interface LayoutBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const layoutBox = (el: HTMLElement): LayoutBox => ({
  left: el.offsetLeft,
  top: el.offsetTop,
  width: el.offsetWidth,
  height: el.offsetHeight,
});

function readDragStart(el: HTMLElement, axis: "x" | "y"): number {
  const value = Number.parseFloat(el.getAttribute(`data-hf-drag-initial-offset-${axis}`) ?? "");
  return Number.isFinite(value) ? value : 0;
}

export type ElementOffsetRefusal = "percent" | "anchored";

/** Moves one element by adding to its own `left`/`top` (GSAP never parses them), or
 *  names why not, leaving the element untouched. */
export function applyElementPositionOffset(
  el: HTMLElement,
  gestureOffset: { x: number; y: number },
): PatchOperation[] | ElementOffsetRefusal {
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!cs) return "anchored";
  const dx = roundTo3(gestureOffset.x - readDragStart(el, "x"));
  const dy = roundTo3(gestureOffset.y - readDragStart(el, "y"));
  // A Layers-panel pick lifts a static element to relative for display only.
  const lifted = el.getAttribute(LAYER_REVEAL_PRIOR_POSITION_ATTR) === "static";
  const isStatic = lifted || !/^(relative|absolute|fixed|sticky)$/.test(cs.position);
  if (!isStatic && (cs.left.endsWith("%") || cs.top.endsWith("%"))) return "percent";
  const baseLeft = isStatic ? 0 : Number.parseFloat(cs.left) || 0;
  const baseTop = isStatic ? 0 : Number.parseFloat(cs.top) || 0;
  const previous = { position: el.style.position, left: el.style.left, top: el.style.top };
  const before = layoutBox(el);
  if (isStatic) el.style.position = "relative";
  el.style.left = `${roundTo3(baseLeft + dx)}px`;
  el.style.top = `${roundTo3(baseTop + dy)}px`;
  const after = layoutBox(el);
  const shiftedExactly =
    Math.abs(after.left - before.left - dx) <= 1 &&
    Math.abs(after.top - before.top - dy) <= 1 &&
    Math.abs(after.width - before.width) <= 1 &&
    Math.abs(after.height - before.height) <= 1;
  if (!shiftedExactly) {
    Object.assign(el.style, previous);
    // When the element is anchored via right/bottom or flex/grid, adjust right/bottom
    // if positioned with right/bottom, or fall back to CSS translate so manual canvas
    // drag never fails on AI-authored layouts.
    if (!isStatic && (cs.right !== "auto" || cs.bottom !== "auto")) {
      const patches: PatchOperation[] = [];
      if (cs.left === "auto" && cs.right !== "auto" && !cs.right.endsWith("%")) {
        const baseRight = Number.parseFloat(cs.right) || 0;
        el.style.right = `${roundTo3(baseRight - dx)}px`;
        patches.push({ type: "inline-style", property: "right", value: el.style.right });
      } else {
        el.style.left = `${roundTo3(baseLeft + dx)}px`;
        patches.push({ type: "inline-style", property: "left", value: el.style.left });
      }
      if (cs.top === "auto" && cs.bottom !== "auto" && !cs.bottom.endsWith("%")) {
        const baseBottom = Number.parseFloat(cs.bottom) || 0;
        el.style.bottom = `${roundTo3(baseBottom - dy)}px`;
        patches.push({ type: "inline-style", property: "bottom", value: el.style.bottom });
      } else {
        el.style.top = `${roundTo3(baseTop + dy)}px`;
        patches.push({ type: "inline-style", property: "top", value: el.style.top });
      }
      return patches;
    }
    const translateValue = `${roundTo3(gestureOffset.x)}px ${roundTo3(gestureOffset.y)}px`;
    el.style.translate = translateValue;
    return [{ type: "inline-style", property: "translate", value: translateValue }];
  }
  if (lifted) el.removeAttribute(LAYER_REVEAL_PRIOR_POSITION_ATTR);
  return [
    ...(isStatic
      ? [{ type: "inline-style", property: "position", value: "relative" } as const]
      : []),
    { type: "inline-style", property: "left", value: el.style.left },
    { type: "inline-style", property: "top", value: el.style.top },
  ];
}
