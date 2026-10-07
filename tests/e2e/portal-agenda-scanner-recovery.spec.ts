import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { formatDateTime } from "../../assets/shared/format-date";
import { apiErrorPayloadSchema } from "../../assets/shared/schemas/api-common";
import {
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import { userAuthLogoutResponseSchema, userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { scanRecoverySchema } from "../../assets/shared/schemas/event-scan-recovery";
import { enrolledOfflineEligibilityResponseSchema } from "../../assets/shared/schemas/event-offline-eligibility";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import {
  downloadScannerRecovery,
  expectScannerSyncTime,
  expectStaleLogoutRefusal,
  downloadScannerRecoveryFile,
  importScannerRecoveryFile,
  holdGuardedLogout,
  reconnectScannerBrowser,
  scannerSessionState,
  scannerEligibilityCount,
  signOutThroughPortal,
  openScannerDiagnostics,
  openScannerManualEntry,
  openScannerRecovery,
  scannerStorage,
  scrollScannerToTop,
} from "./helpers/scanner-recovery-storage";

import { replaceScannerWorker, replayScannerFromTwoTabs } from "./helpers/scanner-worker-replacement";

const slug = "pqc-conference-amsterdam-nl";
const scannerPath = `/portal/#/events/${slug}/scanner`;
const scansPath = `/api/v1/events/${slug}/scans`;
const viewer = Intl.DateTimeFormat().resolvedOptions();
// The canonical formatter uses the viewer's defaults in both browser and test.
test.use({ locale: viewer.locale, timezoneId: viewer.timeZone });

test("real pending scanner storage survives reload and logout without crossing accounts", async ({
  page: initialPage,
  context,
  browser,
}, testInfo) => {
  let page = initialPage;
  test.setTimeout(240_000);
  const ownerEmail = e2eAdminEmail("scanner-recovery-owner");
  const otherEmail = e2eAdminEmail("scanner-recovery-other");
  await signInAsE2eStaff(page, ownerEmail);
  const ownerResponse = await page.request.get("/api/v1/auth/session");
  expect(ownerResponse.status()).toBe(200);
  const owner = userAuthSessionResponseSchema.parse(await ownerResponse.json());
  const preparing = context.waitForEvent("response", (response) => {
    const url = new URL(response.url());
    return (
      url.pathname === `/api/v1/events/${slug}/offline-eligibility` &&
      !url.searchParams.has("afterBadgeId") &&
      response.ok()
    );
  });
  await page.goto(scannerPath);
  const snapshot = enrolledOfflineEligibilityResponseSchema.parse(await (await preparing).json());
  expect(snapshot.operatorUserId).toBe(owner.identity.id);
  await expect(page.getByLabel("Scan mode", { exact: true })).toHaveValue("attendance");
  const diagnostics = await openScannerDiagnostics(page);
  await expectScannerSyncTime(page, "No retained acknowledgment");
  await expect(page.getByText("Last eligibility check", { exact: true })).toBeVisible();
  await expect(page.getByText("Snapshot expires", { exact: true })).toBeVisible();
  for (const [label, timestamp] of [
    ["Last eligibility check", snapshot.serverNow],
    ["Snapshot expires", snapshot.expiresAt],
  ]) {
    const term = page.locator("dt").filter({ hasText: new RegExp(`^${label}$`) });
    await expect(term.locator("xpath=following-sibling::dd[1]")).toHaveText(formatDateTime(timestamp));
  }
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).not.toBe("");
  await expect(diagnostics.getByRole("button", { name: "Close scanner session", exact: true })).toBeEnabled();
  await expect(
    diagnostics.getByText("Scanner session: open. Offline preparation uses the last saved authorization.", {
      exact: true,
    }),
  ).toBeVisible();
  await diagnostics.getByText("Recovery and diagnostics", { exact: true }).click();
  for (const [name, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await scrollScannerToTop(page);
    await page.screenshot({
      fullPage: true,
      animations: "disabled",
      path: testInfo.outputPath(`scanner-ready-${name}.png`),
    });
  }

  await context.setOffline(true);
  const badgeId = randomUUID();
  await openScannerManualEntry(page);
  await page.getByLabel("Badge code", { exact: true }).fill(badgeId);
  await page.getByRole("button", { name: "Record attendance", exact: true }).click();
  await expect(page.getByText("1 scans awaiting upload", { exact: true })).toBeVisible();
  const clearedBadge = page.getByLabel("Badge code", { exact: true });
  await expect(clearedBadge).toHaveValue("");
  await expect(clearedBadge).not.toHaveAttribute("aria-invalid", "true");
  const badgeField = page.locator(".pk-field").filter({ has: clearedBadge });
  await expect(badgeField).not.toHaveClass(/pk-field--invalid/);
  await expect(badgeField.getByRole("alert")).toHaveCount(0);
  const stored = await scannerStorage(page);
  expect(stored.pending).toHaveLength(1);
  const record = stored.pending[0];
  const original = enrolledEventScanRequestSchema.parse(record.scan);
  expect(original).toMatchObject({ badgeId, operatorUserId: owner.identity.id, action: "attendance" });
  expect(original.offlineRight).toBeUndefined();
  expect(Object.keys(original)).not.toEqual(expect.arrayContaining(["email", "name", "contacts"]));
  expect(stored.history).toHaveLength(0);
  await openScannerRecovery(page);
  await expect(page.getByText("1 pending scans included in recovery downloads.", { exact: true })).toBeVisible();
  const pendingFile = await downloadScannerRecoveryFile(page);
  const pendingBackup = pendingFile.payload;
  expect(pendingBackup.operatorUserId).toBe(owner.identity.id);
  expect(pendingBackup.pending).toEqual([{ eventId: slug, scan: original }]);
  expect(pendingBackup.records).toHaveLength(0);
  expect(pendingBackup.scannerEpochs.map((epoch) => epoch.epochId)).toContain(original.scannerSession.epochId);
  await scrollScannerToTop(page);
  await page.screenshot({
    fullPage: true,
    animations: "disabled",
    path: testInfo.outputPath("scanner-pending-recovery-phone.png"),
  });

  // The actual offline control signs out locally before a guarded server request can run.
  await scrollScannerToTop(page);
  await signOutThroughPortal(page);
  await expect(
    page.getByText("Signed out on this device. Connect to finish signing out.", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => scannerSessionState(page))
    .toMatchObject({ active: null, pending: { sessionId: owner.sessionId, operatorUserId: owner.identity.id } });
  expect((await scannerStorage(page)).pending.map(({ scan }) => scan)).toEqual([original]);
  await expect.poll(() => scannerEligibilityCount(page)).toBe(0);
  await page.screenshot({
    fullPage: true,
    animations: "disabled",
    path: testInfo.outputPath("scanner-offline-signed-out-phone.png"),
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Sign in with a passkey", exact: true })).toBeVisible();
  await expect(page.getByLabel("Badge code", { exact: true })).toHaveCount(0);
  await expect
    .poll(() => scannerSessionState(page))
    .toMatchObject({ active: null, pending: { sessionId: owner.sessionId, operatorUserId: owner.identity.id } });
  expect((await scannerStorage(page)).pending.map(({ scan }) => scan)).toEqual([original]);

  const oldLogout = await holdGuardedLogout(page, owner.sessionId);
  await reconnectScannerBrowser(context, page);
  const endedOwner = userAuthLogoutResponseSchema.parse(await (await oldLogout.capture()).json());
  expect(["revoked", "already_ended"]).toContain(endedOwner.outcome);
  // A new tab performs a real B sign-in while A's real logout response is delayed.
  const accountTab = await context.newPage();
  await signInAsE2eStaff(accountTab, otherEmail);
  const otherResponse = await accountTab.request.get("/api/v1/auth/session");
  expect(otherResponse.status()).toBe(200);
  const other = userAuthSessionResponseSchema.parse(await otherResponse.json());
  expect(other.identity.id).not.toBe(owner.identity.id);
  await expectStaleLogoutRefusal(accountTab, owner.sessionId);
  expect(await oldLogout.release()).toEqual(endedOwner);
  await expect(accountTab.getByRole("button", { name: "Sign in with a passkey", exact: true })).toHaveCount(0);
  const stillOther = userAuthSessionResponseSchema.parse(
    await (await accountTab.request.get("/api/v1/auth/session")).json(),
  );
  expect(stillOther.sessionId).toBe(other.sessionId);
  await expect
    .poll(() => scannerSessionState(accountTab))
    .toMatchObject({ active: { sessionId: other.sessionId, operatorUserId: other.identity.id }, pending: null });
  await accountTab.close();
  await page.goto(scannerPath);
  // An unchanged hash route keeps A's signed-out shell; reload checks B's actual current cookie.
  const checkingOther = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/auth/session" && response.request().method() === "GET",
  );
  await page.reload();
  const checkingOtherResponse = await checkingOther;
  expect(checkingOtherResponse.status()).toBe(200);
  const checkedOther = userAuthSessionResponseSchema.parse(await checkingOtherResponse.json());
  expect(checkedOther.sessionId).toBe(other.sessionId);
  expect(checkedOther.identity.id).toBe(other.identity.id);
  await expect(page.getByRole("heading", { name: "Badge scanner", exact: true })).toBeVisible();
  await openScannerDiagnostics(page);
  await expect(page.locator(".pk-event-scanner")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close scanner session", exact: true })).toBeEnabled();
  await openScannerRecovery(page);
  await expect(
    page.getByText("0 uploaded scans available for this event and your account.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0 pending scans included in recovery downloads.", { exact: true })).toBeVisible();
  await expectScannerSyncTime(page, "No retained acknowledgment");
  const otherBackup = await downloadScannerRecovery(page);
  expect(otherBackup.operatorUserId).toBe(other.identity.id);
  expect(otherBackup.pending).toHaveLength(0);
  expect(otherBackup.records).toHaveLength(0);
  expect(otherBackup.scannerEpochs.every((epoch) => epoch.operatorUserId === other.identity.id)).toBe(true);
  expect(otherBackup.scannerEpochs.map((epoch) => epoch.epochId)).not.toContain(original.scannerSession.epochId);
  await importScannerRecoveryFile(page, pendingFile.path);
  await expect(
    page.getByText(
      "Could not import this file. Connect to the internet and sign in with the original account for this event. Existing recovery records have been retained.",
      { exact: true },
    ),
  ).toBeVisible();
  const refused = await page.request.post(scansPath, { data: original });
  expect(refused.status()).toBe(403);
  expect(apiErrorPayloadSchema.parse(await refused.json()).error.code).toBe("SCAN_OPERATOR_CHANGED");
  expect((await scannerStorage(page)).pending.map(({ scan }) => scan)).toEqual([original]);
  expect((await scannerStorage(page)).history).toHaveLength(0);
  await scrollScannerToTop(page);
  await page.screenshot({
    fullPage: true,
    animations: "disabled",
    path: testInfo.outputPath("scanner-other-account-recovery-phone.png"),
  });

  await scrollScannerToTop(page);
  await signOutThroughPortal(page);
  const replacement = await replaceScannerWorker(context, page, original);
  page = replacement.page;
  await writeFile(testInfo.outputPath("scanner-worker-replacement.json"), JSON.stringify(replacement.receipt, null, 2));
  const uploading = context.waitForEvent(
    "response",
    (response) =>
      new URL(response.url()).pathname === scansPath &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.operationId === original.operationId &&
      response.ok(),
  );
  await signInAsE2eStaff(page, ownerEmail);
  await page.goto(scannerPath);
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  const uploaded = await uploading;
  expect(enrolledEventScanRequestSchema.parse(uploaded.request().postDataJSON())).toEqual(original);
  const receipt = eventScanResponseSchema.parse(await uploaded.json());
  expect(receipt).toMatchObject({ operationId: original.operationId, outcome: "unknown", attendanceRecorded: false });
  await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(0);
  await expect(page.getByRole("heading", { name: "Badge scanner", exact: true })).toBeVisible();
  await expect(page.locator(".pk-event-scanner")).toHaveCount(0);
  const recovered = await scannerStorage(page);
  expect(recovered.pending).toHaveLength(0);
  expect(recovered.history).toHaveLength(1);
  expect(recovered.history[0].scan).toEqual(original);
  expect(recovered.history[0].receipt).toEqual(receipt);
  const originalSyncTime = formatDateTime(new Date(recovered.history[0].acknowledgedAt).toISOString());
  await openScannerDiagnostics(page);
  await expectScannerSyncTime(page, originalSyncTime);
  await openScannerRecovery(page);
  const uploadedFile = await downloadScannerRecoveryFile(page);
  const uploadedBackup = uploadedFile.payload;
  expect(uploadedBackup.pending).toHaveLength(0);
  expect(uploadedBackup.records.map(({ scan }) => scan)).toEqual([original]);
  const competition = await replayScannerFromTwoTabs(context, page, scannerPath, scansPath, original, receipt);
  await writeFile(testInfo.outputPath("scanner-two-tab-replay.json"), JSON.stringify(competition, null, 2));
  await expectScannerSyncTime(page, originalSyncTime);

  // A second real deferred logout must also preserve a newer session of the same person.
  const ownerAgain = userAuthSessionResponseSchema.parse(await (await page.request.get("/api/v1/auth/session")).json());
  expect(ownerAgain.identity.id).toBe(owner.identity.id);
  expect(ownerAgain.sessionId).not.toBe(owner.sessionId);
  await context.setOffline(true);
  await scrollScannerToTop(page);
  await signOutThroughPortal(page);
  await expect
    .poll(() => scannerSessionState(page))
    .toMatchObject({ active: null, pending: { sessionId: ownerAgain.sessionId } });
  const sameOwnerLogout = await holdGuardedLogout(page, ownerAgain.sessionId);
  await reconnectScannerBrowser(context, page);
  const endedAgain = userAuthLogoutResponseSchema.parse(await (await sameOwnerLogout.capture()).json());
  expect(["revoked", "already_ended"]).toContain(endedAgain.outcome);
  const renewedTab = await context.newPage();
  await signInAsE2eStaff(renewedTab, ownerEmail);
  const renewed = userAuthSessionResponseSchema.parse(
    await (await renewedTab.request.get("/api/v1/auth/session")).json(),
  );
  expect(renewed.identity.id).toBe(owner.identity.id);
  expect(renewed.sessionId).not.toBe(ownerAgain.sessionId);
  await expectStaleLogoutRefusal(renewedTab, ownerAgain.sessionId);
  expect(await sameOwnerLogout.release()).toEqual(endedAgain);
  await expect(renewedTab.getByRole("button", { name: "Sign in with a passkey", exact: true })).toHaveCount(0);
  expect(
    userAuthSessionResponseSchema.parse(await (await renewedTab.request.get("/api/v1/auth/session")).json()).sessionId,
  ).toBe(renewed.sessionId);
  await expect
    .poll(() => scannerSessionState(renewedTab))
    .toMatchObject({ active: { sessionId: renewed.sessionId }, pending: null });

  // Transfer only the real login cookies: this context has no copied localStorage or IDB.
  const recoveryContext = await browser.newContext({
    storageState: { cookies: await context.cookies(), origins: [] },
    locale: viewer.locale,
    timezoneId: viewer.timeZone,
  });
  try {
    const recoveredPage = await recoveryContext.newPage();
    await recoveredPage.goto(new URL(scannerPath, page.url()).href);
    await expect(recoveredPage.getByLabel("Scan mode", { exact: true })).toHaveValue("attendance");
    await openScannerDiagnostics(recoveredPage);
    await expect(recoveredPage.getByRole("button", { name: "Close scanner session", exact: true })).toBeEnabled();
    await openScannerRecovery(recoveredPage);
    const freshBackup = await downloadScannerRecovery(recoveredPage);
    expect(freshBackup.records).toHaveLength(0);
    expect(freshBackup.pending).toHaveLength(0);
    expect(freshBackup.scannerEpochs).toHaveLength(1);
    expect(freshBackup.scannerEpochs[0].deviceId).not.toBe(original.deviceId);
    await expectScannerSyncTime(recoveredPage, "No retained acknowledgment");
    const beforeImport = await scannerStorage(recoveredPage);
    expect(beforeImport.pending).toHaveLength(0);
    expect(beforeImport.history).toHaveLength(0);
    const importingUpload = recoveryContext.waitForEvent(
      "response",
      (response) =>
        new URL(response.url()).pathname === scansPath &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.operationId === original.operationId &&
        response.ok(),
    );
    await importScannerRecoveryFile(recoveredPage, uploadedFile.path);
    await expect(
      recoveredPage.getByText(
        "Imported 1 scans for recovery and 1 uploaded receipts. Original scan IDs prevent duplicate attendance.",
        { exact: true },
      ),
    ).toBeVisible();
    const importedResponse = await importingUpload;
    expect(enrolledEventScanRequestSchema.parse(importedResponse.request().postDataJSON())).toEqual(original);
    expect(eventScanResponseSchema.parse(await importedResponse.json())).toEqual(receipt);
    await expect.poll(async () => (await scannerStorage(recoveredPage)).pending.length).toBe(0);
    await expect(recoveredPage.getByRole("heading", { name: "Badge scanner", exact: true })).toBeVisible();
    await expect(recoveredPage.locator(".pk-event-scanner")).toHaveCount(0);
    const imported = await scannerStorage(recoveredPage);
    expect(imported.pending).toHaveLength(0);
    expect(imported.history).toEqual(uploadedBackup.records);
    await openScannerDiagnostics(recoveredPage);
    await expectScannerSyncTime(recoveredPage, originalSyncTime);
    await importScannerRecoveryFile(recoveredPage, uploadedFile.path);
    await expect(
      recoveredPage.getByText(
        "Imported 0 scans for recovery and 0 uploaded receipts. Original scan IDs prevent duplicate attendance.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(await scannerStorage(recoveredPage)).toEqual(imported);

    const retainedBackup = await downloadScannerRecovery(recoveredPage);

    // A valid file with the same operation/sequence but substituted immutable badge data must fail atomically.
    const conflicting = scanRecoverySchema.parse({
      ...pendingBackup,
      pending: [{ eventId: slug, scan: { ...original, badgeId: randomUUID() } }],
    });
    const conflictPath = testInfo.outputPath("scanner-recovery-conflict.json");
    await writeFile(conflictPath, JSON.stringify(conflicting));
    await importScannerRecoveryFile(recoveredPage, conflictPath);
    await expect(
      recoveredPage.getByText(
        "Could not import this file. Connect to the internet and sign in with the original account for this event. Existing recovery records have been retained.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(await scannerStorage(recoveredPage)).toEqual(imported);
    const afterBackup = await downloadScannerRecovery(recoveredPage);
    expect(afterBackup.records).toEqual(uploadedBackup.records);
    await expectScannerSyncTime(recoveredPage, originalSyncTime);
    expect(afterBackup.scannerEpochs).toEqual(retainedBackup.scannerEpochs);
    expect(afterBackup.pending).toHaveLength(0);
    expect(afterBackup.scannerEpochs.map((epoch) => epoch.epochId)).toContain(original.scannerSession.epochId);
    const nativeEpochs = afterBackup.scannerEpochs.filter((epoch) => epoch.epochId !== original.scannerSession.epochId);
    expect(nativeEpochs).toHaveLength(1);
    expect(nativeEpochs[0].deviceId).not.toBe(original.deviceId);
    expect(nativeEpochs[0]).toEqual(freshBackup.scannerEpochs[0]);
    expect(nativeEpochs[0].issuedHighWater).toBe(0);
    expect(nativeEpochs[0].state).toBe("open");
  } finally {
    await recoveryContext.close();
    await renewedTab.close();
  }
});
