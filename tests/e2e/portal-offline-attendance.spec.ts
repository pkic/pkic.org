import { generateBadgeCredential } from "../../assets/shared/schemas/badge-credential";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { expect, test, type Page } from "@playwright/test";
import {
  enrolledOfflineEligibilityQuerySchema,
  enrolledOfflineEligibilityResponseSchema,
} from "../../assets/shared/schemas/event-offline-eligibility";
import {
  enrolledEventScanRequestSchema,
  enrolledEventScanResponseSchema,
  offlineScanRecordSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import { archivedScanSchema } from "../../assets/shared/schemas/event-scan-recovery";
import { SCAN_STORAGE_VERSION } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/outbox-storage";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import {
  openScannerDiagnostics,
  closeScannerDiagnostics,
  openScannerManualEntry,
} from "./helpers/scanner-recovery-storage";

const slug = "pqc-conference-amsterdam-nl";
const storedScanSchema = offlineScanRecordSchema.extend({
  leaseUntil: z.number(),
  owner: z.string().nullable(),
  attempts: z.number().optional(),
  nextAttemptAt: z.number().optional(),
});
async function stored(page: Page, store: "scans" | "history") {
  return page.evaluate(
    async ({ version, store }) => {
      const opening = indexedDB.open("pkic-scanner-outbox", version);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error ?? new Error("Scanner storage unavailable"));
      });
      try {
        const read = db.transaction(store).objectStore(store).getAll();
        return await new Promise<unknown[]>((resolve, reject) => {
          read.onsuccess = () => resolve(read.result);
          read.onerror = () => reject(read.error ?? new Error("Scanner storage read failed"));
        });
      } finally {
        db.close();
      }
    },
    { version: SCAN_STORAGE_VERSION, store },
  );
}

// Canonical roster/receipt fixtures isolate browser persistence from backend policy tests.
test("offline supporting scanner captures registered and unregistered attendance and resumes identical operations", async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsE2eStaff(page, e2eAdminEmail("portal-offline-attendance"));
  const badges = [generateBadgeCredential(), generateBadgeCredential()];
  const users = [randomUUID(), randomUUID()];
  const eventId = randomUUID();
  let offline = false;
  let rosterDownloads = 0;
  const uploaded: ReturnType<typeof enrolledEventScanRequestSchema.parse>[] = [];
  await page.route(`**/api/v1/events/${slug}/offline-eligibility?*`, async (route) => {
    if (offline) return route.abort("internetdisconnected");
    const enrollment = enrolledOfflineEligibilityQuerySchema.parse(
      Object.fromEntries(new URL(route.request().url()).searchParams),
    );
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const baseline = enrolledOfflineEligibilityResponseSchema.parse(await response.json());
    rosterDownloads++;
    return route.fulfill({
      json: enrolledOfflineEligibilityResponseSchema.parse({
        ...baseline,
        eventId,
        epochId: enrollment.epochId,
        deviceId: enrollment.deviceId,
        occurrenceId: null,
        revision: 1,
        publishedRevision: 1,
        serverNow: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        session: null,
        entries: badges.map((badge, index) => ({
          badgeId: randomUUID(),
          userId: users[index],
          credentialHash: createHash("sha256").update(badge).digest("hex"),
          revoked: false,
          eventRegistered: index === 0,
          physicalDayEligible: index === 0,
          sessionStatus: null,
          sessionEligible: true,
          privateAccess: true,
        })),
        nextBadgeId: null,
      }),
    });
  });
  await page.route(`**/api/v1/events/${slug}/scans`, async (route) => {
    if (offline) return route.abort("internetdisconnected");
    const scan = enrolledEventScanRequestSchema.parse(route.request().postDataJSON());
    uploaded.push(scan);
    const registered = scan.badgeId === badges[0];
    return route.fulfill({
      json: enrolledEventScanResponseSchema.parse({
        operationId: scan.operationId,
        outcome: registered ? "eligible" : "warning",
        reason: registered ? "eligible" : "missing_registration",
        recorded: true,
        attendanceRecorded: true,
        scannerReceipt: { ...scan.scannerSession, operationId: scan.operationId, receivedAt: new Date().toISOString() },
      }),
    });
  });
  await page.goto(`/portal/#/events/${slug}/scanner`);
  await expect(page.getByLabel("Scan mode", { exact: true })).toHaveValue("attendance");
  await openScannerDiagnostics(page);
  await expect(
    page.getByText("Eligibility data ready. Checks run locally; attendance uploads in the background.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(rosterDownloads).toBeGreaterThan(0);
  await closeScannerDiagnostics(page);
  await expect(
    page.getByRole("button", { name: /Prepare offline admission|Allocate for one hour|Review admission exception/ }),
  ).toHaveCount(0);
  offline = true;
  await context.setOffline(true);
  for (const [index, badge] of badges.entries()) {
    await openScannerManualEntry(page);
    await page.getByLabel("Badge code", { exact: true }).fill(badge);
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect(
      page.locator(index === 0 ? ".pk-event-scanner--eligible" : ".pk-event-scanner--warning"),
    ).toContainText(index === 0 ? "Registered" : "Known badge · not registered");
    await expect(page.getByText(`${index + 1} scans awaiting upload`, { exact: true })).toBeVisible();
  }
  const captured = (await stored(page, "scans")).map((record) => storedScanSchema.parse(record));
  expect(captured).toHaveLength(2);
  expect(new Set(captured.map(({ scan }) => scan.operationId)).size).toBe(2);
  for (const { scan } of captured) {
    expect(scan.action).toBe("attendance");
    expect(scan.offlineRight).toBeUndefined();
    expect(scan.capturePublicationRevision).toBe(1);
    expect(Object.keys(scan)).not.toEqual(expect.arrayContaining(["email", "name", "contacts"]));
  }
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("scanner-offline-unregistered-phone.png"),
  });
  // Remount the real portal scanner while offline; persisted captures must survive.
  await page.evaluate(() => {
    window.location.hash = "#/events";
  });
  await expect(page.getByRole("heading", { name: "Badge scanner", exact: true })).toHaveCount(0);
  await page.evaluate((slug) => {
    window.location.hash = `#/events/${slug}/scanner`;
  }, slug);
  await expect(page.getByRole("heading", { name: "Badge scanner", exact: true })).toBeVisible();
  await expect(page.getByText("2 scans awaiting upload", { exact: true })).toBeVisible();
  const recovered = (await stored(page, "scans")).map((record) => storedScanSchema.parse(record));
  expect(recovered.map(({ scan }) => scan).sort((a, b) => a.operationId.localeCompare(b.operationId))).toEqual(
    captured.map(({ scan }) => scan).sort((a, b) => a.operationId.localeCompare(b.operationId)),
  );
  offline = false;
  await context.setOffline(false);
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect
    .poll(async () => (await stored(page, "scans")).map((record) => storedScanSchema.parse(record)).length)
    .toBe(0);
  await expect(page.getByRole("heading", { name: "Badge scanner", exact: true })).toBeVisible();
  await expect(page.locator(".pk-event-scanner")).toHaveCount(0);
  expect(await stored(page, "scans")).toHaveLength(0);
  expect(uploaded.map((scan) => scan.operationId)).toEqual(
    expect.arrayContaining(captured.map(({ scan }) => scan.operationId)),
  );
  for (const { scan } of captured)
    expect(uploaded.find((value) => value.operationId === scan.operationId)).toEqual(scan);
  const history = (await stored(page, "history")).map((record) => archivedScanSchema.parse(record));
  for (const { scan } of captured) {
    const archived = history.find((record) => record.scan.operationId === scan.operationId);
    expect(archived?.scan).toEqual(scan);
    expect(archived?.receipt).toMatchObject({
      outcome: scan.badgeId === badges[0] ? "eligible" : "warning",
      attendanceRecorded: true,
      recorded: true,
    });
  }
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-offline-resumed-phone.png") });
});
