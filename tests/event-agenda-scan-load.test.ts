import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { createScannerLoadFixture, scannerLoadProtectedState } from "./helpers/scanner-load-fixture";
import { recordScan } from "../functions/_lib/services/event-participation/scanning";
import {
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
  type EventScanRequest,
  type EventScanResponse,
} from "../assets/shared/schemas/event-participation-scanning";
import { callApi } from "./helpers/app";
import { scannerLoadControls, measureScannerLoad } from "./helpers/scanner-load-measurement";
import {
  enrolledOfflineEligibilityQuerySchema,
  enrolledOfflineEligibilityResponseSchema,
} from "../assets/shared/schemas/event-offline-eligibility";

const mode: unknown = Reflect.get(env, "PKIC_SCANNER_BENCHMARK_MODE") ?? "service";
if (mode !== "service" && mode !== "mounted") throw new Error("Choose service or mounted scanner benchmark mode");
const selectedPopulation: unknown = Reflect.get(env, "PKIC_SCANNER_BENCHMARK_POPULATION");
if (
  selectedPopulation !== undefined &&
  (typeof selectedPopulation !== "string" || !["2000", "5000"].includes(selectedPopulation))
)
  throw new Error("Choose a 2000 or 5000 attendee scanner benchmark population");
const controls = scannerLoadControls(env);
const populations = mode === "mounted" ? [Number(selectedPopulation ?? "2000")] : [2000, 5000];

/** Synthetic local D1 benchmark. Opt-in mounted mode adds real Worker routing/auth; TCP, camera and phones remain excluded. */
describe("high-volume event scanner", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it.runIf(controls.workload === "legacy").each(populations)(
    "records %i arrivals, session warnings, and recognized denials at 16/32 concurrency with retry-safe evidence",
    async (population) => {
      const { eventId, operator, observedAt, occurrenceId, attendees, devices, token, epochs } =
        await createScannerLoadFixture(population, mode);
      const originalUploads = new Map<string, EventScanRequest>();
      const scans: EventScanRequest[] = attendees.map((attendee, index) => ({
        operatorUserId: operator.id,
        operationId: attendee.operationId,
        deviceId: devices[index % devices.length],
        badgeId: attendee.credential,
        occurrenceId: null,
        action: "attendance",
        observedAt,
      }));
      const authority = { operatorUserId: operator.id, canScan: true, canAdmitExceptions: false };
      // Canonical scan policy captures recognized registration warnings as attendance,
      // but recognized badge denials retain only the attempt. Neither grants seats.
      const eligible = { outcome: "eligible", reason: "eligible", recorded: true, attendanceRecorded: true } as const;
      async function runBurst(
        items: EventScanRequest[],
        concurrency: number,
        expected: Pick<EventScanResponse, "outcome" | "reason" | "recorded" | "attendanceRecorded"> = eligible,
      ) {
        const latencies: number[] = [];
        let cursor = 0,
          completed = 0,
          inFlight = 0,
          peakInFlight = 0;
        const backlogSamples: { completed: number; pending: number; elapsedMs: number }[] = [];
        const start = performance.now();
        await Promise.all(
          Array.from({ length: concurrency }, async () => {
            while (cursor < items.length) {
              const scan = items[cursor++];
              const began = performance.now();
              inFlight++;
              peakInFlight = Math.max(peakInFlight, inFlight);
              let result: EventScanResponse;
              if (token) {
                let upload = originalUploads.get(scan.operationId);
                if (!upload) {
                  const epoch = epochs.get(scan.deviceId)!;
                  upload = enrolledEventScanRequestSchema.parse({
                    ...scan,
                    capturePublicationRevision: 0,
                    scannerSession: { epochId: epoch.epochId, sequence: ++epoch.sequence },
                  });
                  originalUploads.set(scan.operationId, upload);
                } else expect(upload).toMatchObject(scan);
                const response = await callApi(env, "/api/v1/events/pqc-2026/scans", {
                  method: "POST",
                  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
                  body: JSON.stringify(upload),
                });
                expect(response.status).toBe(200);
                result = eventScanResponseSchema.parse(await response.json());
                expect(result.scannerReceipt).toMatchObject({
                  operationId: upload.operationId,
                  ...upload.scannerSession,
                });
              } else result = await recordScan(env.DB, eventId, authority, scan);
              inFlight--;
              completed++;
              if (completed === Math.ceil(items.length / 2) || completed === items.length)
                backlogSamples.push({
                  completed,
                  pending: items.length - completed,
                  elapsedMs: Number((performance.now() - start).toFixed(2)),
                });
              latencies.push(performance.now() - began);
              expect(result).toMatchObject({ operationId: scan.operationId, ...expected });
              expect(result.admissionRecorded).toBe(false);
            }
          }),
        );
        latencies.sort((a, b) => a - b);
        const percentile = (p: number) =>
          Number(latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1)].toFixed(2));
        const elapsedMs = performance.now() - start;
        expect(completed).toBe(items.length);
        expect(peakInFlight).toBeLessThanOrEqual(concurrency);
        return {
          count: items.length,
          concurrency,
          elapsedMs: Number(elapsedMs.toFixed(2)),
          throughputPerSecond: elapsedMs > 0 ? Number(((items.length * 1000) / elapsedMs).toFixed(2)) : null,
          backlog: { initial: items.length, final: items.length - completed, peakInFlight, samples: backlogSamples },
          p50Ms: percentile(0.5),
          p95Ms: percentile(0.95),
          p99Ms: percentile(0.99),
        };
      }
      const first = await runBurst(scans.slice(0, population / 2), 16);
      const second = await runBurst(scans.slice(population / 2), 32);
      const replay = await runBurst(scans.slice(0, 256), 32);
      const sessionWarnings = await runBurst(
        scans.map((scan) => ({ ...scan, occurrenceId, operationId: crypto.randomUUID() })),
        32,
        { outcome: "warning", reason: "missing_registration", recorded: true, attendanceRecorded: true },
      );
      await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE event_id=?").bind(eventId).run();
      const warnings = await runBurst(
        scans.map((scan) => ({ ...scan, operationId: crypto.randomUUID() })),
        32,
        { outcome: "warning", reason: "canceled_registration", recorded: true, attendanceRecorded: true },
      );
      let missingEventRegistration;
      if (mode === "mounted") {
        await env.DB.batch([
          env.DB.prepare(
            "DELETE FROM registration_day_attendance WHERE registration_id IN (SELECT id FROM registrations WHERE event_id=?)",
          ).bind(eventId),
          env.DB.prepare("DELETE FROM registrations WHERE event_id=?").bind(eventId),
        ]);
        missingEventRegistration = await runBurst(
          scans.map((scan) => ({ ...scan, operationId: crypto.randomUUID() })),
          32,
          { outcome: "warning", reason: "missing_registration", recorded: true, attendanceRecorded: true },
        );
      }
      await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE event_id=?")
        .bind(observedAt, eventId)
        .run();
      const deniedScans = scans.map((scan) => ({ ...scan, operationId: crypto.randomUUID() }));
      const deniedExpected = {
        outcome: "denied",
        reason: "revoked_badge",
        recorded: true,
        attendanceRecorded: false,
      } as const;
      const denied = await runBurst(deniedScans, 32, deniedExpected);
      const deniedReplay = await runBurst(deniedScans.slice(0, 256), 32, deniedExpected);
      const unknown = await runBurst(
        scans.slice(0, 64).map((scan) => ({ ...scan, operationId: crypto.randomUUID(), badgeId: crypto.randomUUID() })),
        32,
        { outcome: "unknown", reason: "unknown_credential", recorded: false, attendanceRecorded: false },
      );
      const [counts] = await queryAll<{ attempts: number; observations: number; people: number }>(
        env.DB,
        "SELECT (SELECT COUNT(*) FROM event_scan_attempts WHERE event_id=?) AS attempts,(SELECT COUNT(*) FROM event_attendance_observations WHERE event_id=?) AS observations,(SELECT COUNT(DISTINCT user_id) FROM event_attendance_observations WHERE event_id=?) AS people",
        eventId,
        eventId,
        eventId,
      );
      expect(counts).toEqual({
        attempts: population * (mode === "mounted" ? 5 : 4),
        observations: population * (mode === "mounted" ? 4 : 3),
        people: population,
      });
      const [integrity] = await queryAll<{
        lostIdentity: number;
        changedObservationTime: number;
        deniedAttempts: number;
        deniedAttendance: number;
        deniedPeople: number;
        mismatchedAttendance: number;
        sessionWarnings: number;
        sessionAttendance: number;
        unknownAttempts: number;
      }>(
        env.DB,
        `SELECT
          SUM(CASE WHEN badge.id IS NULL OR attempt.user_id<>badge.user_id THEN 1 ELSE 0 END) AS lostIdentity,
          SUM(CASE WHEN attempt.observed_at<>? THEN 1 ELSE 0 END) AS changedObservationTime,
          SUM(CASE WHEN attempt.outcome='denied' AND attempt.reason='revoked_badge' THEN 1 ELSE 0 END) AS deniedAttempts,
          SUM(CASE WHEN attempt.outcome='denied' AND observation.id IS NOT NULL THEN 1 ELSE 0 END) AS deniedAttendance,
          COUNT(DISTINCT CASE WHEN attempt.outcome='denied' THEN attempt.user_id END) AS deniedPeople,
          SUM(CASE WHEN observation.id IS NOT NULL AND (observation.user_id<>attempt.user_id OR observation.observed_at<>attempt.observed_at) THEN 1 ELSE 0 END) AS mismatchedAttendance,
          SUM(CASE WHEN attempt.occurrence_id=? AND attempt.reason='missing_registration' THEN 1 ELSE 0 END) AS sessionWarnings,
          SUM(CASE WHEN attempt.occurrence_id=? AND observation.id IS NOT NULL THEN 1 ELSE 0 END) AS sessionAttendance,
          SUM(CASE WHEN attempt.outcome='unknown' THEN 1 ELSE 0 END) AS unknownAttempts
        FROM event_scan_attempts attempt
        LEFT JOIN event_badge_credentials badge ON badge.id=attempt.badge_id AND badge.event_id=attempt.event_id
        LEFT JOIN event_attendance_observations observation ON observation.attempt_id=attempt.id
        WHERE attempt.event_id=?`,
        observedAt,
        occurrenceId,
        occurrenceId,
        eventId,
      );
      expect(integrity).toEqual({
        lostIdentity: 0,
        changedObservationTime: 0,
        deniedAttempts: population,
        deniedAttendance: 0,
        deniedPeople: population,
        mismatchedAttendance: 0,
        sessionWarnings: population,
        sessionAttendance: population,
        unknownAttempts: 0,
      });
      const [capacity] = await queryAll<{ eventCapacity: number; sessionCapacity: number; reservations: number }>(
        env.DB,
        "SELECT event.capacity_in_person AS eventCapacity,session.capacity AS sessionCapacity,(SELECT COUNT(*) FROM agenda_session_participations WHERE occurrence_id=?) AS reservations FROM events event JOIN event_agenda_occurrences session ON session.event_id=event.id WHERE event.id=? AND session.id=?",
        occurrenceId,
        eventId,
        occurrenceId,
      );
      expect(capacity).toEqual({ eventCapacity: population, sessionCapacity: 1, reservations: 0 });
      const [admissions] = await queryAll<{ total: number }>(
        env.DB,
        "SELECT (SELECT COUNT(*) FROM event_entry_admissions WHERE event_id=?)+(SELECT COUNT(*) FROM event_session_admissions WHERE event_id=?) AS total",
        eventId,
        eventId,
      );
      expect(admissions.total).toBe(0);
      console.info(
        mode === "mounted" ? "[scanner-local-mounted-worker-benchmark]" : "[scanner-local-native-d1-benchmark]",
        JSON.stringify({
          mode,
          population,
          measuredAt: new Date().toISOString(),
          environment: {
            runtime: "local workerd",
            database: "local D1 with real migrations",
            config: "vitest.config.ts / wrangler.jsonc",
            processVersion: process.version,
            platform: process.platform,
            architecture: process.arch,
          },
          excludes: [
            "TCP/network latency",
            "camera decoding",
            "physical phone throughput",
            "browser IndexedDB outbox backlog",
          ],
          backlogDefinition:
            "Synthetic scheduled requests awaiting completion, including in-flight calls; final zero requires all successful durable receipts in mounted mode.",
          first,
          second,
          offlineReplay: replay,
          publishedSessionMissingRegistration: sessionWarnings,
          recognizedRegistrationWarnings: warnings,
          missingEventRegistration,
          recognizedDenied: denied,
          recognizedDeniedReplay: deniedReplay,
          unknownCredentials: unknown,
          counts,
        }),
      );
    },
    120000,
  );
  it.runIf(controls.workload !== "legacy")(
    "measures controlled mounted arrivals with durable outcomes and no allocation side effects",
    async () => {
      const population = Number(selectedPopulation ?? "2000");
      if (controls.rate === null) throw new Error("Controlled workloads require an offered rate");
      const pacing = { rate: controls.rate, concurrency: controls.concurrency };
      if ((population + 256) / pacing.rate > 60)
        throw new Error("Choose an offered rate fitting this population and replay within 60 scheduled seconds");
      const fixture = await createScannerLoadFixture(population, "mounted", pacing.concurrency);
      const { eventId, operator, observedAt, occurrenceId, attendees, devices, token, epochs } = fixture;
      if (!token) throw new Error("Mounted workloads require the canonical session");
      const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
      const base = "/api/v1/events/pqc-2026";
      const protectedBefore = await scannerLoadProtectedState();
      const queries: ReturnType<typeof enrolledOfflineEligibilityQuerySchema.parse>[] = [];
      const manifestBadgeIds: string[] = [];
      let afterBadgeId: string | undefined;
      do {
        const query = enrolledOfflineEligibilityQuerySchema.parse({
          deviceId: devices[0],
          epochId: epochs.get(devices[0])!.epochId,
          publishedRevision: 0,
          ...(afterBadgeId ? { afterBadgeId } : {}),
        });
        queries.push(query);
        const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
        const response = await callApi(env, `${base}/offline-eligibility?${search}`, { headers });
        expect(response.status).toBe(200);
        const page = enrolledOfflineEligibilityResponseSchema.parse(await response.json());
        expect(page).toMatchObject({ eventId, operatorUserId: operator.id, publishedRevision: 0 });
        expect(page.entries.every((entry) => entry.eventRegistered && entry.physicalDayEligible)).toBe(true);
        manifestBadgeIds.push(...page.entries.map((entry) => entry.badgeId));
        afterBadgeId = page.nextBadgeId ?? undefined;
        expect(queries.length).toBeLessThanOrEqual(Math.ceil(population / 250) + 1);
      } while (afterBadgeId);
      expect(manifestBadgeIds.sort()).toEqual(attendees.map((attendee) => attendee.badgeId).sort());

      type Kind =
        "eligibility" | "attendance" | "admission" | "warning" | "denied" | "denied_admission" | "unknown" | "invalid";
      type Job = {
        kind: Kind;
        scan?: ReturnType<typeof enrolledEventScanRequestSchema.parse>;
        query?: (typeof queries)[number];
      };
      const kinds: Kind[] = ["attendance", "admission", "warning", "denied", "denied_admission", "unknown", "invalid"];
      const jobs: Job[] = attendees.map((attendee, index) => {
        const kind: Kind =
          controls.workload === "mixed"
            ? kinds[index % kinds.length]
            : controls.workload === "eligibility"
              ? "eligibility"
              : controls.workload === "admission"
                ? index % 2 === 0
                  ? "admission"
                  : "denied_admission"
                : "attendance";
        if (kind === "eligibility") return { kind, query: queries[index % queries.length] };
        const deviceId = devices[index % devices.length];
        const epoch = epochs.get(deviceId)!;
        return {
          kind,
          scan: enrolledEventScanRequestSchema.parse({
            operatorUserId: operator.id,
            operationId: crypto.randomUUID(),
            deviceId,
            // Invalid requests do not consume a legitimate issued upload sequence.
            scannerSession: {
              epochId: epoch.epochId,
              sequence: kind === "invalid" ? Math.max(1, epoch.sequence) : ++epoch.sequence,
            },
            badgeId: kind === "unknown" ? crypto.randomUUID() : attendee.credential,
            occurrenceId: kind === "warning" ? occurrenceId : null,
            action: kind === "admission" || kind === "denied_admission" ? "admission" : "attendance",
            capturePublicationRevision: 0,
            observedAt,
          }),
        };
      });
      if (jobs.some((job) => job.kind === "denied" || job.kind === "denied_admission")) {
        const revokedIds = attendees
          .filter((_, index) => jobs[index].kind === "denied" || jobs[index].kind === "denied_admission")
          .map((attendee) => attendee.badgeId);
        await env.DB.prepare(
          "UPDATE event_badge_credentials SET revoked_at=? WHERE event_id=? AND id IN (SELECT value FROM json_each(?))",
        )
          .bind(observedAt, eventId, JSON.stringify(revokedIds))
          .run();
      }
      const receipts = new Map<string, EventScanResponse>();
      async function execute(job: Job) {
        if (job.query) {
          const search = new URLSearchParams(Object.entries(job.query).map(([key, value]) => [key, String(value)]));
          const response = await callApi(env, `${base}/offline-eligibility?${search}`, { headers });
          expect(response.status).toBe(200);
          const text = await response.text();
          const page = enrolledOfflineEligibilityResponseSchema.parse(JSON.parse(text));
          expect(page).toMatchObject({
            eventId,
            operatorUserId: operator.id,
            publishedRevision: 0,
            deviceId: job.query.deviceId,
            epochId: job.query.epochId,
          });
          expect(page.entries.length).toBeGreaterThan(0);
          return {
            operation: job.kind,
            outcome: "page",
            status: response.status,
            bytes: new TextEncoder().encode(text).length,
          };
        }
        if (!job.scan) throw new Error("A scan workload needs a canonical request");
        const body = job.kind === "invalid" ? { ...job.scan, freeText: "synthetic invalid field" } : job.scan;
        const response = await callApi(env, `${base}/scans`, { method: "POST", headers, body: JSON.stringify(body) });
        const text = await response.text();
        if (job.kind === "invalid") {
          expect(response.status).toBe(400);
          return {
            operation: job.kind,
            outcome: "contract_refusal",
            status: response.status,
            bytes: new TextEncoder().encode(text).length,
          };
        }
        expect(response.status).toBe(200);
        const receipt = eventScanResponseSchema.parse(JSON.parse(text));
        const expected =
          job.kind === "warning"
            ? { outcome: "warning", reason: "missing_registration", recorded: true, attendanceRecorded: true }
            : job.kind === "denied" || job.kind === "denied_admission"
              ? { outcome: "denied", reason: "revoked_badge", recorded: true, attendanceRecorded: false }
              : job.kind === "unknown"
                ? { outcome: "unknown", reason: "unknown_credential", recorded: false, attendanceRecorded: false }
                : {
                    outcome: "eligible",
                    reason: "eligible",
                    recorded: true,
                    attendanceRecorded: job.kind === "attendance",
                  };
        expect(receipt).toMatchObject({
          operationId: job.scan.operationId,
          ...expected,
          admissionRecorded: job.kind === "admission" || job.kind === "denied_admission",
          admissionDecision: job.kind === "admission" ? "allowed" : job.kind === "denied_admission" ? "refused" : null,
        });
        expect(receipt.scannerReceipt).toMatchObject({ operationId: job.scan.operationId, ...job.scan.scannerSession });
        const previous = receipts.get(job.scan.operationId);
        if (previous) expect(receipt).toEqual(previous);
        else receipts.set(job.scan.operationId, receipt);
        return {
          operation: previous ? `${job.kind}_replay` : job.kind,
          outcome: receipt.outcome,
          status: response.status,
          bytes: new TextEncoder().encode(text).length,
        };
      }
      const measured = await measureScannerLoad(jobs, pacing, execute, (job) => job.kind);
      const replayJobs = jobs.filter((job) => job.scan && job.kind !== "invalid").slice(0, 256);
      const replay = await measureScannerLoad(replayJobs, pacing, execute, (job) => `${job.kind}_replay`);
      const countKind = (...selected: Kind[]) => jobs.filter((job) => selected.includes(job.kind)).length;
      const [counts] = await queryAll<{
        attempts: number;
        observations: number;
        allowedDecisions: number;
        refusedDecisions: number;
        deniedAttendance: number;
        unknownAttempts: number;
        invalidAttempts: number;
        mismatched: number;
      }>(
        env.DB,
        `SELECT COUNT(*) AS attempts,
        (SELECT COUNT(*) FROM event_attendance_observations WHERE event_id=?) AS observations,
        SUM(CASE WHEN a.admission_decision='allowed' THEN 1 ELSE 0 END) AS allowedDecisions,
        SUM(CASE WHEN a.admission_decision='refused' THEN 1 ELSE 0 END) AS refusedDecisions,
        SUM(CASE WHEN a.outcome='denied' AND o.id IS NOT NULL THEN 1 ELSE 0 END) AS deniedAttendance,
        SUM(CASE WHEN a.outcome='unknown' THEN 1 ELSE 0 END) AS unknownAttempts,
        (SELECT COUNT(*) FROM event_scan_attempts WHERE operation_id IN (SELECT value FROM json_each(?))) AS invalidAttempts,
        SUM(CASE WHEN b.id IS NULL OR a.user_id<>b.user_id OR a.observed_at<>? OR
          (o.id IS NOT NULL AND (o.user_id<>a.user_id OR o.observed_at<>a.observed_at)) THEN 1 ELSE 0 END) AS mismatched
        FROM event_scan_attempts a LEFT JOIN event_badge_credentials b ON b.id=a.badge_id AND b.event_id=a.event_id
        LEFT JOIN event_attendance_observations o ON o.attempt_id=a.id WHERE a.event_id=?`,
        eventId,
        JSON.stringify(jobs.filter((job) => job.kind === "invalid").map((job) => job.scan!.operationId)),
        observedAt,
        eventId,
      );
      const normalizedCounts = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value ?? 0]));
      console.info(
        "[scanner-local-controlled-mounted-benchmark]",
        JSON.stringify({
          workload: controls.workload,
          population,
          measuredAt: new Date().toISOString(),
          environment: {
            runtime: "local workerd",
            database: "real migrated local D1",
            config: "vitest.config.ts / wrangler.jsonc",
            processVersion: process.version,
            platform: process.platform,
            architecture: process.arch,
          },
          excludes: [
            "TCP/network latency",
            "camera decoding",
            "physical phones",
            "browser IndexedDB backlog",
            "provider quotas",
          ],
          targets:
            "No approved performance thresholds supplied; offered rate and concurrency are exploratory workload controls.",
          sampleUnit: controls.workload === "eligibility" ? "manifest_page_request" : "scan_request",
          mixedOperationKinds: controls.workload === "mixed" ? kinds : undefined,
          manifest: {
            completeBadgeCount: manifestBadgeIds.length,
            pages: queries.length,
            warmup: "Complete manifest read before timed requests; warm local D1, no TCP/CDN measurement.",
          },
          measured,
          replay,
          counts: normalizedCounts,
        }),
      );
      expect(measured.unexpectedErrors).toBe(0);
      expect(replay.unexpectedErrors).toBe(0);
      expect(measured.completed).toBe(population);
      expect(measured.backlog.finalPending).toBe(0);
      expect(replay.backlog.finalPending).toBe(0);
      expect(normalizedCounts).toEqual({
        attempts: countKind("attendance", "admission", "warning", "denied", "denied_admission"),
        observations: countKind("attendance", "warning"),
        allowedDecisions: countKind("admission"),
        refusedDecisions: countKind("denied_admission"),
        deniedAttendance: 0,
        unknownAttempts: 0,
        invalidAttempts: 0,
        mismatched: 0,
      });
      expect(await scannerLoadProtectedState()).toEqual(protectedBefore);
    },
    120000,
  );
});
