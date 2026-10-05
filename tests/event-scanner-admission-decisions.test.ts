import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { enrollScannerDevice } from "../functions/_lib/services/event-participation/scanner-device-sessions";
import { recordScan, hashBadgeCredential } from "../functions/_lib/services/event-participation/scanning";
import {
  enrolledEventScanRequestSchema,
  eventScanRequestSchema,
  eventScanResponseSchema,
} from "../assets/shared/schemas/event-participation-scanning";
import { eventAttendanceAttempts } from "../functions/_lib/services/event-participation/attendance-attempt-report";
import { eventAttendanceSummary } from "../functions/_lib/services/event-participation/attendance-summary";
import { setSessionParticipation } from "../functions/_lib/services/event-participation/session-booking";
import type { DatabaseLike } from "../functions/_lib/types";

const fixture = createEventScannerFixture();
const { eventId, userId, operatorId, occurrenceId, scanBody, scan } = fixture;
async function receive(body: ReturnType<typeof scanBody>) {
  const response = await scan(body);
  expect(response.status, response.status === 200 ? undefined : await response.text()).toBe(200);
  return eventScanResponseSchema.parse(await response.json());
}
async function count(table: string) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>())!.count;
}
async function reserve() {
  await setSessionParticipation(env.DB, eventId, occurrenceId, userId, {
    action: "reserve",
    attendanceMode: "physical",
  });
}
async function noSeatWrites() {
  for (const table of ["event_entry_admissions", "event_session_admissions", "event_offline_admission_spends"])
    expect(await count(table)).toBe(0);
}

describe("Scanner admission decisions are independent evidence", () => {
  beforeEach(fixture.setup);
  it("records a decision without presence, deduplicates concurrent replay, then records distinct attendance", async () => {
    await reserve();
    const before = await env.DB.prepare(
      "SELECT status FROM agenda_session_participations WHERE user_id=? AND occurrence_id=?",
    )
      .bind(userId, occurrenceId)
      .first();
    const body = scanBody({ action: "admission" });
    const [first, replay] = await Promise.all([receive(body), receive(body)]);
    expect(first).toMatchObject({
      recorded: true,
      admissionRecorded: true,
      admissionDecision: "allowed",
      attendanceRecorded: false,
    });
    expect(replay).toEqual(first);
    expect(await receive(body)).toEqual(first);
    expect(await count("event_scan_attempts")).toBe(1);
    expect(await count("event_attendance_observations")).toBe(0);
    expect(
      await env.DB.prepare("SELECT status FROM agenda_session_participations WHERE user_id=? AND occurrence_id=?")
        .bind(userId, occurrenceId)
        .first(),
    ).toEqual(before);
    const attendance = await receive(scanBody({ action: "attendance" }));
    expect(attendance).toMatchObject({ admissionRecorded: false, admissionDecision: null, attendanceRecorded: true });
    expect(await count("event_attendance_observations")).toBe(1);
    expect(await receive(body)).toEqual(first);
    await noSeatWrites();
  });
  it.each(["missing_registration", "canceled_registration", "wrong_attendance_mode"])(
    "retains a refused %s decision without claiming presence or losing sync acceptance",
    async (reason) => {
      const occurrence = reason === "missing_registration" ? occurrenceId : null;
      if (reason === "canceled_registration")
        await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE event_id=? AND user_id=?")
          .bind(eventId, userId)
          .run();
      if (reason === "wrong_attendance_mode")
        await env.DB.prepare("UPDATE registrations SET attendance_type='virtual' WHERE event_id=? AND user_id=?")
          .bind(eventId, userId)
          .run();
      const body = scanBody({ action: "admission", occurrenceId: occurrence });
      const result = await receive(body);
      expect(result).toMatchObject({
        reason,
        outcome: "warning",
        recorded: true,
        admissionRecorded: true,
        admissionDecision: "refused",
        attendanceRecorded: false,
      });
      expect(await receive(body)).toEqual(result);
      expect(await count("event_scan_attempts")).toBe(1);
      expect(await count("event_attendance_observations")).toBe(0);
      await noSeatWrites();
    },
  );
  it.each([false, true])(
    "records an attributable exception after a failure with optional presence=%s",
    async (recordAttendance) => {
      const failedBody = scanBody({ action: "check" });
      const failed = await receive(failedBody);
      expect(failed).toMatchObject({
        reason: "missing_registration",
        admissionRecorded: false,
        admissionDecision: null,
        attendanceRecorded: false,
      });
      const body = scanBody({ action: "exception", exceptionReason: "registration_correction", recordAttendance });
      const exception = await receive(body);
      expect(exception).toMatchObject({
        reason: "missing_registration",
        outcome: "warning",
        admissionRecorded: true,
        admissionDecision: "allowed",
        attendanceRecorded: recordAttendance,
      });
      expect(await receive(failedBody)).toEqual(failed);
      expect(await receive(body)).toEqual(exception);
      expect(await count("event_scan_attempts")).toBe(2);
      expect(await count("event_attendance_observations")).toBe(recordAttendance ? 1 : 0);
      const report = await eventAttendanceAttempts(env.DB, eventId, {});
      expect(report.attempts.find((row) => row.action === "exception")).toMatchObject({
        operatorUserId: operatorId,
        exceptionReason: "registration_correction",
        admissionDecision: "allowed",
      });
      await noSeatWrites();
    },
  );
  it.each(["revoked_badge", "expired_badge"])("never overrides hard badge refusal %s", async (reason) => {
    if (reason === "revoked_badge")
      await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE event_id=?")
        .bind(fixture.observedAt, eventId)
        .run();
    else
      await env.DB.prepare("UPDATE event_badge_credentials SET expires_at='2026-01-01T00:00:00.000Z' WHERE event_id=?")
        .bind(eventId)
        .run();
    for (const action of ["admission", "exception"] as const) {
      const result = await receive(
        scanBody({
          action,
          ...(action === "exception" ? { exceptionReason: "organizer_approval", recordAttendance: true } : {}),
        }),
      );
      expect(result).toMatchObject({
        reason,
        outcome: "denied",
        admissionRecorded: true,
        admissionDecision: "refused",
        attendanceRecorded: false,
      });
    }
    expect(await count("event_attendance_observations")).toBe(0);
    await noSeatWrites();
  });
  it("does not turn a wrong-location warning into an allowed organizer exception", async () => {
    const result = await receive(
      scanBody({
        action: "exception",
        exceptionReason: "organizer_approval",
        occurrenceId: null,
        roomId: crypto.randomUUID(),
      }),
    );
    expect(result).toMatchObject({
      reason: "wrong_location",
      admissionRecorded: true,
      admissionDecision: "refused",
      attendanceRecorded: false,
    });
    expect(await count("event_attendance_observations")).toBe(0);
    await noSeatWrites();
  });
  it("keeps technical target uncertainty unresolved and unknown credentials without invented evidence", async () => {
    const target = await receive(
      scanBody({ action: "exception", exceptionReason: "organizer_approval", occurrenceId: crypto.randomUUID() }),
    );
    expect(target).toMatchObject({
      admissionDecision: "unresolved",
      admissionRecorded: true,
      attendanceRecorded: false,
      reason: "verification_required",
    });
    const unknown = await receive(scanBody({ action: "admission", badgeId: crypto.randomUUID() }));
    expect(unknown).toMatchObject({
      outcome: "unknown",
      recorded: false,
      admissionRecorded: false,
      admissionDecision: null,
      attendanceRecorded: false,
    });
    expect(await count("event_scan_attempts")).toBe(1);
    expect(await count("event_attendance_observations")).toBe(0);
    await noSeatWrites();
  });
  it("refuses exception scope before writes and atomically rolls back decision and presence on a late failure", async () => {
    const body = eventScanRequestSchema.parse(
      scanBody({ action: "exception", exceptionReason: "organizer_approval", recordAttendance: true }),
    );
    await expect(
      recordScan(env.DB, eventId, { operatorUserId: operatorId, canScan: true, canAdmitExceptions: false }, body),
    ).rejects.toMatchObject({ code: "EXCEPTION_PERMISSION_REQUIRED" });
    expect(await count("event_scan_attempts")).toBe(0);
    const original: DatabaseLike = env.DB;
    const db: DatabaseLike = {
      prepare: (sql) => original.prepare(sql),
      batch: (statements) =>
        original.batch([
          ...statements,
          original.prepare("INSERT INTO event_scan_attempts(id) VALUES(?)").bind(crypto.randomUUID()),
        ]),
    };
    await expect(
      recordScan(db, eventId, { operatorUserId: operatorId, canScan: true, canAdmitExceptions: true }, body),
    ).rejects.toThrow();
    expect(await count("event_scan_attempts")).toBe(0);
    expect(await count("event_attendance_observations")).toBe(0);
    await noSeatWrites();
  });
  it("preserves historical NULL decisions and exact legacy receipt replay without inferring entry", async () => {
    const body = scanBody({ action: "admission" });
    const requestHash = await hashBadgeCredential(JSON.stringify(enrolledEventScanRequestSchema.parse(body)));
    const legacy = eventScanResponseSchema.parse({
      operationId: body.operationId,
      outcome: "eligible",
      reason: "eligible",
      recorded: true,
      attendanceRecorded: true,
      admissionRecorded: false,
      scannerReceipt: {
        epochId: fixture.epochId,
        sequence: body.scannerSession.sequence,
        operationId: body.operationId,
        receivedAt: fixture.observedAt,
      },
    });
    const badge = await env.DB.prepare("SELECT id FROM event_badge_credentials WHERE event_id=?")
      .bind(eventId)
      .first<{ id: string }>();
    await env.DB.prepare(
      "INSERT INTO event_scan_attempts(id,event_id,occurrence_id,badge_id,user_id,operator_user_id,device_id,operation_id,request_hash,outcome,reason,action,observed_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,'eligible','eligible','admission',?,?)",
    )
      .bind(
        crypto.randomUUID(),
        eventId,
        occurrenceId,
        badge!.id,
        userId,
        operatorId,
        fixture.deviceId,
        body.operationId,
        requestHash,
        fixture.observedAt,
        fixture.observedAt,
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO event_scanner_upload_receipts(epoch_id,sequence,operation_id,request_hash,response_json,received_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        fixture.epochId,
        body.scannerSession.sequence,
        body.operationId,
        requestHash,
        JSON.stringify(legacy),
        fixture.observedAt,
      )
      .run();
    expect(await receive(body)).toEqual(legacy);
    expect(
      await env.DB.prepare("SELECT admission_decision AS decision FROM event_scan_attempts WHERE operation_id=?")
        .bind(body.operationId)
        .first(),
    ).toEqual({ decision: null });
    expect((await eventAttendanceAttempts(env.DB, eventId, {})).attempts[0].admissionDecision).toBeNull();
    expect((await eventAttendanceSummary(env.DB, eventId, {})).attempts).toMatchObject({
      admissionUnknown: 1,
      admissionAllowed: 0,
    });
  });
  it("counts decisions separately from unique admitted people across two scoped operators", async () => {
    await reserve();
    const firstBody = scanBody({ action: "admission" });
    const other = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
      .bind(other, `${other}@example.test`, `${other}@example.test`)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:admit','event',?,?)",
    )
      .bind(crypto.randomUUID(), other, eventId, new Date().toISOString())
      .run();
    const token = await createAdminSession(env.DB, other, crypto.randomUUID());
    const deviceId = crypto.randomUUID();
    const enrolled = await enrollScannerDevice(env.DB, eventId, other, { operationId: crypto.randomUUID(), deviceId });
    const otherBody = eventScanRequestSchema.parse(
      scanBody({
        action: "admission",
        operatorUserId: other,
        deviceId,
        scannerSession: { epochId: enrolled.epochId, sequence: 1 },
      }),
    );
    const [first, response] = await Promise.all([
      receive(firstBody),
      callApi(env, "/api/v1/events/scan-test/scans", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(otherBody),
      }),
    ]);
    expect(first).toMatchObject({ admissionDecision: "allowed", attendanceRecorded: false });
    expect(response.status).toBe(200);
    expect(eventScanResponseSchema.parse(await response.json())).toMatchObject({
      admissionDecision: "allowed",
      attendanceRecorded: false,
    });
    const report = await eventAttendanceSummary(env.DB, eventId, {});
    expect(report.attempts).toMatchObject({
      admissions: 2,
      admissionAllowed: 2,
      admissionRefused: 0,
      admissionUnresolved: 0,
      admissionUnknown: 0,
      uniqueAllowedAdmissionPeople: 1,
    });
    expect(report.observed.uniquePeople).toBe(0);
    expect((await eventAttendanceAttempts(env.DB, eventId, {})).attempts.map((row) => row.operatorUserId)).toEqual(
      expect.arrayContaining([operatorId, other]),
    );
    const exported = await callApi(env, "/api/v1/events/scan-test/attendance/attempts/exports", {
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("text/csv");
    const csv = await exported.text();
    expect(csv).toContain("admissionDecision");
    expect(csv).toContain("allowed");
    await noSeatWrites();
  });
  it("reads revocation in the same decision transaction rather than allowing a preflight badge", async () => {
    await reserve();
    const body = eventScanRequestSchema.parse(scanBody({ action: "admission" }));
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE event_id=?")
        .bind(fixture.observedAt, eventId)
        .run(),
    );
    const result = await recordScan(
      db,
      eventId,
      { operatorUserId: operatorId, canScan: true, canAdmitExceptions: false },
      body,
    );
    expect(result).toMatchObject({
      reason: "revoked_badge",
      admissionDecision: "refused",
      admissionRecorded: true,
      attendanceRecorded: false,
    });
    expect(await count("event_attendance_observations")).toBe(0);
    await noSeatWrites();
  });
});
