import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { agendaSnapshotSchema, agendaStaffingSchema } from "../../assets/shared/schemas/event-agenda";
import { userCreateSchema, userCreateResponseSchema } from "../../assets/shared/schemas/user-create";
import { userRolesListResponseSchema } from "../../assets/shared/schemas/access-control";
import { userDetailResponseSchema } from "../../assets/shared/schemas/user-management";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";

const slug = "pqc-conference-amsterdam-nl";
const artifacts = process.env.AGENDA_SCREENSHOT_DIR ?? "test-results/agenda-progress";

test("a real multi-day team keeps a senior pin and reports door staffing shortages without granting permissions", async ({
  page,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  await mkdir(artifacts, { recursive: true });
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-staffing-roster"));
  const read = async () =>
    agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  const before = await read();
  const roster: Array<{ id: string; name: string; index: number }> = [];
  for (const [index, name] of ["Senior", "Alex", "Blair", "Remote"].entries()) {
    const response = await page.request.post("/api/v1/users", {
      data: userCreateSchema.parse({
        email: `staffing-${crypto.randomUUID()}@example.test`,
        firstName: name,
        lastName: "Fixture",
      }),
    });
    expect(response.status()).toBe(201);
    roster.push({ id: userCreateResponseSchema.parse(await response.json()).userId, name, index });
  }
  const userBefore = await Promise.all(
    roster.map(async (person) =>
      userDetailResponseSchema.parse(await (await page.request.get(`/api/v1/users/${person.id}`)).json()),
    ),
  );
  const readGrants = async () =>
    Promise.all(
      roster.map(async (person) => {
        const response = await page.request.get(`/api/v1/users/${person.id}/roles`);
        expect(response.ok()).toBe(true);
        return userRolesListResponseSchema.parse(await response.json()).roles;
      }),
    );
  const grantsBefore = await readGrants();
  const prefix = `browser-${crypto.randomUUID()}`;
  const roles = [
    { id: `${prefix}-mc`, name: "MC", showOnAgenda: true },
    { id: `${prefix}-questions`, name: "Remote questions", showOnAgenda: false },
    { id: `${prefix}-scan`, name: "Badge scanning", showOnAgenda: false },
  ];
  const posts = ["North entrance", "South entrance"].map((name, index) => ({
    id: `${prefix}-door-${index}`,
    name,
    roomId: null,
  }));
  const shifts = ["2026-12-01", "2026-12-02"].flatMap((date, day) =>
    [9, 11].map((hour, index) => ({
      id: `${prefix}-shift-${day}-${index}`,
      name: `Day ${day + 1} ${index ? "late morning" : "opening"}`,
      startAt: `${date}T${String(hour - 1).padStart(2, "0")}:00:00.000Z`,
      endAt: `${date}T${String(hour - 1).padStart(2, "0")}:30:00.000Z`,
      roomId: null,
      roles: roles.map((role) => role.id),
      compatibleRolePairs: [],
      roleRequirements: [],
    })),
  );
  const requirements = shifts.flatMap((shift) => [
    {
      id: `${shift.id}-mc`,
      shiftId: shift.id,
      roleId: roles[0]!.id,
      postId: null,
      idealCount: 1,
      seniority: "any",
      attendanceMode: "physical",
    },
    {
      id: `${shift.id}-questions`,
      shiftId: shift.id,
      roleId: roles[1]!.id,
      postId: null,
      idealCount: 1,
      seniority: "any",
      attendanceMode: "remote",
    },
    ...posts.map((post) => ({
      id: `${shift.id}-${post.id}`,
      shiftId: shift.id,
      roleId: roles[2]!.id,
      postId: post.id,
      idealCount: 2,
      seniority: "any",
      attendanceMode: "physical",
    })),
  ]);
  const body = agendaStaffingSchema.parse({
    expectedRevision: before.revision,
    shifts,
    staffingRoles: roles,
    staffingPosts: posts,
    staffingRequirements: requirements,
    staffingPositions: requirements.flatMap((need) =>
      Array.from({ length: need.idealCount }, (_, i) => ({
        id: `${need.id}-position-${i + 1}`,
        requirementId: need.id,
        index: i + 1,
      })),
    ),
    assignments: [],
    roleMembers: roster.map((person) => ({
      userId: person.id,
      displayName: `${person.name} Fixture`,
      roles: person.name === "Remote" ? [roles[1]!.id] : [roles[0]!.id, roles[2]!.id],
      seniority: person.name === "Senior" ? "senior" : "junior",
      attendanceMode: person.name === "Remote" ? "remote" : "physical",
      availableFrom: null,
      availableUntil: null,
      maxMinutes: null,
    })),
  });
  const configured = await page.request.post(`/api/v1/events/${slug}/agenda/staffing`, { data: body });
  expect(configured.ok(), await configured.text()).toBe(true);
  agendaSnapshotSchema.parse(await configured.json());
  await page.goto(`/portal/#/events/${slug}/agenda`);
  await page.getByRole("tab", { name: "Shift roles", exact: true }).click();
  await page.getByRole("button", { name: "Actions for Day 1 opening", exact: true }).click();
  await page.getByRole("menuitem", { name: "Review staffing", exact: true }).click();
  await page.getByRole("button", { name: "Actions for MC · Event", exact: true }).click();
  await page.getByRole("menuitem", { name: "Review positions", exact: true }).click();
  await page.getByRole("button", { name: "Actions for Position 1", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit assignment", exact: true }).click();
  await page.getByLabel("Assigned person", { exact: true }).selectOption(roster[0]!.id);
  await page.getByRole("checkbox", { name: "Pin assignment during rotation", exact: true }).check();
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save assignment", exact: true })).toHaveCount(0);
  const pinned = (await read()).assignments.find((item) => item.pinned)!;
  expect(pinned.userId).toBe(roster[0]!.id);
  expect(pinned.role).toBe(roles[0]!.id);
  expect(pinned.shiftId).toBe(shifts[0]!.id);
  await page.getByRole("button", { name: "Actions for Event staffing", exact: true }).click();
  await page.getByRole("menuitem", { name: "Configure rotation", exact: true }).click();
  await page.getByLabel("Rotation seed", { exact: true }).fill("staffed-multiday-seed");
  await page.getByRole("button", { name: "Generate assignments", exact: true }).click();
  await expect(page.getByText("Assignments generated.", { exact: false })).toBeVisible();
  const generated = await read();
  expect(generated.assignments).toContainEqual(pinned);
  expect(generated.staffingReport!.coverage.filter((item) => item.postId)).toHaveLength(8);
  expect(generated.staffingReport!.uncovered.length).toBeGreaterThan(0);
  expect(generated.assignments.filter((item) => item.role === roles[1]!.id)).toHaveLength(4);
  for (const shift of shifts) {
    const assigned = generated.assignments.filter((item) => item.shiftId === shift.id);
    expect(new Set(assigned.map((item) => item.userId)).size).toBe(assigned.length);
  }
  const physicalMinutes = generated
    .staffingReport!.people.filter((person) => person.userId !== roster[3]!.id)
    .map((person) => person.minutes);
  expect(Math.max(...physicalMinutes) - Math.min(...physicalMinutes)).toBeLessThanOrEqual(30);
  await expect(page.getByText(/unfilled/).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/staffed-multiday-overview-desktop.png`, fullPage: true });
  const shortage = generated.staffingReport!.uncovered.find((item) => item.postId)!;
  const shortageBlock = generated.shifts.find((item) => item.id === shortage.shiftId)!;
  const shortageRole = generated.staffingRoles.find((item) => item.id === shortage.role)!;
  const shortagePost = generated.staffingPosts.find((item) => item.id === shortage.postId)!;
  await page.getByRole("button", { name: `Actions for ${shortageBlock.name}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Review staffing", exact: true }).click();
  await page
    .getByRole("button", { name: `Actions for ${shortageRole.name} · ${shortagePost.name}`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Review positions", exact: true }).click();
  await expect(
    page.getByText("Another duty or talk conflicts, including travel", { exact: false }).first(),
  ).toBeVisible();
  const userAfter = await Promise.all(
    roster.map(async (person) =>
      userDetailResponseSchema.parse(await (await page.request.get(`/api/v1/users/${person.id}`)).json()),
    ),
  );
  expect(userAfter.map((person) => person.user)).toEqual(userBefore.map((person) => person.user));
  expect(await readGrants()).toEqual(grantsBefore);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/staffed-multiday-roles-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/staffed-multiday-roles-phone.png`, fullPage: true });
});
