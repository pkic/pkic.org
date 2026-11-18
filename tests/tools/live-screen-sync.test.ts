import { describe, expect, it } from "vitest";
import { liveScreenComposition } from "../../assets/shared/live-screen-sync";
import { EMPTY_LIVE_STAGE, type LiveStage } from "../../assets/shared/schemas/live-session-room";
import { DEFAULT_LIVE_SCREEN_SYNC } from "../../assets/shared/schemas/live-screen-sync";
import { DEFAULT_LIVE_ROOM_OUTPUTS, type LiveRoomOutput } from "../../assets/shared/schemas/live-room-output-setup";

const outputs = DEFAULT_LIVE_ROOM_OUTPUTS;
import { defaultLiveTimerGraphic } from "../../assets/shared/schemas/live-session-timer";

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
const program: LiveStage = {
  ...EMPTY_LIVE_STAGE,
  question,
  lowerThird: credit,
  timerGraphics: [defaultLiveTimerGraphic("session")],
  reactions: true,
};

describe("room screens synced with Program", () => {
  it("shows Program on the projector by default, but never the stream's own captions, and only its own composition once sync is off", () => {
    expect(DEFAULT_LIVE_SCREEN_SYNC).toEqual({});
    const shown = liveScreenComposition("projector", {
      own: EMPTY_LIVE_STAGE,
      program,
      sync: DEFAULT_LIVE_SCREEN_SYNC,
      timers: [],
      outputs,
    });
    expect(shown).toEqual({
      ...program,
      lowerThird: EMPTY_LIVE_STAGE.lowerThird,
      lowerThirdChange: EMPTY_LIVE_STAGE.lowerThirdChange,
      lowerThirdMotion: EMPTY_LIVE_STAGE.lowerThirdMotion,
      ticker: EMPTY_LIVE_STAGE.ticker,
      panelists: EMPTY_LIVE_STAGE.panelists,
    });
    const off = { ...DEFAULT_LIVE_SCREEN_SYNC, projector: false };
    expect(liveScreenComposition("projector", { own: EMPTY_LIVE_STAGE, program, sync: off, timers: [], outputs })).toBe(
      EMPTY_LIVE_STAGE,
    );
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
    expect(shown).toMatchObject({ question: own, lowerThird: null, timerGraphics: [pitch], reactions: true });
  });

  it("takes only what the stage display shows from Program: no lower third or reactions there", () => {
    const shown = liveScreenComposition("stage-display", {
      own: EMPTY_LIVE_STAGE,
      program,
      sync: DEFAULT_LIVE_SCREEN_SYNC,
      timers: [],
      outputs,
    });
    expect(shown).toMatchObject({ question, timerGraphics: program.timerGraphics, lowerThird: null, reactions: false });
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
    expect(following).toMatchObject({ question, lowerThird: null });
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
