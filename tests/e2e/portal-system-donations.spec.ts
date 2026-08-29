import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

const DONATION_ID = "70000000-0000-4000-8000-000000000001";

test("permitted staff manage donations through the neutral resource API", async ({ page }) => {
  const canonicalRequests: string[] = [];
  const legacyRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/donations")) canonicalRequests.push(`${request.method()} ${pathname}`);
    if (pathname.startsWith("/api/v1/admin/donations")) legacyRequests.push(`${request.method()} ${pathname}`);
  });

  await signInToPortal(page, e2eAdminEmail("portal-donations"));
  await page.goto("/portal/#/system/donations");

  await expect(page.getByRole("tab", { name: "Donations", exact: true })).toBeVisible();
  const donorCell = page.getByRole("cell", { name: /E2E Donor — Example Organization/ });
  await expect(donorCell).toBeVisible();

  await donorCell.click();
  await expect(page).toHaveURL(new RegExp(`/portal/#/system/donations/detail/${DONATION_ID}$`));
  await expect(page.getByText("e2e-donor@example.invalid", { exact: true })).toBeVisible();
  await expect(page.getByText("cs_test_e2e_portal_donation", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "← Back to Donations" }).click();
  await page.getByRole("tab", { name: "Share Links", exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/#\/system\/donations\/promoters$/);
  await expect(page.getByText("E2E Promoter", { exact: true })).toBeVisible();

  await page.goto("/portal/#/system/donations");
  await expect(page).toHaveURL(/\/portal\/#\/system\/donations$/);
  await expect(page.getByRole("cell", { name: /E2E Donor — Example Organization/ })).toBeVisible();

  expect(canonicalRequests).toEqual(
    expect.arrayContaining([
      "GET /api/v1/donations",
      `GET /api/v1/donations/${DONATION_ID}`,
      "GET /api/v1/donations/promoters",
    ]),
  );
  expect(legacyRequests).toEqual([]);
});
