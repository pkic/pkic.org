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
});
