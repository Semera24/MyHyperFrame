// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DomEditRotateHandle } from "./DomEditRotateHandle";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function renderInto(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return { host, root };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("DomEditRotateHandle", () => {
  const defaultOverlayRect = {
    left: 100,
    top: 100,
    width: 200,
    height: 100,
    angle: 0,
    editScaleX: 1,
    editScaleY: 1,
  };

  it("renders rotate handle and numeric angle input", () => {
    const onStartRotate = vi.fn();
    const onCommitRotation = vi.fn();

    const { host, root } = renderInto(
      <DomEditRotateHandle
        overlayRect={defaultOverlayRect}
        onStartRotate={onStartRotate}
        onCommitRotation={onCommitRotation}
      />,
    );

    const button = host.querySelector('button[aria-label="Rotate selection"]');
    expect(button).not.toBeNull();
    const input = host.querySelector(
      'input[data-testid="canvas-rotation-input"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("0°");
    act(() => root.unmount());
  });

  it("updates input when overlayRect angle changes", () => {
    const onStartRotate = vi.fn();
    const onCommitRotation = vi.fn();

    const { host, root } = renderInto(
      <DomEditRotateHandle
        overlayRect={{ ...defaultOverlayRect, angle: 45 }}
        onStartRotate={onStartRotate}
        onCommitRotation={onCommitRotation}
      />,
    );

    const input = host.querySelector(
      'input[data-testid="canvas-rotation-input"]',
    ) as HTMLInputElement;
    expect(input.value).toBe("45°");
    act(() => root.unmount());
  });

  it("commits exact angle when typed and Enter is pressed", () => {
    const onStartRotate = vi.fn();
    const onCommitRotation = vi.fn();

    const { host, root } = renderInto(
      <DomEditRotateHandle
        overlayRect={defaultOverlayRect}
        onStartRotate={onStartRotate}
        onCommitRotation={onCommitRotation}
      />,
    );

    const input = host.querySelector(
      'input[data-testid="canvas-rotation-input"]',
    ) as HTMLInputElement;
    act(() => {
      input.focus();
      setInputValue(input, "180");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onCommitRotation).toHaveBeenCalledWith(180);
    act(() => root.unmount());
  });

  it("commits exact 0 when typed and blurred", () => {
    const onStartRotate = vi.fn();
    const onCommitRotation = vi.fn();

    const { host, root } = renderInto(
      <DomEditRotateHandle
        overlayRect={{ ...defaultOverlayRect, angle: 37.5 }}
        onStartRotate={onStartRotate}
        onCommitRotation={onCommitRotation}
      />,
    );

    const input = host.querySelector(
      'input[data-testid="canvas-rotation-input"]',
    ) as HTMLInputElement;
    act(() => {
      input.focus();
      setInputValue(input, "0");
      input.dispatchEvent(new Event("focusout", { bubbles: true }));
      input.dispatchEvent(new Event("blur"));
    });

    expect(onCommitRotation).toHaveBeenCalledWith(0);
    act(() => root.unmount());
  });
});
