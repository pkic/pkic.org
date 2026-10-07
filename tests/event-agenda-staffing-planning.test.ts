import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { agendaSnapshotSchema, agendaStaffingSchema } from "../assets/shared/schemas/event-agenda";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);
it("saves an empty planning shift before configuring positions and keeps roster eligibility required", async () => {
  await seedEventAndAdmin(env.DB);
  const admin = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!;
  const token = await createAdminSession(env.DB, admin.id, "staffing-planning");
  const input = agendaStaffingSchema.parse({
    expectedRevision: 0,
    shifts: [
      {
        id: "planning",
        name: "Opening doors",
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId: null,
        roles: [],
      },
    ],
    roleMembers: [],
    assignments: [],
    staffingRoles: [],
    staffingPosts: [],
    staffingRequirements: [],
    staffingPositions: [],
  });
  const response = await callApi(env, "/api/v1/events/pqc-2026/agenda/staffing", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  expect(response.status).toBe(200);
  const saved = agendaSnapshotSchema.parse(await response.json());
  expect(saved.revision).toBe(1);
  expect(saved.shifts).toHaveLength(1);
  expect(saved.shifts[0].roles).toEqual([]);
  expect(saved.staffingRequirements).toEqual([]);
  expect(saved.staffingPositions).toEqual([]);
  expect(saved.assignments).toEqual([]);
  expect(
    agendaStaffingSchema.safeParse({
      ...input,
      roleMembers: [
        {
          userId: admin.id,
          displayName: "Staff",
          roles: [],
          availableFrom: null,
          availableUntil: null,
          maxMinutes: null,
        },
      ],
    }).success,
  ).toBe(false);
});
