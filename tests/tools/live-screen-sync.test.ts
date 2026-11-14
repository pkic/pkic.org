import { describe, expect, it } from "vitest";
import { liveScreenComposition } from "../../assets/shared/live-screen-sync";
import { EMPTY_LIVE_STAGE, type LiveStage } from "../../assets/shared/schemas/live-session-room";
import { DEFAULT_LIVE_SCREEN_SYNC } from "../../assets/shared/schemas/live-screen-sync";
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
  it("shows all of Program on the projector by default, and only its own composition once sync is off", () => {
    expect(DEFAULT_LIVE_SCREEN_SYNC).toEqual({ projector: true, "stage-display": true });
    expect(
      liveScreenComposition("projector", {
        own: EMPTY_LIVE_STAGE,
        program,
        sync: DEFAULT_LIVE_SCREEN_SYNC,
        timers: [],
      }),
    ).toEqual(program);
    const off = { ...DEFAULT_LIVE_SCREEN_SYNC, projector: false };
    expect(liveScreenComposition("projector", { own: EMPTY_LIVE_STAGE, program, sync: off, timers: [] })).toBe(
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
    });
    expect(shown).toMatchObject({ question: own, lowerThird: credit, timerGraphics: [pitch], reactions: true });
  });

  it("takes only what the stage display shows from Program: no lower third or reactions there", () => {
    const shown = liveScreenComposition("stage-display", {
      own: EMPTY_LIVE_STAGE,
      program,
      sync: DEFAULT_LIVE_SCREEN_SYNC,
      timers: [],
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
      }),
    ).toBe(EMPTY_LIVE_STAGE);
  });
});
