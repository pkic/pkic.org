import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

test("permitted staff manage users through the canonical domain API", async ({ page }) => {
  const staffEmail = e2eAdminEmail("portal-users");
  const updatedJobTitle = `E2E Portal User ${crypto.randomUUID().slice(0, 8)}`;
  const canonicalRequests: string[] = [];
  const legacyRequests: string[] = [];

  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/users")) canonicalRequests.push(`${request.method()} ${pathname}`);
    if (pathname.startsWith("/api/v1/admin/users") || pathname.startsWith("/api/v1/admin/members")) {
      legacyRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await signInToPortal(page, staffEmail);
  await page.goto("/portal/#/system/users");

  await expect(page.getByRole("link", { name: "Users", exact: true })).toBeVisible();
  const search = page.getByPlaceholder("email or name");
  await search.fill(staffEmail);
  await search.press("Enter");
  const staffRow = page.locator("tr").filter({ hasText: staffEmail });
  await expect(staffRow).toBeVisible();
  await staffRow.click();
  await expect(page.locator(".page-heading")).toHaveText(staffEmail);

  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const jobTitle = page.getByLabel("Job title");
  const saveResponse = page.waitForResponse(
    (response) =>
      /^\/api\/v1\/users\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "PATCH",
  );
  await jobTitle.fill(updatedJobTitle);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.getByText(updatedJobTitle, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText(updatedJobTitle, { exact: true })).toBeVisible();

  await page.goto("/portal/#/system/users");
  await expect(page).toHaveURL(/\/portal\/#\/system\/users$/);
  await expect(page.getByRole("link", { name: "Users", exact: true })).toBeVisible();

  expect(canonicalRequests).toEqual(
    expect.arrayContaining([
      "GET /api/v1/users",
      expect.stringMatching(/^GET \/api\/v1\/users\/[^/]+$/),
      expect.stringMatching(/^PATCH \/api\/v1\/users\/[^/]+$/),
    ]),
  );
  expect(legacyRequests).toEqual([]);
});
