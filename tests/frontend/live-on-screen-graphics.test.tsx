// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_OVERLAY_PRESET_LAYOUTS,
  LIVE_OVERLAY_STANDARD_ELEMENTS,
} from "../../assets/shared/live-overlay-layout-presets";
import { liveOverlayLayoutElementsSchema } from "../../assets/shared/schemas/live-overlay-layout";
import { liveCheckInOnAirSchema } from "../../assets/shared/schemas/live-session-graphic-settings";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  liveRoomClientMessageSchema,
  type LiveRoomClientMessage,
} from "../../assets/shared/schemas/live-session-room";
import { LiveOverlayPresentation } from "../../assets/ts/live-session/LiveOverlayPresentation";
import { stackedPanelBox, timerReserve } from "../../assets/ts/live-session/live-overlay-fields";
import { applyLiveRoomMessage, type LiveRoomState } from "../../assets/ts/live-session/live-room-state";
import {
  LiveReactionsControls,
  LiveTopQuestionsControls,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveAudienceListControls";
import type { LiveTargets } from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-output-targets";
import {
  pitchMarkGraphic,
  stageClockState,
  TIMERS_FIXTURE_NOW,
} from "../../assets/ts/ui/preview/studio-timers-fixtures";
import { controlFor } from "./helpers/labeled-control";
import { liveSnapshot } from "./helpers/live-room-socket";

let host: HTMLElement | undefined;
afterEach(async () => {
  if (!host) return;
  await act(() => render(null, host!));
  host.remove();
  host = undefined;
});

function roomState(overrides: Partial<LiveRoomState> = {}): LiveRoomState {
  return { ...applyLiveRoomMessage(null, liveSnapshot())!, ...overrides };
}

/** Renders one Graphics row over a room and collects what it sends, parsed as the room parses it. */
async function graphicsRow(Row: typeof LiveReactionsControls, state: LiveRoomState) {
  const sent: LiveRoomClientMessage[] = [];
  const targets: LiveTargets = {
    state,
    programActive: true,
    disabled: false,
    sendProgram: vi.fn((message: LiveRoomClientMessage) => {
      sent.push(liveRoomClientMessageSchema.parse(message));
      return true;
    }),
  };
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<Row targets={targets} />, host!));
  const press = (label: string) =>
    act(() => host!.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
  return { sent, press };
}

describe("reactions in the Graphics panel", () => {
  it("turns floating reactions on and off for Preview and Program, as the other graphics do", async () => {
    const off = await graphicsRow(LiveReactionsControls, roomState());
    await off.press("Show reactions in preview");
    await off.press("Show reactions on air");
    expect(off.sent).toEqual([
      { type: "preview.set", composition: { reactions: true } },
      expect.objectContaining({ type: "stage.set", reactions: true }),
    ]);
    await act(() => render(null, host!));
    host!.remove();
    const on = roomState();
    const shown = await graphicsRow(
      LiveReactionsControls,
      roomState({ stage: { ...on.stage, reactions: true }, preview: { ...on.preview, reactions: true } }),
    );
    await shown.press("Show reactions on air");
    // Taking reactions off Program leaves the rest of Program as it was.
    expect(shown.sent).toEqual([
      expect.objectContaining({ type: "stage.set", reactions: false, creditKey: on.stage.lowerThird?.key ?? null }),
    ]);
  });

  it("sends reactions to a room screen in that screen's own composition", async () => {
    const state = roomState();
    const row = await graphicsRow(LiveReactionsControls, state);
    await row.press("Reactions actions");
    const projector = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find((item) =>
      item.textContent?.includes("Projector"),
    )!;
    await act(() => projector.click());
    expect(row.sent).toEqual([
      expect.objectContaining({
        type: "aux.set",
        output: "projector",
        composition: expect.objectContaining({ reactions: true }),
      }),
    ]);
  });

  it("puts top questions on air with the count the operator chose", async () => {
    const row = await graphicsRow(LiveTopQuestionsControls, roomState());
    await row.press("Show top questions on air");
    expect(row.sent).toEqual([expect.objectContaining({ type: "stage.set", topQuestions: { count: 3 } })]);
  });
});

describe("a graphic a scene or another operator put on", () => {
  const pressed = (label: string) =>
    host!.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.getAttribute("aria-pressed");
  /** Preview with the top questions on as a scene brings them on, where this operator's row offers three. */
  const broughtOn = (count: number) => {
    const base = roomState();
    return roomState({ preview: { ...base.preview, topQuestions: { config: { count }, questions: [] } } });
  };

  it("lights its row where it is on, whatever settings it is on with, and a press takes it off", async () => {
    const row = await graphicsRow(LiveTopQuestionsControls, broughtOn(5));
    expect(pressed("Show top questions in preview")).toBe("true");
    expect(pressed("Show top questions on air")).toBe("false");
    // The row names the settings on screen, not the ones it would have offered.
    expect(host!.textContent).toContain("5 open");
    await row.press("Show top questions in preview");
    expect(row.sent).toEqual([{ type: "preview.set", composition: { topQuestions: null } }]);
  });

  it("follows the settings an output shows when they change under it", async () => {
    const targets = (state: LiveRoomState): LiveTargets => ({
      state,
      programActive: true,
      disabled: false,
      sendProgram: () => true,
    });
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<LiveTopQuestionsControls targets={targets(roomState())} />, host!));
    expect(host.textContent).toContain("3 open");
    expect(pressed("Show top questions in preview")).toBe("false");
    await act(() => render(<LiveTopQuestionsControls targets={targets(broughtOn(5))} />, host!));
    expect(host.textContent).toContain("5 open");
    expect(pressed("Show top questions in preview")).toBe("true");
  });

  it("changes the graphic where it is on when its settings are saved, and nowhere else", async () => {
    const row = await graphicsRow(LiveTopQuestionsControls, broughtOn(5));
    await row.press("Top questions actions");
    const settings = [...document.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')].find((item) =>
      item.textContent?.includes("Top questions settings"),
    )!;
    await act(() => settings.click());
    const count = controlFor<HTMLSelectElement>(document.body, "Questions to show");
    await act(() => {
      count.value = "2";
      count.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(
      (button) => button.textContent?.trim() === "Save",
    )!;
    await act(() => save.click());
    // It is on Preview only, so only Preview takes the new settings; Program is not touched.
    expect(row.sent).toEqual([{ type: "preview.set", composition: { topQuestions: { count: 2 } } }]);
    expect(host!.textContent).toContain("2 open");
  });
});

describe("audience graphics on an output", () => {
  const burst = { sequence: 1, counts: { applause: 2, thumbs_up: 1 }, people: { applause: 2, thumbs_up: 1 } };
  const floating = () => host!.querySelectorAll(".pk-live-overlay__reaction").length;

  async function draw(
    state: LiveRoomState,
    view: "program" | "projector" = "program",
    elements?: typeof LIVE_OVERLAY_STANDARD_ELEMENTS,
  ) {
    host ??= document.body.appendChild(document.createElement("div"));
    await act(() => render(<LiveOverlayPresentation view={view} elements={elements} projection={state} />, host!));
  }

  it("floats reactions only on an output an operator turned them on for", async () => {
    const base = roomState({ burst: null });
    await draw(base);
    await draw({ ...base, burst });
    expect(floating()).toBe(0);
    const on = { ...base, stage: { ...base.stage, reactions: true } };
    await draw(on);
    await draw({ ...on, burst: { ...burst, sequence: 2 } });
    expect(floating()).toBe(3);
    // A projector that does not sync draws its own composition: reactions on Program do not reach it.
    const unsynced = { ...on, screenSync: { projector: false, "stage-display": true } };
    await draw({ ...unsynced, burst: { ...burst, sequence: 3 } }, "projector");
    expect(floating()).toBe(0);
    const projector = {
      ...unsynced,
      outputs: { ...on.outputs, projector: { ...EMPTY_LIVE_AUX_COMPOSITION, reactions: true } },
    };
    await draw(projector, "projector");
    await draw({ ...projector, burst: { ...burst, sequence: 4 } }, "projector");
    expect(floating()).toBe(3);
  });

  it("draws the lists the room filled, and nothing for an empty one", async () => {
    const base = roomState();
    await draw(
      {
        ...base,
        stage: {
          ...base.stage,
          topQuestions: {
            config: { count: 3 },
            questions: [{ id: "q-1", text: "Which algorithms first?", authorName: null, votes: 4 }],
          },
          chatFeed: { config: { count: 4, delaySeconds: 10 }, messages: [] },
        },
      },
      "program",
      LIVE_OVERLAY_STANDARD_ELEMENTS,
    );
    const questions = host!.querySelector('[data-overlay-element="topQuestions"]');
    expect(questions?.textContent).toContain("Which algorithms first?");
    expect(questions?.textContent).toContain("Top questions");
    expect(host!.querySelector('[data-overlay-element="chat"]')).toBeNull();
  });

  it("joins the question and panelists into one board only where a layout stacks them", () => {
    const panel = LIVE_OVERLAY_PRESET_LAYOUTS.panel.elements;
    expect(stackedPanelBox(panel)).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
    expect(stackedPanelBox({ ...panel, question: { ...panel.question, visible: false } })).toBeNull();
    // The standard boxes lay both over the whole frame: they overlap rather than stack.
    expect(stackedPanelBox(LIVE_OVERLAY_STANDARD_ELEMENTS)).toBeNull();
  });

  it("reads a layout saved before the audience lists existed, with the lists at their usual place", () => {
    const { topQuestions: _questions, chat: _chat, ...saved } = LIVE_OVERLAY_PRESET_LAYOUTS["check-in"].elements;
    const read = liveOverlayLayoutElementsSchema.parse(saved);
    expect(read.topQuestions).toEqual(LIVE_OVERLAY_STANDARD_ELEMENTS.topQuestions);
    expect(read.chat).toMatchObject({ visible: true, shared: true });
  });
});

describe("timers over a board", () => {
  const questions = {
    config: { count: 3 },
    questions: [{ id: "q-1", text: "Which algorithms first?", authorName: null, votes: 4 }],
  };
  const board = () => host!.querySelector<HTMLElement>('[data-overlay-element="topQuestions"]')!;
  const reserve = () =>
    Number(
      board()
        .querySelector<HTMLElement>(".pk-live-overlay__surface")!
        .style.getPropertyValue("--overlay-timer-reserve"),
    );

  async function draw(state: LiveRoomState, elements = LIVE_OVERLAY_STANDARD_ELEMENTS) {
    host ??= document.body.appendChild(document.createElement("div"));
    await act(() => render(<LiveOverlayPresentation view="program" elements={elements} projection={state} />, host!));
  }

  it("keeps the timers' column clear on a full-frame board, and the whole board without them", async () => {
    const shown = { ...stageClockState, stage: { ...stageClockState.stage, topQuestions: questions } };
    await draw(shown);
    expect(board().hasAttribute("data-logo-covered")).toBe(true);
    // The timer's box starts at 1536 of the 1920 frame: the board keeps its last fifth clear.
    expect(reserve()).toBeCloseTo(0.2, 2);
    await draw({ ...shown, stage: { ...shown.stage, timerGraphics: [] } });
    expect(board().hasAttribute("data-logo-covered")).toBe(false);
    expect(reserve()).toBe(0);
  });

  it("starts a column board's top row under a timer with its own placement, and keeps its full width", async () => {
    const [first] = stageClockState.stage.timerGraphics;
    const question = {
      id: "q-1",
      text: "How long should a certificate issued for a conference be valid?",
      authorName: null,
      authorPhotoUrl: null,
      authorAffiliation: null,
      addressedTo: null,
    };
    const topRight = {
      ...stageClockState,
      stage: { ...stageClockState.stage, question, timerGraphics: [{ ...first!, placement: "top-right" as const }] },
    };
    await draw(topRight, LIVE_OVERLAY_PRESET_LAYOUTS.questions.elements);
    for (const element of ["background", "question"]) {
      const layer = host!.querySelector<HTMLElement>(`[data-overlay-element="${element}"]`)!;
      const surface = layer.querySelector<HTMLElement>(".pk-live-overlay__surface")!;
      // The logo and the eyebrow go under the timer, which ends 174 px down the 1080 px column, on the title-safe line.
      expect(layer.dataset.logoCovered, element).toBe("below");
      expect(Number(surface.style.getPropertyValue("--overlay-timer-drop")), element).toBeCloseTo(174 / 1080, 3);
      // No column is kept clear beside the timer, so the question keeps the column's full width.
      expect(Number(surface.style.getPropertyValue("--overlay-timer-reserve")), element).toBe(0);
    }
    // The same timer over a full-frame board leaves room beside it: the logo steps aside instead.
    await draw({ ...topRight, stage: { ...topRight.stage, question: null, topQuestions: questions } });
    expect(board().dataset.logoCovered).toBe("beside");
    // On the title-safe line the timer starts 432 px from the frame's end.
    expect(reserve()).toBeCloseTo(432 / 1920, 3);
  });

  it("reserves room beside a timer on a wide board and under it on a narrow one", () => {
    const frame = { ...LIVE_OVERLAY_STANDARD_ELEMENTS.question };
    const column = { ...LIVE_OVERLAY_PRESET_LAYOUTS.questions.elements.question };
    const timer = { ...LIVE_OVERLAY_STANDARD_ELEMENTS.timer };
    expect(timerReserve(frame, [timer])).toEqual({ inline: expect.closeTo(0.2, 3), block: 0 });
    expect(timerReserve(column, [timer])).toEqual({ inline: 0, block: expect.closeTo(168 / 1080, 3) });
    // A timer away from the corner, such as the column layout's own timer over the camera, needs no room.
    expect(timerReserve(column, [LIVE_OVERLAY_PRESET_LAYOUTS.questions.elements.timer])).toEqual({
      inline: 0,
      block: 0,
    });
  });

  it("sets digits on a plate over the camera and bare on the scene's background, so no card sits on a card", async () => {
    await draw(stageClockState);
    const plate = () => host!.querySelector<HTMLElement>(".pk-live-overlay__timer")!;
    expect(plate().hasAttribute("data-on-board")).toBe(false);
    // A board has no field of its own: over the camera the timer keeps its plate, with or without a board under it.
    const shown = { ...stageClockState, stage: { ...stageClockState.stage, topQuestions: questions } };
    await draw(shown);
    expect(plate().hasAttribute("data-on-board")).toBe(false);
    const background = { ...LIVE_OVERLAY_STANDARD_ELEMENTS.background, visible: true };
    await draw(shown, { ...LIVE_OVERLAY_STANDARD_ELEMENTS, background });
    expect(plate().hasAttribute("data-on-board")).toBe(true);
    // The background's logo steps aside for the timer on its corner.
    const ground = host!.querySelector<HTMLElement>('[data-overlay-element="background"]')!;
    expect(ground.hasAttribute("data-logo-covered")).toBe(true);
    expect(ground.querySelectorAll(".pk-live-board__logo")).toHaveLength(1);
  });

  it("draws a timer bare or as a tab from the frame's top edge, the next timer under the tab's plate", async () => {
    const [first, ...rest] = stageClockState.stage.timerGraphics;
    const looked = (presentation: "bare" | "tab") => ({
      ...stageClockState,
      stage: { ...stageClockState.stage, timerGraphics: [{ ...first!, presentation }, ...rest] },
    });
    const timers = () => [...host!.querySelectorAll<HTMLElement>(".pk-live-overlay__timer")];
    await draw(looked("bare"));
    expect(timers()[0]!.dataset.look).toBe("bare");
    await draw(looked("tab"));
    const tab = timers()[0]!;
    expect(tab.dataset.look).toBe("tab");
    expect(tab.dataset.edge).toBe("top");
    // The standard timer box sits 48 px below the top: the tab runs those 48 px on to the edge.
    const rule = document.adoptedStyleSheets
      .flatMap((sheet) => [...sheet.cssRules].map((entry) => entry.cssText))
      .find((entry) => entry.includes(tab.dataset.numericCssProperties!));
    expect(Number(/--timer-reach: ([\d.]+)/u.exec(rule ?? "")?.[1])).toBeCloseTo(48, 0);
    // Only the first timer of the stack reaches the edge; the others stay plates.
    expect(
      timers()
        .slice(1)
        .every((timer) => timer.dataset.look === undefined),
    ).toBe(true);
  });

  it("keeps timers off the check-in card: the pitch reads as digits when the mark has no room", async () => {
    vi.useFakeTimers({ now: TIMERS_FIXTURE_NOW, toFake: ["Date"] });
    const timers = [...stageClockState.stage.timerGraphics, pitchMarkGraphic()];
    const stage = { ...stageClockState.stage, timerGraphics: timers };
    await draw({ ...stageClockState, stage });
    expect(host!.querySelectorAll(".pk-live-timer-mark")).toHaveLength(1);
    const checkIn = liveCheckInOnAirSchema.parse({
      selection: { kind: "session", occurrenceId: "50000000-0000-4000-8000-000000000001" },
      label: "Post-quantum migration",
      path: "/portal/#/events/pqc-2026/check-in/code",
    });
    await draw({ ...stageClockState, stage: { ...stage, checkIn } });
    expect(host!.querySelector(".pk-live-timer-mark")).toBeNull();
    expect([...host!.querySelectorAll(".pk-live-overlay__timer-value")].map((value) => value.textContent)).toEqual([
      "15:00",
      "0:42",
    ]);
    vi.useRealTimers();
  });

  it("draws a pitch in the mark: its seconds in the middle, its seats filled as far as the time has gone", async () => {
    vi.useFakeTimers({ now: TIMERS_FIXTURE_NOW, toFake: ["Date"] });
    await draw({ ...stageClockState, stage: { ...stageClockState.stage, timerGraphics: [pitchMarkGraphic()] } });
    const mark = host!.querySelector<HTMLElement>(".pk-live-timer-mark")!;
    expect(mark.querySelector(".pk-live-timer-mark__time")!.textContent).toBe("42");
    // The round emblem's seats and ring only: the time takes the keyhole's place.
    expect(mark.querySelectorAll(".pk-live-timer-mark__track > path")).toHaveLength(3);
    expect(mark.querySelectorAll(".pk-live-overlay__emblem-ink")).toHaveLength(1);
    expect(mark.hasAttribute("data-running")).toBe(true);
    const rules = document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText));
    expect(
      rules.some((rule) => rule.includes(mark.dataset.numericCssProperties!) && rule.includes("--mark-fill: 0.766")),
    ).toBe(true);
    expect(host!.querySelector(".pk-live-overlay__timer")).toBeNull();
    vi.useRealTimers();
  });
});
