import { callApi } from "./helpers/app";
import type { Env } from "../functions/_lib/types";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { eventAttendanceSummary } from "../functions/_lib/services/event-participation/attendance-summary";
import { correctAttendance } from "../functions/_lib/services/event-participation/attendance-corrections";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { revokeBadge, recordScan } from "../functions/_lib/services/event-participation/scanning";
import { attendanceReport, sessionAttendancePeople } from "../functions/_lib/services/event-participation/reporting";
import { eventScanRequestSchema } from "../assets/shared/schemas/event-participation-scanning";

import { mutateBeforeNextBatch } from "./helpers/database-races";

const fixture = createEventScannerFixture();
const { eventId, operatorId, occurrenceId, scan, scanBody } = fixture;
describe("Event checkout evidence", () => {
  beforeEach(fixture.setup);
  it("records departure without admission eligibility or capacity and excludes checkout-only presence", async () => {
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE event_id=?").bind(eventId).run();
    const body = scanBody({ action: "checkout" });
    expect(await (await scan(body)).json()).toMatchObject({
      outcome: "eligible",
      recorded: true,
      attendanceRecorded: false,
      checkoutRecorded: true,
      admissionRecorded: false,
    });
    expect(await (await scan(body)).json()).toMatchObject({
      outcome: "eligible",
      attendanceRecorded: false,
      checkoutRecorded: true,
      admissionRecorded: false,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_session_admissions").first()).toEqual({
      total: 0,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_entry_admissions").first()).toEqual({ total: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_offline_admission_spends").first()).toEqual({
      total: 0,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first()).toEqual({
      total: 1,
    });
    expect((await sessionAttendancePeople(env.DB, eventId, occurrenceId, {})).attendees).toEqual([]);
    expect(await eventAttendanceSummary(env.DB, eventId, {})).toMatchObject({
      observed: { checkoutObservations: 1, uniquePeople: 0 },
      evidence: {
        checkoutCaptureSupported: true,
        presenceDuration: "not_established",
        clockVerification: "unverified",
      },
    });
    const observation = await env.DB.prepare("SELECT id FROM event_attendance_observations").first<{ id: string }>();
    await correctAttendance(env.DB, eventId, observation!.id, operatorId, {
      operationId: crypto.randomUUID(),
      expectedRevision: 0,
      kind: "void",
      reasonCode: "operator_error",
    });
    expect(await eventAttendanceSummary(env.DB, eventId, {})).toMatchObject({
      observed: { checkoutObservations: 0, uniquePeople: 0 },
    });

    expect((await attendanceReport(env.DB, eventId, {})).sessions[0]).toMatchObject({
      attendees: 0,
      physicalAttendees: 0,
      scans: 1,
    });
    expect((await scan({ ...body, observedAt: "2026-10-03T11:00:00.000Z" })).status).toBe(409);
  });
  it("records recognized refused departures and leaves unknown credentials unrecorded", async () => {
    await revokeBadge(
      env.DB,
      eventId,
      operatorId,
      (await env.DB.prepare("SELECT id FROM event_badge_credentials WHERE event_id=?")
        .bind(eventId)
        .first<{ id: string }>())!.id,
    );
    expect(await (await scan(scanBody({ action: "checkout" }))).json()).toMatchObject({
      outcome: "denied",
      reason: "revoked_badge",
      recorded: true,
      attendanceRecorded: false,
      admissionRecorded: false,
    });
    expect(await (await scan(scanBody({ action: "checkout", badgeId: crypto.randomUUID() }))).json()).toMatchObject({
      outcome: "unknown",
      recorded: false,
      attendanceRecorded: false,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first()).toEqual({
      total: 0,
    });
  });
  it("rechecks badge revocation atomically for checkout and rejects admission rights", async () => {
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE event_id=?")
        .bind(new Date().toISOString(), eventId)
        .run(),
    );
    expect(
      await recordScan(
        db,
        eventId,
        { operatorUserId: operatorId, canScan: true, canAdmitExceptions: false },
        eventScanRequestSchema.parse(scanBody({ action: "checkout" })),
      ),
    ).toMatchObject({ outcome: "denied", reason: "revoked_badge", attendanceRecorded: false });
    expect(
      eventScanRequestSchema.safeParse(
        scanBody({
          action: "checkout",
          offlineRight: { grantId: crypto.randomUUID(), activationId: crypto.randomUUID() },
        }),
      ).success,
    ).toBe(false);
  });
  async function restrictOperator(permission: string, contextId = eventId) {
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
      .bind(new Date().toISOString(), operatorId)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,?,'event',?,?)",
    )
      .bind(crypto.randomUUID(), operatorId, permission, contextId, new Date().toISOString())
      .run();
  }
  it("permits attendance-only checkout and rejects check-only or another event's grant", async () => {
    await restrictOperator("agenda:check");
    expect((await scan(scanBody({ action: "checkout" }))).status).toBe(403);
    const foreignEventId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,created_at,updated_at) VALUES(?,?,'Foreign event','UTC',?,?)",
    )
      .bind(foreignEventId, `foreign-${foreignEventId}`, new Date().toISOString(), new Date().toISOString())
      .run();
    await restrictOperator("agenda:attendance_record", foreignEventId);
    expect((await scan(scanBody({ action: "checkout" }))).status).toBe(403);
    await restrictOperator("agenda:attendance_record");
    expect((await scan(scanBody({ action: "checkout" }))).status).toBe(200);
    expect((await scan(scanBody({ action: "admission" }))).status).toBe(403);
  });
  it.each(["permission", "session"])(
    "rolls back checkout after %s revocation between preflight and batch",
    async (kind) => {
      await restrictOperator("agenda:attendance_record");
      let revoked = false;
      const db = mutateBeforeNextBatch(env.DB, async () => {
        revoked = true;
        await env.DB.prepare(
          kind === "permission"
            ? "UPDATE permission_grants SET revoked_at=? WHERE user_id=?"
            : "UPDATE sessions SET revoked_at=? WHERE user_id=?",
        )
          .bind(new Date().toISOString(), operatorId)
          .run();
      });
      const response = await callApi({ ...env, DB: db } as Env, "/api/v1/events/scan-test/scans", {
        method: "POST",
        headers: { authorization: `Bearer ${fixture.token}`, "content-type": "application/json" },
        body: JSON.stringify(scanBody({ action: "checkout" })),
      });
      expect(revoked).toBe(true);
      expect(response.status).toBe(403);
      expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scan_attempts").first()).toEqual({ total: 0 });
      expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first()).toEqual({
        total: 0,
      });
    },
  );
});
