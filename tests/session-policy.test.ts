import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBER_SESSION_TTL_HOURS,
  DEFAULT_USER_SESSION_IDLE_TTL_HOURS,
  resolveMemberSessionTtlHours,
  sessionIdleExpiresAt,
  STAFF_SESSION_IDLE_TTL_HOURS,
} from "../functions/_lib/auth/session-policy";

describe("member session policy", () => {
  it("uses a seven-day user idle limit and a one-hour staff idle limit", () => {
    expect(DEFAULT_USER_SESSION_IDLE_TTL_HOURS).toBe(168);
    expect(STAFF_SESSION_IDLE_TTL_HOURS).toBe(1);
  });

  it("never lets an inactivity deadline exceed the absolute session expiry", () => {
    const activityAt = Date.parse("2026-09-28T10:00:00.000Z") / 1000;
    expect(sessionIdleExpiresAt(activityAt, "2026-10-31T10:00:00.000Z", 1)).toBe("2026-09-28T11:00:00.000Z");
    expect(sessionIdleExpiresAt(activityAt, "2026-09-28T10:30:00.000Z", 1)).toBe("2026-09-28T10:30:00.000Z");
  });

  it("accepts a complete positive integer", () => {
    expect(resolveMemberSessionTtlHours("48")).toBe(48);
  });

  it.each([undefined, "", "0", "-1", "12junk", "12.5", "Infinity", "9007199254740992"])(
    "falls back for invalid session TTL %s",
    (value) => {
      expect(resolveMemberSessionTtlHours(value)).toBe(DEFAULT_MEMBER_SESSION_TTL_HOURS);
    },
  );
});
