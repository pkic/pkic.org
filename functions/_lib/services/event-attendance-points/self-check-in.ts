import { prepareCheckInStanding } from "../member-standing/awards";
/**
 * Attendee self check-in and check-out by scanning a check-in code.
 *
 * Reading a code and recording it share one evaluation, so the confirmation
 * screen shows exactly what pressing the button will do. A recorded scan is an
 * ordinary scan attempt plus attendance observation (method `self`), the same
 * records staff badge scans write, so reports and on-site counts read both.
 *
 * Every signed-in person who scans is recorded: registration, an in-person
 * place and a session booking are kept with the record as the person's
 * standing, never used to refuse them. A registrant attending the day online
 * is recorded as attending online (`virtual`), so a code seen on a livestream
 * never adds to on-site presence or in-person attendance.
 *
 * Recording is one atomic D1 batch whose insert re-checks, in SQL, the key
 * generation, whether the person still attends online, their current
 * presence, a repeat of the same scan within seconds and the daily limit; a
 * lost race re-reads the outcome instead of writing twice. No registration,
 * attendance mode, waiting list or offer changes, and nothing is sent.
 */
import {
  attendanceModeForStanding,
  attendancePointDecision,
  attendeeStanding,
  SELF_CHECK_IN_DAILY_LIMIT,
  SELF_CHECK_IN_REPEAT_SECONDS,
  selfCheckInDailyLimitReached,
  type AttendancePointSelection,
  type AttendeeStanding,
} from "../../../../assets/shared/attendance-points";
import {
  attendancePointResultSchema,
  type AttendancePointCommand,
  type AttendancePointResult,
  type AttendancePointTarget,
} from "../../../../assets/shared/schemas/event-attendance-points";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import { addSeconds, nowIso } from "../../utils/time";
import { resolveAttendanceCapture } from "../event-participation/attendance-capture-context";
import { publishedSessionsSql } from "../event-participation/published-schedule";
import { sessionAccessEligibleSql } from "../event-participation/session-access";
import type { EventRecord } from "../event-types";
import { resolveAttendancePoint, type PointResolution } from "./point-resolution";
import { verifyAttendancePoint } from "./point-keys";
import { readDayStanding, remoteStandingSql } from "./day-standing";
import { sessionCheckedInSql, venuePresenceInModeSql } from "./venue-presence";

/** The attendee's own phone stands in for a scanner device on self-recorded attempts. */
export const SELF_CHECK_IN_DEVICE_ID = "00000000-0000-4000-8000-000000000001";

type Action = "check_in" | "check_out";

interface Recordable {
  selection: AttendancePointSelection;
  generation: number;
  resolution: Exclude<PointResolution, { kind: "refused" }>;
  capture: Awaited<ReturnType<typeof captureClock>>;
  day: string;
  standing: AttendeeStanding;
  booked: boolean | null;
}

interface Evaluation {
  result: AttendancePointResult;
  recordable: Recordable | null;
}

function result(
  status: AttendancePointResult["status"],
  target: AttendancePointTarget | null,
  reason: AttendancePointResult["reason"] = null,
  recordedAt: string | null = null,
  note: { standing: AttendeeStanding; booked: boolean | null } | null = null,
): AttendancePointResult {
  return attendancePointResultSchema.parse({
    status,
    reason,
    target,
    recordedAt,
    standing: note?.standing ?? null,
    booked: note?.booked ?? null,
  });
}

async function captureClock(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  now: string,
  occurrenceId: string | null,
) {
  const capture = await resolveAttendanceCapture(db, eventId, {
    observedAt: now,
    operatorUserId: userId,
    deviceId: SELF_CHECK_IN_DEVICE_ID,
    occurrenceId,
  });
  if (capture.context.state !== "captured")
    throw new AppError(409, "ATTENDANCE_CAPTURE_CONTEXT_UNAVAILABLE", "Check-in is unavailable right now.");
  return { ...capture, context: capture.context };
}

/** Whether the person holds the place a session asks for, in the mode they attend in. */
async function sessionState(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  sessionId: string,
  standing: AttendeeStanding,
) {
  const mode = standing === "remote" ? "'remote'" : "'physical'";
  const row = await first<{ checked_in: number; access: number }>(
    db,
    `SELECT ${sessionCheckedInSql} AS checked_in,
     EXISTS(SELECT 1 FROM (${publishedSessionsSql}) session CROSS JOIN (SELECT ? AS user_id) viewer
      WHERE session.event_id=? AND session.id=? AND ${sessionAccessEligibleSql("session", "viewer.user_id", mode)}) AS access`,
    [eventId, userId, sessionId, userId, eventId, sessionId],
  );
  return { checkedIn: Boolean(row?.checked_in), booked: Boolean(row?.access) };
}

/** SQL: how many check-ins and check-outs a person recorded themselves on a day. Binds event, user and day. */
const selfWritesOnSql = `(SELECT COUNT(*) FROM event_scan_attempts
 WHERE event_id=? AND user_id=? AND capture_day_date=? AND capture_method='self')`;

async function writesOn(db: DatabaseLike, eventId: string, userId: string, day: string): Promise<number> {
  return (await first<{ total: number }>(db, `SELECT ${selfWritesOnSql} AS total`, [eventId, userId, day]))?.total ?? 0;
}

async function evaluate(
  db: DatabaseLike,
  signingSecret: string,
  event: EventRecord,
  userId: string,
  token: string,
  now: string,
): Promise<Evaluation> {
  const verified = await verifyAttendancePoint(db, signingSecret, event.id, token, now);
  if (verified.state !== "valid")
    return {
      recordable: null,
      result: result("refused", null, "invalid_code"),
    };
  const clock = await captureClock(db, event.id, userId, now, null);
  const resolution = await resolveAttendancePoint(db, event, verified.selection, {
    now,
    today: clock.context.dayDate,
    timeZone: clock.context.timeZone,
  });
  if (resolution.kind === "refused")
    return { recordable: null, result: result("refused", resolution.target, resolution.reason) };
  const day = resolution.kind === "venue" ? resolution.target.dayDate : resolution.session.day;
  const standing = attendeeStanding(await readDayStanding(db, event.id, userId, day));
  let decision;
  let booked: boolean | null = null;
  if (resolution.kind === "venue") {
    const presence = await first<{ presence: "none" | "checked_in" | "checked_out" }>(
      db,
      `SELECT ${venuePresenceInModeSql} AS presence`,
      [attendanceModeForStanding(standing), event.id, userId, day],
    );
    decision = attendancePointDecision({
      kind: resolution.target.kind === "venue_check_out" ? "venue_check_out" : "venue_check_in",
      pointDay: day,
      today: clock.context.dayDate,
      eventDay: resolution.eventDay,
      presence: presence?.presence ?? "none",
    });
  } else {
    const session = await sessionState(db, event.id, userId, resolution.session.id, standing);
    booked = session.booked;
    decision = attendancePointDecision({
      kind: "session",
      sessionDay: resolution.session.day,
      today: clock.context.dayDate,
      window: resolution.session.window,
      checkedIntoSession: session.checkedIn,
    });
  }
  if (decision.status === "refused")
    return { recordable: null, result: result("refused", resolution.target, decision.reason) };
  if (
    decision.status === "ready" &&
    selfCheckInDailyLimitReached(await writesOn(db, event.id, userId, clock.context.dayDate))
  )
    return { recordable: null, result: result("refused", resolution.target, "daily_limit") };
  return {
    result: result(decision.status, resolution.target, null, null, { standing, booked }),
    recordable:
      decision.status === "ready"
        ? {
            selection: verified.selection,
            generation: verified.generation,
            resolution,
            capture: clock,
            day,
            standing,
            booked,
          }
        : null,
  };
}

/** What scanning the code does for this attendee now; records nothing. */
export async function readAttendancePoint(
  db: DatabaseLike,
  signingSecret: string,
  event: EventRecord,
  userId: string,
  token: string,
): Promise<AttendancePointResult> {
  return (await evaluate(db, signingSecret, event, userId, token, nowIso())).result;
}

interface Receipt {
  user_id: string;
  request_hash: string;
  observed_at: string;
  attendee_standing: AttendeeStanding | null;
  session_booked: number | null;
}

async function receipt(db: DatabaseLike, eventId: string, operationId: string) {
  return first<Receipt>(
    db,
    "SELECT user_id,request_hash,observed_at,attendee_standing,session_booked FROM event_scan_attempts WHERE event_id=? AND operation_id=? AND capture_method='self'",
    [eventId, operationId],
  );
}

/**
 * SQL: the person's latest own scan that day, when it was this same scan
 * (same code, same direction) within the last few seconds. Only the latest
 * counts, so returning it reports the person's current state. Binds event,
 * user, day, request hash and the earliest instant that still counts.
 */
const repeatedScanSql = `SELECT user_id,request_hash,observed_at,attendee_standing,session_booked FROM (
 SELECT user_id,request_hash,observed_at,attendee_standing,session_booked FROM event_scan_attempts
 WHERE event_id=? AND user_id=? AND capture_day_date=? AND capture_method='self' ORDER BY observed_at DESC,rowid DESC LIMIT 1
) latest WHERE latest.request_hash=? AND latest.observed_at>=?`;

/** The same scan recorded moments ago, if any: a double tap or a second read by the phone camera. */
async function repeatedScan(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  day: string,
  requestHash: string,
  now: string,
) {
  return first<Receipt>(db, repeatedScanSql, [
    eventId,
    userId,
    day,
    requestHash,
    addSeconds(now, -SELF_CHECK_IN_REPEAT_SECONDS),
  ]);
}

/** Record a check-in or a check-out. A refusal or an existing state is returned, never written again. */
export async function recordAttendancePoint(
  db: DatabaseLike,
  signingSecret: string,
  event: EventRecord,
  userId: string,
  action: Action,
  command: AttendancePointCommand,
): Promise<AttendancePointResult> {
  const requestHash = await sha256Hex(JSON.stringify({ userId, action, pointToken: command.pointToken }));
  const recorded = async (written: Receipt, target?: AttendancePointTarget | null) => {
    if (written.user_id !== userId || written.request_hash !== requestHash)
      throw new AppError(409, "ATTENDANCE_OPERATION_REUSED", "Scan the code again.");
    // A retry reads the target as it was when the scan was recorded.
    const shown =
      target === undefined
        ? (await evaluate(db, signingSecret, event, userId, command.pointToken, written.observed_at)).result.target
        : target;
    return result(action === "check_out" ? "checked_out" : "checked_in", shown, null, written.observed_at, {
      standing: written.attendee_standing ?? "in_person",
      booked: written.session_booked === null ? null : Boolean(written.session_booked),
    });
  };
  const replay = await receipt(db, event.id, command.operationId);
  if (replay) return recorded(replay);
  const now = nowIso();
  const evaluation = await evaluate(db, signingSecret, event, userId, command.pointToken, now);
  const recordable = evaluation.recordable;
  if (!recordable) return evaluation.result;
  if (evaluation.result.target!.action !== action)
    throw new AppError(
      400,
      "ATTENDANCE_POINT_ACTION_MISMATCH",
      action === "check_out" ? "This code checks you in." : "This code checks you out.",
    );
  const { resolution, capture, day, standing } = recordable;
  const repeat = await repeatedScan(db, event.id, userId, capture.context.dayDate, requestHash, now);
  if (repeat) return recorded(repeat, evaluation.result.target);
  const session = resolution.kind === "session" ? resolution.session : null;
  const mode = attendanceModeForStanding(standing);
  const presenceGuard = session
    ? { sql: `NOT ${sessionCheckedInSql}`, bindings: [event.id, userId, session.id] }
    : {
        sql: `${venuePresenceInModeSql}${action === "check_out" ? "='checked_in'" : "<>'checked_in'"}`,
        bindings: [mode, event.id, userId, day],
      };
  const remote = remoteStandingSql(event.id, userId, day);
  const attemptId = crypto.randomUUID();
  const context = capture.context;
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO event_scan_attempts(id,event_id,occurrence_id,badge_id,user_id,operator_user_id,device_id,operation_id,request_hash,room_id,outcome,reason,action,observed_at,created_at,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source,capture_method,attendance_point_kind,attendee_standing,session_booked)
           SELECT ?,?,?,NULL,?,?,?,?,?,?,'eligible','eligible',?,?,?,?,?,?,?,'self',?,?,?
           WHERE EXISTS(SELECT 1 FROM event_attendance_point_keys WHERE event_id=? AND generation=?)
           AND EXISTS(${capture.contextEvidence.sql}) AND ${remote.sql}=? AND ${presenceGuard.sql}
           AND NOT EXISTS(${repeatedScanSql}) AND ${selfWritesOnSql}<?
           ON CONFLICT(operation_id) DO NOTHING`,
        )
        .bind(
          attemptId,
          event.id,
          session?.id ?? null,
          userId,
          userId,
          SELF_CHECK_IN_DEVICE_ID,
          command.operationId,
          requestHash,
          session?.roomId ?? null,
          action === "check_out" ? "checkout" : "attendance",
          now,
          now,
          context.dayDate,
          context.timeZone,
          context.publicationRevision,
          context.source,
          recordable.selection.kind,
          standing,
          recordable.booked === null ? null : Number(recordable.booked),
          event.id,
          recordable.generation,
          ...capture.contextEvidence.bindings,
          ...remote.bindings,
          standing === "remote" ? 1 : 0,
          ...presenceGuard.bindings,
          event.id,
          userId,
          context.dayDate,
          requestHash,
          addSeconds(now, -SELF_CHECK_IN_REPEAT_SECONDS),
          event.id,
          userId,
          context.dayDate,
          SELF_CHECK_IN_DAILY_LIMIT,
        ),
      db
        .prepare(
          `INSERT INTO event_attendance_observations(id,attempt_id,event_id,occurrence_id,user_id,attendance_mode,observed_at,room_id,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source)
           SELECT ?,id,event_id,occurrence_id,user_id,?,observed_at,room_id,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source
           FROM event_scan_attempts WHERE id=?`,
        )
        .bind(crypto.randomUUID(), mode, attemptId),
      prepareCheckInStanding(db, attemptId, now),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("EVENT_EVIDENCE_CAPTURE_CLOSED"))
      return result("refused", evaluation.result.target, "closed");
    throw error;
  }
  const written = await receipt(db, event.id, command.operationId);
  if (written) return recorded(written, evaluation.result.target);
  const concurrent = await repeatedScan(db, event.id, userId, context.dayDate, requestHash, now);
  if (concurrent) return recorded(concurrent, evaluation.result.target);
  // A concurrent scan, a reissue, a registration change or the daily limit won the race: report the state as it now is.
  return (await evaluate(db, signingSecret, event, userId, command.pointToken, nowIso())).result;
}
