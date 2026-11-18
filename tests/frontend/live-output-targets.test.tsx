// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_LIVE_AUX_COMPOSITION, liveRoomClientMessageSchema } from "../../assets/shared/schemas/live-session-room";
import { defaultLiveTimerGraphic } from "../../assets/shared/schemas/live-session-timer";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import { OutputTargetControl } from "../../assets/ts/member-flows/portal/sections/events/detail/live/OutputTargetControl";
import {
  liveAuxToggle,
  liveLayerTargets,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-output-targets";
import { liveLayerUnseenLine } from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-layer-unseen";
import { LiveGraphicRow } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveGraphicRow";
import { LIVE_OVERLAY_STANDARD_ELEMENTS } from "../../assets/shared/live-overlay-layout-presets";
import { LIVE_OVERLAY_ELEMENTS } from "../../assets/shared/schemas/live-overlay-layout";
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
    // Each leads with where the graphic is, then says what a click does: Preview is an optional check.
    expect(preview.title).toMatch(/^In Preview\nTransition puts it on air/);
    expect(program.title).toMatch(/^Off air\nClick to put it on air now/);
    expect(host.querySelector("[data-unseen]")).toBeNull();
  });
});

describe("graphics held but unseen", () => {
  const question = liveStageQuestionSchema.parse({ id: LIVE_QUESTION, text: "How do we migrate?", authorName: null });
  const panel = { kind: "panelists", panelists: { layout: "panel" } } as const;
  const elements = LIVE_OVERLAY_STANDARD_ELEMENTS;
  /** A scene with the panel under a question of the same box, and one that leaves the panel out. */
  const scenes = [
    {
      slug: "stacked",
      name: "Stacked",
      elements: {
        ...elements,
        panelists: { ...elements.question, visible: true },
        question: { ...elements.question, visible: true },
      },
    },
    {
      slug: "close-up",
      name: "Close-up",
      elements: { ...elements, panelists: { ...elements.panelists, visible: false } },
    },
    {
      slug: "curtain",
      name: "Curtain",
      elements: {
        ...elements,
        panelists: { ...elements.background, visible: true },
        background: { ...elements.background, visible: true, layer: LIVE_OVERLAY_ELEMENTS.length - 1 },
      },
    },
  ];
  function heldState() {
    const state = roomState();
    state.overlayLayouts = scenes;
    state.stage = { ...state.stage, scene: "stacked", panelists: { layout: "panel" }, question };
    state.preview = { ...state.preview, scene: "close-up", panelists: { layout: "panel" } };
    return state;
  }

  it("says why nobody sees a graphic on Program and in Preview: a board over it, or a scene without it", () => {
    const where = liveLayerTargets(liveTargets(heldState()), panel);
    expect(where).toMatchObject({
      program: true,
      preview: true,
      programUnseen: { reason: "covered", by: "Question" },
      previewUnseen: { reason: "scene", scene: "Close-up" },
    });
    expect(liveLayerUnseenLine(where)).toBe("On air · covered by Question");
    expect(liveLayerUnseenLine({ ...where, programUnseen: null })).toBe("In Preview · not in this scene");
    // With the question off air the panel shows; off air there is nothing to be unseen.
    const shown = heldState();
    shown.stage = { ...shown.stage, question: null };
    expect(liveLayerTargets(liveTargets(shown), panel).programUnseen).toBeNull();
    expect(liveLayerTargets(liveTargets(heldState(), { programActive: false }), panel).programUnseen).toBeNull();
  });

  it("counts the background as covering what it is moved in front of", () => {
    const state = heldState();
    state.stage = { ...state.stage, scene: "curtain", question: null };
    expect(liveLayerTargets(liveTargets(state), panel).programUnseen).toEqual({ reason: "covered", by: "Background" });
  });

  it("hatches PVW and PGM and leads the row's summary with the words while it is unseen", () => {
    host = document.body.appendChild(document.createElement("div"));
    void act(() =>
      render(
        <LiveGraphicRow
          name="Panel"
          detail="Panel layout"
          outputs={{ targets: liveTargets(heldState()), layer: panel, subject: "panel" }}
        />,
        host!,
      ),
    );
    expect(host.querySelector(".pk-live-graphic-row__detail")?.textContent).toBe(
      "On air · covered by Question · Panel layout",
    );
    expect(host.querySelector(".pk-live-unseen")?.textContent).toBe("On air · covered by Question");
    const preview = host.querySelector<HTMLButtonElement>('[aria-label="Show panel in preview"]')!;
    const program = host.querySelector<HTMLButtonElement>('[aria-label="Show panel on air"]')!;
    expect([preview.hasAttribute("data-unseen"), program.hasAttribute("data-unseen")]).toEqual([true, true]);
    expect(program.title).toBe(
      "On air · covered by Question\nQuestion is drawn over it, so nobody sees it. Take Question off air to show it, or click to take this off air.",
    );
    expect(preview.title).toMatch(/^In Preview · not in this scene\nThe Close-up scene does not show it/);
  });
});

describe("room screens", () => {
  const question = liveStageQuestionSchema.parse({ id: LIVE_QUESTION, text: "How do we migrate?", authorName: null });
  const layer = { kind: "question", id: LIVE_QUESTION } as const;

  /** The projector in the Q&A scene, which includes a question; the Default scene holds no boards. */
  const inQuestions = { ...EMPTY_LIVE_AUX_COMPOSITION, scene: "questions" };

  it("marks each synced screen as following when it shows Program's question, and as put there when it has its own", () => {
    const state = roomState();
    state.outputs = { ...state.outputs, projector: inQuestions };
    expect(liveScreens(liveTargets(state), layer)).toMatchObject({ on: [], following: [] });
    state.stage = { ...state.stage, question };
    expect(liveScreens(liveTargets(state), layer)).toMatchObject({ on: [], following: ["projector", "stage-display"] });
    // Off air no screen shows Program's question.
    expect(liveScreens(liveTargets(state, { programActive: false }), layer).following).toEqual([]);
    state.outputs = { ...state.outputs, "stage-display": { ...EMPTY_LIVE_AUX_COMPOSITION, question } };
    expect(liveScreens(liveTargets(state), layer)).toMatchObject({ on: ["stage-display"], following: ["projector"] });
  });

  it("follows Program's graphic on a screen only when the screen's own scene includes it, lower third included", () => {
    const state = roomState();
    const credit = state.session.credits[0]!;
    const lowerThird = { kind: "lowerThird", key: credit.key } as const;
    state.stage = { ...state.stage, question, lowerThird: credit, scene: "questions" };
    // Nobody took a scene to the projector: it draws Default, which places a lower third and no question.
    expect(liveScreens(liveTargets(state), layer).following).toEqual(["stage-display"]);
    expect(liveScreens(liveTargets(state), lowerThird).following).toEqual(["projector"]);
    // In Q&A it draws both; in Panel, which names its people itself, neither the lower third.
    state.outputs = { ...state.outputs, projector: inQuestions };
    expect(liveScreens(liveTargets(state), layer).following).toEqual(["projector", "stage-display"]);
    expect(liveScreens(liveTargets(state), lowerThird).following).toEqual(["projector"]);
    state.outputs = { ...state.outputs, projector: { ...EMPTY_LIVE_AUX_COMPOSITION, scene: "panel" } };
    expect(liveScreens(liveTargets(state), lowerThird).following).toEqual([]);
    // The scene its room fixed for the screen wins over the one taken to it.
    state.session = {
      ...state.session,
      roomOutputs: [{ key: "projector", name: "Projector", code: "PRJ", role: "follow", scene: "break" }],
    };
    expect(liveScreens(liveTargets(state), lowerThird).following).toEqual(["projector"]);
    expect(liveScreens(liveTargets(state), layer).following).toEqual([]);
  });

  it("does not follow on a screen with its own question in place of Program's", () => {
    const state = roomState();
    const own = { ...question, id: "20000000-0000-4000-8000-0000000000c1", text: "Pinned" };
    state.stage = { ...state.stage, question };
    state.outputs = {
      ...state.outputs,
      projector: { ...inQuestions, question: own },
      "stage-display": { ...EMPTY_LIVE_AUX_COMPOSITION, question: own },
    };
    expect(liveScreens(liveTargets(state), layer).following).toEqual([]);
  });

  it("does not follow on a screen whose sync is off", () => {
    const state = roomState();
    state.stage = { ...state.stage, question };
    state.outputs = { ...state.outputs, projector: inQuestions };
    expect(liveScreens(liveTargets(state), layer).following).toEqual(["projector", "stage-display"]);
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
