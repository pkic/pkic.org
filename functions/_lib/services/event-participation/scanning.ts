import {
  eventScanRequestSchema,
  eventScanResponseSchema,
  type EventScanRequest,
  type EventScanResponse,
} from "../../../../assets/shared/schemas/event-participation-scanning";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { publishedSessionsSql, publishedRoomsSql } from "./published-schedule";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";

export async function hashBadgeCredential(credential: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function issueBadge(db: DatabaseLike, eventId: string, userId: string) {
  const credential = crypto.randomUUID();
  const id = crypto.randomUUID();
  const issued = await db
    .prepare(
      "INSERT INTO event_badge_credentials (id,event_id,user_id,credential_hash,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM registrations WHERE event_id=? AND user_id=?)",
    )
    .bind(id, eventId, userId, await hashBadgeCredential(credential), nowIso(), eventId, userId)
    .run();
  if (!issued.meta?.changes)
    throw new AppError(
      409,
      "BADGE_REGISTRATION_REQUIRED",
      "The attendee must have an event registration before a badge can be issued.",
    );
  return { id, credential };
}

export async function revokeBadge(db: DatabaseLike, eventId: string, id: string) {
  await db
    .prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE id=? AND event_id=? AND revoked_at IS NULL")
    .bind(nowIso(), id, eventId)
    .run();
}

type ScannerAuthority = { operatorUserId: string; canScan: boolean; canAdmitExceptions: boolean };
type AttemptRow = {
  request_hash: string;
  outcome: EventScanResponse["outcome"];
  reason: EventScanResponse["reason"];
  action: string;
  attendanceRecorded: number;
};

/** Caller resolves event-scoped permissions; retries are bound to the same operator and event. */
export async function recordScan(
  db: DatabaseLike,
  eventId: string,
  authority: ScannerAuthority,
  raw: EventScanRequest,
): Promise<EventScanResponse> {
  if (!authority.canScan) throw new AppError(403, "SCAN_PERMISSION_REQUIRED", "Scanning permission required.");
  const scan = eventScanRequestSchema.parse(raw);
  if (scan.operatorUserId !== authority.operatorUserId)
    throw new AppError(403, "SCAN_OPERATOR_CHANGED", "Sign in as the original scanner operator.");
  if (scan.action === "lead")
    throw new AppError(403, "LEAD_SCOPE_REQUIRED", "Use the sponsor-scoped lead capture service.");
  if (scan.action === "exception" && !authority.canAdmitExceptions)
    throw new AppError(403, "EXCEPTION_PERMISSION_REQUIRED", "Exception admission permission required.");
  const requestHash = await hashBadgeCredential(JSON.stringify(scan));
  const replay = await first<AttemptRow>(
    db,
    `SELECT a.request_hash,a.outcome,a.reason,a.action,
    EXISTS(SELECT 1 FROM event_attendance_observations o WHERE o.attempt_id=a.id) AS attendanceRecorded
    FROM event_scan_attempts a WHERE a.operation_id=? AND a.event_id=? AND a.operator_user_id=?`,
    [scan.operationId, eventId, authority.operatorUserId],
  );
  if (replay && replay.request_hash !== requestHash)
    throw new AppError(409, "SCAN_OPERATION_REUSED", "Use a new operation ID for a different scan.");
  if (replay)
    return eventScanResponseSchema.parse({
      operationId: scan.operationId,
      outcome: replay.outcome,
      reason: replay.reason,
      recorded: true,
      attendanceRecorded: Boolean(replay.attendanceRecorded),
    });
  if (
    scan.occurrenceId &&
    !(await first(db, `SELECT id FROM (${publishedSessionsSql}) WHERE id=? AND event_id=?`, [
      scan.occurrenceId,
      eventId,
    ]))
  )
    throw new AppError(404, "SCAN_SESSION_NOT_FOUND", "Session not found in this event.");
  const badge = await first<{
    id: string;
    user_id: string;
    revoked_at: string | null;
    registration_status: string | null;
    registration_id: string | null;
    attendance_type: string | null;
    timezone: string;
  }>(
    db,
    `SELECT b.id,b.user_id,b.revoked_at,r.status AS registration_status,r.id AS registration_id,r.attendance_type,COALESCE((SELECT json_extract(p.snapshot_json,'$.timeZone') FROM event_agenda_publications p JOIN event_agenda_state state ON state.event_id=p.event_id AND state.published_revision=p.revision WHERE p.event_id=b.event_id),e.timezone) AS timezone FROM event_badge_credentials b
     JOIN events e ON e.id=b.event_id
     LEFT JOIN registrations r ON r.event_id=b.event_id AND r.user_id=b.user_id
     WHERE b.event_id=? AND b.credential_hash=?`,
    [eventId, await hashBadgeCredential(scan.badgeId)],
  );
  if (!badge)
    return {
      operationId: scan.operationId,
      outcome: "unknown",
      reason: "unknown_credential",
      recorded: false,
      attendanceRecorded: false,
    };
  let outcome: EventScanResponse["outcome"] = "eligible";
  let reason: EventScanResponse["reason"] = "eligible";
  if (badge.revoked_at) {
    outcome = "denied";
    reason = "revoked_badge";
  } else if (badge.registration_status !== "registered") {
    outcome = "warning";
    reason = badge.registration_status === "cancelled" ? "canceled_registration" : "missing_registration";
    if (badge.registration_status === "cancelled") outcome = "denied";
  }
  let checkDate = instantToDateTimeLocal(scan.observedAt, badge.timezone).slice(0, 10);
  if (outcome === "eligible") {
    const occurrence = scan.occurrenceId
      ? await first<{ start_at: string | null }>(
          db,
          `SELECT start_at FROM (${publishedSessionsSql}) WHERE id=? AND event_id=?`,
          [scan.occurrenceId, eventId],
        )
      : null;
    const date = instantToDateTimeLocal(occurrence?.start_at ?? scan.observedAt, badge.timezone).slice(0, 10);
    checkDate = date;
    const day = await first<{ attendance_type: string | null }>(
      db,
      `SELECT a.attendance_type FROM event_days d LEFT JOIN registration_day_attendance a ON a.event_day_id=d.id AND a.registration_id=? WHERE d.event_id=? AND d.day_date=?`,
      [badge.registration_id, eventId, date],
    );
    const attendance = day ? day.attendance_type : badge.attendance_type;
    if (attendance !== "in_person") {
      outcome = "denied";
      reason = "wrong_attendance_mode";
    }
  }
  if (outcome === "eligible" && scan.occurrenceId) {
    const session = await first<{
      admission_policy: string;
      visibility: string;
      participant_status: string | null;
      participant_mode: string | null;
    }>(
      db,
      `SELECT s.admission_policy,s.visibility,p.status AS participant_status,p.attendance_mode AS participant_mode FROM (${publishedSessionsSql}) s
       LEFT JOIN agenda_session_participations p ON p.occurrence_id=s.id AND p.user_id=?
       WHERE s.id=? AND s.event_id=?`,
      [badge.user_id, scan.occurrenceId, eventId],
    );
    if (!session) {
      outcome = "unverified";
      reason = "verification_required";
    } else if (
      (session.admission_policy !== "preference" || session.visibility === "private") &&
      (session.participant_status !== "reserved" || session.participant_mode !== "physical")
    ) {
      outcome = session.visibility === "private" ? "denied" : "warning";
      reason = "missing_registration";
    }
  }
  if (
    scan.action === "exception" &&
    (outcome === "warning" || outcome === "denied") &&
    reason === "missing_registration" &&
    badge.registration_status === "registered"
  ) {
    outcome = "eligible";
    reason = "exception";
  }
  const id = crypto.randomUUID();
  const now = nowIso();
  const capacity =
    "CASE WHEN s.capacity IS NULL THEN r.capacity WHEN r.capacity IS NULL THEN s.capacity ELSE MIN(s.capacity,r.capacity) END";
  const attendanceSql = (reg: string, event: string) =>
    `COALESCE((SELECT day_attendance.attendance_type FROM registration_day_attendance day_attendance JOIN event_days day ON day.id=day_attendance.event_day_id WHERE day_attendance.registration_id=${reg}.id AND day.day_date=?),CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=${event}.event_id AND day.day_date=?) THEN 'none' ELSE ${reg}.attendance_type END)`;
  const allocate = outcome === "eligible" && scan.action !== "check" && Boolean(scan.occurrenceId);
  const statements = [];
  if (allocate)
    statements.push(
      db
        .prepare(
          `INSERT INTO event_session_admissions (id,event_id,occurrence_id,user_id,operation_id,admitted_at)
    SELECT ?,s.event_id,s.id,?,?,? FROM (${publishedSessionsSql}) s LEFT JOIN (${publishedRoomsSql}) r ON r.id=s.room_id AND r.event_id=s.event_id
    WHERE s.id=? AND s.event_id=? AND NOT EXISTS(SELECT 1 FROM event_scan_attempts prior_attempt WHERE prior_attempt.operation_id=? AND prior_attempt.request_hash<>?) AND ((s.admission_policy='preference' AND s.visibility='public') OR ?='exception' OR EXISTS(SELECT 1 FROM agenda_session_participations entitlement WHERE entitlement.occurrence_id=s.id AND entitlement.user_id=? AND entitlement.status='reserved' AND entitlement.attendance_mode='physical')) AND EXISTS(SELECT 1 FROM registrations reg JOIN event_badge_credentials b ON b.user_id=reg.user_id AND b.event_id=reg.event_id
      WHERE reg.event_id=s.event_id AND reg.user_id=? AND reg.status='registered' AND b.id=? AND b.revoked_at IS NULL AND ${attendanceSql("reg", "b")}='in_person')
    AND (${capacity} IS NULL OR (SELECT COUNT(*) FROM (
      SELECT p.user_id FROM agenda_session_participations p WHERE p.occurrence_id=s.id AND p.status='reserved' AND p.attendance_mode='physical' AND p.user_id<>?
      UNION SELECT a.user_id FROM event_session_admissions a WHERE a.occurrence_id=s.id AND a.user_id<>?
    )) < ${capacity}) ON CONFLICT(occurrence_id,user_id) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          badge.user_id,
          scan.operationId,
          scan.observedAt,
          scan.occurrenceId,
          eventId,
          scan.operationId,
          requestHash,
          scan.action,
          badge.user_id,
          badge.user_id,
          badge.id,
          checkDate,
          checkDate,
          badge.user_id,
          badge.user_id,
        ),
    );
  const allocationOutcome = allocate
    ? `CASE WHEN EXISTS(SELECT 1 FROM event_session_admissions WHERE occurrence_id=? AND user_id=?) THEN ? ELSE 'denied' END`
    : "?";
  const allocationReason = allocate
    ? `CASE WHEN EXISTS(SELECT 1 FROM event_session_admissions WHERE occurrence_id=? AND user_id=?) THEN ? ELSE 'capacity' END`
    : "?";
  const entitlement = scan.occurrenceId
    ? `EXISTS(SELECT 1 FROM (${publishedSessionsSql}) live_session WHERE live_session.id=current_occurrence.id AND live_session.event_id=current_badge.event_id AND ((live_session.admission_policy='preference' AND live_session.visibility='public') OR ${scan.action === "exception" ? "1=1" : "EXISTS(SELECT 1 FROM agenda_session_participations live_booking WHERE live_booking.occurrence_id=live_session.id AND live_booking.user_id=current_badge.user_id AND live_booking.status='reserved' AND live_booking.attendance_mode='physical')"}))`
    : "1=1";
  const atomicOutcome = `CASE WHEN current_badge.revoked_at IS NOT NULL OR COALESCE(current_registration.status,'')<>'registered' THEN 'denied' WHEN ${attendanceSql("current_registration", "current_badge")}<>'in_person' THEN 'denied' WHEN NOT (${entitlement}) THEN CASE WHEN current_occurrence.visibility='private' THEN 'denied' ELSE 'warning' END ELSE ${allocationOutcome} END`;
  const atomicReason = `CASE WHEN current_badge.revoked_at IS NOT NULL THEN 'revoked_badge' WHEN current_registration.status='cancelled' THEN 'canceled_registration' WHEN COALESCE(current_registration.status,'')<>'registered' THEN 'missing_registration' WHEN ${attendanceSql("current_registration", "current_badge")}<>'in_person' THEN 'wrong_attendance_mode' WHEN NOT (${entitlement}) THEN 'missing_registration' ELSE ${allocationReason} END`;
  const decisionBindings = [
    checkDate,
    checkDate,
    ...(allocate ? [scan.occurrenceId, badge.user_id, outcome] : [outcome]),
    checkDate,
    checkDate,
    ...(allocate ? [scan.occurrenceId, badge.user_id, reason] : [reason]),
  ];
  statements.push(
    db
      .prepare(
        `INSERT INTO event_scan_attempts
    (id,event_id,occurrence_id,badge_id,user_id,operator_user_id,device_id,operation_id,request_hash,outcome,reason,exception_reason,action,observed_at,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,${atomicOutcome},${atomicReason},?,?,?,?
    FROM event_badge_credentials current_badge LEFT JOIN registrations current_registration ON current_registration.event_id=current_badge.event_id AND current_registration.user_id=current_badge.user_id
    LEFT JOIN (${publishedSessionsSql}) current_occurrence ON current_occurrence.id=? AND current_occurrence.event_id=current_badge.event_id
    WHERE current_badge.id=? AND current_badge.event_id=?
    ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(
        id,
        eventId,
        scan.occurrenceId,
        badge.id,
        badge.user_id,
        authority.operatorUserId,
        scan.deviceId,
        scan.operationId,
        requestHash,
        ...decisionBindings,
        scan.exceptionReason ?? null,
        scan.action,
        scan.observedAt,
        now,
        scan.occurrenceId,
        badge.id,
        eventId,
      ),
  );
  if (scan.action !== "check")
    statements.push(
      db
        .prepare(
          `INSERT INTO event_attendance_observations
    (id,attempt_id,event_id,occurrence_id,user_id,attendance_mode,observed_at)
    SELECT ?,id,event_id,occurrence_id,user_id,'physical',observed_at FROM event_scan_attempts WHERE id=? AND outcome='eligible'`,
        )
        .bind(crypto.randomUUID(), id),
    );
  await db.batch(statements);
  // Return the committed record so concurrent retries agree on the authoritative outcome.
  const committed = await first<AttemptRow>(
    db,
    `SELECT a.request_hash,a.outcome,a.reason,a.action,
    EXISTS(SELECT 1 FROM event_attendance_observations o WHERE o.attempt_id=a.id) AS attendanceRecorded
    FROM event_scan_attempts a WHERE a.operation_id=? AND a.event_id=? AND a.operator_user_id=?`,
    [scan.operationId, eventId, authority.operatorUserId],
  );
  if (committed && committed.request_hash !== requestHash)
    throw new AppError(409, "SCAN_OPERATION_REUSED", "Use a new operation ID for a different scan.");
  if (!committed) throw new Error("Scan operation belongs to another context");
  return eventScanResponseSchema.parse({
    operationId: scan.operationId,
    outcome: committed.outcome,
    reason: committed.reason,
    recorded: true,
    attendanceRecorded: Boolean(committed.attendanceRecorded),
  });
}
