import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

test("permitted staff use focused platform analytics through the System portal", async ({ page }) => {
  const analyticsRequests: string[] = [];
  const retiredSystemRequests: string[] = [];
  const legacyRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/analytics/")) analyticsRequests.push(pathname);
    if (pathname.startsWith("/api/v1/system/analytics/")) retiredSystemRequests.push(pathname);
    if (pathname === "/api/v1/admin/stats") legacyRequests.push(pathname);
  });

  await signInToPortal(page, e2eAdminEmail("portal-analytics"));
  await page.goto("/portal/#/system/analytics");
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
  await expect(page.getByText("Total Registrations", { exact: true })).toBeVisible();
  // Each analytics card is a Panel now, so its title is a real heading. The
  // period tables carry the same wording as their panel's title, so locating
  // by role rather than by text keeps this to the one element it means.
  await expect(page.getByRole("heading", { name: "Top Events", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Registrations", exact: true }).last().click();
  await expect(page).toHaveURL(/\/portal\/#\/system\/analytics\/registrations$/);
  await expect(
    page.getByRole("heading", { name: "Registrations — Weekly (last 12 weeks)", exact: true }),
  ).toBeVisible();

  // Donation analytics now live under Donations → Stats, not here — the
  // System Analytics tab strip only offers Overview and Registrations.
  await expect(page.getByRole("navigation", { name: "System analytics" }).getByText("Donations")).toHaveCount(0);

  await page.goto("/portal/#/system/analytics");
  await expect(page).toHaveURL(/\/portal\/#\/system\/analytics$/);
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();

  expect(analyticsRequests).toEqual(
    expect.arrayContaining(["/api/v1/analytics/summary", "/api/v1/analytics/registrations"]),
  );
  expect(retiredSystemRequests).toEqual([]);
  expect(legacyRequests).toEqual([]);
});
