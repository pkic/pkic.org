import { describe, expect, it } from "vitest";
import { allocateAgendaRoles } from "../../assets/shared/event-agenda-policy";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";

describe("selected block rotation", () => {
  it("skips a speaker who needs travel time and permits an exact same-room boundary", () => {
    const snapshot = agendaSnapshotSchema.parse({
      eventSlug: "synthetic",
      timeZone: "UTC",
      revision: 0,
      publishedRevision: null,
      rooms: [],
      assignments: [],
      shifts: [
        {
          id: "block",
          name: "Next block",
          startAt: "2026-12-01T10:00:00.000Z",
          endAt: "2026-12-01T11:00:00.000Z",
          roomId: "b",
          roles: ["mc"],
        },
      ],
      roleMembers: ["one", "two"].map((userId) => ({
        userId,
        displayName: userId,
        roles: ["mc"],
        availableFrom: null,
        availableUntil: null,
        maxMinutes: null,
      })),
      occurrences: [
        {
          id: "talk",
          title: "Prior talk",
          startAt: "2026-12-01T09:00:00.000Z",
          endAt: "2026-12-01T10:00:00.000Z",
          roomId: "a",
          speakers: [{ userId: "one", displayName: "One" }],
        },
      ],
    });
    const result = allocateAgendaRoles(
      snapshot.shifts,
      snapshot.roleMembers,
      [],
      snapshot.occurrences,
      "travel",
      "balanced",
      undefined,
      10,
    );
    expect(result.assignments[0]?.userId).toBe("two");
    snapshot.shifts[0].roomId = "a";
    expect(
      allocateAgendaRoles(
        snapshot.shifts,
        snapshot.roleMembers,
        [],
        snapshot.occurrences,
        "travel",
        "balanced",
        undefined,
        10,
      ).assignments[0]?.userId,
    ).toBe("one");
  });
  it("accounts for preserved workload and does not allocate outside the selected shifts", () => {
    const snapshot = agendaSnapshotSchema.parse({
      eventSlug: "synthetic",
      timeZone: "UTC",
      revision: 0,
      publishedRevision: null,
      rooms: [],
      occurrences: [],
      shifts: ["a", "b", "c"].map((id, index) => ({
        id,
        name: id,
        startAt: `2026-12-01T${String(9 + index).padStart(2, "0")}:00:00.000Z`,
        endAt: `2026-12-01T${String(10 + index).padStart(2, "0")}:00:00.000Z`,
        roomId: null,
        roles: ["mc"],
      })),
      roleMembers: ["one", "two"].map((userId) => ({
        userId,
        displayName: userId,
        roles: ["mc"],
        availableFrom: null,
        availableUntil: null,
        maxMinutes: null,
      })),
      assignments: [],
    });
    const fixed = { shiftId: "a", role: "mc", userId: "one", pinned: true };
    const result = allocateAgendaRoles(
      snapshot.shifts,
      snapshot.roleMembers,
      [fixed],
      [],
      "reviewable",
      "balanced",
      new Set(["b"]),
    );
    expect(result.assignments).toEqual([
      fixed,
      { shiftId: "b", role: "mc", userId: "two", pinned: false, origin: "generated" },
    ]);
    expect(result.uncovered).toEqual([]);
    expect(result.assignments.some((assignment) => assignment.shiftId === "c")).toBe(false);
  });
});
