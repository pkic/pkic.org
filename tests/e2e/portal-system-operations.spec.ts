/**
 * @covers system.12.5
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { runRowAction } from "./helpers/data-table";
import { signInToPortal } from "./helpers/portal-auth";

const LEGACY_OPERATIONS_APIS = [
  "/api/v1/admin/email/outbox",
  "/api/v1/admin/due-work",
  "/api/v1/internal/email/retry",
  "/api/v1/internal/email/reset-failed",
  "/api/v1/internal/jobs/run",
];

test("the outbox, the due queue and the job registry are pages, each on canonical read routes", async ({ page }) => {
  const requests: string[] = [];
  const canonicalRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (LEGACY_OPERATIONS_APIS.some((prefix) => pathname.startsWith(prefix))) {
      requests.push(`${request.method()} ${pathname}`);
    }
    if (
      pathname === "/api/v1/email/outbox" ||
      pathname === "/api/v1/retention/due" ||
      pathname === "/api/v1/scheduler/jobs" ||
      pathname === "/api/v1/scheduler/jobs/working_group_chair_digest"
    ) {
      canonicalRequests.push(`${request.method()} ${pathname}`);
    }
    if (pathname.endsWith("/pause") || pathname.endsWith("/resume")) requests.push(`${request.method()} ${pathname}`);
  });

  await signInToPortal(page, e2eAdminEmail("portal-system-operations"));
  /*
   * The three subjects used to be tabs inside one "Operations" entry, so
   * none of them had an address and the entry named none of them (#40). Each
   * is a sidebar page now, and reaching it is a click on its own name.
   */
  const sidebar = page.getByRole("complementary", { name: "Portal navigation" });
  await sidebar.getByRole("link", { name: "Settings", exact: true }).click();
  /*
   * From the sidebar, not from the page: `/settings` is an index that lists
   * the same pages the sidebar does, so each name is on screen twice and an
   * unscoped locator matches both. Following the sidebar is also what the
   * reader does once they are already inside the section.
   */
  await sidebar.getByRole("link", { name: "Email outbox", exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/#\/settings\/email-outbox$/);
  await expect(page.getByRole("heading", { name: "Email outbox" })).toBeVisible();
  await expect.poll(() => canonicalRequests.includes("GET /api/v1/email/outbox")).toBe(true);

  await sidebar.getByRole("link", { name: "Scheduled work", exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/#\/settings\/scheduled-work$/);
  await expect(page.getByRole("heading", { name: "Scheduled work" })).toBeVisible();
  await expect.poll(() => canonicalRequests.includes("GET /api/v1/retention/due")).toBe(true);

  await sidebar.getByRole("link", { name: "Scheduled jobs", exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/#\/settings\/scheduled-jobs$/);
  await expect(page.getByRole("heading", { name: "Scheduled jobs" })).toBeVisible();
  await expect.poll(() => canonicalRequests.includes("GET /api/v1/scheduler/jobs")).toBe(true);
  // The pause form expands as the job's own detail row, so the data row is
  // anchored to its `…` menu — the one control the detail row does not carry —
  // to stay unique while the form is open.
  const jobRow = page
    .getByRole("row", { name: /Working Group Chair Digest/ })
    .filter({ has: page.getByRole("button", { name: "Actions for Working Group Chair Digest" }) });
  await expect(jobRow).toBeVisible();
  let paused = false;
  try {
    // Row commands live behind the row's `…` menu, like every other list.
    await runRowAction(page, jobRow, "Pause");
    const pauseForm = page.getByRole("form", { name: "Pause Working Group Chair Digest" });
    await pauseForm.getByLabel("Pause reason").fill("browser verification of scheduler controls");
    const pauseResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === "/api/v1/scheduler/jobs/working_group_chair_digest",
    );
    await pauseForm.getByRole("button", { name: "Confirm pause" }).click();
    expect((await pauseResponse).status()).toBe(200);
    paused = true;
    await expect(jobRow.getByText("Paused", { exact: true })).toBeVisible();

    const resumeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === "/api/v1/scheduler/jobs/working_group_chair_digest",
    );
    await runRowAction(page, jobRow, "Resume");
    expect((await resumeResponse).status()).toBe(200);
    paused = false;
    await expect(jobRow.getByText("Active", { exact: true })).toBeVisible();
  } finally {
    if (paused) {
      await page.request.patch("/api/v1/scheduler/jobs/working_group_chair_digest", {
        data: { state: "active" },
      });
    }
  }
  await expect.poll(() => canonicalRequests.filter((request) => request.startsWith("PATCH ")).length).toBe(2);

  await page.goto("/portal/#/settings/scheduled-jobs");
  await expect(page.getByRole("link", { name: "Scheduled jobs", exact: true })).toHaveAttribute("aria-current", "page");
  expect(requests).toEqual([]);
});
