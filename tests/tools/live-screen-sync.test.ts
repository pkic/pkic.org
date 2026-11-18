import { describe, expect, it } from "vitest";
import { liveScreenComposition, liveScreenTake } from "../../assets/shared/live-screen-sync";
import { liveCompositionInput } from "../../assets/shared/live-room-preview";
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

describe("room screens synced with Program", () => {
  it("shows every graphic on Program on the projector by default, lower third included, and only its own composition once sync is off", () => {
    expect(DEFAULT_LIVE_SCREEN_SYNC).toEqual({});
    const shown = liveScreenComposition("projector", {
      own: EMPTY_LIVE_STAGE,
      program: { ...program, ticker: { ...DEFAULT_LIVE_TICKER_CONFIG, segments: [] }, panelists: { layout: "panel" } },
      sync: DEFAULT_LIVE_SCREEN_SYNC,
      timers: [],
      outputs,
    });
    // No graphic is the stream's alone: the screen's scene decides which of them it draws.
    expect(shown).toEqual({
      ...program,
      ticker: { ...DEFAULT_LIVE_TICKER_CONFIG, segments: [] },
      panelists: { layout: "panel" },
    });
    const off = { ...DEFAULT_LIVE_SCREEN_SYNC, projector: false };
    expect(liveScreenComposition("projector", { own: EMPTY_LIVE_STAGE, program, sync: off, timers: [], outputs })).toBe(
      EMPTY_LIVE_STAGE,
    );
  });

  it("draws in the screen's own scene, never Program's", () => {
    const shown = liveScreenComposition("projector", {
      own: { ...EMPTY_LIVE_STAGE, scene: "break" },
      program: { ...program, scene: "questions" },
      sync: DEFAULT_LIVE_SCREEN_SYNC,
      timers: [],
      outputs,
    });
    expect(shown).toEqual({ ...program, scene: "break" });
  });

  it("keeps a graphic the screen holds itself, such as one that came on with its scene, whatever Program shows", () => {
    const own = { ...EMPTY_LIVE_STAGE, scene: "questions", topQuestions };
    const room = { own, sync: DEFAULT_LIVE_SCREEN_SYNC, timers: [], outputs };
    // Program has no top questions: the screen's own stay on.
    expect(liveScreenComposition("projector", { ...room, program }).topQuestions).toBe(topQuestions);
    // Program's own top questions do not take their place either.
    const live = { ...program, topQuestions: { config: { count: 5 }, questions: [] } };
    expect(liveScreenComposition("projector", { ...room, program: live }).topQuestions).toBe(topQuestions);
  });

  it("follows Program's switch for a graphic the screen's scene leaves to the studio", () => {
    const room = {
      own: { ...EMPTY_LIVE_STAGE, scene: "default" },
      sync: DEFAULT_LIVE_SCREEN_SYNC,
      timers: [],
      outputs,
    };
    expect(liveScreenComposition("projector", { ...room, program }).topQuestions).toBeNull();
    const live = { ...program, topQuestions };
    expect(liveScreenComposition("projector", { ...room, program: live }).topQuestions).toBe(topQuestions);
  });

  it("puts a screen's own graphic in place of Program's, kind by kind", () => {
    const own = { ...question, id: "q2", text: "Pinned" };
    const pitch = { ...defaultLiveTimerGraphic("session"), timerId: "pitch" };
    const shown = liveScreenComposition("projector", {
      own: { ...EMPTY_LIVE_STAGE, question: own, timerGraphics: [pitch] },
      program,
      sync: DEFAULT_LIVE_SCREEN_SYNC,
      timers: [],
      outputs,
    });
    expect(shown).toMatchObject({ question: own, lowerThird: credit, timerGraphics: [pitch], reactions: true });
  });

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

  it("syncs a screen the room sets up by its role: one you take to never follows Program, one that follows does", () => {
    const room: LiveRoomOutput[] = [
      { key: "prj-l", name: "Screen left", code: "PRJ L", role: "follow", scene: null },
      { key: "foy", name: "Foyer", code: "FOY", role: "exact", scene: "break" },
    ];
    const following = liveScreenComposition("prj-l", {
      own: EMPTY_LIVE_STAGE,
      program,
      sync: DEFAULT_LIVE_SCREEN_SYNC,
      timers: [],
      outputs: room,
    });
    expect(following).toMatchObject({ question, lowerThird: credit });
    const exact = liveScreenComposition("foy", {
      own: EMPTY_LIVE_STAGE,
      program,
      sync: { foy: true },
      timers: [],
      outputs: room,
    });
    expect(exact).toBe(EMPTY_LIVE_STAGE);
  });
});

describe("a take to a room screen", () => {
  const shot: LiveStage = { ...program, panelists: { layout: "panel" }, topQuestions, scene: "panel" };
  const room = { shot, sync: DEFAULT_LIVE_SCREEN_SYNC, outputs };

  it("sends a screen that follows Program the scene alone: no pick and no switch", () => {
    expect(liveScreenTake("projector", room)).toEqual({ type: "aux.scene", output: "projector", scene: "panel" });
    // Preview in the Default scene takes that scene to the screen.
    expect(liveScreenTake("projector", { ...room, shot: { ...shot, scene: null } })).toEqual({
      type: "aux.scene",
      output: "projector",
      scene: null,
    });
  });

  it("sends the whole shot to a screen whose sync is off and to one that shows what you take to it", () => {
    const whole = { type: "aux.set", composition: liveCompositionInput(shot) };
    expect(liveScreenTake("projector", { ...room, sync: { projector: false } })).toEqual({
      ...whole,
      output: "projector",
    });
    const exact: LiveRoomOutput[] = [{ key: "foy", name: "Foyer", code: "FOY", role: "exact", scene: null }];
    expect(liveScreenTake("foy", { ...room, outputs: exact })).toEqual({ ...whole, output: "foy" });
    expect(liveScreenTake("stage-preview", room)).toEqual({ ...whole, output: "stage-preview" });
  });

  it("sends the stage display the shot without the question, poll, timers and agenda it takes from Program", () => {
    const next = { ...shot, poll: { id: "p1", presentation: { chart: "bar" as const } } };
    expect(liveScreenTake("stage-display", { ...room, shot: next })).toEqual({
      type: "aux.set",
      output: "stage-display",
      composition: liveCompositionInput({
        ...next,
        question: null,
        questionChange: null,
        poll: null,
        pollChange: null,
        timerGraphics: [],
        schedule: null,
      }),
    });
  });
});
