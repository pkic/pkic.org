import { attendanceSummarySchema } from "../assets/shared/schemas/event-attendance-reporting";
import { captureAttendanceContext } from "../assets/shared/schemas/event-attendance-capture";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { eventAttendanceSummary } from "../functions/_lib/services/event-participation/attendance-summary";
import {
  attendanceAttemptsQuery,
  eventAttendanceAttempts,
  eventAttendanceReasons,
} from "../functions/_lib/services/event-participation/attendance-attempt-report";
import { eventAttendancePeople } from "../functions/_lib/services/event-participation/attendance-people-report";
import {
  attendanceEvidence,
  correctAttendance,
} from "../functions/_lib/services/event-participation/attendance-corrections";
const eventId = crypto.randomUUID(),
  operatorId = crypto.randomUUID(),
  personId = crypto.randomUUID(),
  remoteId = crypto.randomUUID(),
  deniedId = crypto.randomUUID(),
  sessionId = crypto.randomUUID(),
  deviceId = crypto.randomUUID();
const dayDate = "2025-11-02",
  receivedAt = "2025-11-03T06:00:00.000Z";
async function attempt(
  userId: string,
  action: string,
  outcome: string,
  reason: string,
  observedAt: string,
  occurrenceId: string | null = null,
  observe = false,
  captureZone: string | null = "America/New_York",
) {
  const id = crypto.randomUUID();
  const context = captureZone
    ? captureAttendanceContext(observedAt, {
        timeZone: captureZone,
        publicationRevision: 0,
        source: "published_manifest",
      })
    : null;
  await env.DB.prepare(
    "INSERT INTO event_scan_attempts(id,event_id,occurrence_id,user_id,operator_user_id,device_id,operation_id,request_hash,outcome,reason,action,observed_at,created_at,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      eventId,
      occurrenceId,
      userId,
      operatorId,
      deviceId,
      crypto.randomUUID(),
      "fixture",
      outcome,
      reason,
      action,
      observedAt,
      receivedAt,
      context?.dayDate ?? null,
      context?.timeZone ?? null,
      context?.publicationRevision ?? null,
      context?.source ?? null,
    )
    .run();
  if (observe) {
    const observationId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_attendance_observations(id,attempt_id,event_id,occurrence_id,user_id,attendance_mode,observed_at,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source) VALUES(?,?,?,?,?,'physical',?,?,?,?,?)",
    )
      .bind(
        observationId,
        id,
        eventId,
        occurrenceId,
        userId,
        observedAt,
        context?.dayDate ?? null,
        context?.timeZone ?? null,
        context?.publicationRevision ?? null,
        context?.source ?? null,
      )
      .run();
    return observationId;
  }
  return id;
}
describe("Bounded attendance reporting with original provenance", () => {
  beforeEach(async () => {
    await resetDb();
    const now = new Date().toISOString();
    for (const [id, name] of [
      [operatorId, "Operator"],
      [personId, "Physical"],
      [remoteId, "Virtual"],
      [deniedId, "Denied"],
    ])
      await env.DB.prepare("INSERT INTO users(id,email,normalized_email,first_name,active) VALUES(?,?,?,?,1)")
        .bind(id, `${id}@example.test`, `${id}@example.test`, name)
        .run();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'report-evidence','Evidence','America/New_York','invite_or_open','{}',?,?)",
    )
      .bind(eventId, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
    )
      .bind(eventId, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at) VALUES(?,?,'Repeated session','2025-11-02T10:00:00.000Z','2025-11-02T11:00:00.000Z')",
    )
      .bind(sessionId, eventId)
      .run();
    const snapshot = await getAgenda(env.DB, eventId, "report-evidence");
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), operatorId, now)
      .run();
    await attempt(personId, "attendance", "eligible", "registered", "2025-11-02T04:10:00.000Z", null, true);
    await attempt(personId, "attendance", "eligible", "registered", "2025-11-02T06:10:00.000Z", null, true);
    await attempt(personId, "attendance", "eligible", "registered", "2025-11-02T10:10:00.000Z", sessionId, true);
    await attempt(personId, "check", "eligible", "registered", "2025-11-02T08:00:00.000Z");
    await attempt(deniedId, "admission", "denied", "missing_registration", "2025-11-02T09:00:00.000Z");
    const voided = await attempt(
      deniedId,
      "attendance",
      "eligible",
      "registered",
      "2025-11-02T09:30:00.000Z",
      null,
      true,
    );
    await correctAttendance(env.DB, eventId, voided, operatorId, {
      operationId: crypto.randomUUID(),
      expectedRevision: 0,
      kind: "void",
      reasonCode: "operator_error",
    });
    await attempt(deniedId, "attendance", "eligible", "registered", "2025-11-03T05:00:00.000Z", null, true);
    // Existing imported evidence predates captured day context. Do not manufacture a current-zone backfill.
    const reviewId = crypto.randomUUID(),
      importId = crypto.randomUUID(),
      importedObservationId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_attendance_import_reviews(id,event_id,operation_id,actor_user_id,payload_hash,payload_json,reviewed_at,expires_at,applied_at) VALUES(?,?,?,?,?,'{}',?,?,?)",
    )
      .bind(reviewId, eventId, crypto.randomUUID(), operatorId, "legacy-fixture", now, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_attendance_imports(id,event_id,operation_id,review_id,reviewer_user_id,actor_user_id,source,source_reference,row_count,received_at) VALUES(?,?,?,?,?,?,'vendor_attendance','remote-provider',1,?)",
    )
      .bind(importId, eventId, crypto.randomUUID(), reviewId, operatorId, operatorId, receivedAt)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_attendance_observations(id,event_id,user_id,attendance_mode,observed_at) VALUES(?,?,?,'virtual','2025-11-03T04:30:00.000Z')",
    )
      .bind(importedObservationId, eventId, remoteId)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_attendance_import_provenance(observation_id,import_id,event_id,source,source_reference,source_record_id,verification) VALUES(?,?,?,'vendor_attendance','remote-provider','presence-1','provider_verified')",
    )
      .bind(importedObservationId, importId, eventId)
      .run();
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at) VALUES(?,?,?,?,'physical','saved',?,?)",
    )
      .bind(crypto.randomUUID(), eventId, sessionId, personId, now, now)
      .run();
  });
  it("uses immutable captured dates through DST and excludes explicitly unclassified imports from day totals", async () => {
    expect((await eventAttendanceSummary(env.DB, eventId, { dayDate })).currentIntent).toMatchObject({
      startAt: "2025-11-02T04:00:00.000Z",
      endAt: "2025-11-03T05:00:00.000Z",
    });
    await env.DB.prepare("UPDATE events SET timezone='UTC' WHERE id=?").bind(eventId).run();
    const snapshot = await getAgenda(env.DB, eventId, "report-evidence");
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,1,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, JSON.stringify({ ...snapshot, timeZone: "UTC" }), operatorId, receivedAt)
      .run();
    await env.DB.prepare("UPDATE event_agenda_state SET published_revision=1 WHERE event_id=?").bind(eventId).run();
    const report = await eventAttendanceSummary(env.DB, eventId, { dayDate });
    expect(report).toMatchObject({
      timeZone: "UTC",
      currentIntent: { timeZone: "UTC", startAt: "2025-11-02T00:00:00.000Z", endAt: "2025-11-03T00:00:00.000Z" },
      classification: {
        missingObservations: 1,
        missingAttempts: 0,
        capturedTimeZones: 1,
        mixedTimeZones: false,
        dayFilterExcludesMissing: true,
      },
      observed: {
        uniquePeople: 1,
        physicalPeople: 1,
        virtualPeople: 0,
        providerAssertedVirtualPeople: 0,
        originalObservations: 4,
        effectiveObservations: 3,
        voidedObservations: 1,
        entryObservations: 2,
        reentryObservations: 1,
        importedObservations: 0,
        checkoutObservations: 0,
      },
      attempts: { recognized: 6, successful: 5, unsuccessful: 1, checks: 1, admissions: 1, attendance: 4 },
      sync: { deviceBacklog: "unknown", completeness: "not_established" },
      evidence: {
        clockVerification: "unverified",
        providerVerification: "source_assertion",
        presenceDuration: "not_established",
        checkoutCaptureSupported: true,
      },
    });
    expect((await eventAttendanceSummary(env.DB, eventId, {})).observed.uniquePeople).toBe(3);
    const virtual = await eventAttendanceSummary(env.DB, eventId, { dayDate, attendanceMode: "virtual" });
    expect(virtual.observed.uniquePeople).toBe(0);
    expect(virtual.classification.missingObservations).toBe(1);
    expect(virtual.attempts.recognized).toBe(0);
    expect(virtual.observed.entryObservations).toBe(0);
  });
  it("keeps mixed captured zones and missing originals honest across summary, people, attempts and reasons", async () => {
    await attempt(personId, "attendance", "eligible", "registered", "2025-11-02T04:10:00.000Z", null, true, "UTC");
    await attempt(
      deniedId,
      "attendance",
      "eligible",
      "other_day",
      "2025-11-02T04:10:00.000Z",
      null,
      true,
      "Pacific/Honolulu",
    );
    await attempt(deniedId, "attendance", "eligible", "legacy_missing", "2025-11-02T04:10:00.000Z", null, true, null);
    const report = await eventAttendanceSummary(env.DB, eventId, { dayDate });
    expect(report.classification).toMatchObject({
      missingObservations: 2,
      missingAttempts: 1,
      capturedTimeZones: 2,
      mixedTimeZones: true,
      dayFilterExcludesMissing: true,
    });
    expect(report.observed.originalObservations).toBe(5);
    expect((await eventAttendanceAttempts(env.DB, eventId, { dayDate, reason: "other_day" })).page.total).toBe(0);
    expect((await eventAttendanceReasons(env.DB, eventId, { dayDate, q: "legacy_missing" })).page.total).toBe(0);
    expect(
      (await eventAttendanceAttempts(env.DB, eventId, { reason: "legacy_missing" })).attempts[0].captureContext,
    ).toEqual({ state: "missing", reason: "not_captured" });
    expect((await eventAttendanceSummary(env.DB, eventId, {})).classification).toMatchObject({
      missingObservations: 2,
      missingAttempts: 1,
      capturedTimeZones: 3,
      dayFilterExcludesMissing: false,
    });
    const people = await eventAttendancePeople(env.DB, eventId, { dayDate });
    expect(people.attendees[0]).toMatchObject({ capturedTimeZones: 2, missingContextObservations: 0 });
    const session = await eventAttendanceSummary(env.DB, eventId, { dayDate, occurrenceId: sessionId });
    expect(session.classification).toMatchObject({ missingObservations: 0, missingAttempts: 0, capturedTimeZones: 1 });
    const virtual = await eventAttendanceSummary(env.DB, eventId, { dayDate, attendanceMode: "virtual" });
    expect(virtual.classification).toMatchObject({ missingObservations: 1, missingAttempts: 0, capturedTimeZones: 0 });
  });
  it("excludes incomplete tuples from day filters and counts them as missing without changing originals", async () => {
    const id = await attempt(personId, "check", "eligible", "partial", "2025-11-02T04:10:00.000Z", null, false, null);
    await env.DB.prepare("UPDATE event_scan_attempts SET capture_day_date=?,capture_time_zone='UTC' WHERE id=?")
      .bind(dayDate, id)
      .run();
    expect((await eventAttendanceAttempts(env.DB, eventId, { reason: "partial" })).attempts[0].captureContext).toEqual({
      state: "missing",
      reason: "incomplete_capture",
    });
    expect((await eventAttendanceAttempts(env.DB, eventId, { reason: "partial", dayDate })).page.total).toBe(0);
    expect((await eventAttendanceSummary(env.DB, eventId, { dayDate })).classification.missingAttempts).toBe(1);
  });
  it("uses the indexed recorded-day predicate for the shared attempt population", async () => {
    const built = await attendanceAttemptsQuery(env.DB, eventId, { dayDate });
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${built.sql}`)
      .bind(...built.bindings)
      .all<{ detail: string }>();
    expect(
      plan.results.some(
        (row) => row.detail.includes("event_scan_attempts_capture_day") && row.detail.includes("capture_day_date=?"),
      ),
    ).toBe(true);
  });
  it("retains captured evidence on a date unavailable in the current schedule timezone", async () => {
    await attempt(personId, "attendance", "eligible", "old_zone", "2011-12-30T10:00:00.000Z", null, true, "UTC");
    await env.DB.prepare("UPDATE event_agenda_state SET published_revision=NULL WHERE event_id=?").bind(eventId).run();
    await env.DB.prepare("UPDATE events SET timezone='Pacific/Apia' WHERE id=?").bind(eventId).run();
    const report = await eventAttendanceSummary(env.DB, eventId, { dayDate: "2011-12-30" });
    expect(report.observed.uniquePeople).toBe(1);
    expect(report.currentIntent).toMatchObject({ dayIntervalAvailable: false, startAt: null, endAt: null });
    expect((await eventAttendancePeople(env.DB, eventId, { dayDate: "2011-12-30" })).attendees[0].savedSessions).toBe(
      0,
    );
  });
  it("keeps denial/check evidence bounded and attributable without counting it as presence", async () => {
    const first = await eventAttendanceAttempts(env.DB, eventId, { dayDate, limit: 1, sort: "observedAt" });
    expect(first.page).toMatchObject({ total: 6, hasMore: true });
    expect(first.attempts[0]).toMatchObject({ userId: personId, clockVerification: "unverified", receivedAt });
    const denied = await eventAttendanceAttempts(env.DB, eventId, {
      dayDate,
      userId: deniedId,
      reason: "missing_registration",
    });
    expect(denied.attempts).toHaveLength(1);
    expect(denied.attempts[0]).toMatchObject({ outcome: "denied", action: "admission" });
    const reasons = await eventAttendanceReasons(env.DB, eventId, { dayDate, limit: 1, sort: "-count" });
    expect(reasons.page).toMatchObject({ total: 3, hasMore: true });
    expect(reasons.reasons[0]).toMatchObject({ action: "attendance", count: 4 });
    expect(
      (await eventAttendanceSummary(env.DB, eventId, { dayDate, occurrenceId: sessionId })).observed,
    ).toMatchObject({ uniquePeople: 1, entryObservations: 1, reentryObservations: 0 });
  });

  it("lists the most recently received attempt first unless another order is requested", async () => {
    const latest = await attempt(deniedId, "check", "eligible", "registered", "2025-11-02T07:00:00.000Z");
    await env.DB.prepare("UPDATE event_scan_attempts SET created_at='2025-11-03T07:00:00.000Z' WHERE id=?")
      .bind(latest)
      .run();
    expect((await eventAttendanceAttempts(env.DB, eventId, { limit: 1 })).attempts[0]).toMatchObject({ id: latest });
    expect(
      (await eventAttendanceAttempts(env.DB, eventId, { limit: 1, sort: "receivedAt" })).attempts[0],
    ).not.toMatchObject({ id: latest });
  });

  it("lists the most recent attendance evidence first unless another order is requested", async () => {
    expect((await attendanceEvidence(env.DB, eventId, {})).observations[0]).toMatchObject({
      userId: deniedId,
      observedAt: "2025-11-03T05:00:00.000Z",
    });
    expect((await attendanceEvidence(env.DB, eventId, { sort: "observedAt" })).observations[0]).toMatchObject({
      userId: personId,
      observedAt: "2025-11-02T04:10:00.000Z",
    });
  });

  it("searches grouped safe reasons and exceptions consistently for count, pages and expired contact privacy", async () => {
    const exceptionId = await attempt(personId, "exception", "eligible", "exception", "2025-11-02T10:00:00.000Z");
    await env.DB.prepare("UPDATE event_scan_attempts SET exception_reason='Private Explanation' WHERE id=?")
      .bind(exceptionId)
      .run();
    const denied = await eventAttendanceReasons(env.DB, eventId, { dayDate, q: "MISSING_REG", limit: 1 });
    expect(denied.page).toMatchObject({ total: 1, hasMore: false });
    expect(denied.reasons[0]).toMatchObject({ reason: "missing_registration", count: 1 });
    expect(
      await eventAttendanceReasons(env.DB, eventId, { dayDate, q: "MISSING_REG", limit: 1, offset: 1 }),
    ).toMatchObject({ reasons: [], page: { total: 1, hasMore: false } });
    const explanation = await eventAttendanceReasons(env.DB, eventId, { dayDate, q: "private explanation", limit: 1 });
    expect(explanation.page.total).toBe(1);
    expect(explanation.reasons[0]?.exceptionReason).toBe("Private Explanation");
    const empty = await eventAttendanceReasons(env.DB, eventId, { q: "does-not-exist" });
    expect(empty).toMatchObject({ reasons: [], page: { total: 0, hasMore: false } });
    await env.DB.prepare("UPDATE events SET ends_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(eventId).run();
    await env.DB.prepare("INSERT INTO retention_policies(event_id,user_retention_days,updated_at) VALUES(?,1,?)")
      .bind(eventId, new Date().toISOString())
      .run();
    const expired = await eventAttendanceReasons(env.DB, eventId, { q: "private explanation" });
    expect(expired).toMatchObject({ reasons: [], page: { total: 0 } });
    const structured = await eventAttendanceReasons(env.DB, eventId, { dayDate, q: "exception" });
    expect(structured.reasons[0]).toMatchObject({ reason: "exception", exceptionReason: null, count: 1 });
  });
  it("reports live identities and intent separately from effective physical/virtual evidence; preserves first original observation after repeats", async () => {
    const people = await eventAttendancePeople(env.DB, eventId, { dayDate, limit: 1, sort: "name" });
    expect(people.page).toMatchObject({ total: 1, hasMore: false });
    expect(people.attendees[0]).toMatchObject({
      userId: personId,
      displayName: "Physical",
      firstObservedAt: "2025-11-02T04:10:00.000Z",
      lastObservedAt: "2025-11-02T10:10:00.000Z",
      observationCount: 3,
      physicalObservations: 3,
      virtualObservations: 0,
      reservedSessions: 0,
      savedSessions: 1,
    });
    const virtual = await eventAttendancePeople(env.DB, eventId, { attendanceMode: "virtual" });
    expect(virtual.attendees[0]).toMatchObject({
      userId: remoteId,
      virtualObservations: 1,
      importedObservations: 1,
      providerAssertedVirtualObservations: 1,
      missingContextObservations: 1,
      capturedTimeZones: 0,
    });
    expect((await eventAttendancePeople(env.DB, eventId, { dayDate, q: "Denied" })).page.total).toBe(0);
  });
  it("exposes unclosed/revoked/expired quota reconciliation without inventing an unuploaded device backlog", async () => {
    const grantId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_offline_admission_grants(id,event_id,day_date,operator_user_id,device_id,quantity,issued_at,expires_at,revoked_at,created_by) VALUES(?,?,?,?,?,3,'2025-11-02T04:00:00.000Z','2025-11-03T05:00:00.000Z','2025-11-03T04:00:00.000Z',?)",
    )
      .bind(grantId, eventId, dayDate, operatorId, deviceId, operatorId)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_offline_admission_spends(operation_id,grant_id,slot,user_id,observed_at,accepted_at) VALUES(?,?,0,?,'2025-11-02T06:10:00.000Z',?)",
    )
      .bind(crypto.randomUUID(), grantId, personId, receivedAt)
      .run();
    const report = await eventAttendanceSummary(env.DB, eventId, { dayDate });
    expect(report.sync).toMatchObject({
      knownGrants: 1,
      unclosedGrants: 1,
      unclosedDevices: 1,
      revokedUnclosedGrants: 1,
      expiredUnclosedGrants: 1,
      reconciledAdmissions: 1,
      heldUnspentSlots: 2,
      deviceBacklog: "unknown",
      completeness: "not_established",
    });
    await env.DB.prepare("UPDATE event_offline_admission_grants SET closed_at=? WHERE id=?")
      .bind(receivedAt, grantId)
      .run();
    expect((await eventAttendanceSummary(env.DB, eventId, { dayDate })).sync).toMatchObject({
      unclosedGrants: 0,
      heldUnspentSlots: 0,
      deviceBacklog: "unknown",
    });
  });
  it("rejects foreign occurrences and invalid event-local calendar dates", async () => {
    await expect(eventAttendanceSummary(env.DB, eventId, { occurrenceId: crypto.randomUUID() })).rejects.toMatchObject({
      code: "ATTENDANCE_OCCURRENCE_NOT_FOUND",
    });
    await expect(eventAttendanceSummary(env.DB, eventId, { dayDate: "2025-02-30" })).rejects.toThrow();
  });
  it("mounted reports require event-scoped attendance authority and resolve people live with sensitive cache policy", async () => {
    const token = await createAdminSession(env.DB, operatorId, crypto.randomUUID());
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:attendance_read','event',?,?)",
    )
      .bind(crypto.randomUUID(), operatorId, eventId, new Date().toISOString())
      .run();
    const headers = { authorization: `Bearer ${token}` };
    // Events created through legacy SQLite defaults retain a UTC timestamp without ISO separators.
    await env.DB.prepare("UPDATE event_scanner_reconciliation_coverage SET coverage_started_at=? WHERE event_id=?")
      .bind("2025-10-01 08:15:30", eventId)
      .run();
    const summaryResponse = await callApi(env, "/api/v1/events/report-evidence/attendance/summary", { headers });
    expect(summaryResponse.status).toBe(200);
    expect(
      attendanceSummarySchema.parse(await summaryResponse.json()).sync.scannerReconciliation.coverageStartedAt,
    ).toBe("2025-10-01T08:15:30.000Z");
    for (const path of ["summary", "attempts", "reasons", "people"]) {
      const response = await callApi(env, `/api/v1/events/report-evidence/attendance/${path}?dayDate=${dayDate}`, {
        headers,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    await env.DB.prepare("UPDATE users SET first_name='Current name' WHERE id=?").bind(personId).run();
    const response = await callApi(
      env,
      `/api/v1/events/report-evidence/attendance/people?dayDate=${dayDate}&q=Current`,
      { headers },
    );
    expect(((await response.json()) as { attendees: Array<{ displayName: string }> }).attendees[0].displayName).toBe(
      "Current name",
    );
    await env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), operatorId)
      .run();
    expect([401, 403]).toContain(
      (await callApi(env, "/api/v1/events/report-evidence/attendance/summary", { headers })).status,
    );
  });
});
