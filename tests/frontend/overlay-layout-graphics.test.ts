import { describe, expect, it, vi } from "vitest";
import { liveOverlayDrawn } from "../../assets/shared/live-overlay-cover";
import { LIVE_OVERLAY_PRESET_LAYOUTS } from "../../assets/shared/live-overlay-layout-presets";
import { LIVE_OVERLAY_ELEMENTS, LIVE_OVERLAY_ELEMENT_SWITCHES } from "../../assets/shared/schemas/live-overlay-layout";
import { describeGraphicSwitch } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-copy";
import { graphicActions } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-graphic-actions";
import { describeGraphicPosition } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-graphics";
import {
  sampleOverlayRoom,
  withSampleGraphic,
} from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-sample";

describe("where a graphic sits, in words", () => {
  const at = (x: number, y: number, w: number, h: number) => describeGraphicPosition({ x, y, w, h });
  it("names bars, columns, halves and corners from the box", () => {
    expect(at(0, 0.88, 1, 0.12)).toBe("Bottom bar");
    expect(at(0, 0, 1, 0.1)).toBe("Top bar");
    expect(at(0.6, 0, 0.4, 1)).toBe("Right column");
    expect(at(0, 0, 0.4, 1)).toBe("Left column");
    expect(at(0, 0.5, 1, 0.5)).toBe("Bottom half");
    expect(at(0, 0, 1, 1)).toBe("Full frame");
    expect(at(0.025, 0.67, 0.65, 0.28)).toBe("Bottom left");
    expect(at(0.8, 0.04, 0.175, 0.11)).toBe("Top right");
    expect(at(0.725, 0.2, 0.25, 0.6)).toBe("Middle right");
    expect(at(0.4, 0.4, 0.2, 0.2)).toBe("Center");
  });
});

describe("what puts a graphic on, in words", () => {
  const NO_CHOICE = { pick: "On when you pick one in the studio", scene: "On whenever this scene is on" };
  it("reads the scene's choice for a graphic that fills itself from the room, and one fixed line for any other", () => {
    for (const element of LIVE_OVERLAY_ELEMENTS) {
      const by = LIVE_OVERLAY_ELEMENT_SWITCHES[element];
      const [on, off, unset] = [{ comesOn: true }, { comesOn: false }, {}].map((placement) =>
        describeGraphicSwitch(element, placement),
      );
      expect(on).toBe(by === "room" ? "Comes on with the scene" : NO_CHOICE[by]);
      expect(off).toBe(by === "room" ? "Switched in the studio" : NO_CHOICE[by]);
      expect(unset).toBe(off);
    }
  });
});

describe("a graphic's menu", () => {
  const elements = LIVE_OVERLAY_PRESET_LAYOUTS.default.elements;
  const handlers = { onShow: vi.fn(), onSharing: vi.fn(), onTurns: vi.fn(), onQrLook: vi.fn() };
  it("offers the QR code's looks, the card checked until another is picked, and none for other graphics", () => {
    const looks = (qrLook?: "white-on-black") =>
      graphicActions({ ...elements, qrCode: { ...elements.qrCode, qrLook } }, "qrCode", false, handlers).filter(
        (item) => item.id.startsWith("look-"),
      );
    expect(looks().map((item) => [item.label, item.checked])).toEqual([
      ["Card", true],
      ["Black on white", false],
      ["White on black", false],
      ["Black, no background", false],
    ]);
    expect(looks("white-on-black").find((item) => item.checked)?.label).toBe("White on black");
    looks()[3]!.onSelect!();
    expect(handlers.onQrLook).toHaveBeenCalledWith("black-on-clear");
    expect(graphicActions(elements, "lowerThird", false, handlers).some((item) => item.id.startsWith("look-"))).toBe(
      false,
    );
  });
});

describe("sample content for a graphic that is off", () => {
  it("fills only the picked graphic from the sample, so the others stay as the room has them", () => {
    const now = Date.parse("2026-11-27T10:00:00.000Z");
    const empty = {
      ...sampleOverlayRoom(now),
      stage: { ...sampleOverlayRoom(now).stage, timerGraphics: [], poll: null },
    };
    const timer = withSampleGraphic(empty, "timer", now);
    expect(liveOverlayDrawn(timer.stage, "timer")).toBe(true);
    expect(liveOverlayDrawn(timer.stage, "poll")).toBe(false);
    expect(withSampleGraphic(empty, "qrCode", now)).toBe(empty);
  });
});
