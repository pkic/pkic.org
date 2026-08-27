import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

test("a permitted staff identity uses the system audit log only through the portal", async ({ page }) => {
  const systemRequests: string[] = [];
  const legacyAuditRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/v1/system/audit-log") systemRequests.push(`${request.method()} ${pathname}`);
    if (pathname === "/api/v1/admin/audit-log") legacyAuditRequests.push(`${request.method()} ${pathname}`);
  });

  await signInToPortal(page, e2eAdminEmail("portal-system-audit"));
  await page.goto("/portal/#/system/audit-log");

  await expect(page.getByRole("heading", { name: "System Audit Log" })).toBeVisible();
  await expect(page.getByRole("link", { name: "System" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  expect(systemRequests).toContain("GET /api/v1/system/audit-log");
  expect(legacyAuditRequests).toEqual([]);

  await page.goto("/admin/#/auditlog");
  await expect(page).toHaveURL(/\/portal\/#\/system\/audit-log$/);
  await expect(page.getByRole("heading", { name: "System Audit Log" })).toBeVisible();
  expect(legacyAuditRequests).toEqual([]);
});
