import { describe, expect, it } from "vitest";
import { agendaShiftSchema, agendaRoleMemberSchema } from "../../assets/shared/schemas/event-agenda";
import { agendaStaffingPositionPlanSchema } from "../../assets/shared/schemas/event-agenda-staffing-positions";
import {
  allocateAgendaStaffingPositions,
  agendaStaffingPositionCoverage,
  agendaStaffingPositionShortfalls,
  validateAgendaStaffingPositionAssignments,
} from "../../assets/shared/event-agenda-staffing-positions";
function fixture() {
  const shifts = [
    agendaShiftSchema.parse({
      id: "morning",
      name: "Morning",
      startAt: "2027-01-01T09:00:00.000Z",
      endAt: "2027-01-01T10:00:00.000Z",
      roomId: null,
      roles: ["badge-scanner"],
    }),
  ];
  const members = Array.from({ length: 6 }, (_, index) =>
    agendaRoleMemberSchema.parse({
      userId: `person-${index}`,
      displayName: `Person ${index}`,
      roles: ["badge-scanner"],
      availableFrom: null,
      availableUntil: null,
      maxMinutes: null,
    }),
  );
  return {
    ...agendaStaffingPositionPlanSchema.parse({
      roles: [{ id: "badge-scanner", name: "Badge scanning" }],
      posts: [
        { id: "north", name: "North door", roomId: "north-room" },
        { id: "south", name: "South door", roomId: "south-room" },
      ],
      requirements: ["north", "south"].map((postId) => ({
        id: postId,
        shiftId: "morning",
        roleId: "badge-scanner",
        postId,
        idealCount: 2,
        attendanceMode: "physical",
      })),
      positions: ["north", "south"].flatMap((requirementId) =>
        [1, 2].map((index) => ({ id: `${requirementId}-${index}`, requirementId, index })),
      ),
      assignments: [],
    }),
    shifts,
    members,
    occurrences: [],
    seed: "same-seed",
    strategy: "random" as const,
  };
}
describe("event-defined staffing positions", () => {
  it("explains successful shortfalls from current assignments without allocating or weakening constraints", () => {
    const input = fixture();
    input.members = input.members.slice(0, 1);
    const generated = allocateAgendaStaffingPositions(input);
    const plan = { ...input, assignments: generated.assignments };
    const before = JSON.stringify(plan);
    const shortages = agendaStaffingPositionShortfalls(plan);
    expect(shortages).toHaveLength(3);
    expect(shortages.every((row) => row.eligiblePeople === 0)).toBe(true);
    expect(shortages[0].reasons).toContainEqual({ reason: "conflict", people: 1 });
    expect(JSON.stringify(plan)).toBe(before);
    const available = agendaStaffingPositionShortfalls({ ...input, assignments: [] });
    expect(available.every((row) => row.eligiblePeople === 1 && row.reasons.length === 0)).toBe(true);
    const external = agendaStaffingPositionShortfalls({
      ...input,
      assignments: [],
      unavailablePairs: new Set([JSON.stringify(["north-1", input.members[0].userId])]),
    });
    expect(external.find((row) => row.positionId === "north-1")?.reasons).toEqual([
      { reason: "external_conflict", people: 1 },
    ]);
  });

  it("combines explicitly compatible distinct roles only at the same post", () => {
    const input = fixture();
    input.members = input.members.slice(0, 1);
    input.roles.push({ id: "room-questions", name: "Room questions", showOnAgenda: false });
    input.members[0].roles.push("room-questions");
    input.shifts[0].roles.push("room-questions");
    input.shifts[0].compatibleRolePairs = [["badge-scanner", "room-questions"]];
    input.requirements.forEach((row) => (row.idealCount = 1));
    input.positions = input.positions.filter((row) => row.index === 1);
    input.requirements[1].roleId = "room-questions";
    input.requirements[1].postId = "north";
    const together = allocateAgendaStaffingPositions(input);
    expect(together.assignments).toHaveLength(2);
    expect(new Set(together.assignments.map((row) => row.userId)).size).toBe(1);
    expect(validateAgendaStaffingPositionAssignments({ ...input, assignments: together.assignments })).toEqual([]);
    input.requirements[1].postId = "south";
    expect(allocateAgendaStaffingPositions(input).uncovered).toHaveLength(1);
  });
  it("fills two doors with two distinct people each without encoding the role into a position", () => {
    const input = fixture(),
      result = allocateAgendaStaffingPositions(input);
    expect(result.assignments).toHaveLength(4);
    expect(new Set(result.assignments.map((row) => row.userId)).size).toBe(4);
    expect(result.assignments.every((row) => row.role === "badge-scanner")).toBe(true);
    expect(result.uncovered).toEqual([]);
    expect(allocateAgendaStaffingPositions(input)).toEqual(result);
    expect(agendaStaffingPositionCoverage({ ...input, assignments: result.assignments })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ postId: "north", idealCount: 2, assignedCount: 2, missingCount: 0 }),
        expect.objectContaining({ postId: "south", idealCount: 2, assignedCount: 2, missingCount: 0 }),
      ]),
    );
  });
  it("retains pinned senior people, accepts arbitrary roles and explains staffing shortages", () => {
    const input = fixture();
    input.roles[0] = { id: "welcome-desk", name: "Welcome desk", showOnAgenda: false };
    input.requirements.forEach((requirement) => (requirement.roleId = "welcome-desk"));
    input.members = input.members.slice(0, 3).map((member) => ({ ...member, roles: ["welcome-desk"] }));
    input.members[0].seniority = "senior";
    input.requirements[0].seniority = "senior";
    input.assignments = [
      {
        positionId: "north-1",
        shiftId: "morning",
        role: "welcome-desk",
        postId: "north",
        userId: input.members[0].userId,
        pinned: true,
        origin: "manual",
      },
    ];
    const result = allocateAgendaStaffingPositions(input);
    expect(result.assignments[0]).toEqual(input.assignments[0]);
    expect(result.uncovered).toContainEqual(
      expect.objectContaining({
        positionId: "north-2",
        role: "welcome-desk",
        reasons: expect.arrayContaining([{ reason: "experience", people: 2 }]),
      }),
    );
    expect(
      agendaStaffingPositionCoverage({ ...input, assignments: result.assignments }).find(
        (row) => row.postId === "north",
      ),
    ).toMatchObject({ assignedCount: 1, missingCount: 1 });
  });
  it("rejects one person covering simultaneous positions and pins outside eligibility", () => {
    const input = fixture();
    input.assignments = ["north-1", "south-1"].map((positionId) => ({
      positionId,
      shiftId: "morning",
      role: "badge-scanner",
      postId: positionId.startsWith("north") ? "north" : "south",
      userId: input.members[0].userId,
      pinned: true,
    }));
    expect(validateAgendaStaffingPositionAssignments(input)).toHaveLength(2);
    expect(validateAgendaStaffingPositionAssignments(input).every((row) => row.reasons.includes("conflict"))).toBe(
      true,
    );
    input.assignments = input.assignments.slice(0, 1);
    input.members[0].availableFrom = "2027-01-01T09:30:00.000Z";
    expect(validateAgendaStaffingPositionAssignments(input)[0].reasons).toContain("availability");
  });
  it("keeps physical door duties separate from remote support requirements", () => {
    const input = fixture();
    input.members = input.members.slice(0, 2);
    input.members[0].attendanceMode = "remote";
    input.requirements[1].attendanceMode = "remote";
    const result = allocateAgendaStaffingPositions(input);
    expect(result.assignments.find((row) => row.postId === "north")?.userId).toBe(input.members[1].userId);
    expect(result.assignments.find((row) => row.postId === "south")?.userId).toBe(input.members[0].userId);
    expect(result.uncovered).toHaveLength(2);
    expect(result.uncovered[0].reasons).toContainEqual({ reason: "attendance", people: 1 });
  });
  it("balances duty minutes across consecutive shifts while preserving position pins", () => {
    const input = fixture();
    const afternoon = {
      ...input.shifts[0],
      id: "afternoon",
      startAt: "2027-01-01T11:00:00.000Z",
      endAt: "2027-01-01T12:00:00.000Z",
    };
    input.shifts.push(afternoon);
    const requirements = input.requirements.map((row) => ({ ...row, id: `${row.id}-later`, shiftId: afternoon.id }));
    input.requirements.push(...requirements);
    input.positions.push(
      ...requirements.flatMap((row) =>
        [1, 2].map((index) => ({ id: `${row.id}-${index}`, requirementId: row.id, index })),
      ),
    );
    input.assignments = [
      {
        positionId: "north-1",
        shiftId: "morning",
        role: "badge-scanner",
        postId: "north",
        userId: "person-0",
        pinned: true,
      },
    ];
    const result = allocateAgendaStaffingPositions(input);
    const loads = input.members.map(
      (member) => result.assignments.filter((row) => row.userId === member.userId).length * 60,
    );
    expect(result.assignments[0]).toEqual(input.assignments[0]);
    expect(result.uncovered).toEqual([]);
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(60);
  });
  it("validates exact requested headcounts and matching position identities", () => {
    const input = fixture();
    expect(agendaStaffingPositionPlanSchema.safeParse({ ...input, positions: input.positions.slice(1) }).success).toBe(
      false,
    );
    expect(
      agendaStaffingPositionPlanSchema.safeParse({
        ...input,
        assignments: [
          {
            positionId: "north-1",
            shiftId: "morning",
            role: "badge-scanner",
            postId: "south",
            userId: "person-0",
            pinned: true,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
