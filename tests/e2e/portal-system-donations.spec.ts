import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { tab } from "./helpers/tabs";

const DONATION_ID = "70000000-0000-4000-8000-000000000001";

test("permitted staff manage donations through the neutral resource API", async ({ page }) => {
  const canonicalRequests: string[] = [];
  const legacyRequests: string[] = [];
  const analyticsRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/donations")) canonicalRequests.push(`${request.method()} ${pathname}`);
    if (pathname.startsWith("/api/v1/admin/donations")) legacyRequests.push(`${request.method()} ${pathname}`);
    if (pathname === "/api/v1/analytics/donations") analyticsRequests.push(pathname);
  });

  await signInToPortal(page, e2eAdminEmail("portal-donations"));
  await page.goto("/portal/#/donations");

  await expect(tab(page, "Donations")).toBeVisible();
  const donorCell = page.getByRole("cell", { name: /E2E Donor — Example Organization/ });
  await expect(donorCell).toBeVisible();

  await donorCell.click();
  await expect(page).toHaveURL(new RegExp(`/portal/#/donations/detail/${DONATION_ID}$`));
  await expect(page.getByText("e2e-donor@example.invalid", { exact: true })).toBeVisible();
  await expect(page.getByText("cs_test_e2e_portal_donation", { exact: true })).toBeVisible();

  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Donations" }).click();
  await tab(page, "Share Links").click();
  await expect(page).toHaveURL(/\/portal\/#\/donations\/promoters$/);
  await expect(page.getByText("E2E Promoter", { exact: true })).toBeVisible();

  // Donation analytics moved from System Analytics into a Stats tab here,
  // alongside the domain that owns it (see portal-system-analytics.spec.ts,
  // which confirms Donations no longer appears in System Analytics's tabs).
  await tab(page, "Stats").click();
  await expect(page).toHaveURL(/\/portal\/#\/donations\/stats$/);
  await expect(page.getByText("Total Gross (USD)", { exact: true })).toBeVisible();

  await page.goto("/portal/#/donations");
  await expect(page).toHaveURL(/\/portal\/#\/donations$/);
  await expect(page.getByRole("cell", { name: /E2E Donor — Example Organization/ })).toBeVisible();

  expect(canonicalRequests).toEqual(
    expect.arrayContaining([
      "GET /api/v1/donations",
      `GET /api/v1/donations/${DONATION_ID}`,
      "GET /api/v1/donations/promoters",
    ]),
  );
  expect(legacyRequests).toEqual([]);
  expect(analyticsRequests).toEqual(["/api/v1/analytics/donations"]);
});
