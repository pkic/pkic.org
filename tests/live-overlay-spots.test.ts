import { describe, expect, it } from "vitest";
import { liveOverlayCoveredBy, liveOverlayWaitsForTurn } from "../assets/shared/live-overlay-cover";
import { LIVE_OVERLAY_PRESET_LAYOUTS } from "../assets/shared/live-overlay-layout-presets";
import {
  liveOverlayNextTurnAt,
  liveOverlayPartialOverlaps,
  liveOverlaySpotOf,
  liveOverlaySpots,
  liveOverlaySpotTurns,
  liveOverlayTurnHolder,
} from "../assets/shared/live-overlay-spots";
import type { LiveOverlayLayoutElements } from "../assets/shared/schemas/live-overlay-layout";
import { EMPTY_LIVE_STAGE, type LiveStage } from "../assets/shared/schemas/live-session-room";
import {
  snapIntoSpot,
  spotTurnsFor,
  withSpotTurns,
} from "../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-spots";
import { layoutElementsChanged } from "../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-sharing";

const BREAK = LIVE_OVERLAY_PRESET_LAYOUTS.break.elements;
const onAir = (stage: Partial<LiveStage>): LiveStage => ({ ...EMPTY_LIVE_STAGE, ...stage }) as LiveStage;
const schedule = { config: {} } as unknown as LiveStage["schedule"];
const chatFeed = { messages: [{ id: "m1" }] } as unknown as LiveStage["chatFeed"];
const topQuestions = { questions: [{ id: "q1" }] } as unknown as LiveStage["topQuestions"];

describe("a scene's spots", () => {
  it("puts Break's Up next, chat and top questions in one spot beside the clip that takes turns every 15 seconds", () => {
    const spot = liveOverlaySpotOf(BREAK, "chat")!;
    expect([...spot].sort()).toEqual(["chat", "schedule", "topQuestions"]);
    expect(liveOverlaySpots(BREAK)).toHaveLength(1);
    expect(liveOverlaySpotTurns(BREAK, spot)).toBe(15);
    // The column runs from 1376 to the title-safe edge, clear of the 1280 × 720 clip at 48, 48.
    expect(BREAK.schedule.x * 1920).toBeCloseTo(1376, 0);
    expect((BREAK.schedule.x + BREAK.schedule.w) * 1920).toBeCloseTo(1872, 0);
    expect(BREAK.schedule.comesOn).toBe(true);
  });

  it("finds no board in a built-in scene that only partly covers another", () => {
    for (const { elements } of Object.values(LIVE_OVERLAY_PRESET_LAYOUTS))
      expect(liveOverlayPartialOverlaps(elements)).toEqual([]);
  });

  it("names two boards that partly overlap, front one first", () => {
    const scene: LiveOverlayLayoutElements = {
      ...BREAK,
      chat: { ...BREAK.chat, turns: undefined, y: BREAK.chat.y + 0.1 },
    };
    expect(liveOverlayPartialOverlaps(scene).map((pair) => [...pair].sort())).toContainEqual(["chat", "schedule"]);
  });
});

describe("taking turns", () => {
  it("gives every output the same board at the same moment, front first, and says when the next turn starts", () => {
    expect(liveOverlayTurnHolder(["a", "b", "c"], 15, 0)).toBe("a");
    expect(liveOverlayTurnHolder(["a", "b", "c"], 15, 15_000)).toBe("b");
    expect(liveOverlayTurnHolder(["a", "b", "c"], 15, 44_999)).toBe("c");
    expect(liveOverlayTurnHolder(["a", "b", "c"], 15, 45_000)).toBe("a");
    expect(liveOverlayTurnHolder([], 15, 0)).toBeNull();
    expect(liveOverlayNextTurnAt(15, 16_000)).toBe(30_000);
  });

  it("lets a board on its own keep the spot, and makes the others wait while one holds the turn", () => {
    const alone = onAir({ schedule });
    expect(liveOverlayWaitsForTurn(alone, BREAK, "schedule", 15_000)).toBe(false);
    const all = onAir({ schedule, chatFeed, topQuestions });
    const waiting = (now: number) =>
      (["schedule", "chat", "topQuestions"] as const).filter((board) =>
        liveOverlayWaitsForTurn(all, BREAK, board, now),
      );
    for (const now of [0, 15_000, 30_000]) expect(waiting(now)).toHaveLength(2);
    // A board waiting for its turn is not covered: the studio says it is next in turn.
    for (const board of ["schedule", "chat", "topQuestions"] as const)
      expect(liveOverlayCoveredBy(all, BREAK, board)).toBeNull();
  });

  it("shows only the front board of a spot that does not take turns, and hides the ones behind it", () => {
    const front = withSpotTurns(BREAK, "chat", null);
    const all = onAir({ schedule, chatFeed, topQuestions });
    const [first, ...behind] = liveOverlaySpotOf(front, "chat")!;
    expect(liveOverlayCoveredBy(all, front, first!)).toBeNull();
    for (const board of behind) expect(liveOverlayCoveredBy(all, front, board)).not.toBeNull();
    expect(liveOverlayWaitsForTurn(all, front, "chat", 0)).toBe(false);
  });
});

describe("editing a spot", () => {
  it("sets the spot's turns on every board in it, and a change of turns is a change to save", () => {
    const slower = withSpotTurns(BREAK, "chat", 30);
    for (const board of ["schedule", "chat", "topQuestions"] as const) expect(slower[board].turns).toBe(30);
    expect(layoutElementsChanged(slower, BREAK)).toBe(true);
    expect(layoutElementsChanged({ ...BREAK, chat: { ...BREAK.chat, locked: true } }, BREAK)).toBe(true);
    expect(layoutElementsChanged(BREAK, BREAK)).toBe(false);
  });

  it("drops a board mostly over another into that board's box, and takes the spot's turns", () => {
    const scene: LiveOverlayLayoutElements = { ...BREAK, poll: { ...BREAK.poll, visible: true } };
    const near = { x: BREAK.chat.x + 0.01, y: BREAK.chat.y + 0.02, w: BREAK.chat.w, h: BREAK.chat.h };
    const landed = snapIntoSpot(scene, "poll", near);
    expect(landed).toEqual({ x: BREAK.chat.x, y: BREAK.chat.y, w: BREAK.chat.w, h: BREAK.chat.h });
    expect(spotTurnsFor({ ...scene, poll: { ...scene.poll, ...landed } }, "poll")).toBe(15);
    // Less than half over it, it stays where it was dropped; a graphic that is not a board never snaps.
    const apart = { ...near, x: BREAK.chat.x - BREAK.chat.w * 0.6 };
    expect(snapIntoSpot(scene, "poll", apart)).toEqual(apart);
    expect(snapIntoSpot(scene, "timer", near)).toEqual(near);
  });
});
