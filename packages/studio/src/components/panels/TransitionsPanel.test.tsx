// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TransitionsPanel } from "./TransitionsPanel";
import { useStudioMotionStore } from "../editor/useStudioMotionStore";

vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({
    projectId: "EP_TEST",
    activeCompPath: "index.html",
    previewIframeRef: {
      current: {
        contentDocument: {
          querySelectorAll: () => [
            {
              id: "s01",
              getAttribute: (name: string) => (name === "data-start" ? "0" : "s01"),
            },
            {
              id: "s02",
              getAttribute: (name: string) => (name === "data-start" ? "3" : "s02"),
            },
            {
              id: "s03",
              getAttribute: (name: string) => (name === "data-start" ? "7.5" : "s03"),
            },
          ],
        },
      },
    },
    showToast: vi.fn(),
  }),
  useStudioPlaybackContext: () => ({
    timelineElements: [],
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
      currentTime: 1.5,
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

describe("TransitionsPanel", () => {
  it("renders the 8 scene transitions with animated cards", () => {
    useStudioMotionStore.setState({
      manifest: { version: 1, motions: [] },
      selectedMotionId: null,
      activeStylePreset: "documentary",
    });

    act(() => {
      root?.render(<TransitionsPanel />);
    });

    expect(container?.textContent).toContain("SCENE TRANSITIONS");
    expect(container?.textContent).toContain("8 Types");
    expect(
      container?.querySelector('[data-testid="transition-card-transition-crossfade"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="transition-card-transition-wipe"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="transition-card-transition-push"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="transition-card-transition-reveal"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="transition-card-transition-split"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="transition-card-transition-zoom"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="transition-card-transition-morph"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('[data-testid="transition-card-transition-cut"]'),
    ).not.toBeNull();
  });

  it("detects episode scene cuts and displays cut selector buttons", () => {
    act(() => {
      root?.render(<TransitionsPanel />);
    });
    expect(container?.querySelector('[data-testid="scene-cut-btn-s02"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="scene-cut-btn-s03"]')).not.toBeNull();
  });
});
