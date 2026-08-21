import { describe, expect, it } from "vitest";
import { DEFAULT_MEMBER_SESSION_TTL_HOURS, resolveMemberSessionTtlHours } from "../functions/_lib/auth/session-policy";

describe("member session policy", () => {
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
