import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { hashBadgeCredential, recordScan } from "../functions/_lib/services/event-participation/scanning";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import {
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
  type EventScanRequest,
  type EventScanResponse,
} from "../assets/shared/schemas/event-participation-scanning";
import { scannerDeviceSessionEnrollmentResponseSchema } from "../assets/shared/schemas/event-scanner-devices";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";

const mode: unknown = Reflect.get(env, "PKIC_SCANNER_BENCHMARK_MODE") ?? "service";
if (mode !== "service" && mode !== "mounted") throw new Error("Choose service or mounted scanner benchmark mode");
const selectedPopulation: unknown = Reflect.get(env, "PKIC_SCANNER_BENCHMARK_POPULATION");
if (
  selectedPopulation !== undefined &&
  (typeof selectedPopulation !== "string" || !["2000", "5000"].includes(selectedPopulation))
)
  throw new Error("Choose a 2000 or 5000 attendee scanner benchmark population");
const populations = mode === "mounted" ? [Number(selectedPopulation ?? "2000")] : [2000, 5000];

/** Synthetic local D1 benchmark. Opt-in mounted mode adds real Worker routing/auth; TCP, camera and phones remain excluded. */
describe("high-volume event scanner", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it.each(populations)(
    "records %i arrivals, session warnings, and recognized denials at 16/32 concurrency with retry-safe evidence",
    async (population) => {
      const { eventId } = await seedEventAndAdmin(env.DB);
      const [operator] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
      const observedAt = new Date().toISOString();
      const dayId = crypto.randomUUID();
      const day = observedAt.slice(0, 10);
      const expiresAt = new Date(Date.parse(observedAt) + 24 * 60 * 60 * 1000).toISOString();
      // Provision the actual dated entrance before filling its confirmed capacity.
      // The generic workflow fixture deliberately has only one physical place.
      await env.DB.prepare("UPDATE events SET timezone='UTC',starts_at=?,ends_at=?,capacity_in_person=? WHERE id=?")
        .bind(`${day}T00:00:00.000Z`, expiresAt, population, eventId)
        .run();
      await env.DB.prepare(
        "INSERT INTO event_days(id,event_id,day_date,label,in_person_capacity,sort_order,created_at,updated_at) VALUES(?,?,?,'Arrival day',?,0,?,?)",
      )
        .bind(dayId, eventId, day, population, observedAt, observedAt)
        .run();
      const occurrenceId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,admission_policy,capacity) VALUES(?,?,'Published reservation session',?,?,'reservation',1)",
      )
        .bind(occurrenceId, eventId, observedAt, expiresAt)
        .run();
      await env.DB.prepare(
        "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
      )
        .bind(eventId, observedAt)
        .run();
      const snapshot = await getAgenda(env.DB, eventId, "pqc-2026");
      expect(snapshot.occurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: occurrenceId, admissionPolicy: "reservation", capacity: 1 }),
        ]),
      );
      await env.DB.prepare(
        "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
      )
        .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), operator.id, observedAt)
        .run();
      const attendees = await Promise.all(
        Array.from({ length: population }, async () => {
          const userId = crypto.randomUUID();
          const credential = crypto.randomUUID();
          return {
            userId,
            credential,
            hash: await hashBadgeCredential(credential),
            badgeId: crypto.randomUUID(),
            registrationId: crypto.randomUUID(),
            operationId: crypto.randomUUID(),
          };
        }),
      );
      for (let offset = 0; offset < attendees.length; offset += 100) {
        const json = JSON.stringify(attendees.slice(offset, offset + 100));
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) SELECT json_extract(value,'$.userId'),json_extract(value,'$.userId')||'@example.test',json_extract(value,'$.userId')||'@example.test',1,?,? FROM json_each(?)",
          ).bind(observedAt, observedAt, json),
          env.DB.prepare(
            "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) SELECT json_extract(value,'$.registrationId'),?,json_extract(value,'$.userId'),'registered','in_person','synthetic',json_extract(value,'$.registrationId'),?,? FROM json_each(?)",
          ).bind(eventId, observedAt, observedAt, json),
          env.DB.prepare(
            "INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at) SELECT lower(hex(randomblob(16))),json_extract(value,'$.registrationId'),?,'in_person',?,? FROM json_each(?)",
          ).bind(dayId, observedAt, observedAt, json),
          env.DB.prepare(
            "INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at,expires_at) SELECT json_extract(value,'$.badgeId'),?,json_extract(value,'$.userId'),json_extract(value,'$.hash'),?,? FROM json_each(?)",
          ).bind(eventId, observedAt, expiresAt, json),
        ]);
      }
      const devices = Array.from({ length: 32 }, () => crypto.randomUUID());
      const token = mode === "mounted" ? await createAdminSession(env.DB, operator.id, crypto.randomUUID()) : null;
      const epochs = new Map<string, { epochId: string; sequence: number }>();
      if (token) {
        for (const deviceId of devices) {
          const response = await callApi(env, "/api/v1/events/pqc-2026/scanner/devices/sessions", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ operationId: crypto.randomUUID(), deviceId }),
          });
          expect(response.status).toBe(200);
          const enrolled = scannerDeviceSessionEnrollmentResponseSchema.parse(await response.json());
          expect(enrolled).toMatchObject({ eventId, operatorUserId: operator.id, deviceId });
          epochs.set(deviceId, { epochId: enrolled.epochId, sequence: 0 });
        }
      }
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
});
