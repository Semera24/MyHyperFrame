import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import {
  MOTION_PRESET_CATALOG,
  compileMotionPreset,
  reversePathWaypoints,
} from "./motionPresetCatalog";
import {
  addStudioGsapMotion,
  applyStudioMotionManifest,
  duplicateStudioGsapMotionById,
  emptyStudioMotionManifest,
  removeStudioGsapMotionById,
  reorderStudioGsapMotionById,
  updateStudioGsapMotionById,
} from "./studioMotion";
import { detectStudioMotionConflict, getMotionsForTarget } from "./useStudioMotionStore";

describe("Motion Preset Catalog & Multi-Motion Operations", () => {
  it("contains all 48 presets across entrance, emphasis, exit, path, and transition categories", () => {
    expect(MOTION_PRESET_CATALOG.length).toBe(48);

    const categories = {
      entrance: MOTION_PRESET_CATALOG.filter((p) => p.category === "entrance").length,
      emphasis: MOTION_PRESET_CATALOG.filter((p) => p.category === "emphasis").length,
      exit: MOTION_PRESET_CATALOG.filter((p) => p.category === "exit").length,
      path: MOTION_PRESET_CATALOG.filter((p) => p.category === "path").length,
      transition: MOTION_PRESET_CATALOG.filter((p) => p.category === "transition").length,
    };

    expect(categories).toEqual({
      entrance: 15,
      emphasis: 9,
      exit: 11,
      path: 5,
      transition: 8,
    });
  });

  it("compiles every preset across subtle, documentary, and energetic profiles", () => {
    for (const preset of MOTION_PRESET_CATALOG) {
      for (const stylePreset of ["subtle", "documentary", "energetic"] as const) {
        const compiled = compileMotionPreset(preset.id, {
          start: 1.0,
          stylePreset,
        });
        expect(compiled.presetId).toBe(preset.id);
        expect(compiled.category).toBe(preset.category);
        expect(compiled.start).toBe(1.0);
        expect(compiled.duration).toBeGreaterThan(0);
      }
    }
  });

  it("supports adding, updating, duplicating, reordering, and removing multiple ordered motions on one object", () => {
    const target = {
      sourceFile: "compositions/s01.html",
      id: "hero-card",
      selector: "#hero-card",
    };
    let manifest = emptyStudioMotionManifest();

    const entrance = compileMotionPreset("entrance-rise-up", { start: 0.5, duration: 0.8 });
    const emphasis = compileMotionPreset("emphasis-pulse", { start: 2.0, duration: 0.7 });
    const exit = compileMotionPreset("exit-fade-out", { start: 4.0, duration: 0.6 });

    manifest = addStudioGsapMotion(manifest, target, entrance);
    manifest = addStudioGsapMotion(manifest, target, emphasis);
    manifest = addStudioGsapMotion(manifest, target, exit);

    let list = getMotionsForTarget(manifest, target);
    expect(list).toHaveLength(3);
    expect(list.map((m) => m.presetId)).toEqual([
      "entrance-rise-up",
      "emphasis-pulse",
      "exit-fade-out",
    ]);

    // Update second motion
    const empId = list[1]!.id!;
    manifest = updateStudioGsapMotionById(manifest, empId, {
      start: 2.25,
      duration: 0.9,
    });
    list = getMotionsForTarget(manifest, target);
    expect(list[1]!.start).toBe(2.25);
    expect(list[1]!.duration).toBe(0.9);

    // Duplicate second motion
    const dupRes = duplicateStudioGsapMotionById(manifest, empId);
    manifest = dupRes.manifest;
    list = getMotionsForTarget(manifest, target);
    expect(list).toHaveLength(4);

    // Reorder first motion down
    const firstId = list[0]!.id!;
    manifest = reorderStudioGsapMotionById(manifest, firstId, "down");
    list = getMotionsForTarget(manifest, target);
    expect(list[1]!.id).toBe(firstId);

    // Remove duplicated motion
    manifest = removeStudioGsapMotionById(manifest, dupRes.duplicatedId!);
    list = getMotionsForTarget(manifest, target);
    expect(list).toHaveLength(3);
  });

  it("reverses custom motion path waypoints accurately", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 120, y: -60 },
      { x: 240, y: 20 },
    ];
    const rev = reversePathWaypoints(pts);
    expect(rev).toEqual([
      { x: 240, y: 20 },
      { x: 120, y: -60 },
      { x: 0, y: 0 },
    ]);
  });

  it("evaluates forward and backward seeks identically for multi-motion objects", () => {
    const win = new Window();
    win.document.body.innerHTML = `<div id="card" style="opacity: 1; transform: none;">Hello</div>`;
    const doc = win.document as unknown as Document;
    const el = doc.getElementById("card")!;

    const target = { sourceFile: "index.html", id: "card", selector: "#card" };
    let manifest = emptyStudioMotionManifest();
    manifest = addStudioGsapMotion(
      manifest,
      target,
      compileMotionPreset("entrance-rise-up", { start: 1.0, duration: 1.0 }),
    );
    manifest = addStudioGsapMotion(
      manifest,
      target,
      compileMotionPreset("emphasis-pulse", { start: 3.0, duration: 1.0 }),
    );
    manifest = addStudioGsapMotion(
      manifest,
      target,
      compileMotionPreset("exit-fade-out", { start: 5.0, duration: 1.0 }),
    );

    // Forward seek sequence: 0 -> 1.5 -> 3.5 -> 5.5
    applyStudioMotionManifest(doc, manifest, null, 0);
    applyStudioMotionManifest(doc, manifest, null, 1.5);
    const forwardAt1_5 = {
      opacity: el.style.opacity,
      transform: el.style.transform,
      visibility: el.style.visibility,
    };

    applyStudioMotionManifest(doc, manifest, null, 3.5);
    const forwardAt3_5 = {
      opacity: el.style.opacity,
      transform: el.style.transform,
    };

    // Seek past end to 7.0s, then seek backward to 3.5s and 1.5s
    applyStudioMotionManifest(doc, manifest, null, 7.0);
    applyStudioMotionManifest(doc, manifest, null, 3.5);
    const backwardAt3_5 = {
      opacity: el.style.opacity,
      transform: el.style.transform,
    };
    expect(backwardAt3_5).toEqual(forwardAt3_5);

    applyStudioMotionManifest(doc, manifest, null, 1.5);
    const backwardAt1_5 = {
      opacity: el.style.opacity,
      transform: el.style.transform,
      visibility: el.style.visibility,
    };
    expect(backwardAt1_5).toEqual(forwardAt1_5);
  });

  it("detects conflicts with hand-authored GSAP scripts and overlapping motions", () => {
    const win = new Window();
    win.document.body.innerHTML = `
      <div id="s01-headline-card">Headline</div>
      <script>
        gsap.fromTo("#s01-headline-card", { opacity: 0 }, { opacity: 1, duration: 1 });
      </script>
    `;
    const doc = win.document as unknown as Document;
    const manifest = emptyStudioMotionManifest();
    const target = {
      sourceFile: "index.html",
      id: "s01-headline-card",
      selector: "#s01-headline-card",
    };
    const incoming = compileMotionPreset("entrance-fade-in", { start: 0.2, duration: 0.8 });

    const conflict = detectStudioMotionConflict(manifest, target, incoming, doc);
    expect(conflict).not.toBeNull();
    expect(conflict!.hasHandAuthoredGsap).toBe(true);
    expect(conflict!.reason).toContain("Hand-authored GSAP");
  });
});
