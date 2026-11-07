// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MotionInspector } from "./MotionInspector";
import { useStudioMotionStore } from "../editor/useStudioMotionStore";

vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({
    projectId: "EP_TEST",
    activeCompPath: "index.html",
    previewIframeRef: { current: null },
    showToast: vi.fn(),
  }),
}));

vi.mock("../../contexts/FileManagerContext", () => ({
  useFileManagerContext: () => ({
    readOptionalProjectFile: vi.fn().mockResolvedValue(null),
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../player", () => ({
  usePlayerStore: (selector: (s: any) => any) =>
    selector({
      currentTime: 1.0,
      requestSeek: vi.fn(),
    }),
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  container = null;
  root = null;
});

describe("MotionInspector", () => {
  it("renders placeholder when no motion is selected", () => {
    useStudioMotionStore.setState({
      manifest: { version: 1, motions: [] },
      selectedMotionId: null,
    });

    act(() => {
      root?.render(<MotionInspector />);
    });

    expect(container?.textContent).toContain("No Motion Selected");
  });

  it("renders controls when a motion is selected", () => {
    useStudioMotionStore.setState({
      manifest: {
        version: 1,
        motions: [
          {
            id: "m-123",
            kind: "gsap-motion",
            category: "entrance",
            presetId: "entrance-rise-up",
            name: "Rise Up",
            target: { sourceFile: "index.html", id: "hero-card" },
            start: 0.5,
            duration: 0.8,
            delay: 0,
            direction: "up",
            distance: 60,
            ease: "power2.out",
            from: { y: 60, opacity: 0 },
            to: { y: 0, opacity: 1 },
          },
        ],
      },
      selectedMotionId: "m-123",
      activeStylePreset: "documentary",
    });

    act(() => {
      root?.render(<MotionInspector />);
    });

    expect(container?.textContent).toContain("Rise Up");
    expect(container?.textContent).toContain("Target: #hero-card");
    expect(container?.textContent).toContain("Timing & Duration");
    expect(container?.textContent).toContain("Spatial & Visual Transform");
    expect(container?.textContent).toContain("Easing Curve");
    expect(container?.textContent).toContain("Duplicate");
    expect(container?.textContent).toContain("Remove");
  });
});
