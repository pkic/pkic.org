// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { LIVE_OVERLAY_STANDARD_ELEMENTS } from "../../assets/shared/live-overlay-layout-presets";
import { LIVE_OVERLAY_PRESETS } from "../../assets/shared/schemas/live-overlay-layout";
import { EMPTY_LIVE_STAGE, type LiveStage } from "../../assets/shared/schemas/live-session-room";
import { LiveOverlayPresentation } from "../../assets/ts/live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../../assets/ts/live-session/live-room-state";
import { sampleOverlayRoom } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-sample";

const hosts: HTMLElement[] = [];
const SAMPLE = sampleOverlayRoom(Date.parse("2026-11-30T10:00:00.000Z"));

/** The sample room with only the listed graphics on air. */
function room(...on: (keyof LiveStage)[]): LiveRoomState {
  const stage: Record<string, unknown> = { ...EMPTY_LIVE_STAGE };
  for (const key of on) stage[key] = SAMPLE.stage[key];
  return { ...SAMPLE, stage: stage as LiveStage };
}

function draw(props: Parameters<typeof LiveOverlayPresentation>[0]) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => render(<LiveOverlayPresentation {...props} />, host));
  return host;
}

const fields = (host: HTMLElement) =>
  host.querySelectorAll('[data-overlay-element="background"] .pk-live-board--ground');
const layer = (host: HTMLElement, element: string) =>
  host.querySelector<HTMLElement>(`[data-overlay-element="${element}"]`);
const drawn = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("[data-overlay-element]")].map((each) => each.dataset.overlayElement);

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

describe("the conference field on an output", () => {
  it("draws nothing at all for a cleared stage, in every scene", () => {
    for (const layout of LIVE_OVERLAY_PRESETS) {
      const host = draw({ view: "program", layout, projection: room() });
      // A scene's lower third stays mounted, empty, so it can animate in; nothing else is drawn.
      expect(
        drawn(host).filter((element) => element !== "lowerThird"),
        layout,
      ).toEqual([]);
      expect(host.textContent, layout).toBe("");
      expect(host.querySelector("svg, img"), layout).toBeNull();
    }
  });

  it("draws the scene's background only while a board on it is on air", () => {
    // Q&A and Check-in place it in their column, under the question and the check-in code.
    expect(fields(draw({ view: "program", layout: "questions", projection: room("lowerThird") }))).toHaveLength(0);
    const questions = draw({ view: "program", layout: "questions", projection: room("question", "lowerThird") });
    expect(fields(questions)).toHaveLength(1);
    expect(layer(questions, "question")?.hasAttribute("data-on-ground")).toBe(true);
    expect(fields(draw({ view: "program", layout: "check-in", projection: room("checkIn") }))).toHaveLength(1);
    // Default and Talk place no board and no background.
    const plain = draw({ view: "program", layout: "default", projection: room("question", "lowerThird") });
    expect(drawn(plain)).toEqual(["lowerThird"]);
  });

  it("draws one field under the panel's question and panelists, its logo beside the timer", () => {
    const host = draw({ view: "program", layout: "panel", projection: room("question", "panelists", "timerGraphics") });
    expect(fields(host)).toHaveLength(1);
    expect(layer(host, "background")?.hasAttribute("data-logo-covered")).toBe(true);
    expect([...host.querySelectorAll("[data-on-ground]")]).not.toHaveLength(0);
  });

  it("draws Up next alone over the whole frame in Full board, on the field", () => {
    const host = draw({ view: "program", layout: "full-board", projection: room("schedule") });
    expect(drawn(host)).toEqual(["background", "schedule"]);
    expect(layer(host, "schedule")?.hasAttribute("data-on-ground")).toBe(true);
    const surface = layer(host, "schedule")!.querySelector<HTMLElement>(".pk-live-overlay__surface")!;
    expect(surface.style.getPropertyValue("--overlay-scale")).toBe("1");
  });

  it("still draws a field in the box of a graphic an older scene put on it, while it is on air", () => {
    const elements = {
      ...LIVE_OVERLAY_STANDARD_ELEMENTS,
      topQuestions: { ...LIVE_OVERLAY_STANDARD_ELEMENTS.topQuestions, background: true },
    };
    expect(fields(draw({ view: "program", elements, projection: room() }))).toHaveLength(0);
    expect(fields(draw({ view: "program", elements, projection: room("topQuestions") }))).toHaveLength(1);
  });

  it("draws no field on the stage display", () => {
    expect(fields(draw({ view: "stage-display", layout: "questions", projection: room("question") }))).toHaveLength(0);
  });
});
