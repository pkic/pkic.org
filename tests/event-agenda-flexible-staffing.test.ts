import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { agendaSnapshotSchema, agendaStaffingSchema } from "../assets/shared/schemas/event-agenda";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
let eventId: string, token: string, admin: string;
const roomId = crypto.randomUUID();
const people: string[] = Array.from({ length: 5 }, () => crypto.randomUUID());
const roles = [
  { id: "scanner", name: "Door scanner" },
  { id: "mc", name: "MC" },
  { id: "welcome", name: "Welcome host" },
];
function body(expectedRevision = 0) {
  const requirements = [
    {
      id: "north-scanners",
      shiftId: "opening",
      roleId: "scanner",
      postId: "north-door",
      idealCount: 2,
      attendanceMode: "physical",
    },
    {
      id: "south-scanners",
      shiftId: "opening",
      roleId: "scanner",
      postId: "south-door",
      idealCount: 2,
      attendanceMode: "physical",
    },
    { id: "opening-mc", shiftId: "opening", roleId: "mc", postId: null, idealCount: 1, seniority: "senior" },
  ];
  return agendaStaffingSchema.parse({
    expectedRevision,
    shifts: [
      {
        id: "opening",
        name: "Doors and opening",
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId,
        roles: ["scanner", "mc"],
      },
    ],
    staffingRoles: roles,
    staffingPosts: [
      { id: "north-door", name: "North door", roomId },
      { id: "south-door", name: "South door", roomId },
    ],
    staffingRequirements: requirements,
    staffingPositions: requirements.flatMap((requirement) =>
      Array.from({ length: requirement.idealCount }, (_, index) => ({
        id: `${requirement.id}-${index + 1}`,
        requirementId: requirement.id,
        index: index + 1,
      })),
    ),
    roleMembers: people.map((userId, index) => ({
      userId,
      displayName: `Person ${index}`,
      roles: index === 0 ? ["mc"] : ["scanner", "welcome"],
      availableFrom: null,
      availableUntil: null,
      maxMinutes: 120,
      seniority: index === 0 ? "senior" : "junior",
      attendanceMode: "physical",
    })),
    assignments: [
      {
        positionId: "opening-mc-1",
        shiftId: "opening",
        role: "mc",
        postId: null,
        userId: people[0],
        pinned: true,
        origin: "manual",
      },
    ],
  });
}
function request(path: string, payload?: unknown, authenticated = true) {
  return callApi(env, `/api/v1/events/pqc-2026/agenda${path}`, {
    method: payload ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
}
beforeEach(async () => {
  await resetDb();
  ({ eventId } = await seedEventAndAdmin(env.DB));
  admin = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!.id;
  token = await createAdminSession(env.DB, admin, "flexible-staffing");
  await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,'Main',40)")
    .bind(roomId, eventId)
    .run();
  await env.DB.batch(
    people.map((id, index) =>
      env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)").bind(
        id,
        `door-${index}@example.test`,
        `door-${index}@example.test`,
      ),
    ),
  );
});
describe("Normalized staffing roles and multi-person posts", () => {
  it("covers two positions per door alongside a senior pinned MC without granting scanner authority", async () => {
    expect((await request("/staffing", body(), false)).status).toBe(401);
    const save = await request("/staffing", body());
    expect(save.status).toBe(200);
    const saved = agendaSnapshotSchema.parse(await save.json());
    expect(saved.staffingPositions).toHaveLength(5);
    expect(
      saved.staffingReport?.coverage.filter((item) => item.role === "scanner").map((item) => item.missingCount),
    ).toEqual([2, 2]);
    const response = await request("/allocations", { expectedRevision: 1, seed: "doors", strategy: "random" });
    expect(response.status).toBe(200);
    const allocated = agendaSnapshotSchema.parse(await response.json());
    expect(allocated.assignments).toHaveLength(5);
    expect(new Set(allocated.assignments.map((item) => item.userId)).size).toBe(5);
    expect(
      allocated.assignments.filter((item) => item.role === "scanner" && item.postId === "north-door"),
    ).toHaveLength(2);
    expect(
      allocated.assignments.filter((item) => item.role === "scanner" && item.postId === "south-door"),
    ).toHaveLength(2);
    expect(allocated.assignments).toContainEqual(saved.assignments[0]);
    expect(allocated.staffingReport?.coverage.every((item) => item.missingCount === 0)).toBe(true);
    const grants = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM permission_grants WHERE user_id IN(SELECT value FROM json_each(?))",
    )
      .bind(JSON.stringify(people))
      .first<{ count: number }>();
    expect(grants?.count).toBe(0);
    const stale = body(1);
    stale.staffingRoles[0].name = "Stale replacement";
    expect((await request("/staffing", stale)).status).toBe(409);
    const unchanged = agendaSnapshotSchema.parse(await (await request("")).json());
    expect(unchanged.revision).toBe(2);
    expect(unchanged.assignments).toEqual(allocated.assignments);
    expect(unchanged.staffingRoles.find((role) => role.id === "scanner")?.name).toBe("Door scanner");
  });
  it("keeps headcount shortfalls advisory while mode and availability remain assignment constraints", async () => {
    const input = body();
    input.roleMembers[4].attendanceMode = "remote";
    input.roleMembers[3].availableUntil = "2026-12-01T09:00:00.000Z";
    expect((await request("/staffing", input)).status).toBe(200);
    const response = await request("/allocations", { expectedRevision: 1, seed: "limited", strategy: "balanced" });
    expect(response.status).toBe(200);
    const allocated = agendaSnapshotSchema.parse(await response.json());
    expect(allocated.assignments).toHaveLength(3);
    expect(allocated.assignments.some((item) => [people[3], people[4]].includes(item.userId))).toBe(false);
    expect(allocated.staffingReport?.coverage.reduce((sum, item) => sum + item.missingCount, 0)).toBe(2);
    expect(allocated.staffingReport?.uncovered).toHaveLength(2);
    const invalid = {
      ...input,
      expectedRevision: 2,
      assignments: [
        ...allocated.assignments,
        {
          positionId: allocated.staffingReport!.uncovered[0].positionId,
          shiftId: "opening",
          role: "scanner",
          postId: allocated.staffingReport!.uncovered[0].postId,
          userId: people[4],
          pinned: true,
        },
      ],
    };
    expect((await request("/staffing", invalid)).status).toBe(409);
    expect(agendaSnapshotSchema.parse(await (await request("")).json()).revision).toBe(2);
  });
  it("reuses stable positions for reviewed role/post edits and rolls back an incompatible pinned mode", async () => {
    const input = body();
    expect((await request("/staffing", input)).status).toBe(200);
    const changed = {
      ...input,
      expectedRevision: 1,
      staffingRequirements: input.staffingRequirements.map((requirement) =>
        requirement.id === "opening-mc" ? { ...requirement, roleId: "welcome", postId: "north-door" } : requirement,
      ),
      roleMembers: input.roleMembers.map((member) =>
        member.userId === people[0] ? { ...member, roles: [...member.roles, "welcome"] } : member,
      ),
      assignments: input.assignments.map((assignment) => ({ ...assignment, role: "welcome", postId: "north-door" })),
    };
    expect((await request("/staffing", changed)).status).toBe(200);
    const saved = agendaSnapshotSchema.parse(await (await request("")).json());
    expect(saved.assignments[0]).toMatchObject({
      positionId: "opening-mc-1",
      role: "welcome",
      postId: "north-door",
      userId: people[0],
      pinned: true,
    });
    expect(new Set(saved.staffingPositions.map((position) => position.id))).toEqual(
      new Set(input.staffingPositions.map((position) => position.id)),
    );
    const incompatible = {
      ...changed,
      expectedRevision: 2,
      staffingRequirements: changed.staffingRequirements.map((requirement) =>
        requirement.id === "opening-mc" ? { ...requirement, attendanceMode: "remote" } : requirement,
      ),
    };
    expect((await request("/staffing", incompatible)).status).toBe(409);
    const unchanged = agendaSnapshotSchema.parse(await (await request("")).json());
    expect(unchanged.revision).toBe(2);
    expect(unchanged.assignments).toEqual(saved.assignments);
    expect(unchanged.staffingRequirements.find((requirement) => requirement.id === "opening-mc")?.attendanceMode).toBe(
      "any",
    );
  });
});
