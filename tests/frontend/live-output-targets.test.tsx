// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_LIVE_AUX_COMPOSITION, liveRoomClientMessageSchema } from "../../assets/shared/schemas/live-session-room";
import { defaultLiveTimerGraphic } from "../../assets/shared/schemas/live-session-timer";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import { OutputTargetControl } from "../../assets/ts/member-flows/portal/sections/events/detail/live/OutputTargetControl";
import { liveAuxToggle } from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-output-targets";
import { livePreviewDifferences } from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-stage-preview";
import { liveSnapshot } from "./helpers/live-room-socket";

let host: HTMLElement | undefined;
afterEach(() => {
  if (!host) return;
  void act(() => render(null, host!));
  host.remove();
  host = undefined;
});

function roomState() {
  const state = applyLiveRoomMessage(null, liveSnapshot());
  if (!state) throw new Error("Missing fixture");
  return state;
}

describe("output target control", () => {
  it("presses each bus that shows the graphic and toggles Preview and Program, with no screens button", () => {
    const onToggle = vi.fn();
    host = document.body.appendChild(document.createElement("div"));
    void act(() =>
      render(
        <OutputTargetControl subject="timer" preview program={false} disabled={false} onToggle={onToggle} />,
        host!,
      ),
    );
    const preview = host.querySelector<HTMLButtonElement>('[aria-label="Show timer in preview"]')!;
    const program = host.querySelector<HTMLButtonElement>('[aria-label="Show timer on air"]')!;
    expect([preview.textContent, preview.getAttribute("aria-pressed")]).toEqual(["PVW", "true"]);
    expect([program.textContent, program.getAttribute("aria-pressed")]).toEqual(["PGM", "false"]);
    // The room's screens are in the row's menu, so the control is two buttons wide.
    expect(host.querySelectorAll("button")).toHaveLength(2);
    void act(() => program.click());
    expect(onToggle.mock.calls).toEqual([["program"]]);
  });
});

describe("output compositions", () => {
  it("counts each graphic a Take would change", () => {
    const state = roomState();
    const credit = state.session.credits[0]!;
    expect(livePreviewDifferences(state.stage, state.stage)).toBe(0);
    expect(
      livePreviewDifferences(
        {
          ...state.stage,
          lowerThird: credit,
          panelists: { layout: "panel" },
          timerGraphics: [defaultLiveTimerGraphic("session")],
        },
        state.stage,
      ),
    ).toBe(3);
  });

  it("toggles one graphic on an aux output and keeps the rest of its composition", () => {
    const state = roomState();
    const credit = state.session.credits[0]!;
    state.outputs = { ...state.outputs, projector: { ...EMPTY_LIVE_AUX_COMPOSITION, lowerThird: credit } };
    const graphic = defaultLiveTimerGraphic("session");
    expect(
      liveRoomClientMessageSchema.parse(liveAuxToggle(state, "projector", { kind: "timer", graphic })),
    ).toMatchObject({
      type: "aux.set",
      output: "projector",
      composition: { creditKey: credit.key, timerGraphics: [graphic] },
    });
    expect(
      liveRoomClientMessageSchema.parse(liveAuxToggle(state, "projector", { kind: "lowerThird", key: credit.key })),
    ).toMatchObject({ composition: { creditKey: null, timerGraphics: [] } });
  });
});
