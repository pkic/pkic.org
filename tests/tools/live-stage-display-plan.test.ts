import { describe, expect, it } from "vitest";
import { cutAtWord, liveStageSpeakers, liveStageTitle, liveSurname } from "../../assets/shared/live-stage-display";
import { liveStageDisplayPlan, type LiveStageDisplayInput } from "../../assets/shared/live-stage-display-plan";
import { sessionLiveTimer } from "../../assets/shared/live-timer-policy";
import { EMPTY_LIVE_STAGE, type LiveTimer } from "../../assets/shared/schemas/live-session-room";
import { DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS } from "../../assets/shared/schemas/live-stage-display-settings";
import { defaultLiveTimerGraphic } from "../../assets/shared/schemas/live-session-timer";

const now = Date.parse("2026-11-12T10:00:00.000Z");
const at = (ms: number) => new Date(now + ms).toISOString();
const MINUTE = 60_000;
const session = sessionLiveTimer();
const pitch: LiveTimer = {
  ...session,
  id: "pitch",
  name: "Pitch",
  kind: "duration",
  followsAgenda: false,
  durationSeconds: 180,
  running: true,
  anchorAt: at(70_000),
};
const question = {
  id: "q1",
  text: "What about hybrid certificates?",
  authorName: null,
  authorPhotoUrl: null,
  authorAffiliation: null,
};
const nextSession = {
  config: { scope: "this-room" as const, layout: "list" as const, theme: "white-on-black" as const },
  available: true,
  timeZone: "Europe/Amsterdam",
  resolvedAt: at(0),
  rooms: [
    {
      roomId: "room",
      roomName: "Blue room",
      roomIndex: 0,
      occurrenceId: "next",
      title: "Crypto agility in HSMs",
      startAt: at(30 * MINUTE),
      endAt: at(60 * MINUTE),
      speakers: [{ name: "Casey Demo", moderator: false, photoUrl: null }],
    },
  ],
};

/** A session from `startMs` to `endMs` around now, with these timers pinned to the stage display. */
function input(startMs: number, endMs: number, overrides: Partial<LiveStageDisplayInput> = {}): LiveStageDisplayInput {
  return {
    session: {
      title: "Opening keynote",
      startAt: at(startMs),
      endAt: at(endMs),
      timeZone: "Europe/Amsterdam",
      credits: [],
    },
    own: { ...EMPTY_LIVE_STAGE, timerGraphics: [defaultLiveTimerGraphic("session")], schedule: nextSession },
    program: EMPTY_LIVE_STAGE,
    next: null,
    nextVotes: null,
    polls: [],
    timers: [session, pitch],
    speakerMessage: null,
    settings: DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS,
    roomId: "room",
    now,
    ...overrides,
  };
}
const both = {
  ...EMPTY_LIVE_STAGE,
  timerGraphics: ["session", "pitch"].map(defaultLiveTimerGraphic),
  schedule: nextSession,
};

describe("stage display text", () => {
  it("cuts a title at a whole word, never mid-word", () => {
    expect(cutAtWord("Quantum-safe by 2030", 40)).toBe("Quantum-safe by 2030");
    expect(cutAtWord("Migrating a national PKI to post-quantum algorithms", 30)).toBe("Migrating a national PKI to…");
    expect([...liveStageTitle("word ".repeat(60))].length).toBeLessThanOrEqual(103);
  });

  it("reads a surname with its particles", () => {
    expect(liveSurname("Art de Blaauw")).toBe("de Blaauw");
    expect(liveSurname("Paul van Brouwershaven")).toBe("van Brouwershaven");
    expect(liveSurname("Jane Doe")).toBe("Doe");
    expect(liveSurname("Cher")).toBe("Cher");
  });

  it("fits the speakers in one line: affiliations, then names, then surnames, then a count", () => {
    const two = [
      { name: "Jane Doe", affiliation: "Ministry of the Interior" },
      { name: "John Roe", affiliation: "Stedin" },
    ];
    expect(liveStageSpeakers(two)).toBe("Jane Doe, Ministry of the Interior · John Roe, Stedin");
    expect(liveStageSpeakers(two, 30)).toBe("Jane Doe · John Roe");
    expect(liveStageSpeakers(two, 12)).toBe("Doe · Roe");
    expect(liveStageSpeakers(two, 5)).toBe("Panel · 2 speakers");
    expect(liveStageSpeakers([])).toBe("");
  });
});

describe("stage display plan", () => {
  it("makes the timer that ends first the large one, each keeping its side", () => {
    const plan = liveStageDisplayPlan(input(-10 * MINUTE, 20 * MINUTE, { own: both }));
    expect(plan.main).toMatchObject({
      kind: "timers",
      timers: [
        { timerId: "session", size: "small", text: "20:00" },
        { timerId: "pitch", size: "large", text: "1:10" },
      ],
    });
    expect(plan.footer).toMatchObject({ marker: "live", title: "Opening keynote" });
    expect(plan.clock).toBe("11:00");
  });

  it("shows Program's timers when the stage display has none of its own", () => {
    const plan = liveStageDisplayPlan(
      input(-10 * MINUTE, 20 * MINUTE, {
        own: EMPTY_LIVE_STAGE,
        program: { ...EMPTY_LIVE_STAGE, timerGraphics: [defaultLiveTimerGraphic("pitch")] },
      }),
    );
    expect(plan.main).toMatchObject({ kind: "timers", timers: [{ timerId: "pitch" }] });
  });

  it("gives a timer at zero or over the whole main area, and names what is next", () => {
    const plan = liveStageDisplayPlan(input(-30 * MINUTE, -2 * MINUTE - 14_000, { own: both }));
    expect(plan.main).toMatchObject({ kind: "overtime", timer: { label: "Session over by", text: "+2:14" } });
    expect(plan.footer).toMatchObject({ marker: "next", title: "Crypto agility in HSMs", speakers: "Casey Demo" });
  });

  it("drops a countdown left running an hour past zero", () => {
    const stale = { ...pitch, atZero: { ...pitch.atZero, action: "overtime" as const }, anchorAt: at(-61 * MINUTE) };
    const plan = liveStageDisplayPlan(input(-10 * MINUTE, 50 * MINUTE, { own: both, timers: [session, stale] }));
    expect(plan.main.kind).not.toBe("overtime");
    expect(JSON.stringify(plan.main)).not.toContain("Pitch");
  });

  it("counts down to the next session in a break", () => {
    const plan = liveStageDisplayPlan(input(11 * MINUTE + 57_000, 40 * MINUTE));
    expect(plan.main).toMatchObject({ kind: "break", timer: { label: "Next session starts in", text: "11:57" } });
    expect(plan.footer).toMatchObject({ marker: "next", title: "Opening keynote" });
  });

  it("sets a question beside the small timer, tagged on air, with the next one and its votes", () => {
    const lined = { ...question, id: "q2", text: "And HSMs?" };
    const plan = liveStageDisplayPlan(
      input(-10 * MINUTE, 20 * MINUTE, { program: { ...EMPTY_LIVE_STAGE, question }, next: lined, nextVotes: 31 }),
    );
    expect(plan.main).toMatchObject({
      kind: "content",
      timer: { timerId: "session", size: "small" },
      content: { kind: "question", question, onAir: true, next: { question: lined, votes: 31 } },
    });
  });

  it("cues the end with questions or a wrap-up, turns the session amber and names what is next", () => {
    const plan = liveStageDisplayPlan(input(-25 * MINUTE, 4 * MINUTE));
    expect(plan.banner).toMatchObject({ text: "Questions now", source: "near-end" });
    expect(plan.main).toMatchObject({ kind: "timers", timers: [{ timerId: "session", tone: "warn" }] });
    expect(plan.footer.marker).toBe("next");
    const wrap = liveStageDisplayPlan(
      input(-25 * MINUTE, 4 * MINUTE, {
        settings: { ...DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS, endsWithQuestions: false },
      }),
    );
    expect(wrap.banner?.text).toBe("Wrap up");
    const off = liveStageDisplayPlan(
      input(-25 * MINUTE, 4 * MINUTE, { settings: { ...DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS, nearEndSeconds: 0 } }),
    );
    expect([off.banner, off.footer.marker]).toEqual([null, "live"]);
  });

  it("puts the operators' message above the near-end cue", () => {
    const plan = liveStageDisplayPlan(
      input(-25 * MINUTE, 4 * MINUTE, {
        speakerMessage: { text: "Two minutes for questions", tone: "warning", flash: true, change: null },
      }),
    );
    expect(plan.banner).toMatchObject({ text: "Two minutes for questions", source: "operator", flash: true });
  });

  it("shows reactions only with no banner, no timer warning and the switch on", () => {
    expect(liveStageDisplayPlan(input(-10 * MINUTE, 20 * MINUTE)).reactions).toBe(true);
    expect(liveStageDisplayPlan(input(-10 * MINUTE, 20 * MINUTE, { own: both })).reactions).toBe(false);
    expect(liveStageDisplayPlan(input(-25 * MINUTE, 4 * MINUTE)).reactions).toBe(false);
    const off = { ...DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS, reactions: false };
    expect(liveStageDisplayPlan(input(-10 * MINUTE, 20 * MINUTE, { settings: off })).reactions).toBe(false);
  });
});
