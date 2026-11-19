import { describe, expect, it } from "vitest";
import {
  liveScreenAfterProgramChange,
  liveScreenCaughtUp,
  liveScreenComposition,
  liveScreenTake,
  liveScreenTakesProgramChanges,
} from "../../assets/shared/live-screen-sync";
import { liveCompositionInput } from "../../assets/shared/live-room-preview";
import { liveTakeTargets } from "../../assets/shared/live-room-outputs";
import { EMPTY_LIVE_STAGE, type LiveStage } from "../../assets/shared/schemas/live-session-room";
import { DEFAULT_LIVE_SCREEN_SYNC } from "../../assets/shared/schemas/live-screen-sync";
import { DEFAULT_LIVE_ROOM_OUTPUTS, type LiveRoomOutput } from "../../assets/shared/schemas/live-room-output-setup";

const outputs = DEFAULT_LIVE_ROOM_OUTPUTS;
import { defaultLiveTimerGraphic } from "../../assets/shared/schemas/live-session-timer";
import { DEFAULT_LIVE_TICKER_CONFIG } from "../../assets/shared/schemas/live-session-ticker";

const question = {
  id: "q1",
  text: "What about hybrid certificates?",
  authorName: null,
  authorPhotoUrl: null,
  authorAffiliation: null,
  addressedTo: null,
};
const credit = {
  key: "user:sam",
  moderator: false,
  roleLabel: null,
  name: "Sam Speaker",
  photoUrl: null,
  identity: null,
  additionalIdentities: [],
};
const topQuestions = { config: { count: 3 }, questions: [] };
const program: LiveStage = {
  ...EMPTY_LIVE_STAGE,
  question,
  lowerThird: credit,
  timerGraphics: [defaultLiveTimerGraphic("session")],
  reactions: true,
  reactionsGraphic: { showCount: true },
};

describe("a screen that follows Program", () => {
  const ticker = { ...DEFAULT_LIVE_TICKER_CONFIG, segments: [] };

  it("shows its own composition and nothing else, whatever is on Program", () => {
    expect(DEFAULT_LIVE_SCREEN_SYNC).toEqual({});
    const own = { ...EMPTY_LIVE_STAGE, scene: "check-in", topQuestions };
    const room = { own, program, timers: [], outputs };
    expect(liveScreenComposition("projector", { ...room, sync: DEFAULT_LIVE_SCREEN_SYNC })).toBe(own);
    expect(liveScreenComposition("projector", { ...room, sync: { projector: false } })).toBe(own);
  });

  it("takes each graphic an operator changed on Program and keeps the rest, its scene included", () => {
    const own: LiveStage = { ...EMPTY_LIVE_STAGE, scene: "check-in", lowerThird: credit, topQuestions };
    const before: LiveStage = { ...EMPTY_LIVE_STAGE, lowerThird: credit, scene: "default" };
    // The lower third comes off Program, a question goes on, and Program moves to another scene.
    const after: LiveStage = { ...EMPTY_LIVE_STAGE, question, scene: "panel" };
    expect(liveScreenAfterProgramChange(own, before, after)).toEqual({
      ...own,
      lowerThird: null,
      question,
    });
  });

  it("keeps a graphic it holds that Program did not touch, and stays off where it was taken off", () => {
    // Preview was taken to the screen without Program's lower third; Program then only shows a ticker.
    const own: LiveStage = { ...EMPTY_LIVE_STAGE, topQuestions };
    const before: LiveStage = { ...EMPTY_LIVE_STAGE, lowerThird: credit };
    const next = liveScreenAfterProgramChange(own, before, { ...before, ticker });
    expect(next).toEqual({ ...own, ticker });
  });

  it("does not count who changed a graphic, or content the room filled in again, as a change", () => {
    const own: LiveStage = { ...EMPTY_LIVE_STAGE, question: { ...question, id: "q2" } };
    const before: LiveStage = { ...EMPTY_LIVE_STAGE, question, ticker };
    const after: LiveStage = {
      ...before,
      questionChange: { operatorName: "Op", at: "2026-11-19T10:00:00.000Z" },
      ticker: { ...ticker, segments: [{ id: "next", prefix: "", markdown: "Up next: lunch" }] },
    };
    expect(liveScreenAfterProgramChange(own, before, after)).toBeNull();
  });

  it("counts how a graphic looks only while Program shows it", () => {
    const own: LiveStage = { ...EMPTY_LIVE_STAGE, reactions: true };
    const quiet = { ...EMPTY_LIVE_STAGE, reactionsGraphic: { showCount: true } };
    // Program's reactions are off: a new look for them changes nothing on a screen that shows its own.
    expect(liveScreenAfterProgramChange(own, EMPTY_LIVE_STAGE, quiet)).toBeNull();
    const shown = { ...EMPTY_LIVE_STAGE, reactions: true };
    expect(liveScreenAfterProgramChange(own, shown, { ...shown, reactionsGraphic: { showCount: true } })).toEqual({
      ...own,
      reactionsGraphic: { showCount: true },
    });
  });

  it("catches up with everything on Program, in its own scene, once it follows again", () => {
    const own: LiveStage = { ...EMPTY_LIVE_STAGE, scene: "check-in", topQuestions };
    expect(liveScreenCaughtUp(own, { ...program, scene: "panel" })).toEqual({ ...program, scene: "check-in" });
  });

  it("is carried Program's changes by its role and its sync: never a screen you take to, the speaker's or the stage preview", () => {
    const room: LiveRoomOutput[] = [
      { key: "prj-l", name: "Screen left", code: "PRJ L", role: "follow", scene: null, sceneLocked: false },
      { key: "foy", name: "Foyer", code: "FOY", role: "exact", scene: "break", sceneLocked: true },
    ];
    expect(liveScreenTakesProgramChanges(DEFAULT_LIVE_SCREEN_SYNC, room, "prj-l")).toBe(true);
    expect(liveScreenTakesProgramChanges({ "prj-l": false }, room, "prj-l")).toBe(false);
    expect(liveScreenTakesProgramChanges({ foy: true }, room, "foy")).toBe(false);
    expect(liveScreenTakesProgramChanges(DEFAULT_LIVE_SCREEN_SYNC, outputs, "stage-display")).toBe(false);
    expect(liveScreenTakesProgramChanges(DEFAULT_LIVE_SCREEN_SYNC, outputs, "stage-preview")).toBe(false);
  });
});

describe("the speaker's screen synced with Program", () => {
  it("takes only what the stage display shows from Program: no lower third or reactions there", () => {
    const shown = liveScreenComposition("stage-display", {
      own: EMPTY_LIVE_STAGE,
      program: { ...program, poll: { id: "p1", presentation: { chart: "bar" } }, topQuestions },
      sync: DEFAULT_LIVE_SCREEN_SYNC,
      timers: [],
      outputs,
    });
    // Exactly the question, the poll, the timers and the agenda, each with the fields that travel with it.
    expect(shown).toEqual({
      ...EMPTY_LIVE_STAGE,
      question,
      poll: { id: "p1", presentation: { chart: "bar" } },
      timerGraphics: program.timerGraphics,
    });
  });

  it("puts its own question in place of Program's", () => {
    const own = { ...question, id: "q2", text: "Pinned" };
    const shown = liveScreenComposition("stage-display", {
      own: { ...EMPTY_LIVE_STAGE, question: own },
      program,
      sync: DEFAULT_LIVE_SCREEN_SYNC,
      timers: [],
      outputs,
    });
    expect(shown).toMatchObject({ question: own, timerGraphics: program.timerGraphics });
  });

  it("never syncs the stage preview, which follows the room on its own", () => {
    expect(
      liveScreenComposition("stage-preview", {
        own: EMPTY_LIVE_STAGE,
        program,
        sync: DEFAULT_LIVE_SCREEN_SYNC,
        timers: [],
        outputs,
      }),
    ).toBe(EMPTY_LIVE_STAGE);
  });
});

describe("a take to a room screen", () => {
  const shot: LiveStage = { ...program, panelists: { layout: "panel" }, topQuestions, scene: "panel" };

  it("sends Preview exactly: scene, picks and switches", () => {
    expect(liveScreenTake("projector", shot)).toEqual({
      type: "aux.set",
      output: "projector",
      composition: liveCompositionInput(shot),
    });
  });

  it("offers Program and every screen but the speaker's, which draws its own fixed layout", () => {
    const foyer: LiveRoomOutput = {
      key: "foy",
      name: "Foyer",
      code: "FOY",
      role: "exact",
      scene: null,
      sceneLocked: false,
    };
    expect(liveTakeTargets([...outputs, foyer])).toEqual(["program", "projector", "foy"]);
  });
});
