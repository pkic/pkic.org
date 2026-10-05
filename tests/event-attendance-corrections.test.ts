import { seedLegacyOfflineGrant } from "./helpers/legacy-offline-grant";
import { grantAdministrator } from "./helpers/administrator";
import { guardPermissionDatabase } from "../functions/_lib/auth/permissions";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import { AppError } from "../functions/_lib/errors";
import {
  correctAttendance,
  attendanceEvidence,
  attendanceCorrectionHistory,
} from "../functions/_lib/services/event-participation/attendance-corrections";
import { attendanceReport } from "../functions/_lib/services/event-participation/reporting";
import { eventScanRequestSchema } from "../assets/shared/schemas/event-participation-scanning";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { issueBadge, recordScan } from "../functions/_lib/services/event-participation/scanning";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";

import { mutateBeforeNextBatch } from "./helpers/database-races";

const eventId = crypto.randomUUID();
const userId = crypto.randomUUID();
const operatorId = crypto.randomUUID();
const occurrenceId = crypto.randomUUID();
let token: string;
let badgeId: string;
const observedAt = "2026-10-03T10:00:00.000Z";
function scanBody(overrides: Record<string, unknown> = {}) {
  return {
    operatorUserId: operatorId,
    operationId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    badgeId,
    occurrenceId,
    action: "attendance",
    observedAt,
    ...overrides,
  };
}
describe("Attributable attendance corrections", () => {
  beforeEach(async () => {
    await resetDb();
    const now = new Date().toISOString();
    for (const id of [userId, operatorId])
      await env.DB.prepare("INSERT INTO users (id,email,normalized_email,active) VALUES (?,?,?,1)")
        .bind(id, `${id}@example.test`, `${id}@example.test`)
        .run();
    await grantAdministrator(env.DB, operatorId);
    await env.DB.prepare(
      "INSERT INTO events (id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES (?,'scan-test','Scan test','UTC','invite_or_open','{}',?,?)",
    )
      .bind(eventId, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO registrations (id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES (?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, userId, crypto.randomUUID(), now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences (id,event_id,title,admission_policy,capacity) VALUES (?,?,'Limited session','reservation',1)",
    )
      .bind(occurrenceId, eventId)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
    )
      .bind(eventId, now)
      .run();
    const snapshot = await getAgenda(env.DB, eventId, "scan-test");
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), operatorId, now)
      .run();
    badgeId = (await issueBadge(env.DB, eventId, operatorId, { userId, operationId: crypto.randomUUID() })).credential!;
    token = await createAdminSession(env.DB, operatorId, crypto.randomUUID());
  });
  async function observation() {
    await recordScan(
      env.DB,
      eventId,
      { operatorUserId: operatorId, canScan: true, canAdmitExceptions: true },
      eventScanRequestSchema.parse(
        scanBody({ action: "exception", exceptionReason: "organizer_approval", recordAttendance: true }),
      ),
    );
    return (await env.DB.prepare("SELECT id FROM event_attendance_observations WHERE event_id=?")
      .bind(eventId)
      .first<{ id: string }>())!.id;
  }
  it("voids and restores effective attendance while retaining original provenance and attributable idempotent history", async () => {
    const id = await observation();
    const input = { operationId: crypto.randomUUID(), expectedRevision: 0, kind: "void", reasonCode: "operator_error" };
    const correction = await correctAttendance(env.DB, eventId, id, operatorId, input);
    expect(await correctAttendance(env.DB, eventId, id, operatorId, input)).toEqual(correction);
    expect((await attendanceReport(env.DB, eventId, {})).sessions[0]?.attendees).toBe(0);
    const evidence = await attendanceEvidence(env.DB, eventId, {});
    expect(evidence.observations[0]).toMatchObject({
      id,
      observedAt,
      voided: true,
      captureContext: {
        state: "captured",
        dayDate: "2026-10-03",
        timeZone: "UTC",
        publicationRevision: 0,
        source: "server_receipt",
      },
      revision: 1,
      operatorUserId: operatorId,
      deviceTimeVerified: false,
    });
    await expect(
      env.DB.prepare("DELETE FROM event_attendance_observations WHERE id=?").bind(id).run(),
    ).rejects.toThrow();
    await correctAttendance(env.DB, eventId, id, operatorId, {
      ...input,
      operationId: crypto.randomUUID(),
      expectedRevision: 1,
      kind: "restore",
      reasonCode: "verified_evidence_review",
    });
    expect((await attendanceReport(env.DB, eventId, {})).sessions[0]?.attendees).toBe(1);
    expect((await attendanceCorrectionHistory(env.DB, eventId, id, {})).corrections).toHaveLength(2);
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scan_attempts").first()).toEqual({ total: 1 });
    expect(
      await env.DB.prepare("SELECT observed_at FROM event_attendance_observations WHERE id=?").bind(id).first(),
    ).toEqual({ observed_at: observedAt });
  });
  it("rejects wrong-event evidence and rolls back a conflicting concurrent correction", async () => {
    const id = await observation(),
      input = { operationId: crypto.randomUUID(), expectedRevision: 0, kind: "void", reasonCode: "operator_error" };
    await expect(correctAttendance(env.DB, crypto.randomUUID(), id, operatorId, input)).rejects.toMatchObject({
      code: "ATTENDANCE_OBSERVATION_NOT_FOUND",
    });
    const raced = mutateBeforeNextBatch(env.DB, () =>
      correctAttendance(env.DB, eventId, id, operatorId, { ...input, operationId: crypto.randomUUID() }),
    );
    await expect(correctAttendance(raced, eventId, id, operatorId, input)).rejects.toMatchObject({
      code: "ATTENDANCE_EVIDENCE_CHANGED",
    });
    expect((await attendanceCorrectionHistory(env.DB, eventId, id, {})).corrections).toHaveLength(1);
    await expect(
      correctAttendance(env.DB, eventId, id, operatorId, {
        ...input,
        operationId: crypto.randomUUID(),
        kind: "restore",
      }),
    ).rejects.toMatchObject({ code: "ATTENDANCE_EVIDENCE_CHANGED" });
  });
  it("rolls back correction, effective state and audit when its exact permission is revoked before commit", async () => {
    const id = await observation();
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
      .bind(new Date().toISOString(), operatorId)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:attendance_correct','event',?,?)",
    )
      .bind(crypto.randomUUID(), operatorId, eventId, new Date().toISOString())
      .run();
    const actor = createUserBackedAuthAdmin({
      id: operatorId,
      email: "operator@example.test",
      scopes: [],
      grants: [{ permission: "agenda:attendance_correct", contextType: "event", contextId: eventId }],
    });
    const raced = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE user_id=?")
        .bind(new Date().toISOString(), operatorId)
        .run(),
    );
    const guarded = guardPermissionDatabase(
      raced,
      actor,
      [{ permission: "agenda:attendance_correct", context: { type: "event", id: eventId } }],
      () => new AppError(403, "ATTENDANCE_CORRECTION_PERMISSION_CHANGED", "Permission revoked."),
    );
    await expect(
      correctAttendance(guarded, eventId, id, operatorId, {
        operationId: crypto.randomUUID(),
        expectedRevision: 0,
        kind: "void",
        reasonCode: "operator_error",
      }),
    ).rejects.toMatchObject({ code: "ATTENDANCE_CORRECTION_PERMISSION_CHANGED" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_corrections").first()).toEqual({
      total: 0,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_correction_state").first()).toEqual({
      total: 0,
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM audit_log WHERE action='agenda.attendance.corrected'",
      ).first(),
    ).toEqual({ total: 0 });
  });
  it("returns the same durable receipt for concurrent authorized mounted POST replays", async () => {
    const id = await observation(),
      body = { operationId: crypto.randomUUID(), expectedRevision: 0, kind: "void", reasonCode: "operator_error" };
    const send = () =>
      callApi(env, `/api/v1/events/scan-test/attendance/observations/${id}/corrections`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const responses = await Promise.all([send(), send()]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
    expect((await attendanceCorrectionHistory(env.DB, eventId, id, {})).corrections).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM audit_log WHERE action='agenda.attendance.corrected'",
      ).first(),
    ).toEqual({ total: 1 });
  });
  it("distinguishes current browser captures from historical offline spend provenance", async () => {
    const deviceId = crypto.randomUUID(),
      activationId = crypto.randomUUID();
    const grant = await seedLegacyOfflineGrant({ eventId, occurrenceId, operatorId, deviceId });
    const originalTime = new Date().toISOString();
    const input = eventScanRequestSchema.parse(
      scanBody({
        action: "exception",
        exceptionReason: "organizer_approval",
        recordAttendance: true,
        observedAt: originalTime,
        deviceId,
        offlineRight: { grantId: grant.id, activationId, slot: 0 },
      }),
    );
    await recordScan(env.DB, eventId, { operatorUserId: operatorId, canScan: true, canAdmitExceptions: true }, input);
    expect((await attendanceEvidence(env.DB, eventId, {})).observations[0]).toMatchObject({
      source: "browser_scan",
      action: "exception",
      observedAt: originalTime,
      deviceTimeVerified: false,
    }); // Historical spend evidence remains attributable without issuing new admission authority.
    await env.DB.prepare(
      "INSERT INTO event_offline_admission_spends(operation_id,grant_id,slot,user_id,observed_at,accepted_at) VALUES(?,?,0,?,?,?)",
    )
      .bind(input.operationId, grant.id, userId, originalTime, new Date().toISOString())
      .run();
    expect((await attendanceEvidence(env.DB, eventId, {})).observations[0]).toMatchObject({
      source: "offline_authorized_scan",
      action: "exception",
      observedAt: originalTime,
      deviceTimeVerified: false,
    });
  });
  it("keeps correction permission independent from authorized attendance reading", async () => {
    const id = await observation();
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
      .bind(new Date().toISOString(), operatorId)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:attendance_read','event',?,?)",
    )
      .bind(crypto.randomUUID(), operatorId, eventId, new Date().toISOString())
      .run();
    expect(
      (
        await callApi(env, "/api/v1/events/scan-test/attendance/observations", {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await callApi(env, `/api/v1/events/scan-test/attendance/observations/${id}/corrections`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            expectedRevision: 0,
            kind: "void",
            reasonCode: "operator_error",
          }),
        })
      ).status,
    ).toBe(403);
    expect((await attendanceCorrectionHistory(env.DB, eventId, id, {})).corrections).toHaveLength(0);
  });
});
