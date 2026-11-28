import { describe, expect, it, vi } from "vitest";
import { LIVE_FIELD_THEMES, LIVE_FIELD_THEME_DEFAULT } from "../../assets/shared/live-graphic-theme";
import { liveOverlayDrawn } from "../../assets/shared/live-overlay-cover";
import { LIVE_OVERLAY_PRESET_LAYOUTS } from "../../assets/shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_ELEMENTS,
  LIVE_OVERLAY_ELEMENT_SWITCHES,
  LIVE_QR_LOOKS,
} from "../../assets/shared/schemas/live-overlay-layout";
import { LIVE_TIMER_PRESENTATIONS } from "../../assets/shared/schemas/live-session-timer";
import { describeGraphicSwitch } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-copy";
import {
  graphicActions,
  graphicLookChange,
  graphicLookElement,
} from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-graphic-actions";
import { describeGraphicPosition } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-graphics";
import { layoutElementsChanged } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-sharing";
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
  const handlers = { onShow: vi.fn(), onSharing: vi.fn(), onTurns: vi.fn(), onLook: vi.fn() };
  it("offers the QR code's looks, the card checked until another is picked, and none for other graphics", () => {
    const looks = (qrLook?: "white-on-black") =>
      graphicActions({ ...elements, qrCode: { ...elements.qrCode, qrLook } }, "qrCode", false, handlers).filter(
        (item) => item.id.startsWith("look-"),
      );
    const checked = (qrLook?: "white-on-black") =>
      looks(qrLook)
        .filter((item) => item.checked)
        .map((item) => item.id);
    expect(
      looks()
        .map((item) => item.id)
        .sort(),
    ).toEqual(LIVE_QR_LOOKS.map((look) => `look-${look}`).sort());
    expect(checked()).toEqual(["look-card"]);
    expect(checked("white-on-black")).toEqual(["look-white-on-black"]);
    looks().find((item) => item.id === "look-black-on-clear")!.onSelect!();
    expect(handlers.onLook).toHaveBeenCalledWith({ qrLook: "black-on-clear" });
    expect(graphicActions(elements, "lowerThird", false, handlers).some((item) => item.id.startsWith("look-"))).toBe(
      false,
    );
  });

  it("offers the timers' looks on Auto until the scene picks one, and Auto puts back each timer's own", () => {
    const looks = (timerLook?: "ring") =>
      graphicActions({ ...elements, timer: { ...elements.timer, timerLook } }, "timer", false, handlers).filter(
        (item) => item.id.startsWith("look-"),
      );
    const checked = (timerLook?: "ring") =>
      looks(timerLook)
        .filter((item) => item.checked)
        .map((item) => item.id);
    expect(
      looks()
        .map((item) => item.id)
        .sort(),
    ).toEqual(["auto", ...LIVE_TIMER_PRESENTATIONS].map((look) => `look-${look}`).sort());
    expect(checked()).toEqual(["look-auto"]);
    expect(checked("ring")).toEqual(["look-ring"]);
    looks("ring").find((item) => item.id === "look-tab")!.onSelect!();
    expect(handlers.onLook).toHaveBeenCalledWith({ timerLook: "tab" });
    looks("ring").find((item) => item.id === "look-auto")!.onSelect!();
    expect(handlers.onLook).toHaveBeenLastCalledWith({ timerLook: undefined });
  });

  it("offers the background's colors on navy glass until the scene picks one, and navy glass clears the choice", () => {
    const looks = (fieldTheme?: "event") =>
      graphicActions(
        { ...elements, background: { ...elements.background, fieldTheme } },
        "background",
        false,
        handlers,
      ).filter((item) => item.id.startsWith("look-"));
    const checked = (fieldTheme?: "event") =>
      looks(fieldTheme)
        .filter((item) => item.checked)
        .map((item) => item.id);
    expect(
      looks()
        .map((item) => item.id)
        .sort(),
    ).toEqual(LIVE_FIELD_THEMES.map((theme) => `look-${theme}`).sort());
    expect(checked()).toEqual([`look-${LIVE_FIELD_THEME_DEFAULT}`]);
    expect(checked("event")).toEqual(["look-event"]);
    looks().find((item) => item.id === "look-event")!.onSelect!();
    expect(handlers.onLook).toHaveBeenLastCalledWith({ fieldTheme: "event" });
    looks("event").find((item) => item.id === `look-${LIVE_FIELD_THEME_DEFAULT}`)!.onSelect!();
    expect(handlers.onLook).toHaveBeenLastCalledWith({ fieldTheme: undefined });
  });

  it("lets the background wait for a board, and Always clears the choice", () => {
    const shows = (withBoardOnly?: true) =>
      graphicActions(
        { ...elements, background: { ...elements.background, withBoardOnly } },
        "background",
        false,
        handlers,
      ).filter((item) => item.id.startsWith("shows-"));
    expect(shows().map((item) => [item.label, item.checked])).toEqual([
      ["Always", true],
      ["Under the board on air", false],
    ]);
    expect(shows(true).find((item) => item.checked)!.label).toBe("Under the board on air");
    expect(shows()[0]!.separatorBefore).toBe(true);
    shows()[1]!.onSelect!();
    expect(handlers.onLook).toHaveBeenLastCalledWith({ withBoardOnly: true });
    shows(true)[0]!.onSelect!();
    expect(handlers.onLook).toHaveBeenLastCalledWith({ withBoardOnly: undefined });
    expect(graphicLookElement({ withBoardOnly: true })).toBe("background");
  });

  it("offers a board's text size at Standard until the scene picks one, and Standard follows the box again", () => {
    const sizes = (textSize?: number) =>
      graphicActions({ ...elements, question: { ...elements.question, textSize } }, "question", false, handlers).find(
        (item) => item.id === "text-size",
      )!;
    expect(sizes().description).toBe("Standard");
    expect(sizes().children!.map((item) => item.label)).toEqual(["80%", "90%", "Standard", "115%", "130%", "150%"]);
    expect(sizes(1.3).description).toBe("130%");
    expect(sizes(1.3).children!.find((item) => item.checked)!.label).toBe("130%");
    sizes().children!.find((item) => item.label === "150%")!.onSelect!();
    expect(handlers.onLook).toHaveBeenLastCalledWith({ element: "question", textSize: 1.5 });
    sizes(1.5).children!.find((item) => item.label === "Standard")!.onSelect!();
    expect(handlers.onLook).toHaveBeenLastCalledWith({ element: "question", textSize: undefined });
    expect(graphicLookElement({ element: "poll", textSize: 1.15 })).toBe("poll");
    expect(graphicLookChange({ element: "poll", textSize: 1.15 })).toEqual({ textSize: 1.15 });
    // Graphics that are not boards size their text with their box alone.
    expect(graphicActions(elements, "lowerThird", false, handlers).some((item) => item.id === "text-size")).toBe(false);
  });

  it("offers Up next's speakers as a list or one at a time, the list checked until the other is picked", () => {
    const looks = (speakersLook?: "turns") =>
      graphicActions(
        { ...elements, schedule: { ...elements.schedule, speakersLook } },
        "schedule",
        false,
        handlers,
      ).filter((item) => item.id.startsWith("look-"));
    expect(looks().map((item) => [item.id, item.checked])).toEqual([
      ["look-list", true],
      ["look-turns", false],
    ]);
    expect(looks("turns").find((item) => item.checked)?.id).toBe("look-turns");
    looks("turns").find((item) => item.id === "look-list")!.onSelect!();
    expect(handlers.onLook).toHaveBeenLastCalledWith({ speakersLook: undefined });
  });

  it("files each look under its own graphic", () => {
    expect(graphicLookElement({ qrLook: "card" })).toBe("qrCode");
    expect(graphicLookElement({ timerLook: undefined })).toBe("timer");
    expect(graphicLookElement({ fieldTheme: "event" })).toBe("background");
    expect(graphicLookElement({ speakersLook: "turns" })).toBe("schedule");
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

  it("keeps the room's people while the panelists are on air, and samples them only when nothing else draws them", () => {
    const now = Date.parse("2026-11-27T10:00:00.000Z");
    const room = sampleOverlayRoom(now);
    const ours = [{ ...room.session.credits[0]!, name: "On air now" }];
    const onAir = { ...room, session: { ...room.session, credits: ours } };
    expect(liveOverlayDrawn(onAir.stage, "panelists")).toBe(true);
    expect(withSampleGraphic(onAir, "speakerWelcome", now).session.credits).toEqual(ours);
    const off = { ...onAir, stage: { ...onAir.stage, panelists: null } };
    expect(withSampleGraphic(off, "speakerWelcome", now).session.credits).toEqual(room.session.credits);
  });
});

describe("what a scene saves for a shared graphic", () => {
  it("counts a new look as the scene's change, and a shared move as the positions' alone", () => {
    const elements = LIVE_OVERLAY_PRESET_LAYOUTS.default.elements;
    const shared = { ...elements, timer: { ...elements.timer, shared: true } };
    expect(layoutElementsChanged(shared, { ...shared, timer: { ...shared.timer, timerLook: "ring" } })).toBe(true);
    const board = { ...elements, poll: { ...elements.poll, shared: true } };
    expect(layoutElementsChanged(board, { ...board, poll: { ...board.poll, textSize: 1.3 } })).toBe(true);
    expect(layoutElementsChanged(shared, { ...shared, timer: { ...shared.timer, x: shared.timer.x + 0.1 } })).toBe(
      false,
    );
  });
});
