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
  it("shows Program's lower third where its own scene places one, and not where it leaves it out", () => {
    // Program is in Full board, which places no lower third: the screen draws its own scene, never Program's.
    const live = { lowerThird: CREDIT, scene: "full-board" };
    // Nobody took a scene to the projector, so it draws Default, which places a lower third.
    expect(drawn(room(live, {})).name).toBe("Sam Speaker");
    expect(drawn(room(live, { scene: "questions" })).name).toBe("Sam Speaker");
    // Panel names its people itself and places none.
    expect(drawn(room(live, { scene: "panel" })).name).toBeNull();
    // The scene its room locked the screen to is the one it draws, whatever scene was taken to it.
    const setUp = (scene: string, sceneLocked: boolean): Partial<LiveRoomState> => ({
      session: {
        ...SNAPSHOT.session,
        roomOutputs: [{ key: "projector", name: "Projector", code: "PRJ", role: "follow", scene, sceneLocked }],
      },
    });
    expect(drawn(room(live, { scene: "questions" }, setUp("panel", true))).name).toBeNull();
    expect(drawn(room(live, { scene: "panel" }, setUp("questions", true))).name).toBe("Sam Speaker");
    // A scene it only starts in gives way to the one taken to it.
    expect(drawn(room(live, { scene: "questions" }, setUp("panel", false))).name).toBe("Sam Speaker");
  });

  it("keeps top questions that came on with its scene while Program has none, and follows Program's switch for ones left to the studio", () => {
    // The screen holds them itself, as its Q&A scene brought them on: on, whatever Program shows.
    expect(drawn(room({}, { scene: "questions", topQuestions: TOP })).topQuestions).toBe(true);
    // It holds none: they are on only while Program has them on.
    expect(drawn(room({}, { scene: "questions" })).topQuestions).toBe(false);
    expect(drawn(room({ topQuestions: TOP }, { scene: "questions" })).topQuestions).toBe(true);
    // A scene that leaves them out draws none, on Program or not.
    expect(drawn(room({ topQuestions: TOP }, { scene: "break" })).topQuestions).toBe(false);
  });

  it("holds what it has once its sync is off, and nothing of Program's", () => {
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
