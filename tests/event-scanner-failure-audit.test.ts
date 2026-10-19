import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { scannerFailureRequestSchema } from "../assets/shared/schemas/event-scanner-failure";
import { boundedScannedValue } from "../assets/shared/schemas/scanner-attempt-capture";
import { enrolledEventScanResponseSchema } from "../assets/shared/schemas/event-participation-scanning";
import { callApi } from "./helpers/app";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import {
  eventAttendanceAttempts,
  eventAttendanceReasons,
} from "../functions/_lib/services/event-participation/attendance-attempt-report";
import { materializeEventAttendanceSummary } from "../functions/_lib/services/event-participation/attendance-summary";
const f = createEventScannerFixture();
function failure(overrides: Record<string, unknown> = {}) {
  const scan = f.scanBody();
  return scannerFailureRequestSchema.parse({
    operationId: scan.operationId,
    operatorUserId: scan.operatorUserId,
    deviceId: scan.deviceId,
    scannerSession: scan.scannerSession,
    occurrenceId: scan.occurrenceId,
    action: scan.action,
    observedAt: scan.observedAt,
    reason: "malformed_credential",
    ...boundedScannedValue("  Not a badge\n"),
    ...overrides,
  });
}
function upload(body: unknown, token = f.token) {
  return callApi(env, "/api/v1/events/scan-test/scans/failures", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function noBusinessWrites() {
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_attendance_observations").first("count")).toBe(0);
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM event_scan_attempts WHERE admission_decision IS NOT NULL",
    ).first("count"),
  ).toBe(0);
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_sponsor_leads").first("count")).toBe(0);
}
describe("enrolled local scanner refusal audit", () => {
  beforeEach(f.setup);
  it("records the bounded original value and acknowledges the same device sequence without attendance", async () => {
    const body = failure();
    const response = await upload(body);
    expect(response.status, await response.clone().text()).toBe(200);
    const receipt = enrolledEventScanResponseSchema.parse(await response.json());
    expect(receipt).toMatchObject({
      recorded: true,
      reason: "malformed_credential",
      outcome: "unknown",
      attendanceRecorded: false,
      admissionRecorded: false,
      checkoutRecorded: false,
      scannerReceipt: { epochId: f.epochId, sequence: body.scannerSession.sequence, operationId: body.operationId },
    });
    const row = await env.DB.prepare(
      "SELECT operator_user_id,device_id,occurrence_id,badge_id,user_id,scanned_value,scanned_value_truncated,reason,observed_at FROM event_scan_attempts WHERE operation_id=?",
    )
      .bind(body.operationId)
      .first();
    expect(row).toMatchObject({
      operator_user_id: f.operatorId,
      device_id: f.deviceId,
      occurrence_id: f.occurrenceId,
      badge_id: null,
      user_id: null,
      scanned_value: "  Not a badge\n",
      scanned_value_truncated: 0,
      reason: "malformed_credential",
      observed_at: body.observedAt,
    });
    await noBusinessWrites();
    const scanLog = await eventAttendanceAttempts(env.DB, f.eventId, { unsuccessful: true });
    expect(scanLog.attempts).toHaveLength(1);
    expect(scanLog.attempts[0]).toMatchObject({ userId: null, displayName: null, reason: "malformed_credential" });
    expect(scanLog.attempts[0]).not.toHaveProperty("scannedValue");
    for (const q of ["unknown", "malformed", body.operationId])
      expect((await eventAttendanceAttempts(env.DB, f.eventId, { q })).attempts).toHaveLength(1);
    expect((await eventAttendanceReasons(env.DB, f.eventId, {})).reasons).toEqual([
      expect.objectContaining({ reason: "malformed_credential", count: 1 }),
    ]);
    expect((await materializeEventAttendanceSummary(env.DB, f.eventId, {})).observed).toMatchObject({
      uniquePeople: 0,
      originalObservations: 0,
      effectiveObservations: 0,
    });
    const replay = await upload(body);
    expect(await replay.json()).toEqual(receipt);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_scan_attempts").first("count")).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_scanner_upload_receipts").first("count")).toBe(1);
  });
  it("records an out-of-window refusal as audit without asserting attendance", async () => {
    const response = await upload(
      failure({ observedAt: "2000-01-01T00:00:00.000Z", reason: "capture_validation_failed" }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      recorded: true,
      reason: "capture_validation_failed",
      attendanceRecorded: false,
    });
    await noBusinessWrites();
  });
  it("refuses a changed operation value and raw capture beyond64Unicodepoints without partial audit", async () => {
    const body = failure();
    expect((await upload(body)).status).toBe(200);
    expect((await upload({ ...body, scannedValue: "Different input" })).status).toBe(409);
    const tooLong = { ...failure(), scannedValue: "😀".repeat(65) };
    expect((await upload(tooLong)).status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_scan_attempts").first("count")).toBe(1);
    await noBusinessWrites();
  });
  it("enforces operator device epoch ownership and declared sequence bounds atomically", async () => {
    for (const change of [
      { operatorUserId: f.userId },
      { deviceId: crypto.randomUUID() },
      { scannerSession: { epochId: crypto.randomUUID(), sequence: 1 } },
    ])
      expect((await upload(failure(change))).status).toBeGreaterThanOrEqual(400);
    await env.DB.prepare("UPDATE event_scanner_device_sessions SET high_water_sequence=1 WHERE id=?")
      .bind(f.epochId)
      .run();
    expect((await upload(failure())).status).toBe(409);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_scan_attempts").first("count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_scanner_upload_receipts").first("count")).toBe(0);
  });
  it("refuses a closed epoch without recording a locally claimed storage failure", async () => {
    const body = failure({ reason: "storage_unavailable" });
    await env.DB.prepare("UPDATE event_scanner_device_sessions SET closed_at=? WHERE id=?")
      .bind(new Date().toISOString(), f.epochId)
      .run();
    expect((await upload(body)).status).toBe(409);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_scan_attempts").first("count")).toBe(0);
    await noBusinessWrites();
  });
  it("audits the normal server unknown-credential result with original capture and no attendance", async () => {
    const raw = "not-a-real-badge";
    const body = f.scanBody({
      badgeId: "ABCDEFGHJKLMNPQR",
      ...boundedScannedValue(raw),
      occurrenceId: null,
    });
    const response = await f.scan(body);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(enrolledEventScanResponseSchema.parse(await response.json())).toMatchObject({
      reason: "unknown_credential",
      recorded: true,
      attendanceRecorded: false,
    });
    expect(
      await env.DB.prepare("SELECT scanned_value,badge_id,user_id FROM event_scan_attempts WHERE operation_id=?")
        .bind(body.operationId)
        .first(),
    ).toEqual({ scanned_value: raw, badge_id: null, user_id: null });
    await noBusinessWrites();
  });
});
