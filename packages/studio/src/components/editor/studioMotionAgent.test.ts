// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { emptyStudioMotionManifest, type StudioMotionManifest } from "./studioMotion";
import {
  computeSmartMotionStart,
  installHyperFramesAgentBridge,
  resolveMotionPresetAlias,
  syncDeclarativeDomMotions,
} from "./studioMotionAgent";

describe("studioMotionAgent — AI Agent Motion & Transition Helpers", () => {
  it("resolves natural AI agent shorthands to canonical presets", () => {
    expect(resolveMotionPresetAlias("crossfade")?.id).toBe("transition-crossfade");
    expect(resolveMotionPresetAlias("dissolve")?.id).toBe("transition-crossfade");
    expect(resolveMotionPresetAlias("rise-up")?.id).toBe("entrance-rise-up");
    expect(resolveMotionPresetAlias("pulse")?.id).toBe("emphasis-pulse");
    expect(resolveMotionPresetAlias("fade-out")?.id).toBe("exit-fade-out");
    expect(resolveMotionPresetAlias("arc")?.id).toBe("path-arc");
  });

  it("computes smart placement start times for entrance, emphasis, and exit effects", () => {
    expect(
      computeSmartMotionStart({
        category: "entrance",
        duration: 0.6,
        clipStart: 1.0,
        clipDuration: 4.0,
        placement: "auto",
      }),
    ).toBe(1.0);

    expect(
      computeSmartMotionStart({
        category: "emphasis",
        duration: 0.8,
        clipStart: 1.0,
        clipDuration: 4.0,
        placement: "auto",
      }),
    ).toBe(2.6);

    expect(
      computeSmartMotionStart({
        category: "exit",
        duration: 0.5,
        clipStart: 1.0,
        clipDuration: 4.0,
        placement: "auto",
      }),
    ).toBe(4.5);
  });

  it("hydrates declarative data-transition and data-motion-* HTML attributes into a StudioMotionManifest", () => {
    const doc = document.implementation.createHTMLDocument("test");
    doc.body.innerHTML = `
      <div id="master-stage" data-composition-id="master">
        <div id="s01" data-composition-id="s01" data-start="0" data-duration="3.0"></div>
        <div id="s02" data-composition-id="s02" data-start="3" data-duration="3.0" data-transition="crossfade" data-transition-duration="0.8"></div>
        <div id="s01-evidence-card" data-start="0.2" data-duration="2.8" data-motion-in="rise-up" data-motion-emphasis="pulse" data-motion-out="fade-out"></div>
      </div>
    `;

    const { manifest, addedCount } = syncDeclarativeDomMotions(
      doc,
      "index.html",
      emptyStudioMotionManifest(),
      "documentary",
    );

    expect(addedCount).toBe(4);
    expect(manifest.motions).toHaveLength(4);

    const transition = manifest.motions.find((m) => m.category === "transition");
    expect(transition).toBeDefined();
    expect(transition?.transition?.fromSceneId).toBe("s01");
    expect(transition?.transition?.toSceneId).toBe("s02");
    expect(transition?.transition?.cutTime).toBe(3);
    expect(transition?.duration).toBe(0.8);
    expect(transition?.start).toBe(2.6);

    const entrance = manifest.motions.find((m) => m.category === "entrance");
    const emphasis = manifest.motions.find((m) => m.category === "emphasis");
    const exit = manifest.motions.find((m) => m.category === "exit");
    expect(entrance?.target.id).toBe("s01-evidence-card");
    expect(entrance?.start).toBe(0.2);
    expect(emphasis?.target.id).toBe("s01-evidence-card");
    expect(exit?.target.id).toBe("s01-evidence-card");
    expect(exit?.start).toBeGreaterThan(2.0);
  });

  it("exposes window.__hyperframesAgent for one-call object effects and scene transitions", async () => {
    let manifest: StudioMotionManifest = emptyStudioMotionManifest();
    const commitManifest = vi.fn(async (next: StudioMotionManifest) => {
      manifest = next;
    });
    const setSelectedMotionId = vi.fn();
    const requestSeek = vi.fn();

    const cleanup = installHyperFramesAgentBridge({
      getManifest: () => manifest,
      getActiveStylePreset: () => "documentary",
      getActiveCompPath: () => "index.html",
      getCurrentTime: () => 0,
      getIframeDoc: () => null,
      getTimelineElements: () => [
        {
          id: "s01",
          domId: "s01",
          label: "Scene 01",
          start: 0,
          duration: 3,
          compositionSrc: "compositions/s01.html",
        },
        {
          id: "s02",
          domId: "s02",
          label: "Scene 02",
          start: 3,
          duration: 3,
          compositionSrc: "compositions/s02.html",
        },
        {
          id: "s01-evidence-card",
          domId: "s01-evidence-card",
          label: "Evidence Card",
          start: 0,
          duration: 3,
          sourceFile: "compositions/s01.html",
        },
      ],
      commitManifest,
      setSelectedMotionId,
      requestSeek,
    });

    try {
      const agent = window.__hyperframesAgent!;
      expect(agent).toBeDefined();
      expect(agent.listPresets("transition").length).toBeGreaterThan(0);

      const targets = agent.listTargets();
      expect(targets.sceneCuts).toHaveLength(1);
      expect(targets.sceneCuts[0]?.fromSceneId).toBe("s01");
      expect(targets.sceneCuts[0]?.toSceneId).toBe("s02");

      const transRes = await agent.applySceneTransition({
        presetId: "crossfade",
        toSceneId: "s02",
        duration: 0.6,
      });
      expect(transRes.ok).toBe(true);
      expect(manifest.motions).toHaveLength(1);
      expect(manifest.motions[0]?.category).toBe("transition");
      expect(manifest.motions[0]?.start).toBe(2.7);
      expect(manifest.motions[0]?.duration).toBe(0.6);

      const effectRes = await agent.applyObjectEffect({
        targetId: "s01-evidence-card",
        presetId: "rise-up",
        placement: "auto",
      });
      expect(effectRes.ok).toBe(true);
      expect(manifest.motions).toHaveLength(2);

      const removeRes = await agent.removeSceneTransition({ toSceneId: "s02" });
      expect(removeRes.ok).toBe(true);
      expect(removeRes.removedCount).toBe(1);
      expect(manifest.motions).toHaveLength(1);
    } finally {
      cleanup();
    }
  });
});
