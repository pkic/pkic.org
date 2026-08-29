import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

const LEGACY_OPERATIONS_APIS = [
  "/api/v1/admin/email/outbox",
  "/api/v1/admin/due-work",
  "/api/v1/internal/email/retry",
  "/api/v1/internal/email/reset-failed",
  "/api/v1/internal/jobs/run",
];

test("System Operations uses canonical read routes and redirects legacy bookmarks", async ({ page }) => {
  const requests: string[] = [];
  const canonicalRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (LEGACY_OPERATIONS_APIS.some((prefix) => pathname.startsWith(prefix))) {
      requests.push(`${request.method()} ${pathname}`);
    }
    if (pathname === "/api/v1/email/outbox" || pathname === "/api/v1/retention/due") {
      canonicalRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await signInToPortal(page, e2eAdminEmail("portal-system-operations"));
  await page.getByRole("link", { name: "System", exact: true }).click();
  await page.getByRole("link", { name: "Operations", exact: true }).click();

  await expect(page.getByRole("heading", { name: "System Operations" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Email Outbox" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Scheduled Work" })).toBeVisible();
  await expect.poll(() => canonicalRequests.includes("GET /api/v1/email/outbox")).toBe(true);
  await page.getByRole("tab", { name: "Scheduled Work" }).click();
  await expect.poll(() => canonicalRequests.includes("GET /api/v1/retention/due")).toBe(true);

  await page.goto("/admin/#/email/outbox");
  await expect(page).toHaveURL(/\/portal\/#\/system\/operations$/);
  await expect(page.getByRole("heading", { name: "System Operations" })).toBeVisible();
  expect(requests).toEqual([]);
});
