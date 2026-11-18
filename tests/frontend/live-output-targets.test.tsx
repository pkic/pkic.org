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
import { liveScreens } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveRowMenu";
import { liveStageQuestionSchema } from "../../assets/shared/schemas/live-session-room";
import { LIVE_QUESTION, liveSnapshot, liveTargets } from "./helpers/live-room-socket";

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
    // Each says what it does: Preview is an optional check, Program goes on air at once.
    expect(preview.title).toMatch(/^In Preview\./);
    expect(program.title).toMatch(/^Program: put it on air now/);
  });
});

describe("room screens", () => {
  const question = liveStageQuestionSchema.parse({ id: LIVE_QUESTION, text: "How do we migrate?", authorName: null });
  const layer = { kind: "question", id: LIVE_QUESTION } as const;

  it("marks each synced screen as following when it shows Program's question, and as put there when it has its own", () => {
    const state = roomState();
    expect(liveScreens(liveTargets(state), layer)).toMatchObject({ on: [], following: [] });
    state.stage = { ...state.stage, question };
    expect(liveScreens(liveTargets(state), layer)).toMatchObject({ on: [], following: ["projector", "stage-display"] });
    // Off air no screen shows Program's question.
    expect(liveScreens(liveTargets(state, { programActive: false }), layer).following).toEqual([]);
    state.outputs = { ...state.outputs, "stage-display": { ...EMPTY_LIVE_AUX_COMPOSITION, question } };
    expect(liveScreens(liveTargets(state), layer)).toMatchObject({ on: ["stage-display"], following: ["projector"] });
  });

  it("does not follow on a screen with its own question in place of Program's", () => {
    const state = roomState();
    const own = { ...question, id: "20000000-0000-4000-8000-0000000000c1", text: "Pinned" };
    state.stage = { ...state.stage, question };
    state.outputs = {
      ...state.outputs,
      projector: { ...EMPTY_LIVE_AUX_COMPOSITION, question: own },
      "stage-display": { ...EMPTY_LIVE_AUX_COMPOSITION, question: own },
    };
    expect(liveScreens(liveTargets(state), layer).following).toEqual([]);
  });

  it("does not follow on a screen whose sync is off", () => {
    const state = roomState();
    state.stage = { ...state.stage, question };
    state.screenSync = { projector: false, "stage-display": true };
    expect(liveScreens(liveTargets(state), layer).following).toEqual(["stage-display"]);
    state.screenSync = { projector: false, "stage-display": false };
    expect(liveScreens(liveTargets(state), layer).following).toEqual([]);
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
