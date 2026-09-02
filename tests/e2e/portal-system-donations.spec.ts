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

test("permitted staff filter donations by status and open the donation's badge and sync controls", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-donations"));
  await page.goto("/portal/#/donations");

  const donorCell = page.getByRole("cell", { name: /E2E Donor — Example Organization/ });
  const donorRow = page.locator("tr").filter({ has: donorCell });
  await expect(donorRow).toBeVisible();

  // The Status column's own menu narrows the list — matching the seeded
  // donation's "completed" status keeps its row, any other status hides it.
  const statusFilterRequest = () =>
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/v1/donations" && response.request().method() === "GET",
    );
  await page.getByRole("button", { name: "Status column options" }).click();
  let filtered = statusFilterRequest();
  await page.getByRole("menuitemradio", { name: /^Completed \(\d+\)$/ }).click();
  const completedUrl = new URL((await filtered).url());
  expect(completedUrl.searchParams.get("status")).toBe("completed");
  await expect(donorRow).toBeVisible();

  await page.getByRole("button", { name: "Status column options" }).click();
  filtered = statusFilterRequest();
  await page.getByRole("menuitemradio", { name: /^Pending \(\d+\)$/ }).click();
  const pendingUrl = new URL((await filtered).url());
  expect(pendingUrl.searchParams.get("status")).toBe("pending");
  await expect(donorRow).toHaveCount(0);

  await page.getByRole("button", { name: "Status column options" }).click();
  await page.getByRole("menuitemradio", { name: /^All \(\d+\)$/ }).click();
  await expect(donorRow).toBeVisible();

  // The toolbar's sync controls reflect a reconciled donation: nothing is
  // pending or backfillable, so "Sync all" is present but has nothing to do.
  await expect(page.getByRole("button", { name: /^Sync (all|donations)/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Sync pending/ })).toHaveCount(0);

  await donorCell.click();
  await expect(page).toHaveURL(new RegExp(`/portal/#/donations/detail/${DONATION_ID}$`));
  // A completed, fully-settled donation needs no sync action of its own, and
  // offers its badge for download instead.
  await expect(page.getByRole("button", { name: /^Sync with Stripe/ })).toHaveCount(0);
  const badgeLink = page.getByRole("link", { name: "Download badge" });
  await expect(badgeLink).toBeVisible();
  await expect(badgeLink).toHaveAttribute("href", new RegExp(`/api/v1/donations/checkouts/[^/]+/badge\\?name=`));
});
