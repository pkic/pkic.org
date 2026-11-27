// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { LiveRoomOutput } from "../../assets/shared/schemas/live-room-output-setup";
import { EMPTY_LIVE_AUX_COMPOSITION, type LiveStage } from "../../assets/shared/schemas/live-session-room";
import { LiveOverlayPresentation } from "../../assets/ts/live-session/LiveOverlayPresentation";
import { applyLiveRoomMessage, type LiveRoomState } from "../../assets/ts/live-session/live-room-state";
import { LIVE_QUESTION, liveSnapshot } from "./helpers/live-room-socket";

let host: HTMLElement | undefined;
afterEach(() => {
  if (!host) return;
  void act(() => render(null, host!));
  host.remove();
  host = undefined;
});

const SNAPSHOT = liveSnapshot();
const CREDIT = SNAPSHOT.session.credits[0]!;
const TOP = { config: { count: 3 }, questions: [{ id: LIVE_QUESTION, text: "Top one", authorName: null, votes: 3 }] };
const FOYER: LiveRoomOutput = {
  key: "foy",
  name: "Foyer",
  code: "FOY",
  role: "exact",
  scene: null,
  sceneLocked: false,
};

/** The room with this on Program, and this held by the screen itself. */
function room(program: Partial<LiveStage>, own: Partial<LiveStage>, changes: Partial<LiveRoomState> = {}) {
  const state = applyLiveRoomMessage(null, SNAPSHOT);
  if (!state) throw new Error("Missing fixture");
  const held = { ...EMPTY_LIVE_AUX_COMPOSITION, ...own };
  return { ...state, stage: { ...state.stage, ...program }, outputs: { projector: held, foy: held }, ...changes };
}

/** What a screen draws for the room: the name on its lower third, and its top questions. */
function drawn(state: LiveRoomState, screen = "projector") {
  host ??= document.body.appendChild(document.createElement("div"));
  void act(() => render(<LiveOverlayPresentation view={screen} projection={state} eventSlug="pqc-2026" />, host!));
  return {
    name: host.querySelector(".pk-live-overlay__name")?.textContent ?? null,
    topQuestions: host.textContent?.includes("Top one") ?? false,
  };
}

describe("a room screen that follows Program", () => {
  it("draws the lower third it holds where its own scene places one, and not where it leaves it out", () => {
    // Program is in Full board, which places no lower third: the screen draws its own scene, never Program's.
    const live = { lowerThird: CREDIT, scene: "full-board" };
    // The room carried the lower third to the projector. Nobody took a scene to it, so it draws Default.
    expect(drawn(room(live, { lowerThird: CREDIT })).name).toBe("Sam Speaker");
    expect(drawn(room(live, { lowerThird: CREDIT, scene: "questions" })).name).toBe("Sam Speaker");
    // Full board places no lower third.
    expect(drawn(room(live, { lowerThird: CREDIT, scene: "full-board" })).name).toBeNull();
    // The scene its room locked the screen to is the one it draws, whatever scene was taken to it.
    const setUp = (scene: string, sceneLocked: boolean): Partial<LiveRoomState> => ({
      session: {
        ...SNAPSHOT.session,
        roomOutputs: [{ key: "projector", name: "Projector", code: "PRJ", role: "follow", scene, sceneLocked }],
      },
    });
    expect(drawn(room(live, { lowerThird: CREDIT, scene: "questions" }, setUp("full-board", true))).name).toBeNull();
    expect(drawn(room(live, { lowerThird: CREDIT, scene: "full-board" }, setUp("questions", true))).name).toBe(
      "Sam Speaker",
    );
    // A scene it only starts in gives way to the one taken to it.
    expect(drawn(room(live, { lowerThird: CREDIT, scene: "questions" }, setUp("full-board", false))).name).toBe(
      "Sam Speaker",
    );
  });

  it("shows exactly what it holds, whatever is on Program", () => {
    // It holds top questions Program does not show: they are on.
    expect(drawn(room({}, { scene: "questions", topQuestions: TOP })).topQuestions).toBe(true);
    // A take left Program's lower third and top questions out: neither is drawn.
    const live = { lowerThird: CREDIT, topQuestions: TOP };
    expect(drawn(room(live, { scene: "questions" }))).toEqual({ name: null, topQuestions: false });
  });

  it("stays as it is once its sync is off", () => {
    const off = { screenSync: { projector: false } };
    const shown = drawn(room({ lowerThird: CREDIT }, { scene: "questions", topQuestions: TOP }, off));
    expect(shown).toEqual({ name: null, topQuestions: true });
  });

  it("leaves a screen that shows what you take to it to exactly that", () => {
    const exact = { session: { ...SNAPSHOT.session, roomOutputs: [FOYER] } };
    const live = { lowerThird: CREDIT, topQuestions: TOP, scene: "questions" };
    expect(drawn(room(live, { scene: "questions" }, exact), "foy")).toEqual({ name: null, topQuestions: false });
    const taken = { lowerThird: CREDIT, scene: "questions" };
    expect(drawn(room({}, taken, exact), "foy")).toEqual({ name: "Sam Speaker", topQuestions: false });
  });
});
