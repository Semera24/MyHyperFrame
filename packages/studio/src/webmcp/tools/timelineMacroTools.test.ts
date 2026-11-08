import { describe, expect, it, vi } from "vitest";
import {
  studioGenerateCaptions,
  studioSplitClip,
  studioRemoveSilence,
  studioInsertBroll,
  type TimelineMacroToolDeps,
} from "./timelineMacroTools";

function makeMockDeps(overrides: Partial<TimelineMacroToolDeps> = {}): TimelineMacroToolDeps {
  return {
    getProjectId: () => "EP06_Test",
    getCurrentTime: () => 2.5,
    reloadPreview: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  };
}

describe("timelineMacroTools", () => {
  describe("studioGenerateCaptions", () => {
    it("fails with blocked when no project is loaded", async () => {
      const deps = makeMockDeps({ getProjectId: () => null });
      const result = await studioGenerateCaptions(deps, { stylePreset: "hormozi" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("blocked");
      }
    });

    it("succeeds when backend returns caption file", async () => {
      const deps = makeMockDeps();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          captionFile: "compositions/captions.html",
          wordCount: 15,
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await studioGenerateCaptions(deps, { stylePreset: "hormozi" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.preset).toBe("hormozi");
        expect(result.captionFile).toBe("compositions/captions.html");
      }
      expect(deps.reloadPreview).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });
  });

  describe("studioSplitClip", () => {
    it("fails with blocked when no project is loaded", async () => {
      const deps = makeMockDeps({ getProjectId: () => null });
      const result = await studioSplitClip(deps, { time: 5.0 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("blocked");
      }
    });

    it("calls backend split endpoint and returns clip ids", async () => {
      const deps = makeMockDeps();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          splitTime: 5.0,
          originalClipId: "s01",
          newClipId: "s01_split",
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await studioSplitClip(deps, { time: 5.0 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.splitTime).toBe(5.0);
        expect(result.originalClipId).toBe("s01");
        expect(result.newClipId).toBe("s01_split");
      }
      expect(deps.reloadPreview).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });
  });

  describe("studioRemoveSilence", () => {
    it("calls backend remove-silence endpoint", async () => {
      const deps = makeMockDeps();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          gapsRemoved: 2,
          timeSavedSeconds: 1.4,
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await studioRemoveSilence(deps, { minPauseSeconds: 0.5 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.gapsRemoved).toBe(2);
        expect(result.timeSavedSeconds).toBe(1.4);
      }
      expect(deps.reloadPreview).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });
  });

  describe("studioInsertBroll", () => {
    it("calls backend insert-broll endpoint", async () => {
      const deps = makeMockDeps();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          layerId: "broll_map",
          startTime: 4.0,
          duration: 3.5,
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await studioInsertBroll(deps, {
        src: "assets/map.png",
        startTime: 4.0,
        duration: 3.5,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.layerId).toBe("broll_map");
        expect(result.startTime).toBe(4.0);
        expect(result.duration).toBe(3.5);
      }
      expect(deps.reloadPreview).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });
  });
});
