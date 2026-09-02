import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

test("a permitted staff identity uses the system audit log only through the portal", async ({ page }) => {
  const auditLogRequests: string[] = [];
  const retiredSystemRequests: string[] = [];
  const legacyAuditRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/v1/audit-log") auditLogRequests.push(`${request.method()} ${pathname}`);
    if (pathname === "/api/v1/system/audit-log") retiredSystemRequests.push(`${request.method()} ${pathname}`);
    if (pathname === "/api/v1/admin/audit-log") legacyAuditRequests.push(`${request.method()} ${pathname}`);
  });

  await signInToPortal(page, e2eAdminEmail("portal-system-audit-list"));
  await page.goto("/portal/#/system/audit-log");

  // The Settings hub heads the page; the selected tab names the surface.
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Audit Log", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  expect(auditLogRequests).toContain("GET /api/v1/audit-log");
  expect(retiredSystemRequests).toEqual([]);
  expect(legacyAuditRequests).toEqual([]);

  await page.goto("/portal/#/system/audit-log");
  await expect(page).toHaveURL(/\/portal\/#\/system\/audit-log$/);
  await expect(page.getByRole("link", { name: "Audit Log", exact: true })).toHaveAttribute("aria-current", "page");
  expect(legacyAuditRequests).toEqual([]);
});

test("renders loading, empty, and paginated audit-log states", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-system-audit-states"));

  let releaseInitialRequest!: () => void;
  const initialRequestReleased = new Promise<void>((resolve) => {
    releaseInitialRequest = resolve;
  });
  let requestCount = 0;
  const requestOffsets: number[] = [];
  const pageOneEntry = {
    id: "audit-page-one",
    actor_type: "admin",
    actor_id: "admin-1",
    actor_display: "Audit Manager",
    action: "page_one_action",
    entity_type: "system_setting",
    entity_id: "setting-1",
    details: null,
    created_at: "2026-08-27T12:00:00.000Z",
  };
  const pageTwoEntry = {
    ...pageOneEntry,
    id: "audit-page-two",
    action: "page_two_action",
  };

  await page.route("**/api/v1/audit-log**", async (route) => {
    requestCount += 1;
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset") ?? "0");
    requestOffsets.push(offset);

    if (requestCount === 4) {
      await route.fulfill({
        status: 500,
        json: { error: { code: "TEST_ERROR", message: "Synthetic audit log failure" } },
      });
      return;
    }

    if (requestCount === 1) {
      await initialRequestReleased;
      await route.fulfill({
        json: { entries: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } },
      });
      return;
    }

    if (offset === 0) {
      await route.fulfill({
        json: { entries: [pageOneEntry], page: { limit: 50, offset: 0, total: 51, hasMore: true } },
      });
      return;
    }

    await route.fulfill({
      json: { entries: [pageTwoEntry], page: { limit: 50, offset, total: 51, hasMore: false } },
    });
  });

  await page.goto("/portal/#/system/audit-log");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  // Loading is skeleton rows under the real headers, announced by `aria-busy`
  // on the table — there is no spinner with a status role any more.
  await expect(page.locator('table[aria-busy="true"]')).toBeVisible();
  releaseInitialRequest();

  // The pager is located by its role and accessible name, and the current
  // page by `aria-current`, rather than by `.adm-pager`/`.page-item`: those
  // Bootstrap classes left the markup when the pager moved onto the design
  // system, and a role does not break the next time it is restyled.
  const pager = page.getByRole("navigation", { name: "Pagination" });
  const nextPage = pager.getByRole("button", { name: "Next page" });
  const currentPage = pager.locator('button[aria-current="page"]');

  await expect(page.getByText("No entries match the current filters.", { exact: true })).toBeVisible();
  await expect(pager).toHaveCount(0);

  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("page_one_action", { exact: true })).toBeVisible();
  await expect(pager).toContainText("1–1 of 51");
  await expect(currentPage).toHaveText("1");
  await expect(nextPage).toBeEnabled();

  await nextPage.click();
  await expect(page.getByText("page_two_action", { exact: true })).toBeVisible();
  await expect(page.getByText("page_one_action", { exact: true })).toHaveCount(0);
  await expect(pager).toContainText("51–51 of 51");
  await expect(currentPage).toHaveText("2");

  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Synthetic audit log failure");
  expect(requestCount).toBe(4);
  expect(requestOffsets).toEqual([0, 0, 50, 50]);
});
