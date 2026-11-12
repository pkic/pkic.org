// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIVE_OVERLAY_PRESET_LAYOUTS } from "../../assets/shared/live-overlay-layout-presets";
import { liveOverlayLayoutElementsSchema } from "../../assets/shared/schemas/live-overlay-layout";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  liveRoomClientMessageSchema,
  type LiveRoomClientMessage,
} from "../../assets/shared/schemas/live-session-room";
import { LiveOverlayPresentation } from "../../assets/ts/live-session/LiveOverlayPresentation";
import { applyLiveRoomMessage, type LiveRoomState } from "../../assets/ts/live-session/live-room-state";
import {
  LiveReactionsControls,
  LiveTopQuestionsControls,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveAudienceListControls";
import type { LiveTargets } from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-output-targets";
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
    await row.press("Send reactions to the room's screens");
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

describe("audience graphics on an output", () => {
  const burst = { sequence: 1, counts: { applause: 2, thumbs_up: 1 } };
  const floating = () => host!.querySelectorAll(".pk-live-overlay__reaction").length;

  async function draw(state: LiveRoomState, view: "program" | "projector" = "program") {
    host ??= document.body.appendChild(document.createElement("div"));
    await act(() => render(<LiveOverlayPresentation view={view} projection={state} />, host!));
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
    // The projector draws its own composition: reactions on Program do not reach it.
    await draw({ ...on, burst: { ...burst, sequence: 3 } }, "projector");
    expect(floating()).toBe(0);
    const projector = {
      ...on,
      outputs: { ...on.outputs, projector: { ...EMPTY_LIVE_AUX_COMPOSITION, reactions: true } },
    };
    await draw(projector, "projector");
    await draw({ ...projector, burst: { ...burst, sequence: 4 } }, "projector");
    expect(floating()).toBe(3);
  });

  it("draws the lists the room filled, and nothing for an empty one", async () => {
    const base = roomState();
    await draw({
      ...base,
      stage: {
        ...base.stage,
        topQuestions: {
          config: { count: 3 },
          questions: [{ id: "q-1", text: "Which algorithms first?", authorName: null, votes: 4 }],
        },
        chatFeed: { config: { count: 4, delaySeconds: 10 }, messages: [] },
      },
    });
    const questions = host!.querySelector('[data-overlay-element="topQuestions"]');
    expect(questions?.textContent).toContain("Which algorithms first?");
    expect(questions?.textContent).toContain("Audience question");
    expect(host!.querySelector('[data-overlay-element="chat"]')).toBeNull();
  });

  it("reads a layout saved before the audience lists existed, with the lists at their usual place", () => {
    const { topQuestions: _questions, chat: _chat, ...saved } = LIVE_OVERLAY_PRESET_LAYOUTS["side-by-side"].elements;
    const read = liveOverlayLayoutElementsSchema.parse(saved);
    expect(read.topQuestions).toEqual(LIVE_OVERLAY_PRESET_LAYOUTS["full-frame"].elements.topQuestions);
    expect(read.chat).toMatchObject({ visible: true, shared: true });
  });
});
