import { describe, expect, it } from "vitest";
import {
  canSetLiveParticipationBlock,
  liveParticipationActions,
  livePauseEndsAt,
  liveRestrictionActive,
} from "../../assets/shared/live-moderation-policy";

const author = { mine: false, staff: false, restriction: null };

describe("live moderation policy", () => {
  it("lets moderators pause and block for the session, and only organizers block for the event", () => {
    expect(canSetLiveParticipationBlock({ role: "operator", organizer: false }, "session")).toBe(true);
    expect(canSetLiveParticipationBlock({ role: "operator", organizer: false }, "event")).toBe(false);
    expect(canSetLiveParticipationBlock({ role: "operator", organizer: true }, "event")).toBe(true);
    expect(canSetLiveParticipationBlock({ role: "speaker" }, "paused")).toBe(false);
  });

  it("offers each action for the author's current block, never on staff or yourself", () => {
    expect([...liveParticipationActions({ role: "operator", organizer: true }, author)]).toEqual([
      "pause",
      "block",
      "blockEvent",
    ]);
    expect([...liveParticipationActions({ role: "operator" }, { ...author, restriction: "paused" })]).toEqual([
      "block",
      "lift",
    ]);
    expect([...liveParticipationActions({ role: "operator" }, { ...author, restriction: "event" })]).toEqual([]);
    expect(liveParticipationActions({ role: "operator" }, { ...author, staff: true }).size).toBe(0);
    expect(liveParticipationActions({ role: "operator" }, { ...author, mine: true }).size).toBe(0);
    expect(liveParticipationActions({ role: "attendee" }, author).size).toBe(0);
  });

  it("ends a pause ten minutes after it starts, as a UTC instant", () => {
    const until = livePauseEndsAt("2026-11-17T10:00:00.000Z");
    expect(until).toBe("2026-11-17T10:10:00.000Z");
    expect(liveRestrictionActive({ block: "paused", until }, Date.parse("2026-11-17T10:09:59.000Z"))).toBe(true);
    expect(liveRestrictionActive({ block: "paused", until }, Date.parse(until))).toBe(false);
    expect(liveRestrictionActive({ block: "session", until: null }, Date.now())).toBe(true);
  });
});
