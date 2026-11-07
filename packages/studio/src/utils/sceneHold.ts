import type { TimelineElement } from "../player";

type SceneHoldingWindow = Window & { __hfHoldScenes?: (names: string[]) => Promise<void> };

/** Mounts the scenes holding a timeline element; undefined, so no wait, where the preview mounts every scene. */
export function holdScenesOf(
  iframe: HTMLIFrameElement | null,
  element: TimelineElement | null,
): Promise<void> | undefined {
  let hold: SceneHoldingWindow["__hfHoldScenes"];
  try {
    hold = (iframe?.contentWindow as SceneHoldingWindow | null)?.__hfHoldScenes;
  } catch {
    return undefined;
  }
  if (!hold) return undefined;
  const selfCompId =
    element && (element.type === "composition" || Boolean(element.compositionSrc))
      ? element.domId || element.id
      : "";
  const names = element
    ? [...(element.compositionAncestors ?? []), element.parentCompositionId ?? "", selfCompId]
    : [];
  return hold(names.filter(Boolean)).catch(() => {});
}
