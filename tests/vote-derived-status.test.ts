import { describe, expect, it } from "vitest";
import { deriveVoteStatus, isVoteAcceptingBallots } from "../functions/_lib/services/votes/status";

const T = (iso: string) => iso;
const NOW = T("2026-06-15T12:00:00.000Z");

function vote(overrides: Partial<Parameters<typeof deriveVoteStatus>[0]> = {}) {
  return {
    opens_at: T("2026-06-01T00:00:00.000Z"),
    closes_at: T("2026-07-01T00:00:00.000Z"),
    opened_at: null,
    closed_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

describe("derived vote status", () => {
  it("reads as open from the schedule alone, before any job has run", () => {
    // The regression this replaces: the window had opened but the transition
    // job had not yet flipped a stored string, so members were shown the vote
    // as not yet votable for up to a full scheduling interval.
    expect(deriveVoteStatus(vote({ opened_at: null }), NOW)).toBe("open");
    expect(isVoteAcceptingBallots(vote({ opened_at: null }), NOW)).toBe(true);
  });

  it("stops accepting ballots the instant the window closes, even if no job has run", () => {
    const past = vote({ closes_at: T("2026-06-15T11:59:59.999Z"), closed_at: null });
    expect(deriveVoteStatus(past, NOW)).toBe("closed");
    expect(isVoteAcceptingBallots(past, NOW)).toBe(false);
  });

  it("is scheduled before its window opens", () => {
    const future = vote({ opens_at: T("2026-06-20T00:00:00.000Z") });
    expect(deriveVoteStatus(future, NOW)).toBe("scheduled");
    expect(isVoteAcceptingBallots(future, NOW)).toBe(false);
  });

  it("treats a completed close as closed even inside the window", () => {
    // A manual close ends the vote early; the schedule must not reopen it.
    const closedEarly = vote({ closed_at: T("2026-06-10T00:00:00.000Z") });
    expect(deriveVoteStatus(closedEarly, NOW)).toBe("closed");
    expect(isVoteAcceptingBallots(closedEarly, NOW)).toBe(false);
  });

  it("lets cancellation outrank every other state", () => {
    const cancelled = vote({ cancelled_at: T("2026-06-02T00:00:00.000Z"), closed_at: null });
    expect(deriveVoteStatus(cancelled, NOW)).toBe("cancelled");
    expect(isVoteAcceptingBallots(cancelled, NOW)).toBe(false);
    // Even one already closed.
    expect(deriveVoteStatus(vote({ cancelled_at: NOW, closed_at: NOW }), NOW)).toBe("cancelled");
  });

  it("is exact at both boundaries", () => {
    const opensNow = vote({ opens_at: NOW });
    expect(isVoteAcceptingBallots(opensNow, NOW)).toBe(true);
    const closesNow = vote({ closes_at: NOW });
    expect(isVoteAcceptingBallots(closesNow, NOW)).toBe(false);
  });
});
