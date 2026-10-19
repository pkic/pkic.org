import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { expect, test } from "@playwright/test";
import {
  attendanceSummarySchema,
  attendanceAttemptsResponseSchema,
  attendanceAttemptQuerySchema,
} from "../../assets/shared/schemas/event-attendance-reporting";
import { eventScanResponseSchema } from "../../assets/shared/schemas/event-participation-scanning";
import { scannerDeviceSessionStatusSchema } from "../../assets/shared/schemas/event-scanner-devices";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { registrationManageReadResponseSchema } from "../../assets/shared/schemas/registration";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { scannerStorage, reconnectScannerBrowser, openScannerDiagnostics } from "./helpers/scanner-recovery-storage";
import { expectNoStoredSponsorContacts, captureDeviceConsole } from "./helpers/sponsor-live-fixture";
import {
  measurementApi,
  prepareScannerMeasurement,
  openMeasurementScanner,
  resumeMeasurementScanner,
  measureScannerFeedback,
  waitScannerPacing,
  leaveMeasurementScanner,
  loseFirstScanAcknowledgment,
  distribution,
  originalPendingScans,
  expectPacedRepeatIgnored,
  type FeedbackSample,
} from "./helpers/scanner-browser-measurement";

// No default benchmark or extra browser download: opt-in execution is deliberately separate.
test.skip(process.env.PKIC_SCANNER_BROWSER_MEASUREMENT !== "1", "Explicit scanner browser measurement only");
test.use({
  browserName: "firefox",
  actionTimeout: 30_000,
  viewport: { width: 1280, height: 900 },
  launchOptions: { slowMo: 0 },
});

test("@scanner-measurement two unsupported-sync devices preserve twelve captures through a lost HTTP acknowledgment", async ({
  page,
  browser,
  context,
}, info) => {
  test.setTimeout(240_000);
  const fixture = await prepareScannerMeasurement(page);
  const secondContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const other = await secondContext.newPage();
  const firstLogs = captureDeviceConsole(page),
    secondLogs = captureDeviceConsole(other);
  const summaryPath = `${measurementApi}/attendance/summary`;
  const before = attendanceSummarySchema.parse(await (await page.request.get(summaryPath)).json());
  const agendaBefore = agendaSnapshotSchema.parse(await (await page.request.get(`${measurementApi}/agenda`)).json());
  const samples: FeedbackSample[] = [];
  try {
    const first = await openMeasurementScanner(page, fixture.publishedRevision);
    expect(first.manifest.entries.find((entry) => entry.badgeId === fixture.eligibleBadgeId)).toMatchObject({
      revoked: false,
      eventRegistered: true,
      physicalDayEligible: true,
    });
    await signInAsE2eStaff(other, fixture.operatorEmail);
    const secondIdentity = userAuthSessionResponseSchema.parse(
      await (await other.request.get("/api/v1/auth/session")).json(),
    );
    expect(secondIdentity.identity.id).toBe(fixture.operatorId);
    const second = await openMeasurementScanner(other, fixture.publishedRevision);
    expect(second.manifest.deviceId).not.toBe(first.manifest.deviceId);
    expect(second.manifest.epochId).not.toBe(first.manifest.epochId);
    await context.setOffline(true);
    await secondContext.setOffline(true);
    await resumeMeasurementScanner(page);
    samples.push(await measureScannerFeedback(page, fixture.eligible, "eligible", "Registered · scan saved on device"));
    const repeat = await expectPacedRepeatIgnored(page, fixture.eligible);
    for (let index = 1; index < 6; index++) {
      await waitScannerPacing(page);
      samples.push(
        await measureScannerFeedback(page, fixture.eligible, "eligible", "Registered · scan saved on device"),
      );
    }
    await waitScannerPacing(page);
    samples.push(await measureScannerFeedback(page, fixture.revoked, "revoked", "Badge not valid"));
    await waitScannerPacing(page);
    samples.push(await measureScannerFeedback(page, fixture.unknown, "unknown", "Unknown badge"));
    const firstPending = await originalPendingScans(page, 8);
    await waitScannerPacing(page);
    samples.push(await measureScannerFeedback(page, fixture.malformed, "malformed", "Unknown badge"));
    expect(await originalPendingScans(page, 8)).toEqual(firstPending);
    await resumeMeasurementScanner(other);
    for (let index = 0; index < 4; index++) {
      await waitScannerPacing(other);
      samples.push(
        await measureScannerFeedback(other, fixture.eligible, "eligible", "Registered · scan saved on device"),
      );
    }
    const secondPending = await originalPendingScans(other, 4);
    const originals = [...firstPending, ...secondPending];
    expect(new Set(originals.map((scan) => scan.operationId)).size).toBe(12);
    for (const [device, scans] of [
      [first.manifest, firstPending],
      [second.manifest, secondPending],
    ] as const) {
      expect(scans.map((scan) => scan.scannerSession.sequence)).toEqual(scans.map((_, index) => index + 1));
      for (const scan of scans)
        expect(scan).toMatchObject({
          action: "attendance",
          operatorUserId: fixture.operatorId,
          deviceId: device.deviceId,
          scannerSession: { epochId: device.epochId },
          occurrenceId: null,
          capturePublicationRevision: fixture.publishedRevision,
        });
    }
    const pendingPrivacy = await Promise.all([
      expectNoStoredSponsorContacts(page, fixture.forbidden, await firstLogs()),
      expectNoStoredSponsorContacts(other, fixture.forbidden, await secondLogs()),
    ]);
    await leaveMeasurementScanner(page);
    await leaveMeasurementScanner(other);
    const delayMs = 150; // Controlled transport perturbation, never a performance acceptance target.
    const loss = await loseFirstScanAcknowledgment(context, firstPending[0]!, delayMs);
    const ordinary = await loseFirstScanAcknowledgment(secondContext, firstPending[0]!, delayMs);
    const startedAt = new Date().toISOString(),
      began = performance.now();
    try {
      await reconnectScannerBrowser(context, page);
      await reconnectScannerBrowser(secondContext, other);
      // Existing online/focus paths and actual foreground controls compete through canonical IDB leases.
      await page.bringToFront();
      await openScannerDiagnostics(page);
      await page.getByRole("button", { name: "Sync now", exact: true }).click();
      await other.bringToFront();
      await openScannerDiagnostics(other);
      await other.getByRole("button", { name: "Sync now", exact: true }).click();
      const durableObservations = new Map<string, number>();
      await expect
        .poll(
          async () => {
            const stores = await Promise.all([scannerStorage(page), scannerStorage(other)]);
            for (const row of stores.flatMap((store) => store.history))
              if (!durableObservations.has(row.scan.operationId))
                durableObservations.set(row.scan.operationId, performance.now() - began);
            return stores.reduce((count, store) => count + store.pending.length, 0);
          },
          { timeout: 60_000, intervals: [25, 50, 100] },
        )
        .toBe(0);
      const drainElapsedMs = performance.now() - began;
      const acknowledged = [...(await scannerStorage(page)).history, ...(await scannerStorage(other)).history];
      expect(acknowledged).toHaveLength(12);
      expect(durableObservations.size).toBe(12);
      expect(new Set(acknowledged.map((row) => row.scan.operationId)).size).toBe(12);
      for (const original of originals) {
        const archived = acknowledged.find((row) => row.scan.operationId === original.operationId);
        expect(archived?.scan).toEqual(original);
        expect(archived?.receipt.scannerReceipt).toMatchObject({
          operationId: original.operationId,
          epochId: original.scannerSession.epochId,
          sequence: original.scannerSession.sequence,
        });
        expect(archived?.receipt.admissionRecorded ?? false).toBe(false);
        if (original.badgeId === fixture.eligible)
          expect(archived?.receipt).toMatchObject({ outcome: "eligible", attendanceRecorded: true });
        else
          expect(archived?.receipt).toMatchObject({
            outcome: original.badgeId === fixture.revoked ? "denied" : "unknown",
            attendanceRecorded: false,
          });
      }
      const lost = loss.exchanges.filter((exchange) => exchange.delivery === "lost");
      expect(lost).toHaveLength(1);
      const retried = loss.exchanges.filter(
        (exchange) => exchange.scan.operationId === firstPending[0]!.operationId && exchange.delivery === "delivered",
      );
      expect(retried.length).toBeGreaterThanOrEqual(1);
      for (const exchange of retried) {
        expect(exchange.scan).toEqual(firstPending[0]);
        expect(exchange.receipt).toEqual(lost[0]!.receipt);
      }
      for (const original of originals) {
        const replay = await page.request.post(`${measurementApi}/scans`, { data: original });
        expect(replay.status()).toBe(200);
        expect(eventScanResponseSchema.parse(await replay.json())).toEqual(
          acknowledged.find((row) => row.scan.operationId === original.operationId)?.receipt,
        );
      }
      const query = attendanceAttemptQuerySchema.parse({ userId: fixture.attendeeId, limit: 50, offset: 0 });
      const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
      const attempts = attendanceAttemptsResponseSchema.parse(
        await (await page.request.get(`${measurementApi}/attendance/attempts?${params}`)).json(),
      );
      expect(attempts.page.total).toBe(11);
      expect(attempts.attempts).toHaveLength(11);
      expect(new Set(attempts.attempts.map((attempt) => attempt.id)).size).toBe(11);
      const after = attendanceSummarySchema.parse(await (await page.request.get(summaryPath)).json());
      expect(after.observed.uniquePeople - before.observed.uniquePeople).toBe(1);
      expect(after.observed.originalObservations - before.observed.originalObservations).toBe(10);
      expect(after.attempts.recognized - before.attempts.recognized).toBe(11);
      expect(after.attempts.admissions).toBe(before.attempts.admissions);
      expect(agendaSnapshotSchema.parse(await (await page.request.get(`${measurementApi}/agenda`)).json())).toEqual(
        agendaBefore,
      );
      expect(
        registrationManageReadResponseSchema.parse(await (await page.request.get(fixture.managePath)).json()),
      ).toEqual(fixture.registrationBefore);
      const statuses = [];
      for (const [device, actor, scans] of [
        [first.manifest, page, firstPending],
        [second.manifest, other, secondPending],
      ] as const) {
        const status = scannerDeviceSessionStatusSchema.parse(
          await (await actor.request.get(`${measurementApi}/scanner/devices/sessions/${device.epochId}`)).json(),
        );
        expect(status.receivedCount).toBe(scans.length);
        statuses.push({ deviceId: status.deviceId, epochId: status.epochId, receivedCount: status.receivedCount });
      }
      const acknowledgedPrivacy = await Promise.all([
        expectNoStoredSponsorContacts(page, fixture.forbidden, await firstLogs(true)),
        expectNoStoredSponsorContacts(other, fixture.forbidden, await secondLogs(true)),
      ]);
      const deliveries = [...loss.exchanges, ...ordinary.exchanges].filter(
        (exchange) => exchange.delivery === "delivered",
      );
      await writeFile(
        info.outputPath("scanner-browser-measurement.json"),
        JSON.stringify(
          {
            kind: "local_unsupported_background_sync_browser_measurement",
            measuredAt: startedAt,
            environment: {
              browser: "firefox",
              version: browser.version(),
              node: process.version,
              platform: process.platform,
              architecture: process.arch,
              viewport: page.viewportSize(),
              baseURL: info.project.use.baseURL,
            },
            capabilities: [first.capabilities, second.capabilities],
            deviceCount: 2,
            registeredPersonPopulation: 1,
            backlog: { initial: 12, final: 0, distinctOperations: 12, acknowledged: acknowledged.length },
            feedback: {
              all: distribution(samples.map((sample) => sample.elapsedMs)),
              classes: ["eligible", "revoked", "unknown", "malformed"].map((kind) => ({
                kind,
                ...distribution(samples.filter((sample) => sample.kind === kind).map((sample) => sample.elapsedMs)),
              })),
              samples,
            },
            repeat,
            transport: {
              imposedDelayMs: delayMs,
              lostCommittedAcknowledgments: lost.length,
              exactRetries: retried.length,
            },
            drain: {
              elapsedMs: drainElapsedMs,
              durableArchiveObservedFromResume: distribution([...durableObservations.values()]),
              archivePollIntervalsMs: [25, 50, 100],
              serverResponseFromResume: distribution(deliveries.map((exchange) => exchange.completedAtMs - began)),
            },
            durable: {
              recognizedAttempts: 11,
              attendanceObservations: 10,
              uniquePeople: 1,
              unknownAttempts: 0,
              statuses,
            },
            devicePrivacy: { pending: pendingPrivacy, acknowledged: acknowledgedPrivacy },
            limits: {
              agreedLatencyTarget: null,
              physicalPhones: "unverified",
              cameraFrames: "unverified",
              providerCapacity: "unverified",
              suspendedBrowserDelivery: "not_guaranteed",
            },
          },
          null,
          2,
        ),
      );
    } finally {
      await loss.stop();
      await ordinary.stop();
    }
  } finally {
    await context.setOffline(false);
    await secondContext.close();
  }
});
