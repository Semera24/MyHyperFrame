import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { createStudioMotionRenderBodyScript } from "./studioMotionRenderScript";

function runScript(window: Window, script: string): void {
  const execute = new Function("window", "document", "HTMLElement", script);
  execute(window, window.document, window.HTMLElement);
}

function installFakeGsap(window: Window): {
  calls: Array<{
    target: HTMLElement;
    from: Record<string, unknown>;
    to: Record<string, unknown>;
    at: number;
  }>;
  timeCalls: number[];
  customEaseCalls: Array<{ id: string; data: string }>;
  killCalls: number;
} {
  const state = {
    calls: [] as Array<{
      target: HTMLElement;
      from: Record<string, unknown>;
      to: Record<string, unknown>;
      at: number;
    }>,
    timeCalls: [] as number[],
    customEaseCalls: [] as Array<{ id: string; data: string }>,
    killCalls: 0,
  };
  const timeline = {
    fromTo(
      target: HTMLElement,
      from: Record<string, unknown>,
      to: Record<string, unknown>,
      at: number,
    ) {
      state.calls.push({ target, from, to, at });
      return timeline;
    },
    time(value: number) {
      state.timeCalls.push(value);
      return timeline;
    },
    pause() {
      return timeline;
    },
    kill() {
      state.killCalls += 1;
    },
    duration() {
      return 2;
    },
  };
  (
    window as unknown as {
      gsap: {
        timeline: () => typeof timeline;
        set: (target: HTMLElement, vars: Record<string, unknown>) => void;
      };
      CustomEase: { create: (id: string, data: string) => void };
      __player?: { getTime: () => number };
    }
  ).gsap = {
    timeline: () => timeline,
    set(target, vars) {
      if (vars.clearProps === "transform,opacity,visibility") {
        target.style.removeProperty("transform");
        target.style.removeProperty("opacity");
        target.style.removeProperty("visibility");
      }
    },
  };
  (
    window as unknown as {
      CustomEase: { create: (id: string, data: string) => void };
    }
  ).CustomEase = {
    create(id, data) {
      state.customEaseCalls.push({ id, data });
    },
  };
  return state;
}

describe("createStudioMotionRenderBodyScript", () => {
  it("returns null for an empty manifest", () => {
    expect(createStudioMotionRenderBodyScript("")).toBeNull();
  });

  it("returns null for a valid manifest without motions", () => {
    expect(createStudioMotionRenderBodyScript(`{"version":1,"motions":[]}`)).toBeNull();
  });

  it("registers Studio-authored GSAP motion into window.__timelines", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div id="card" style="opacity: 0.6"></div>';
    const card = window.document.getElementById("card");
    if (!(card instanceof window.HTMLElement)) throw new Error("card fixture missing");
    const gsapState = installFakeGsap(window);
    (
      window as unknown as {
        __player: { getTime: () => number };
      }
    ).__player = { getTime: () => 0.5 };

    const script = createStudioMotionRenderBodyScript(
      JSON.stringify({
        version: 1,
        motions: [
          {
            kind: "gsap-motion",
            target: { sourceFile: "index.html", id: "card" },
            start: 0.2,
            duration: 0.7,
            ease: "power2.out",
            from: { y: 32, autoAlpha: 0 },
            to: { y: 0, autoAlpha: 1 },
          },
        ],
      }),
    );
    if (!script) throw new Error("script fixture missing");

    runScript(window, script);

    expect(gsapState.calls[0]).toMatchObject({
      target: card,
      from: { y: 32, autoAlpha: 0 },
      to: { y: 0, autoAlpha: 1, duration: 0.7, ease: "power2.out" },
      at: 0.2,
    });
    expect(gsapState.timeCalls).toEqual([0.5]);
    expect(
      (window as unknown as { __timelines?: Record<string, unknown> }).__timelines?.[
        "studio-motion"
      ],
    ).toBeTruthy();
  });

  it("does not mutate when GSAP is unavailable", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div id="card" style="opacity: 0.6"></div>';
    const script = createStudioMotionRenderBodyScript(
      JSON.stringify({
        version: 1,
        motions: [
          {
            kind: "gsap-motion",
            target: { sourceFile: "index.html", id: "card" },
            start: 0,
            duration: 1,
            ease: "none",
            from: { x: 0 },
            to: { x: 10 },
          },
        ],
      }),
    );
    if (!script) throw new Error("script fixture missing");

    runScript(window, script);

    expect(
      (window as unknown as { __timelines?: Record<string, unknown> }).__timelines?.[
        "studio-motion"
      ],
    ).toBeUndefined();
  });

  it("registers CustomEase data before adding Studio motion tweens", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div id="card"></div>';
    const gsapState = installFakeGsap(window);
    const script = createStudioMotionRenderBodyScript(
      JSON.stringify({
        version: 1,
        motions: [
          {
            kind: "gsap-motion",
            target: { sourceFile: "index.html", id: "card" },
            start: 0,
            duration: 1,
            ease: "studio-card-bounce",
            customEase: {
              id: "studio-card-bounce",
              data: "M0,0 C0.18,0.9 0.32,1 1,1",
            },
            from: { y: 32 },
            to: { y: 0 },
          },
        ],
      }),
    );
    if (!script) throw new Error("script fixture missing");

    runScript(window, script);

    expect(gsapState.customEaseCalls).toEqual([
      { id: "studio-card-bounce", data: "M0,0 C0.18,0.9 0.32,1 1,1" },
    ]);
    expect(gsapState.calls[0]?.to.ease).toBe("studio-card-bounce");
  });

  it("simultaneously evaluates and blends two scenes during a crossfade transition without dipping to black", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div id="s01" data-start="0" data-duration="3.0"></div>
      <div id="s02" data-start="3.0" data-duration="3.0"></div>
    `;
    installFakeGsap(window);
    const script = createStudioMotionRenderBodyScript(
      JSON.stringify({
        version: 1,
        motions: [
          {
            id: "transition-crossfade-s01-s02",
            kind: "gsap-motion",
            category: "transition",
            target: { sourceFile: "index.html", id: "s02" },
            start: 2.6,
            duration: 0.8,
            ease: "sine.inOut",
            from: { opacity: 0 },
            to: { opacity: 1 },
            transition: {
              fromSceneId: "s01",
              toSceneId: "s02",
              cutTime: 3.0,
              type: "crossfade",
            },
          },
        ],
      }),
    );
    if (!script) throw new Error("script fixture missing");

    runScript(window, script);

    const s01 = window.document.getElementById("s01")!;
    const s02 = window.document.getElementById("s02")!;
    const apply = (window as unknown as { __hfStudioMotionApply: (time: number) => void })
      .__hfStudioMotionApply;

    // 1. At start of transition (2.60s): Scene 1 is dominant, Scene 2 is at 0
    apply(2.6);
    expect(parseFloat(s01.style.opacity)).toBeCloseTo(1.0, 1);
    expect(parseFloat(s02.style.opacity)).toBeCloseTo(0.0, 1);

    // 2. Exactly at cut (3.00s): Both scenes are visible and rendered at 50% opacity simultaneously
    apply(3.0);
    expect(s01.style.visibility).toBe("visible");
    expect(s02.style.visibility).toBe("visible");
    expect(parseFloat(s01.style.opacity)).toBeCloseTo(0.5, 1);
    expect(parseFloat(s02.style.opacity)).toBeCloseTo(0.5, 1);

    // 3. At end of transition (3.40s): Scene 1 has faded to 0, Scene 2 is at 1.0
    apply(3.4);
    expect(parseFloat(s01.style.opacity)).toBeCloseTo(0.0, 1);
    expect(parseFloat(s02.style.opacity)).toBeCloseTo(1.0, 1);
  });
});
