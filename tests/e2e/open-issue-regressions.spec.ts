/** Open production-readiness regressions #171, #172, #175, #182, #186. @covers presentation.13.7 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

test("registration shows completion marks only for completed steps and uses the available width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/events/2026/pqc-conference-amsterdam-nl/register/");
  const checks = page.locator(".event-flow-stepper-check");
  await expect(checks).toHaveCount(4);
  for (const check of await checks.all()) await expect(check).toBeHidden();
  const form = page.locator("[data-event-registration] form");
  await expect(form).toBeVisible();
  expect((await form.boundingBox())!.width).toBeGreaterThan(800);
  await page.screenshot({ path: test.info().outputPath("registration.png"), fullPage: true });
});

test("staff can create and search for a user and table settings do not cover the final heading", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-user-create"));
  await page.goto("/portal/#/users");
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  const email = `created-${Date.now()}@example.test`;
  await page.getByRole("textbox", { name: "Email address (required)", exact: true }).fill(email);
  await page.getByLabel("First name", { exact: true }).fill("Created");
  await page.getByLabel("Last name", { exact: true }).fill("Person");
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Created Person" })).toBeVisible();
  await page.goto("/portal/#/users");
  await expect(page.getByRole("searchbox")).toBeVisible();
  await page.getByRole("searchbox").fill(email);
  await page.getByRole("searchbox").press("Enter");
  await expect(page.getByRole("row").filter({ hasText: "Created Person" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("users-table.png") });
  await page.goto("/portal/#/settings/application-workflow");
  await expect(page.getByRole("columnheader", { name: /Required steps/ })).toBeVisible();
  const settings = page.getByRole("button", { name: "Choose columns", exact: true });
  await expect(settings).toBeVisible();
  const heading = page.locator("th").filter({ has: settings });
  const content = heading.locator(".pk-table__head-content");
  await expect(content).toContainText("Required steps");
  const overlaps = await content.evaluate((el) => {
    const children = [...el.children].map((child) => child.getBoundingClientRect()).filter((rect) => rect.width > 0);
    return children.some((rect, index) => index > 0 && rect.left < children[index - 1].right);
  });
  expect(overlaps).toBe(false);
  await page.screenshot({ path: test.info().outputPath("workflow-table.png") });
  const membership = page.locator("#portal-sidebar details").filter({ hasText: "Membership" });
  await expect(membership.locator("summary")).toHaveText("Membership");
  await expect(membership.getByRole("link")).toHaveCount(4);
  await membership.locator("summary").click();
  await expect(membership.getByRole("link").first()).toBeHidden();
  await page.goto("/portal/#/donations");
  await expect(page.getByRole("searchbox", { name: "Search donations", exact: true })).toBeVisible();
  await page.goto("/portal/#/forms");
  const controls = page.getByRole("toolbar", { name: "Configured forms controls" });
  const create = controls.getByRole("button", { name: "New form", exact: true });
  await expect(create).toBeVisible();
  expect(
    Math.abs((await create.boundingBox())!.height - (await controls.getByRole("searchbox").boundingBox())!.height),
  ).toBeLessThanOrEqual(1);
});
