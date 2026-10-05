import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";

const slug = "pqc-conference-amsterdam-nl";
const artifacts = process.env.AGENDA_SCREENSHOT_DIR ?? "test-results/agenda-progress";

test("organizers configure two doors and generate an advisory staffing plan", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(artifacts, { recursive: true });
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  await page.goto(`/portal/#/events/${slug}/agenda`);
  await page.getByRole("button", { name: "Block roles", exact: true }).click();
  await page.getByRole("button", { name: "Roles and posts", exact: true }).click();
  await page.getByRole("button", { name: "Add role", exact: true }).click();
  await page.getByRole("textbox", { name: "Role name", exact: true }).last().fill("Badge scanning");
  await expect(page.getByRole("checkbox", { name: "Show this role on the public agenda" }).last()).not.toBeChecked();
  for (const door of ["North entrance", "South entrance"]) {
    await page.getByRole("button", { name: "Add physical post", exact: true }).click();
    await page.getByRole("textbox", { name: "Post name", exact: true }).last().fill(door);
  }
  await page.getByRole("button", { name: "Save roles and posts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Event roles and posts", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "New block", exact: true }).click();
  await page.getByLabel(/^Block name/).fill("Morning arrivals");
  await page.getByLabel(/^Block starts/).fill("2026-12-01T09:00");
  await page.getByLabel(/^Block ends/).fill("2026-12-01T10:00");
  await page.getByRole("button", { name: "Save block", exact: true }).click();
  await page.getByRole("button", { name: "Staffing needs for Morning arrivals", exact: true }).click();
  for (const door of ["North entrance", "South entrance"]) {
    await page.getByRole("button", { name: "Add duty requirement", exact: true }).click();
    await page.getByLabel("Duty role", { exact: true }).last().selectOption({ label: "Badge scanning" });
    await page.getByLabel("Duty post", { exact: true }).last().selectOption({ label: door });
    await page.getByLabel("Ideal headcount", { exact: true }).last().fill("2");
    await page.getByLabel("Duty attendance mode", { exact: true }).last().selectOption("physical");
  }
  await page.getByRole("button", { name: "Save staffing needs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Badge scanning · North entrance", exact: true })).toBeVisible();
  await expect(page.getByText("0 assigned · 2 ideal · 2 unfilled", { exact: true })).toHaveCount(2);
  const read = async () =>
    agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  const before = await read();
  const block = before.blocks.find((row) => row.name === "Morning arrivals")!;
  const requirements = before.staffingRequirements.filter((row) => row.blockId === block.id);
  expect(requirements).toHaveLength(2);
  expect(
    before.staffingPositions.filter((row) => requirements.some((need) => need.id === row.requirementId)),
  ).toHaveLength(4);
  await page.getByRole("button", { name: "Configure rotation", exact: true }).click();
  await page.getByLabel("Rotation seed", { exact: true }).fill("door-plan-browser");
  await page.getByRole("button", { name: "Generate assignments", exact: true }).click();
  await expect.poll(async () => (await read()).revision).toBe(before.revision + 1);
  const after = await read();
  expect(after.staffingPositions).toEqual(before.staffingPositions);
  expect(after.assignments.filter((row) => row.blockId === block.id)).toHaveLength(0);
  await expect(page.getByText("0 assigned · 2 ideal · 2 unfilled", { exact: true })).toHaveCount(2);
  await page.screenshot({ path: `${artifacts}/staffing-two-doors-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${artifacts}/staffing-two-doors-phone.png`, fullPage: true });
});
