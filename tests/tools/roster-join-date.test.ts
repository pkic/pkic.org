import { describe, expect, it } from "vitest";
import { rosterJoinedAt } from "../../scripts/migrate-members/roster-join-date.mjs";

describe("historical roster join dates", () => {
  const parts = { year: 2023, month: 1, day: 15, hour: 10, minute: 0, second: 12 };
  it("converts winter and summer wall clocks using the approved IANA zone", () => {
    expect(rosterJoinedAt(parts, "Europe/Tallinn")).toBe("2023-01-15T08:00:12.000Z");
    expect(rosterJoinedAt({ ...parts, month: 7 }, "Eastern European Summer Time", "Europe/Tallinn")).toBe(
      "2023-07-15T07:00:12.000Z",
    );
  });
  it("rejects ambiguous zone labels and nonexistent local times", () => {
    expect(() => rosterJoinedAt(parts, "Eastern European Summer Time")).toThrow("IANA");
    expect(() => rosterJoinedAt(parts, "EET")).toThrow("IANA");
    expect(() => rosterJoinedAt({ ...parts, month: 3, day: 26, hour: 3 }, "Europe/Tallinn")).toThrow("does not exist");
    expect(rosterJoinedAt(null, null)).toBeNull();
  });
});
