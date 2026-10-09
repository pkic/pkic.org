import { openOrganizerAgenda } from "./helpers/organizer-agenda";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { eventDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import { groupEventCreateSchema, groupEventDetailResponseSchema } from "../../assets/shared/schemas/group-events";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { runRowAction } from "./helpers/data-table";

const artifacts = process.env.AGENDA_SCREENSHOT_DIR ?? "test-results/agenda-progress";

test("organizers configure two doors and generate an advisory staffing plan", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(artifacts, { recursive: true });
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-staffing"));
  const owner = eventDetailResponseSchema.parse(
    await (await page.request.get("/api/v1/events/pqc-conference-amsterdam-nl")).json(),
  ).event;
  if (!("ownerGroupId" in owner) || !owner.ownerGroupId) throw new Error("Canonical conference owner missing");
  const slug = `staffing-two-doors-${crypto.randomUUID()}`;
  const created = await page.request.post(`/api/v1/groups/${owner.ownerGroupId}/events`, {
    data: groupEventCreateSchema.parse({
      slug,
      name: "Synthetic two-door staffing plan",
      profileKey: "conference",
      visibility: "invitation_only",
      registrationPolicy: "no_registration",
      timezone: "UTC",
      startsAt: "2026-12-01T08:00:00.000Z",
      endsAt: "2026-12-03T18:00:00.000Z",
      links: [],
    }),
  });
  expect(created.status()).toBe(201);
  groupEventDetailResponseSchema.parse(await created.json());
  await openOrganizerAgenda(page, slug);
  await page.getByRole("tab", { name: "Shifts", exact: true }).click();
  await page.getByRole("button", { name: "Actions for Event staffing", exact: true }).click();
  await page.getByRole("menuitem", { name: "Roles and posts", exact: true }).click();
  await page.getByRole("button", { name: "Add role", exact: true }).click();
  await page.getByRole("textbox", { name: "Role name", exact: true }).last().fill("Badge scanning");
  await expect(page.getByRole("checkbox", { name: "Show this role on the public agenda" }).last()).not.toBeChecked();
  for (const door of ["North entrance", "South entrance"]) {
    await page.getByRole("button", { name: "Add physical post", exact: true }).click();
    await page.getByRole("textbox", { name: "Post name", exact: true }).last().fill(door);
  }
  await page.getByRole("button", { name: "Save roles and posts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Event roles and posts", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "New shift", exact: true }).click();
  await page.getByLabel(/^Shift name/).fill("Morning arrivals");
  await page.getByLabel(/^Shift starts/).fill("2026-12-01T09:00");
  await page.getByLabel(/^Shift ends/).fill("2026-12-01T10:00");
  await page.getByRole("button", { name: "Save shift", exact: true }).click();
  const blockRow = page
    .getByRole("table", { name: "Staffing shifts", exact: true })
    .getByRole("row")
    .filter({ hasText: "Morning arrivals" });
  await runRowAction(page, blockRow, "Staffing needs");
  for (const door of ["North entrance", "South entrance"]) {
    await page.getByRole("button", { name: "Add duty requirement", exact: true }).click();
    await page.getByLabel("Duty role", { exact: true }).last().selectOption({ label: "Badge scanning" });
    await page.getByLabel("Duty post", { exact: true }).last().selectOption({ label: door });
    await page.getByLabel("Ideal headcount", { exact: true }).last().fill("2");
    await page.getByLabel("Duty attendance mode", { exact: true }).last().selectOption("physical");
  }
  await page.getByRole("button", { name: "Save staffing needs", exact: true }).click();
  async function reviewNeeds() {
    await expect(blockRow.getByRole("cell", { name: "4 unfilled", exact: true })).toBeVisible();
    await blockRow.getByRole("button", { name: "Review Morning arrivals", exact: true }).click();
    const needs = page.getByRole("table", { name: "Shift staffing needs", exact: true });
    await expect(needs.getByRole("row")).toHaveCount(3);
    for (const door of ["North entrance", "South entrance"]) {
      const row = needs.getByRole("row").filter({ hasText: door });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole("cell").nth(0)).toContainText("Badge scanning");
      await expect(row.getByRole("cell").nth(1).locator(":scope > .pk-table__value")).toHaveText(door);
      await expect(row.getByRole("cell").nth(2).locator(":scope > .pk-table__value")).toHaveText("0");
      await expect(row.getByRole("cell").nth(3).locator(":scope > .pk-table__value")).toHaveText("2");
      await expect(row.getByRole("cell").nth(4).locator(":scope > .pk-table__value")).toHaveText("2");
    }
  }
  await reviewNeeds();
  await page.getByRole("button", { name: "Back to staffing", exact: true }).click();
  const read = async () =>
    agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  const before = await read();
  const shift = before.shifts.find((row) => row.name === "Morning arrivals")!;
  const requirements = before.staffingRequirements.filter((row) => row.shiftId === shift.id);
  expect(requirements).toHaveLength(2);
  expect(
    before.staffingPositions.filter((row) => requirements.some((need) => need.id === row.requirementId)),
  ).toHaveLength(4);
  await page.getByRole("button", { name: "Actions for Event staffing", exact: true }).click();
  await page.getByRole("menuitem", { name: "Configure rotation", exact: true }).click();
  await page.getByLabel("Rotation seed", { exact: true }).fill("door-plan-browser");
  await page.getByRole("button", { name: "Generate assignments", exact: true }).click();
  await expect.poll(async () => (await read()).revision).toBe(before.revision + 1);
  const after = await read();
  expect(after.staffingPositions).toEqual(before.staffingPositions);
  expect(after.roleMembers).toEqual(before.roleMembers);
  expect(after.assignments.filter((row) => row.shiftId === shift.id)).toHaveLength(0);
  await reviewNeeds();
  await page.screenshot({ path: `${artifacts}/staffing-two-doors-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${artifacts}/staffing-two-doors-phone.png`, fullPage: true });
});
