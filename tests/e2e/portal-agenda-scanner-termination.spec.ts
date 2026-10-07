import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { expect, test, type BrowserContext } from "@playwright/test";
import {
  attendanceSummarySchema,
  attendanceAttemptQuerySchema,
  attendanceAttemptsResponseSchema,
} from "../../assets/shared/schemas/event-attendance-reporting";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { enrolledOfflineEligibilityResponseSchema } from "../../assets/shared/schemas/event-offline-eligibility";
import {
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { registrationManageReadResponseSchema } from "../../assets/shared/schemas/registration";
import {
  scannerStorage,
  openScannerDiagnostics,
  openScannerManualEntry,
  scannerSessionState,
} from "./helpers/scanner-recovery-storage";
import { captureDeviceConsole, expectNoStoredSponsorContacts } from "./helpers/sponsor-live-fixture";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { clientIpForIdentity } from "./helpers/portal-auth";
import {
  launchPersistentScanner,
  prepareScannerTermination,
  holdScannerReceipt,
  crashPersistentScanner,
  observeScannerReplay,
} from "./helpers/scanner-browser-termination";

test("a real browser crash preserves a committed upload lease and reclaims the original operation after restart", async ({
  browserName,
}, info) => {
  test.skip(browserName !== "chromium", "Owned process termination requires Chromium's CDP process identity");
  const stateRoot =
    process.env.E2E_STATE_ROOT ?? resolve((await readFile("test-results/e2e-state-dir", "utf8")).trim());
  const baseURL = info.project.use.baseURL;
  if (!stateRoot || !baseURL) throw new Error("Use the private E2E_STATE_ROOT and canonical configured baseURL");
  const reportRelativePath = relative(resolve(info.project.outputDir), resolve(stateRoot));
  if (reportRelativePath !== ".." && !reportRelativePath.startsWith(`..${sep}`) && !isAbsolute(reportRelativePath))
    throw new Error("Persistent authentication and IDB profiles must remain outside browser report output");
  // Keep session cookies/IDB profile outside Playwright reports and attachments.
  const profile = await mkdtemp(join(stateRoot, "scanner-termination-profile-"));
  let context: BrowserContext | null = null;
  let releaseHeld: (() => void) | undefined;
  try {
    context = await launchPersistentScanner(profile, baseURL);
    let page = context.pages()[0] ?? (await context.newPage());
    const fixture = await prepareScannerTermination(page);
    const measurementApi = fixture.api;
    const measurementScanner = fixture.scanner;
    const owner = userAuthSessionResponseSchema.parse(await (await page.request.get("/api/v1/auth/session")).json());
    const logs = captureDeviceConsole(page);
    const before = attendanceSummarySchema.parse(
      await (await page.request.get(`${measurementApi}/attendance/summary`)).json(),
    );
    const agendaBefore = agendaSnapshotSchema.parse(await (await page.request.get(`${measurementApi}/agenda`)).json());
    const preparing = page
      .waitForResponse(
        (response) => new URL(response.url()).pathname === `${measurementApi}/offline-eligibility` && response.ok(),
      )
      .then(async (response) => enrolledOfflineEligibilityResponseSchema.parse(await response.json()));
    await page.goto(measurementScanner);
    const manifest = await preparing;
    expect(manifest.publishedRevision).toBe(fixture.publishedRevision);
    expect(manifest.entries.find((entry) => entry.badgeId === fixture.eligibleBadgeId)).toMatchObject({
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
    await context.setOffline(true);
    await openScannerManualEntry(page);
    await page.getByLabel("Badge code", { exact: true }).fill(fixture.eligible);
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(1);
    const original = enrolledEventScanRequestSchema.parse((await scannerStorage(page)).pending[0]!.scan);
    expect(original).toMatchObject({
      operatorUserId: fixture.operatorId,
      action: "attendance",
      deviceId: manifest.deviceId,
      capturePublicationRevision: fixture.publishedRevision,
      scannerSession: { epochId: manifest.epochId, sequence: 1 },
    });
    const held = await holdScannerReceipt(context, `${measurementApi}/scans`, original);
    releaseHeld = held.release;
    await context.setOffline(false);
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    const committed = await held.committed();
    expect(committed.receipt).toMatchObject({
      operationId: original.operationId,
      outcome: "eligible",
      attendanceRecorded: true,
    });
    const claimed = await scannerStorage(page);
    expect(claimed.pending).toHaveLength(1);
    expect(claimed.history).toHaveLength(0);
    const lease = claimed.pending[0]!;
    expect(lease.scan).toEqual(original);
    expect(lease.owner).not.toBeNull();
    expect(lease.leaseUntil).toBeGreaterThan(await page.evaluate(() => Date.now()));
    const alreadyCommitted = attendanceSummarySchema.parse(
      await (await page.request.get(`${measurementApi}/attendance/summary`)).json(),
    );
    expect(alreadyCommitted.observed.originalObservations - before.observed.originalObservations).toBe(1);
    expect(alreadyCommitted.attempts.recognized - before.attempts.recognized).toBe(1);
    const pendingPrivacy = await expectNoStoredSponsorContacts(page, fixture.forbidden, await logs());
    await page.screenshot({
      path: info.outputPath("scanner-claimed-before-crash.png"),
      fullPage: true,
      animations: "disabled",
    });
    expect(lease.leaseUntil).toBeGreaterThan(await page.evaluate(() => Date.now()));
    const crash = await crashPersistentScanner(context, held.release);
    releaseHeld = undefined;
    context = null;

    context = await launchPersistentScanner(profile, baseURL, true);
    await context.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(fixture.operatorEmail) });
    page = context.pages()[0] ?? (await context.newPage());
    const resumedLogs = captureDeviceConsole(page);
    await page.goto("/portal/", { waitUntil: "domcontentloaded" });
    const restarted = await scannerStorage(page);
    expect(restarted).toEqual(claimed);
    expect(await scannerSessionState(page)).toMatchObject({
      active: { sessionId: owner.sessionId, operatorUserId: fixture.operatorId },
      pending: null,
    });
    const restartedPrivacy = await expectNoStoredSponsorContacts(page, fixture.forbidden, await resumedLogs());
    // Wait for the actual committed deadline, never rewrite IDB leases or mock the browser clock.
    await expect
      .poll(() => page.evaluate(() => Date.now()), { timeout: 31_000, intervals: [100, 250, 1000] })
      .toBeGreaterThanOrEqual(lease.leaseUntil);
    expect((await scannerStorage(page)).pending[0]!.scan).toEqual(original);
    const replay = await observeScannerReplay(context, `${measurementApi}/scans`, original);
    await context.setOffline(false);
    const sessionResponse = await page.request.get("/api/v1/auth/session");
    let reauthenticated = false;
    if (sessionResponse.status() === 401) {
      await signInAsE2eStaff(page, fixture.operatorEmail);
      reauthenticated = true;
    } else expect(sessionResponse.status()).toBe(200);
    const resumedOwner = userAuthSessionResponseSchema.parse(
      await (await page.request.get("/api/v1/auth/session")).json(),
    );
    expect(resumedOwner.identity.id).toBe(fixture.operatorId);
    if (!reauthenticated) expect(resumedOwner.sessionId).toBe(owner.sessionId);
    await page.goto(measurementScanner);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Badge scanner", exact: true })).toBeVisible();
    await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(0);
    const recovered = await scannerStorage(page);
    expect(recovered.history).toHaveLength(1);
    expect(recovered.history[0]!.scan).toEqual(original);
    expect(recovered.history[0]!.receipt).toEqual(committed.receipt);
    expect(replay.exchanges.length).toBeGreaterThanOrEqual(1);
    for (const exchange of replay.exchanges) {
      expect(exchange.scan).toEqual(original);
      expect(exchange.receipt).toEqual(committed.receipt);
    }
    const retry = await page.request.post(`${measurementApi}/scans`, { data: original });
    expect(retry.status()).toBe(200);
    expect(eventScanResponseSchema.parse(await retry.json())).toEqual(committed.receipt);
    const query = attendanceAttemptQuerySchema.parse({ userId: fixture.attendeeId, limit: 50, offset: 0 });
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    const attempts = attendanceAttemptsResponseSchema.parse(
      await (await page.request.get(`${measurementApi}/attendance/attempts?${params}`)).json(),
    );
    expect(attempts.page.total).toBe(1);
    expect(attempts.attempts).toHaveLength(1);
    expect(attempts.attempts[0]).toMatchObject({
      operatorUserId: fixture.operatorId,
      deviceId: original.deviceId,
      observedAt: original.observedAt,
      action: "attendance",
    });
    const after = attendanceSummarySchema.parse(
      await (await page.request.get(`${measurementApi}/attendance/summary`)).json(),
    );
    expect(after.observed.originalObservations - before.observed.originalObservations).toBe(1);
    expect(after.observed.uniquePeople - before.observed.uniquePeople).toBe(1);
    expect(after.attempts.recognized - before.attempts.recognized).toBe(1);
    expect(after.attempts.admissions).toBe(before.attempts.admissions);
    expect(agendaSnapshotSchema.parse(await (await page.request.get(`${measurementApi}/agenda`)).json())).toEqual(
      agendaBefore,
    );
    expect(
      registrationManageReadResponseSchema.parse(await (await page.request.get(fixture.managePath)).json()),
    ).toEqual(fixture.registrationBefore);
    const finalPrivacy = await expectNoStoredSponsorContacts(page, fixture.forbidden, await resumedLogs(true));
    await page.screenshot({
      path: info.outputPath("scanner-recovered-after-crash.png"),
      fullPage: true,
      animations: "disabled",
    });
    await replay.stop();
    await writeFile(
      info.outputPath("scanner-browser-termination.json"),
      JSON.stringify(
        {
          kind: "local_actual_browser_termination_during_upload_lease",
          crash,
          samePersistentProfile: true,
          original,
          originalLease: { owner: lease.owner, leaseUntil: lease.leaseUntil },
          backendReceiptBeforeCrash: committed.receipt,
          claimant: committed.source,
          reauthenticated,
          resumedSameActor: true,
          finalPending: recovered.pending.length,
          finalHistory: recovered.history.length,
          recognizedAttemptDelta: after.attempts.recognized - before.attempts.recognized,
          originalObservationDelta: after.observed.originalObservations - before.observed.originalObservations,
          privacy: { pending: pendingPrivacy, restarted: restartedPrivacy, acknowledged: finalPrivacy },
          limits: [
            "Synthetic local Chromium process, not an iPhone/Android OS termination or camera test",
            "No changed-code worker upgrade or storage-eviction claim",
            "New event confirmation uses the real mailbox token and mounted API, not newly published public HTML",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    releaseHeld?.();
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
