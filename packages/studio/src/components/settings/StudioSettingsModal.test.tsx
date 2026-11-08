// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioSettingsModal } from "./StudioSettingsModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.localStorage === "undefined" || !globalThis.localStorage?.clear) {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as unknown as Storage;
}

describe("StudioSettingsModal", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("does not render when isOpen is false", () => {
    act(() => {
      root.render(
        <StudioSettingsModal
          isOpen={false}
          onClose={() => {}}
          projectId="EP06_Test"
        />,
      );
    });

    expect(container.querySelector("[data-testid='studio-settings-modal']")).toBeNull();
  });

  it("renders modal with all 4 tab buttons when isOpen is true", () => {
    act(() => {
      root.render(
        <StudioSettingsModal
          isOpen={true}
          onClose={() => {}}
          projectId="EP06_Test"
        />,
      );
    });

    const modal = container.querySelector("[data-testid='studio-settings-modal']");
    expect(modal).not.toBeNull();

    expect(container.querySelector("[data-testid='tab-settings-general']")).not.toBeNull();
    expect(container.querySelector("[data-testid='tab-settings-project']")).not.toBeNull();
    expect(container.querySelector("[data-testid='tab-settings-agent']")).not.toBeNull();
    expect(container.querySelector("[data-testid='tab-settings-shortcuts']")).not.toBeNull();
  });

  it("switches tabs and displays relevant panels", async () => {
    const handleClose = vi.fn();
    act(() => {
      root.render(
        <StudioSettingsModal
          isOpen={true}
          onClose={handleClose}
          projectId="EP06_Test"
        />,
      );
    });

    // Default tab: General
    expect(container.textContent).toContain("Appearance & Workspace Controls");
    expect(container.textContent).toContain("Safe Margin Overlays");

    // Click Project Tab
    const projectTab = container.querySelector("[data-testid='tab-settings-project']") as HTMLButtonElement;
    act(() => {
      projectTab.click();
    });
    expect(container.textContent).toContain("Active Production Episode & Audio Alignment");
    expect(container.textContent).toContain("Narration Audio Probe");

    // Click AI Tab
    const agentTab = container.querySelector("[data-testid='tab-settings-agent']") as HTMLButtonElement;
    act(() => {
      agentTab.click();
    });
    expect(container.textContent).toContain("AI Studio Assistant & Local CLI Configuration");
    expect(container.textContent).toContain("Target Agent Provider");

    // Click Shortcuts Tab
    const shortcutsTab = container.querySelector("[data-testid='tab-settings-shortcuts']") as HTMLButtonElement;
    act(() => {
      shortcutsTab.click();
    });
    expect(container.textContent).toContain("Keyboard Shortcuts & Editing Cheat Sheet");
    expect(container.textContent).toContain("Play / Pause Timeline");

    // Test close button
    const closeBtn = container.querySelector("[data-testid='close-settings-modal']") as HTMLButtonElement;
    act(() => {
      closeBtn.click();
    });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
