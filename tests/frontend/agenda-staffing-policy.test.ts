import { describe, expect, it } from "vitest";
import { agendaShiftSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { allocateAgendaRoles, agendaStaffingReport } from "../../assets/shared/event-agenda-staffing";
const snapshot = () =>
  agendaSnapshotSchema.parse({
    eventSlug: "synthetic",
    timeZone: "UTC",
    revision: 0,
    publishedRevision: null,
    rooms: [],
    occurrences: [],
    assignments: [],
    shifts: ["a", "b", "c"].map((id, index) => ({
      id,
      name: id,
      startAt: `2026-12-01T${9 + index}:00:00.000Z`.replace("T9:", "T09:"),
      endAt: `2026-12-01T${10 + index}:00:00.000Z`,
      roomId: "room",
      roles: ["mc"],
    })),
    roleMembers: ["one", "two"].map((userId) => ({
      userId,
      displayName: userId,
      roles: ["mc", "questions"],
      availableFrom: null,
      availableUntil: null,
      maxMinutes: null,
    })),
  });
describe("Staffing eligibility and fair review", () => {
  it("permits only configured same-shift duty pairs while retaining workload limits", () => {
    const s = snapshot();
    s.shifts = s.shifts.slice(0, 1);
    s.shifts[0].roles = ["mc", "questions"];
    s.roleMembers = s.roleMembers.slice(0, 1);
    expect(
      allocateAgendaRoles(s.shifts, s.roleMembers, [], [], "same", "balanced").uncovered[0].reasons,
    ).toContainEqual({ reason: "conflict", people: 1 });
    s.shifts[0].compatibleRolePairs = [["mc", "questions"]];
    const result = allocateAgendaRoles(s.shifts, s.roleMembers, [], [], "same", "balanced");
    expect(result.assignments).toHaveLength(2);
    s.roleMembers[0].maxMinutes = 90;
    expect(
      allocateAgendaRoles(s.shifts, s.roleMembers, [], [], "same", "balanced").uncovered[0].reasons,
    ).toContainEqual({ reason: "workload", people: 1 });
    expect(agendaShiftSchema.safeParse({ ...s.shifts[0], compatibleRolePairs: [["mc", "mc"]] }).success).toBe(false);
  });
  it("spreads consecutive duty at equal role and duration workload and reproduces randomized review", () => {
    const s = snapshot();
    const pinned = [
      { shiftId: "a", role: "mc", userId: "two", pinned: true },
      { shiftId: "b", role: "mc", userId: "one", pinned: true },
    ];
    const result = allocateAgendaRoles(s.shifts, s.roleMembers, pinned, [], "repeatable", "random");
    expect(result.assignments.at(-1)?.userId).toBe("two");
    expect(result).toEqual(allocateAgendaRoles(s.shifts, s.roleMembers, pinned, [], "repeatable", "random"));
  });
  it("reports precise ineligible reasons and unequal pinned/manual workload without hiding changed break boundaries", () => {
    const s = snapshot();
    s.roleMembers = s.roleMembers.slice(0, 1);
    s.roleMembers[0].attendanceMode = "remote";
    s.shifts[0].roleRequirements = [{ role: "mc", seniority: "senior", attendanceMode: "physical" }];
    const result = allocateAgendaRoles([s.shifts[0]], s.roleMembers, [], [], "reason", "balanced");
    expect(result.uncovered[0].reasons).toEqual(
      expect.arrayContaining([
        { reason: "experience", people: 1 },
        { reason: "attendance", people: 1 },
      ]),
    );
    s.shifts[0].boundaries = { endOccurrenceId: "coffee" };
    s.assignments = [
      { positionId: "a-mc", postId: null, shiftId: "a", role: "mc", userId: "one", pinned: true, origin: "manual" },
    ];
    const report = agendaStaffingReport(s);
    expect(report.people[0]).toMatchObject({
      minutes: 60,
      pinnedCount: 1,
      manualCount: 1,
      roles: [
        { role: "mc", minutes: 60 },
        { role: "questions", minutes: 0 },
      ],
    });
    expect(report.boundaryChanges).toEqual([{ shiftId: "a", boundary: "end", occurrenceId: "coffee" }]);
    expect(report.uncovered).toHaveLength(2);
  });
});

it("allows remote duties across different room labels without relaxing time conflicts", () => {
  const s = snapshot();
  s.shifts = [
    s.shifts[0],
    { ...s.shifts[1], roomId: "other", startAt: "2026-12-01T10:05:00.000Z", endAt: "2026-12-01T10:35:00.000Z" },
  ];
  s.roleMembers = [{ ...s.roleMembers[0], attendanceMode: "remote" }];
  const assignments = [{ shiftId: s.shifts[0].id, role: "mc", userId: s.roleMembers[0].userId, pinned: true }];
  expect(
    allocateAgendaRoles(s.shifts, s.roleMembers, assignments, [], "remote", "balanced", undefined, 15).uncovered,
  ).toHaveLength(0);
  s.shifts[1].startAt = "2026-12-01T09:55:00.000Z";
  expect(
    allocateAgendaRoles(s.shifts, s.roleMembers, assignments, [], "remote", "balanced", undefined, 15).uncovered,
  ).toHaveLength(1);
});
