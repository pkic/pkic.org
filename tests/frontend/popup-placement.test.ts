import { afterEach, describe, expect, it, vi } from "vitest";
import { measurePopupPosition } from "../../assets/ts/ui/popup-placement";

const rect = (top: number, left: number, width: number, height: number) =>
  ({ top, left, width, height, bottom: top + height, right: left + width }) as DOMRect;

describe("popup placement", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a field visible when a phone keyboard leaves no room for its matches on either side", () => {
    vi.stubGlobal("visualViewport", { offsetTop: 0, offsetLeft: 0, width: 375, height: 400 });
    const position = measurePopupPosition(
      rect(200, 20, 335, 40),
      rect(0, 0, 335, 300),
      "start",
      "bottom",
      undefined,
      true,
    );
    expect(position).toMatchObject({ top: 8, maxHeight: 188 });
    expect(position.top + position.maxHeight!).toBeLessThanOrEqual(200);
  });

  it("caps a popup below a field near the top of a short viewport", () => {
    vi.stubGlobal("visualViewport", { offsetTop: 0, offsetLeft: 0, width: 375, height: 400 });
    expect(
      measurePopupPosition(rect(60, 20, 335, 40), rect(0, 0, 335, 380), "start", "bottom", undefined, true),
    ).toMatchObject({
      top: 104,
      maxHeight: 288,
    });
  });

  it("lets a card overlap a subject too large to sit beside instead of shrinking it", () => {
    vi.stubGlobal("visualViewport", { offsetTop: 0, offsetLeft: 0, width: 375, height: 400 });
    expect(measurePopupPosition(rect(10, 0, 375, 380), rect(0, 0, 300, 160), "start", "top").maxHeight).toBeUndefined();
  });

  it("leaves a popup that fits uncapped", () => {
    expect(measurePopupPosition(rect(400, 300, 32, 32), rect(0, 0, 240, 48)).maxHeight).toBeUndefined();
  });

  it("opens a top-preferring popup above its anchor", () => {
    expect(measurePopupPosition(rect(400, 300, 32, 32), rect(0, 0, 240, 48), "end", "top").top).toBe(348);
  });

  it("drops a top-preferring popup below its anchor without room above", () => {
    expect(measurePopupPosition(rect(20, 300, 32, 32), rect(0, 0, 240, 48), "end", "top").top).toBe(56);
  });

  it("keeps opening a default popup below its anchor", () => {
    expect(measurePopupPosition(rect(400, 300, 32, 32), rect(0, 0, 240, 48)).top).toBe(436);
  });
  it("keeps a left-opening submenu adjacent and aligned to its parent item", () => {
    const position = measurePopupPosition(rect(200, 700, 180, 32), rect(0, 0, 190, 100), "start", "left", {
      gap: 4,
      crossAxis: -4,
    });
    expect(position.left).toBe(506);
    expect(position.top).toBe(196);
    expect(position.minWidth).toBe(0);
  });
  it("flips a left-opening submenu when the viewport has no room on that side", () => {
    const position = measurePopupPosition(rect(200, 10, 180, 32), rect(0, 0, 190, 100), "start", "left", {
      gap: 4,
      crossAxis: -4,
    });
    expect(position.left).toBe(194);
    expect(position.top).toBe(196);
  });
});
