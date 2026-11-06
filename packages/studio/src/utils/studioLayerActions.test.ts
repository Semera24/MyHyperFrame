// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { usePlayerStore } from "../player";
import { detectUnbundleCandidate, resolveActiveSceneTargetAtPlayhead } from "./studioLayerActions";

describe("studioLayerActions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    usePlayerStore.setState({
      currentTime: 0,
      elements: [],
      clipManifest: [],
    });
  });

  it("resolves active scene target at playhead from playerStore.elements without crashing", () => {
    usePlayerStore.setState({
      currentTime: 25,
      elements: [
        {
          id: "scene-1",
          tag: "div",
          kind: "composition",
          compositionId: "s01",
          compositionSrc: "compositions/s01.html",
          start: 0,
          duration: 20.67,
          track: 1,
        },
        {
          id: "scene-2",
          tag: "div",
          kind: "composition",
          compositionId: "s02",
          compositionSrc: "compositions/s02.html",
          start: 20.67,
          duration: 25.62,
          track: 1,
        },
      ],
    });

    const target = resolveActiveSceneTargetAtPlayhead("index.html");
    expect(target.targetFile).toBe("compositions/s02.html");
    expect(target.localStart).toBeCloseTo(4.33);
    expect(target.defaultDuration).toBe(5);
  });

  it("detects ancestor Grid container when clicking a nested map image inside a block wrapper", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="s01">
        <div id="s01-split-maps" style="display: grid; grid-template-columns: 1fr 1fr;">
          <div data-hf-id="hf-qs74" style="position: relative; overflow: hidden;">
            <img id="suez-img" data-hf-id="hf-p8kc" src="assets/suez.svg" />
            <div data-hf-id="hf-xetq">SUEZ CANAL</div>
          </div>
          <div data-hf-id="hf-fn7c" style="position: relative; overflow: hidden;">
            <img id="hormuz-img" data-hf-id="hf-3zfl" src="assets/hormuz.svg" />
          </div>
        </div>
      </div>
    `;
    const suezImg = document.getElementById("suez-img") as HTMLElement;
    const candidate = detectUnbundleCandidate(suezImg);
    expect(candidate).not.toBeNull();
    expect(candidate?.container.id).toBe("s01-split-maps");
    expect(candidate?.children.length).toBe(2);
  });
});
