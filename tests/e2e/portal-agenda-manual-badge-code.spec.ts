import { scannerOfflineContextSchema } from "../../assets/shared/schemas/event-scanner-offline-context";
import { SCAN_STORAGE_VERSION } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/outbox-storage";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import jsQR from "jsqr";
import { expect, test, type Page } from "@playwright/test";
import { formatBadgeCredential, badgeCredentialSchema } from "../../assets/shared/schemas/badge-credential";
import {
  badgeCredentialMetadataSchema,
  badgeCredentialsResponseSchema,
  badgePrintRequestSchema,
  badgePrintResponseSchema,
} from "../../assets/shared/schemas/route-contracts-event-badges";
import { enrolledOfflineEligibilityResponseSchema } from "../../assets/shared/schemas/event-offline-eligibility";
import {
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import {
  attendanceSummarySchema,
  attendanceAttemptQuerySchema,
  attendanceAttemptsResponseSchema,
} from "../../assets/shared/schemas/event-attendance-reporting";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { eventManagementDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import { registrationManageReadResponseSchema } from "../../assets/shared/schemas/registration";
import { prepareScannerTermination } from "./helpers/scanner-browser-termination";
import { scannerStorage, openScannerDiagnostics, openScannerManualEntry } from "./helpers/scanner-recovery-storage";
import { captureDeviceConsole, expectNoStoredSponsorContacts } from "./helpers/sponsor-live-fixture";

test.use({ actionTimeout: 20_000 });

async function metadata(page: Page, endpoint: string, credential: string) {
  const response = await page.request.get(endpoint);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const raw = await response.json();
  expect(JSON.stringify(raw)).not.toContain(credential);
  return badgeCredentialMetadataSchema.parse(raw);
}

/** Decodes only the rendered protected SVG's actual pixels, without supplying an expected credential. */
async function preparePrintedBadge(page: Page, endpoint: string, credential: string) {
  const printing = page
    .waitForResponse(
      (response) => new URL(response.url()).pathname === endpoint + "/print" && response.request().method() === "POST",
    )
    .then(async (response) => {
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toContain("no-store");
      return {
        request: badgePrintRequestSchema.parse(response.request().postDataJSON()),
        artifact: badgePrintResponseSchema.parse(await response.json()),
      };
    });
  await page.getByRole("button", { name: "Prepare print preview", exact: true }).click();
  const printed = await printing;
  const image = page.getByRole("img", { name: "Attendee badge QR code", exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await image.getAttribute("src")).toBe(
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(printed.artifact.svg),
  );
  const pixels = await sharp(await image.screenshot())
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(pixels.data), pixels.info.width, pixels.info.height);
  expect(decoded?.data).toBe(credential);
  const text = await image.evaluate((element) => {
    const source = (element as HTMLImageElement).src;
    const svg = decodeURIComponent(source.slice(source.indexOf(",") + 1));
    return [...new DOMParser().parseFromString(svg, "image/svg+xml").querySelectorAll("text")].map(
      (node) => node.textContent,
    );
  });
  expect(text).toEqual(["Badge code", formatBadgeCredential(credential)]);
  const preview = page.frameLocator('iframe[title="Attendee badge print preview"]');
  await expect(preview.getByRole("img", { name: "Attendee badge QR code", exact: true })).toHaveAttribute(
    "src",
    (await image.getAttribute("src")) ?? "",
  );
  return printed;
}

test("the protected printed short code works through manual offline capture and exact original-operation replay", async ({
  page,
}, info) => {
  const fixture = await prepareScannerTermination(page);
  const credential = badgeCredentialSchema.parse(fixture.eligible);
  expect(credential).toHaveLength(16);
  expect(credential).not.toBe(fixture.eligibleBadgeId);
  const endpoint = fixture.api + "/badges/" + fixture.eligibleBadgeId;
  const eventResponse = await page.request.get(fixture.api);
  expect(eventResponse.status()).toBe(200);
  const { event } = eventManagementDetailResponseSchema.parse(await eventResponse.json());
  if (!event.ownerGroupId) throw new Error("The fixture event must have its actual owning group");
  const printPage = `/portal/#/groups/${event.ownerGroupId}/events/${event.id}/registrations/badges/${fixture.eligibleBadgeId}/print`;
  const before = await metadata(page, endpoint, credential);
  expect(before).toMatchObject({
    id: fixture.eligibleBadgeId,
    userId: fixture.attendeeId,
    status: "active",
    reprintAvailable: true,
  });
  const readConsole = captureDeviceConsole(page);
  const summaryBefore = attendanceSummarySchema.parse(
    await (await page.request.get(fixture.api + "/attendance/summary")).json(),
  );
  const agendaBefore = agendaSnapshotSchema.parse(await (await page.request.get(fixture.api + "/agenda")).json());
  await page.goto(printPage);
  await expect(page.getByRole("heading", { name: "Reprint badge", exact: true })).toBeVisible();
  const firstPrint = await preparePrintedBadge(page, endpoint, credential);
  expect(firstPrint.artifact.id).toBe(fixture.eligibleBadgeId);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("manual-code-protected-print-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  const printPrivacy = await expectNoStoredSponsorContacts(
    page,
    [...fixture.forbidden, firstPrint.artifact.svg],
    await readConsole(),
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Prepare print preview", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Attendee badge QR code", exact: true })).toHaveCount(0);
  const repeatedPrint = await preparePrintedBadge(page, endpoint, credential);
  expect(repeatedPrint.artifact).toEqual(firstPrint.artifact);
  expect(repeatedPrint.request.operationId).not.toBe(firstPrint.request.operationId);
  expect(await metadata(page, endpoint, credential)).toEqual(before);
  const inventory = badgeCredentialsResponseSchema.parse(
    await (await page.request.get(fixture.api + "/badges")).json(),
  );
  expect(inventory.badges.map((row) => row.id)).toEqual([fixture.eligibleBadgeId]);
  expect(inventory.page.total).toBe(1);

  const preparing = page
    .waitForResponse(
      (response) => new URL(response.url()).pathname === fixture.api + "/offline-eligibility" && response.ok(),
    )
    .then(async (response) => enrolledOfflineEligibilityResponseSchema.parse(await response.json()));
  await page.goto(fixture.scanner);
  const manifest = await preparing;
  expect(manifest.publishedRevision).toBe(fixture.publishedRevision);
  expect(manifest.entries.find((row) => row.badgeId === fixture.eligibleBadgeId)).toMatchObject({
    userId: fixture.attendeeId,
    revoked: false,
    eventRegistered: true,
  });
  await openScannerDiagnostics(page);
  await expect(
    page.getByText("Eligibility data ready. Checks run locally; attendance uploads in the background.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Offline camera files prepared.", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).not.toBe("");
  await expect
    .poll(async () =>
      page
        .evaluate(
          async ({ version, epochId }) => {
            const opening = indexedDB.open("pkic-scanner-outbox", version);
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              opening.onsuccess = () => resolve(opening.result);
              opening.onerror = () => reject(opening.error ?? new Error("Scanner storage unavailable"));
            });
            try {
              return await new Promise<unknown>((resolve, reject) => {
                const request = db.transaction("scanner-epochs").objectStore("scanner-epochs").getAll();
                request.onsuccess = () =>
                  resolve(
                    request.result.find((row: { epochId: string }) => row.epochId === epochId)?.collectorContext ??
                      null,
                  );
                request.onerror = () => reject(request.error ?? new Error("Scanner preparation unavailable"));
              });
            } finally {
              db.close();
            }
          },
          { version: SCAN_STORAGE_VERSION, epochId: manifest.epochId },
        )
        .then((raw) => {
          const parsed = scannerOfflineContextSchema.safeParse(raw);
          return (
            parsed.success &&
            parsed.data.eventId === manifest.eventId &&
            parsed.data.epochId === manifest.epochId &&
            parsed.data.deviceId === manifest.deviceId &&
            parsed.data.action === "attendance"
          );
        }),
    )
    .toBe(true);
  await page.context().setOffline(true);
  try {
    await openScannerManualEntry(page);
    await page
      .getByRole("textbox", { name: "Badge code", exact: true })
      .fill(formatBadgeCredential(credential).toLowerCase());
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(1);
    const queued = enrolledEventScanRequestSchema.parse((await scannerStorage(page)).pending[0]!.scan);
    expect(queued).toMatchObject({
      badgeId: credential,
      operatorUserId: fixture.operatorId,
      occurrenceId: null,
      action: "attendance",
      capturePublicationRevision: fixture.publishedRevision,
      scannerSession: { epochId: manifest.epochId, sequence: 1 },
    });
    const queuedPrivacy = await expectNoStoredSponsorContacts(page, fixture.forbidden, await readConsole());
    await page.reload();
    await expect(page.getByRole("heading", { name: "Badge scanner", exact: true })).toBeVisible();
    await expect(page.getByText("Offline · unverified until synced", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export sponsor leads", exact: true })).toHaveCount(0);
    expect((await scannerStorage(page)).pending[0]!.scan).toEqual(queued);
    await openScannerManualEntry(page);
    await page.getByRole("textbox", { name: "Badge code", exact: true }).fill(fixture.eligibleBadgeId);
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect(page.getByText("Enter all 16 characters of the badge code.", { exact: true })).toBeVisible();
    const afterReference = await scannerStorage(page);
    expect(afterReference.pending).toHaveLength(1);
    expect(afterReference.pending[0]!.scan).toEqual(queued);
    expect(afterReference.history).toHaveLength(0);
    await page
      .getByRole("textbox", { name: "Badge code", exact: true })
      .fill(formatBadgeCredential(credential).toLowerCase());
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(2);
    const afterReload = (await scannerStorage(page)).pending.find((row) => row.scan.operationId !== queued.operationId);
    expect(afterReload).toBeDefined();
    const second = enrolledEventScanRequestSchema.parse(afterReload!.scan);
    expect(second.operationId).not.toBe(queued.operationId);
    expect(second).toMatchObject({
      badgeId: credential,
      operatorUserId: fixture.operatorId,
      occurrenceId: queued.occurrenceId,
      action: "attendance",
      capturePublicationRevision: queued.capturePublicationRevision,
      scannerSession: { epochId: manifest.epochId, sequence: 2 },
    });
    expect(
      (await scannerStorage(page)).pending.find((row) => row.scan.operationId === queued.operationId)?.scan,
    ).toEqual(queued);
    await expect(page.locator(".pk-event-scanner--unverified")).toBeVisible();
    await expect(
      page.getByText("Scan saved on this device. Reconnect to verify and upload.", { exact: true }),
    ).toBeVisible();
    expect((await scannerStorage(page)).history).toHaveLength(0);
    const collectorPrivacy = await expectNoStoredSponsorContacts(page, fixture.forbidden, await readConsole());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath("manual-code-offline-canonical-phone.png"),
      fullPage: true,
      animations: "disabled",
    });
    const originals = [queued, second];
    const uploads = originals.map((original) =>
      page
        .context()
        .waitForEvent("response", {
          predicate: (response) =>
            new URL(response.url()).pathname === fixture.api + "/scans" &&
            response.request().method() === "POST" &&
            response.request().postDataJSON()?.operationId === original.operationId,
        })
        .then(async (response) => {
          expect(response.status()).toBe(200);
          expect(enrolledEventScanRequestSchema.parse(response.request().postDataJSON())).toEqual(original);
          return eventScanResponseSchema.parse(await response.json());
        }),
    );
    await page.context().setOffline(false);
    const reauthenticated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/auth/session" && response.request().method() === "GET",
    );
    await page.getByRole("button", { name: "Check sign-in again", exact: true }).click();
    expect((await reauthenticated).status()).toBe(200);
    await expect(page.getByText("Offline · unverified until synced", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    const receipts = await Promise.all(uploads);
    for (const [index, original] of originals.entries())
      expect(receipts[index]).toMatchObject({
        operationId: original.operationId,
        recorded: true,
        attendanceRecorded: true,
        outcome: "eligible",
      });
    await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(0);
    const reconciled = await scannerStorage(page);
    expect(reconciled.history).toHaveLength(2);
    for (const [index, original] of originals.entries()) {
      expect(reconciled.history.filter((row) => row.scan.operationId === original.operationId)).toHaveLength(1);
      expect(reconciled.history.find((row) => row.scan.operationId === original.operationId)).toMatchObject({
        scan: original,
        receipt: receipts[index],
      });
      const replay = await page.request.post(fixture.api + "/scans", { data: original });
      expect(replay.status()).toBe(200);
      expect(eventScanResponseSchema.parse(await replay.json())).toEqual(receipts[index]);
    }
    const query = attendanceAttemptQuerySchema.parse({ userId: fixture.attendeeId, limit: 50, offset: 0 });
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    const attempts = attendanceAttemptsResponseSchema.parse(
      await (await page.request.get(fixture.api + "/attendance/attempts?" + params.toString())).json(),
    );
    expect(attempts.page.total).toBe(2);
    expect(attempts.attempts).toHaveLength(2);
    expect(new Set(attempts.attempts.map((attempt) => attempt.id)).size).toBe(2);
    for (const original of originals)
      expect(attempts.attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            deviceId: original.deviceId,
            operatorUserId: fixture.operatorId,
            action: "attendance",
            observedAt: original.observedAt,
          }),
        ]),
      );
    const after = attendanceSummarySchema.parse(
      await (await page.request.get(fixture.api + "/attendance/summary")).json(),
    );
    expect(after.observed.originalObservations - summaryBefore.observed.originalObservations).toBe(2);
    expect(after.observed.uniquePeople - summaryBefore.observed.uniquePeople).toBe(1);
    expect(after.attempts.recognized - summaryBefore.attempts.recognized).toBe(2);
    expect(after.attempts.admissions).toBe(summaryBefore.attempts.admissions);
    expect(agendaSnapshotSchema.parse(await (await page.request.get(fixture.api + "/agenda")).json())).toEqual(
      agendaBefore,
    );
    expect(
      registrationManageReadResponseSchema.parse(await (await page.request.get(fixture.managePath)).json()),
    ).toEqual(fixture.registrationBefore);
    expect(await metadata(page, endpoint, credential)).toEqual(before);
    const finalPrivacy = await expectNoStoredSponsorContacts(
      page,
      [...fixture.forbidden, firstPrint.artifact.svg],
      await readConsole(true),
    );
    await writeFile(
      info.outputPath("manual-badge-code-proof.json"),
      JSON.stringify(
        {
          kind: "synthetic_actual_manual_short_code_offline_replay",
          badgeId: fixture.eligibleBadgeId,
          operatorId: fixture.operatorId,
          originalOperationIds: originals.map((original) => original.operationId),
          metadataReferenceRejectedBeforeCapture: true,
          renderedQrDecoded: true,
          printedCodeLength: credential.length,
          protectedReprintSameArtifact: true,
          canonicalOfflineQueueSurvivedReload: true,
          twoIntentionalOriginalOperationsReplayedExactlyOnce: true,
          oneUniqueObservedPerson: true,
          postReloadCaptureWasUnverifiedUntilCanonicalSync: true,
          reconnectUsedExplicitCanonicalSignInRetry: true,
          printPrivacy,
          queuedPrivacy,
          collectorPrivacy,
          finalPrivacy,
          physicalCameraAndPrintingAcceptance: "not_tested",
        },
        null,
        2,
      ),
    );
  } finally {
    await page.context().setOffline(false);
  }
});
