import { randomUUID } from "node:crypto";
import { z } from "zod";
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { registerInBrowser } from "./helpers/registration";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import { offlineScanRecordSchema } from "../../assets/shared/schemas/event-participation-scanning";
import { badgeIssueResponseSchema } from "../../assets/shared/schemas/route-contracts-event-badges";

const slug = "pqc-conference-amsterdam-nl";
const scannerPath = `/portal/#/events/${slug}/scanner`;
test.use({ actionTimeout: 20_000 });

async function queuedRecords(page: Page) {
  return page.evaluate(async () => {
    const opening = indexedDB.open("pkic-scanner-outbox", 2);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error("Could not open scanner queue"));
    });
    try {
      const read = db.transaction("scans").objectStore("scans").getAll();
      return await new Promise<unknown[]>((resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error ?? new Error("Could not read scanner queue"));
      });
    } finally {
      db.close();
    }
  });
}

test("phone scanner retains an IDs-only offline scan and acknowledges it after reconnect", async ({
  page,
  context,
}) => {
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(scannerPath);
  await expect(page.getByRole("heading", { name: "Badge scanner", exact: true })).toBeVisible();
  await expect(
    page.getByText("Eligibility data ready. Checks run locally; attendance uploads in the background.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).not.toBe("");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/portal/");
        return registration?.active?.state ?? "";
      }),
    )
    .toBe("activated");
  await context.setOffline(true);
  const badgeId = randomUUID();
  await page.getByLabel("Badge code", { exact: true }).fill(badgeId);
  await page.getByRole("button", { name: "Check badge", exact: true }).click();
  await expect(page.getByText("1 scans awaiting upload", { exact: true })).toBeVisible();
  await expect(page.getByText("Unknown badge", { exact: true })).toBeVisible();
  const records = await queuedRecords(page);
  expect(records).toHaveLength(1);
  const record = offlineScanRecordSchema
    .extend({
      leaseUntil: z.number(),
      owner: z.string().nullable(),
      attempts: z.number().optional(),
      nextAttemptAt: z.number().optional(),
    })
    .parse(records[0]);
  expect(record.scan.badgeId).toBe(badgeId);
  expect(Object.keys(record.scan)).not.toEqual(expect.arrayContaining(["email", "name", "contacts"]));
  const shellPage = await context.newPage();
  const shell = await shellPage.goto("/portal/");
  expect(shell?.status()).toBe(200);
  expect(shell?.headers()["content-type"]).toContain("text/html");
  expect(await shell?.text()).toContain('id="portal-app"');
  await shellPage.close();
  await context.setOffline(false);
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByText("Unknown badge", { exact: true })).toBeVisible();
  await expect(page.getByText("0 scans awaiting upload", { exact: true })).toBeVisible();
  expect(await queuedRecords(page)).toHaveLength(0);
  expect(
    await page.evaluate(async () => {
      const cachesForScanner = await caches.keys();
      const paths: string[] = [];
      for (const name of cachesForScanner.filter((value) => value.startsWith("pkic-scanner-"))) {
        paths.push(...(await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname));
      }
      return paths.filter((path) => path.startsWith("/api/"));
    }),
  ).toEqual([]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("organizer issues a printable opaque QR and revoked credentials are denied on the phone", async ({ page }) => {
  const email = `scanner-${randomUUID()}@example.test`;
  const since = await capturedEmailCount();
  await registerInBrowser(page, email);
  const confirmation = await waitForCapturedEmail(email, "Confirm your registration", { since });
  await page.goto(extractEmailUrl(confirmation, "/register/confirm"));
  await page.getByRole("button", { name: /Confirm my registration/i }).click();
  await waitForCapturedEmail(email, "registration is confirmed", { since });
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  await page.goto(`/portal/#/events/${slug}/badges`);
  await page.getByRole("textbox", { name: /^Attendee/ }).fill(email);
  await page.getByRole("button").filter({ hasText: email }).click();
  const issuedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/events/${slug}/badges` && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create badge QR", exact: true }).click();
  const response = await issuedResponse;
  expect(response.status(), await response.text()).toBe(200);
  const badge = badgeIssueResponseSchema.parse(await response.json());
  const qr = page.getByRole("img", { name: "Attendee badge QR code", exact: true });
  await expect(qr).toBeVisible();
  await expect.poll(() => qr.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(512);
  await expect(page.locator(".pk-badge-credential")).toContainText(badge.credential);
  await expect(page.locator(".pk-badge-credential")).not.toContainText(email);
  await page.getByRole("button", { name: "Revoke credential", exact: true }).click();
  await expect(qr).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(scannerPath);
  await page.getByLabel("Badge code", { exact: true }).fill(badge.credential);
  const receipt = page.waitForResponse(
    (value) => new URL(value.url()).pathname === `/api/v1/events/${slug}/scans` && value.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Check badge", exact: true }).click();
  expect(await (await receipt).json()).toMatchObject({
    outcome: "denied",
    reason: "revoked_badge",
    recorded: true,
    attendanceRecorded: false,
  });
  await expect(page.getByText("Admission denied", { exact: true })).toBeVisible();
});
