import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { tab } from "./helpers/tabs";

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
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Operations", exact: true }).click();

  await expect(page.getByRole("heading", { name: "System Operations" })).toBeVisible();
  await expect(tab(page, "Email Outbox")).toBeVisible();
  await expect(tab(page, "Scheduled Work")).toBeVisible();
  await expect(tab(page, "Scheduled Jobs")).toBeVisible();
  await expect.poll(() => canonicalRequests.includes("GET /api/v1/email/outbox")).toBe(true);
  await tab(page, "Scheduled Work").click();
  await expect.poll(() => canonicalRequests.includes("GET /api/v1/retention/due")).toBe(true);

  await tab(page, "Scheduled Jobs").click();
  await expect.poll(() => canonicalRequests.includes("GET /api/v1/scheduler/jobs")).toBe(true);
  const jobRow = page.getByRole("row", { name: /Working Group Chair Digest/ });
  await expect(jobRow).toBeVisible();
  let paused = false;
  try {
    await jobRow.getByRole("button", { name: "Pause", exact: true }).click();
    await jobRow.getByLabel("Pause reason").fill("browser verification of scheduler controls");
    const pauseResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === "/api/v1/scheduler/jobs/working_group_chair_digest",
    );
    await jobRow.getByRole("button", { name: "Confirm pause" }).click();
    expect((await pauseResponse).status()).toBe(200);
    paused = true;
    await expect(jobRow.getByRole("button", { name: "Resume" })).toBeVisible();

    const resumeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === "/api/v1/scheduler/jobs/working_group_chair_digest",
    );
    await jobRow.getByRole("button", { name: "Resume" }).click();
    expect((await resumeResponse).status()).toBe(200);
    paused = false;
    await expect(jobRow.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  } finally {
    if (paused) {
      await page.request.patch("/api/v1/scheduler/jobs/working_group_chair_digest", {
        data: { state: "active" },
      });
    }
  }
  await expect.poll(() => canonicalRequests.filter((request) => request.startsWith("PATCH ")).length).toBe(2);

  await page.goto("/portal/#/system/operations");
  await expect(page).toHaveURL(/\/portal\/#\/system\/operations$/);
  await expect(page.getByRole("heading", { name: "System Operations" })).toBeVisible();
  expect(requests).toEqual([]);
});
