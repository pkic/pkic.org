import { describe, expect, it } from "vitest";
import { measurePopupPosition } from "../../assets/ts/ui/popup-placement";

const rect = (top: number, left: number, width: number, height: number) =>
  ({ top, left, width, height, bottom: top + height, right: left + width }) as DOMRect;

describe("popup placement", () => {
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
