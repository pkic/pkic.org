import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

test("permitted staff use focused platform analytics through the System portal", async ({ page }) => {
  const systemRequests: string[] = [];
  const legacyRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/system/analytics/")) systemRequests.push(pathname);
    if (pathname === "/api/v1/admin/stats") legacyRequests.push(pathname);
  });

  await signInToPortal(page, e2eAdminEmail("portal-analytics"));
  await page.goto("/portal/#/system/analytics");
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
  await expect(page.getByText("Total Registrations", { exact: true })).toBeVisible();
  await expect(page.getByText("Top Events", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Registrations", exact: true }).last().click();
  await expect(page).toHaveURL(/\/portal\/#\/system\/analytics\/registrations$/);
  await expect(page.getByText("Registrations — Weekly (last 12 weeks)", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Donations", exact: true }).last().click();
  await expect(page).toHaveURL(/\/portal\/#\/system\/analytics\/donations$/);
  await expect(page.getByText("Total Gross (USD)", { exact: true })).toBeVisible();

  await page.goto("/admin/#/stats/registrations");
  await expect(page).toHaveURL(/\/portal\/#\/system\/analytics$/);
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();

  expect(systemRequests).toEqual(
    expect.arrayContaining([
      "/api/v1/system/analytics/summary",
      "/api/v1/system/analytics/registrations",
      "/api/v1/system/analytics/donations",
    ]),
  );
  expect(legacyRequests).toEqual([]);
});
