import { expect, test } from "@playwright/test";
import { memberJoinStartSchema } from "../../assets/shared/schemas/member-join";

test("maintenance refusal preserves a public form and recovery never replays it", async ({ page }) => {
  let paused = false;
  let attempts = 0;
  const state = () => ({
    mode: paused ? "maintenance" : "normal",
    message: paused
      ? "Online services are temporarily unavailable for maintenance. Please try again later."
      : "Online services are available.",
    endsAt: null,
  });
  await page.route("**/api/v1/", (route) =>
    route.fulfill({
      json: {
        name: "PKI Consortium API",
        version: "v1",
        docs: "/api/v1/redocs",
        status: paused ? "unavailable" : "ok",
        availability: state(),
      },
    }),
  );
  await page.route("**/api/v1/members/join/start", async (route) => {
    attempts++;
    memberJoinStartSchema.parse(route.request().postDataJSON());
    if (paused)
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: state().message, details: state() } },
      });
    else await route.continue();
  });
  await page.goto("/join/");
  await page.getByLabel("Yes — I am employed by or own an organization").check();
  const email = page.getByLabel("Your official work or organization email address");
  const address = `maintenance-${Date.now()}@organization.test`;
  await email.fill(address);
  paused = true;
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Maintenance in progress", { exact: true })).toBeVisible();
  await expect(email).toHaveValue(address);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  expect(attempts).toBe(1);
  await page.getByText("Maintenance in progress", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("pkic-maintenance-notice.png") });
  paused = false;
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.getByText("Online services restored", { exact: true })).toBeVisible();
  await expect(email).toHaveValue(address);
  expect(attempts).toBe(1);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/We sent an email/)).toBeVisible();
  expect(attempts).toBe(2);
});

test("a temporary data outage preserves loaded user rows and recovers on explicit refresh", async ({ page }) => {
  const { signInToPortal } = await import("./helpers/portal-auth");
  const { e2eAdminEmail } = await import("../helpers/e2e-admin");
  await signInToPortal(page, e2eAdminEmail("portal-permission-boundaries"));
  await page.goto("/portal/#/users");
  const table = page.getByRole("table").first();
  await expect(table.getByRole("row").nth(1)).toBeVisible();
  const firstRow = await table.getByRole("row").nth(1).innerText();
  let outage = true;
  let failures = 0;
  await page.route(/\/api\/v1\/users\?/, async (route) => {
    if (!outage) return route.continue();
    failures++;
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Online data is temporarily unavailable. Your existing view can remain open.",
        },
      },
    });
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).first().click();
  await expect(
    page.getByText("Online data is temporarily unavailable. Your existing view can remain open.", { exact: true }),
  ).toBeVisible();
  await expect(table.getByRole("row").nth(1)).toHaveText(firstRow, { useInnerText: true });
  expect(failures).toBe(1);
  await page.screenshot({ path: test.info().outputPath("pkic-81-cached-users.png") });
  outage = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).first().click();
  await expect(
    page.getByText("Online data is temporarily unavailable. Your existing view can remain open.", { exact: true }),
  ).toHaveCount(0);
  await expect(table.getByRole("row").nth(1)).toBeVisible();
  let sessionUnavailable = true;
  await page.route("**/api/v1/auth/session", async (route) => {
    if (!sessionUnavailable) return route.continue();
    await route.fulfill({
      status: 503,
      json: { error: { code: "DEPENDENCY_UNAVAILABLE", message: "Online data is temporarily unavailable." } },
    });
  });
  await page.reload();
  await expect(page.getByText("Could not check sign-in", { exact: true })).toBeVisible();
  sessionUnavailable = false;
  await page.getByRole("button", { name: "Check sign-in again", exact: true }).click();
  await expect(page.getByRole("table").first().getByRole("row").nth(1)).toBeVisible();
});

test("a static information page renders without polling the Worker status endpoint", async ({ page }) => {
  let checks = 0;
  await page.route("**/api/v1/", async (route) => {
    checks++;
    await route.abort();
  });
  await page.goto("/bylaws/");
  await expect(page.getByRole("main")).toBeVisible();
  expect(checks).toBe(0);
});
