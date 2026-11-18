// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { LIVE_OVERLAY_STANDARD_ELEMENTS } from "../../assets/shared/live-overlay-layout-presets";
import { EMPTY_LIVE_STAGE } from "../../assets/shared/schemas/live-session-room";
import { LiveOverlayPresentation } from "../../assets/ts/live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../../assets/ts/live-session/live-room-state";
import { liveSnapshot } from "./helpers/live-room-socket";

const hosts: HTMLElement[] = [];

function room(): LiveRoomState {
  const { type: _type, ...snapshot } = liveSnapshot({ stage: EMPTY_LIVE_STAGE });
  return { ...snapshot, burst: null, refusal: null };
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

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

describe("a graphic on the conference field", () => {
  it("draws the field in the graphic's box while the scene shows it, with or without content", () => {
    expect(fields(draw({ view: "program", layout: "questions", projection: room() })).length).toBeGreaterThan(0);
  });

  it("draws no field for a graphic without one, nor on the stage display", () => {
    expect(fields(draw({ view: "program", elements: LIVE_OVERLAY_STANDARD_ELEMENTS, projection: room() })).length).toBe(
      0,
    );
    expect(fields(draw({ view: "stage-display", layout: "questions", projection: room() })).length).toBe(0);
  });
});
