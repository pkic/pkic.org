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
  it("presses each bus that shows the graphic, names the aux outputs and toggles each destination", () => {
    const onToggle = vi.fn();
    host = document.body.appendChild(document.createElement("div"));
    const mount = (aux: string[]) =>
      act(() =>
        render(
          <OutputTargetControl
            subject="timer"
            preview
            program={false}
            aux={(output) => aux.includes(output)}
            disabled={false}
            onToggle={onToggle}
          />,
          host!,
        ),
      );
    void mount([]);
    expect(host.querySelector('[aria-label="Show timer in preview"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[aria-label="Show timer on air"]')?.getAttribute("aria-pressed")).toBe("false");
    const aux = () => host!.querySelector<HTMLButtonElement>(`[aria-label="Send timer to the room's screens"]`)!;
    expect(aux().textContent).toContain("Screens");
    void mount(["projector"]);
    expect(aux().textContent).toContain("Projector");
    expect(host.querySelector(".pk-output-target")?.getAttribute("data-aux-active")).toBe("true");
    void mount(["projector", "stage-display"]);
    expect(aux().textContent).toContain("2 screens");
    void act(() => aux().click());
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')];
    expect(items.map((item) => [item.textContent?.trim(), item.getAttribute("aria-checked")])).toEqual([
      ["✓Projector", "true"],
      ["Stage preview", "false"],
      ["✓Stage display", "true"],
    ]);
    void act(() => items[1]!.click());
    // The menu stays open so several outputs can be chosen together.
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    void act(() => host!.querySelector<HTMLButtonElement>('[aria-label="Show timer on air"]')!.click());
    expect(onToggle.mock.calls).toEqual([["stage-preview"], ["program"]]);
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
