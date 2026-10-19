import { afterEach, describe, expect, it } from "vitest";
import { trackVisualViewportShift, visualViewportShift } from "../../assets/ts/ui/visual-viewport-shift";

describe("visualViewportShift", () => {
  it("is zero while the visible area fills the layout viewport", () => {
    expect(visualViewportShift(800, { offsetTop: 0, height: 800, scale: 1 }, false)).toEqual({ top: 0, bottom: 0 });
  });

  it("moves top chrome down and bottom chrome to the visible edge when the visible area is left offset", () => {
    // Mobile Safari after its toolbar collapses: the visible area starts 72px down and runs 64px past the layout bottom.
    expect(visualViewportShift(736, { offsetTop: 72, height: 728, scale: 1 }, false)).toEqual({ top: 72, bottom: -64 });
  });

  it("leaves the browser's own placement while the reader types or zooms", () => {
    expect(visualViewportShift(800, { offsetTop: 120, height: 400, scale: 1 }, true)).toEqual({ top: 0, bottom: 0 });
    expect(visualViewportShift(800, { offsetTop: 120, height: 400, scale: 2 }, false)).toEqual({ top: 0, bottom: 0 });
    expect(visualViewportShift(800, null, false)).toEqual({ top: 0, bottom: 0 });
  });
});

describe("trackVisualViewportShift", () => {
  let stop: (() => void) | undefined;
  afterEach(() => stop?.());

  it("publishes the shift on the root element and clears it when stopped", () => {
    const root = document.documentElement;
    stop = trackVisualViewportShift(window);
    expect(root.style.getPropertyValue("--pk-viewport-shift-top")).toBe("0px");
    expect(root.style.getPropertyValue("--pk-viewport-shift-bottom")).toMatch(/^-?\d+px$/);
    stop();
    stop = undefined;
    expect(root.style.getPropertyValue("--pk-viewport-shift-top")).toBe("");
    expect(root.style.getPropertyValue("--pk-viewport-shift-bottom")).toBe("");
  });
});
