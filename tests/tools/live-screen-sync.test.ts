import { describe, expect, it } from "vitest";
import { liveScreenProgram, liveSyncedComposition } from "../../assets/shared/live-screen-sync";
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
  it("syncs both screens by default and takes nothing from Program once a screen's sync is off", () => {
    expect(DEFAULT_LIVE_SCREEN_SYNC).toEqual({ projector: true, "stage-display": true });
    expect(liveScreenProgram(program, DEFAULT_LIVE_SCREEN_SYNC, "projector")).toBe(program);
    expect(liveScreenProgram(program, { ...DEFAULT_LIVE_SCREEN_SYNC, projector: false }, "projector")).toBe(
      EMPTY_LIVE_STAGE,
    );
  });

  it("shows Program wherever the screen has nothing of its own, and its own graphic in place of Program's", () => {
    expect(liveSyncedComposition(EMPTY_LIVE_STAGE, program)).toEqual(program);
    const own = { ...question, id: "q2", text: "Pinned" };
    const pitch = { ...defaultLiveTimerGraphic("session"), timerId: "pitch" };
    const synced = liveSyncedComposition({ ...EMPTY_LIVE_STAGE, question: own, timerGraphics: [pitch] }, program);
    expect(synced).toMatchObject({ question: own, lowerThird: credit, timerGraphics: [pitch], reactions: true });
  });
});
