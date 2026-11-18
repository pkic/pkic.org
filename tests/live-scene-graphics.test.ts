import { describe, expect, it } from "vitest";
import { LIVE_OVERLAY_PRESET_LAYOUTS } from "../assets/shared/live-overlay-layout-presets";
import {
  LIVE_SCENE_BRINGS_ON,
  liveSceneBringsOn,
  liveSceneSource,
  liveSessionHasPanel,
} from "../assets/shared/live-scene-graphics";
import { LIVE_OVERLAY_PRESETS, type LiveOverlayLayoutElements } from "../assets/shared/schemas/live-overlay-layout";

const talk = LIVE_OVERLAY_PRESET_LAYOUTS.talk.elements;
const hidden = (elements: LiveOverlayLayoutElements, element: keyof LiveOverlayLayoutElements) => ({
  ...elements,
  [element]: { ...elements[element], visible: false },
});

describe("the graphics a scene brings on", () => {
  it("puts each built-in scene's own graphics on", () => {
    expect(LIVE_SCENE_BRINGS_ON).toEqual({
      talk: ["lowerThird", "timer", "ticker"],
      questions: ["topQuestions", "ticker", "timer"],
      panel: ["panelists", "ticker", "timer"],
      break: ["timer", "ticker", "schedule"],
      "check-in": ["checkIn", "ticker"],
      "full-board": [],
    });
    expect(liveSceneBringsOn(liveSceneSource([], "questions"))).toEqual(["topQuestions", "ticker", "timer"]);
    expect(liveSceneBringsOn(liveSceneSource([], "check-in"))).toEqual(["checkIn", "ticker"]);
    expect(liveSceneBringsOn(liveSceneSource([], "full-board"))).toEqual([]);
  });

  it("never brings on a graphic the scene does not show", () => {
    for (const preset of LIVE_OVERLAY_PRESETS) {
      const { elements } = LIVE_OVERLAY_PRESET_LAYOUTS[preset];
      for (const graphic of liveSceneBringsOn({ preset, elements })) expect(elements[graphic].visible).toBe(true);
    }
    // An event that saved Talk without its timer gets the name and the ticker only.
    const saved = [{ slug: "talk", name: "Talk", elements: hidden(talk, "timer") }];
    expect(liveSceneBringsOn(liveSceneSource(saved, "talk"))).toEqual(["lowerThird", "ticker"]);
  });

  it("reads the default scene for no scene or one the event does not have", () => {
    expect(liveSceneSource([], null)).toEqual({ preset: "talk", elements: talk });
    expect(liveSceneSource([], "retired-scene").preset).toBe("talk");
  });

  it("brings on only the graphics that never cover the camera for an event's own scene", () => {
    const own = liveSceneSource([{ slug: "keynote", name: "Keynote", elements: talk }], "keynote");
    expect(own.preset).toBeNull();
    expect(liveSceneBringsOn(own)).toEqual(["lowerThird", "timer", "ticker"]);
    expect(liveSceneBringsOn({ ...own, elements: hidden(talk, "lowerThird") })).toEqual(["timer", "ticker"]);
  });

  it("uses the built-in scene's list for an own scene that started from one", () => {
    const own = liveSceneSource(
      [{ slug: "keynote-qa", name: "Keynote Q&A", preset: "questions", elements: talk }],
      "keynote-qa",
    );
    expect(own.preset).toBe("questions");
    expect(liveSceneBringsOn(own)).toEqual(["topQuestions", "ticker", "timer"]);
  });

  it("shows a panel only for a session with more than one speaker", () => {
    expect([0, 1, 2].map(liveSessionHasPanel)).toEqual([false, false, true]);
  });
});
