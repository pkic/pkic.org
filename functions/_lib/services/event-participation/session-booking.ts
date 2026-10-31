import { operationalAllocationCompatibleSql, physicalAllocationAvailableSql } from "./session-allocation";
import { prepareBookingNotification, prepareEventBookingNotifications } from "./booking-notifications";
import { prepareParticipationWork } from "./reconciliation";
import { preparePersonalCalendarEntries } from "./calendar-entries";
import {
  sessionParticipationCommandSchema,
  sessionParticipationResponseSchema,
} from "../../../../assets/shared/schemas/event-participation-scanning";
import { sessionAttendanceModeForDay } from "../../../../assets/shared/event-participation-availability";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { first } from "../../db/queries";
import { batchFirst } from "../../db/pagination";
import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import { nowIso } from "../../utils/time";
import { publishedSessionsSql } from "./published-schedule";
import { AppError } from "../../errors";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { remoteOccupiedSql } from "./capacity-accounting";
import {
  registrationDayAttendanceSql,
  registrationSessionDayOptionsSql,
  registrationSessionAttendance,
} from "./session-access";
import { prepareScopedAuditLogAfterOneChange, isAuditChangeGuardFailure } from "../audit";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { readParticipantEvent } from "./participant-read-context";
import { participantSessionDatabase } from "./self-authorization";
import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { userSessionRequestAuthorizationEvidence } from "../../auth/user-session-evidence";
import { prepareSessionPreference, refuseSessionPreference } from "./session-preference";

interface ParticipationBasis {
  event_id: string;
  published_revision: number;
  admission_policy: string;
  visibility: string;
  start_at: string | null;
  timezone: string;
  approval_state: string | null;
  prior_status: string | null;
  prior_participation_id: string | null;
  prior_mode: "physical" | "remote" | null;
  access_policy: string;
  booking_opens_at: string | null;
  booking_closes_at: string | null;
  invited: number;
  registered: number;
  registration_default_mode: string | null;
  registration_days_json: string | null;
}

function prepareParticipationBasis(db: DatabaseLike, event: EventReadSelection, occurrenceId: string, userId: string) {
  const scope = eventReadIdSql(event);
  return {
    statements: [
      db
        .prepare(`SELECT s.event_id,s.published_revision,s.visibility,p.id AS prior_participation_id,s.admission_policy,s.start_at,s.timezone,p.status AS prior_status,p.attendance_mode AS prior_mode,p.approval_state,s.access_policy,s.booking_opens_at,s.booking_closes_at,EXISTS(SELECT 1 FROM agenda_session_invitations invitation WHERE invitation.occurrence_id=s.id AND invitation.user_id=p.user_id AND invitation.revoked_at IS NULL) AS invited,
      reg.id IS NOT NULL AS registered,reg.attendance_type AS registration_default_mode,${registrationSessionDayOptionsSql("reg", "s")} AS registration_days_json
      FROM (${publishedSessionsSql}) s LEFT JOIN agenda_session_participations p ON p.occurrence_id=s.id AND p.user_id=?
      LEFT JOIN registrations reg ON reg.event_id=s.event_id AND reg.user_id=? AND reg.status='registered'
      WHERE s.id=? AND s.event_id=${scope.sql}`)
        .bind(userId, userId, occurrenceId, ...scope.bindings),
    ],
    decode(results: D1StatementResult[]) {
      const session = batchFirst<ParticipationBasis>(results[0]);
      if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "Session not found.");
      return session;
    },
  };
}

/** Preferences use one authenticated batch; seat allocations retain their guarded preflight and command. */
export async function setSessionParticipationRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  occurrenceId: string,
  input: unknown,
) {
  const command = sessionParticipationCommandSchema.parse(input);
  if (command.action === "save" || command.action === "unsave") {
    const actor = await prepareUserSessionRequest(db, request, env);
    const plan = prepareSessionPreference(
      db,
      { slug: eventSlug },
      occurrenceId,
      actor.claims.sub,
      command.action,
      command,
    );
    try {
      const result = await db.batch([
        prepareAuthorizationGuard(db, userSessionRequestAuthorizationEvidence(actor.claims)),
        ...actor.statements,
        ...plan.statements,
      ]);
      await actor.decode(result.slice(1, 1 + actor.statements.length));
      return plan.decode(result.slice(1 + actor.statements.length));
    } catch (error) {
      return refuseSessionPreference(error);
    }
  }
  const basis = await readParticipantEvent(db, request, env, eventSlug, "audience", (userId, event, sessionId) => {
    const read = prepareParticipationBasis(db, event, occurrenceId, userId);
    return {
      statements: read.statements,
      decode: (results: D1StatementResult[]) => ({ session: read.decode(results), userId, sessionId }),
    };
  });
  return applySessionParticipation(
    participantSessionDatabase(db, basis.userId, basis.sessionId),
    basis.session.event_id,
    occurrenceId,
    basis.userId,
    input,
    {},
    basis.session,
  );
}

interface ParticipationOptions {
  management?: { actorId: string; reasonCode: string };
  /** A calendar decline means "not attending": it releases any place and takes the session off the agenda. */
  cancelUnstars?: boolean;
}

/**
 * A person's own participation. Releasing a place ("cancel") keeps the session starred, so it
 * stays on their agenda; only the place is released. Reserving or requesting stars; starring never reserves.
 */
export async function setSessionParticipation(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  userId: string,
  raw: unknown,
) {
  return applySessionParticipation(db, eventId, occurrenceId, userId, raw, {});
}

/**
 * One guarded write owns registration, attendance mode, overlap and last-seat allocation.
 * A seat is for the session as a whole: its rooms are one pool, so nobody chooses a room.
 * Without an explicit mode the person attends the way their registration attends the session's day.
 */
async function applySessionParticipation(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  userId: string,
  raw: unknown,
  { management, cancelUnstars = false }: ParticipationOptions,
  preparedSession?: ParticipationBasis,
) {
  const input = sessionParticipationCommandSchema.parse(raw);
  if (input.action === "save" || input.action === "unsave") {
    const plan = prepareSessionPreference(db, eventId, occurrenceId, userId, input.action, input);
    try {
      return plan.decode(await db.batch(plan.statements));
    } catch (error) {
      return refuseSessionPreference(error);
    }
  }
  const requiresReconfirmation =
    ["reserve", "request"].includes(input.action) && input.expectedPublishedRevision !== undefined;
  const stalePublication = () =>
    new AppError(
      409,
      "SESSION_PUBLICATION_CHANGED",
      "The published agenda changed. Refresh it and confirm your choice again. Any existing reservation has been preserved.",
    );
  const read = prepareParticipationBasis(db, eventId, occurrenceId, userId);
  const session = preparedSession ?? read.decode(await db.batch(read.statements));
  if (requiresReconfirmation && input.expectedPublishedRevision !== session.published_revision)
    throw stalePublication();
  if (input.action === "reserve" && session.admission_policy === "preference" && session.prior_status !== "reserved")
    throw new AppError(
      409,
      "SESSION_PREFERENCE_ONLY",
      "Star this session to add it to your agenda. Admission is first come, first served.",
    );
  if (input.action === "request" && session.admission_policy !== "approval")
    throw new AppError(409, "APPROVAL_NOT_REQUIRED", "This session does not require approval.");
  if (input.action !== "cancel") {
    const clock = nowIso();
    if (
      (session.booking_opens_at && session.booking_opens_at > clock) ||
      (session.booking_closes_at && session.booking_closes_at <= clock)
    )
      throw new AppError(409, "SESSION_BOOKING_CLOSED", "Registration for this session is outside its booking window.");
    if (session.access_policy === "invitation" && !session.invited)
      throw new AppError(403, "SESSION_INVITATION_REQUIRED", "An invitation is required for this session.");
  }
  const date = session.start_at ? instantToDateTimeLocal(session.start_at, session.timezone).slice(0, 10) : null;
  const attendanceMode = resolveAttendanceMode();
  function resolveAttendanceMode(): "physical" | "remote" {
    if (input.attendanceMode) return input.attendanceMode;
    if (input.action === "cancel" && session!.prior_mode) return session!.prior_mode;
    const derived = sessionAttendanceModeForDay(
      registrationSessionAttendance({ ...session!, startAt: session!.start_at, timeZone: session!.timezone }),
    );
    if (derived) return derived;
    // A release holds no seat, so its mode is inert.
    if (input.action === "cancel") return "physical";
    throw new AppError(
      409,
      "SESSION_ATTENDANCE_DAY_REQUIRED",
      "Register to attend this session's day in person or online before reserving a seat.",
    );
  }
  const historicalReservation = session.prior_status === "reserved" && session.prior_mode === attendanceMode;
  const target =
    input.action === "cancel"
      ? "canceled"
      : session.admission_policy === "approval" &&
          session.approval_state !== "approved" &&
          !management &&
          !historicalReservation
        ? "approval_pending"
        : "reserved";
  if (session.prior_status === "reserved" && target === "approval_pending")
    throw new AppError(
      409,
      "SESSION_MODE_APPROVAL_REQUIRED",
      "This change requires approval. Your existing confirmed place has been preserved; an organizer can review the new attendance mode.",
    );
  if (
    input.replaceOccurrenceId &&
    (input.action !== "reserve" || target !== "reserved" || input.replaceOccurrenceId === occurrenceId)
  )
    throw new AppError(
      409,
      "SESSION_SWITCH_INVALID",
      "Choose a different confirmed reservation and a session you can reserve immediately.",
    );
  const available =
    attendanceMode === "remote"
      ? `(s.remote_capacity IS NULL OR ${remoteOccupiedSql("s.id", "(SELECT user_id FROM actor)")}<s.remote_capacity)`
      : `(${physicalAllocationAvailableSql("s", "(SELECT user_id FROM actor)")})`;
  const now = nowIso();
  const participationId = session.prior_participation_id ?? crypto.randomUUID();
  // Reserving or requesting a seat puts the session on the person's agenda; a star never reserves.
  // Releasing a place keeps the person's star unless the release also means "not attending".
  const keepStar = input.action === "cancel" && !cancelUnstars;
  const statement = db
    .prepare(
      `WITH actor AS (SELECT ? AS user_id,? AS replacement_id) INSERT INTO agenda_session_participations (id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at,approval_state,waitlisted_at,attendance_day_date,saved)
 SELECT ?,s.event_id,s.id,?,?,CASE WHEN ?='reserved' AND NOT ${available} THEN 'waitlisted' ELSE ? END,?,?,CASE WHEN ?='approval_pending' THEN 'pending' WHEN ?=1 THEN 'approved' ELSE 'none' END,?,?,CASE WHEN ? IN ('reserve','request') THEN 1 ELSE 0 END
 FROM (${publishedSessionsSql}) s
 WHERE s.id=? AND s.event_id=? AND (?=0 OR s.published_revision=?) AND s.start_at IS ? AND s.timezone=? AND s.admission_policy=? AND (SELECT id FROM agenda_session_participations previous WHERE previous.occurrence_id=s.id AND previous.user_id=(SELECT user_id FROM actor)) IS ? AND (SELECT status FROM agenda_session_participations previous WHERE previous.occurrence_id=s.id AND previous.user_id=(SELECT user_id FROM actor)) IS ? AND (SELECT approval_state FROM agenda_session_participations approval WHERE approval.occurrence_id=s.id AND approval.user_id=(SELECT user_id FROM actor)) IS ?
 AND (?<>'reserve' OR s.admission_policy<>'preference' OR EXISTS(SELECT 1 FROM agenda_session_participations grandfathered WHERE grandfathered.occurrence_id=s.id AND grandfathered.user_id=(SELECT user_id FROM actor) AND grandfathered.status='reserved'))
 AND ${target === "canceled" ? "1" : operationalAllocationCompatibleSql("s.id", "(SELECT user_id FROM actor)", `'${attendanceMode}'`)}
 AND (s.visibility='public' OR EXISTS(SELECT 1 FROM agenda_session_participations access WHERE access.occurrence_id=s.id AND access.user_id=? AND access.status IN ('reserved','approval_pending')) OR EXISTS(SELECT 1 FROM agenda_session_invitations invitation WHERE invitation.occurrence_id=s.id AND invitation.user_id=(SELECT user_id FROM actor) AND invitation.revoked_at IS NULL))
 AND (?='cancel' OR ((s.booking_opens_at IS NULL OR s.booking_opens_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND (s.booking_closes_at IS NULL OR s.booking_closes_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND (s.access_policy='open' OR EXISTS(SELECT 1 FROM agenda_session_invitations invitation WHERE invitation.occurrence_id=s.id AND invitation.user_id=(SELECT user_id FROM actor) AND invitation.revoked_at IS NULL))))
 AND (?='cancel' OR EXISTS(SELECT 1 FROM registrations reg WHERE reg.event_id=s.event_id AND reg.user_id=? AND reg.status='registered' AND ${registrationDayAttendanceSql("reg", "?")}=?))
 AND (?<>'reserved' OR NOT EXISTS(SELECT 1 FROM agenda_session_participations other JOIN (${publishedSessionsSql}) time ON time.id=other.occurrence_id
   WHERE other.user_id=? AND other.status='reserved' AND other.occurrence_id<>s.id AND other.occurrence_id IS NOT (SELECT replacement_id FROM actor) AND time.start_at<s.end_at AND time.end_at>s.start_at))
 AND NOT (?='reserved' AND NOT ${available} AND ((SELECT replacement_id FROM actor) IS NOT NULL OR EXISTS(SELECT 1 FROM agenda_session_participations prior WHERE prior.occurrence_id=s.id AND prior.user_id=? AND prior.status='reserved' AND prior.attendance_mode<>?)))
 AND ((SELECT replacement_id FROM actor) IS NULL OR EXISTS(SELECT 1 FROM agenda_session_participations replacing WHERE replacing.occurrence_id=(SELECT replacement_id FROM actor) AND replacing.event_id=s.event_id AND replacing.user_id=(SELECT user_id FROM actor) AND (replacing.status='reserved' OR replacing.status='canceled' AND EXISTS(SELECT 1 FROM agenda_session_participations done WHERE done.occurrence_id=s.id AND done.user_id=replacing.user_id AND done.status='reserved'))))
 ON CONFLICT(occurrence_id,user_id) DO UPDATE SET attendance_mode=excluded.attendance_mode,allocation_revision=allocation_revision+CASE WHEN (agenda_session_participations.status IN ('reserved','approval_pending','waitlisted') OR excluded.status IN ('reserved','approval_pending','waitlisted')) AND (agenda_session_participations.status<>excluded.status OR agenda_session_participations.attendance_mode<>excluded.attendance_mode OR (?=1 AND agenda_session_participations.approval_state<>'approved')) THEN 1 ELSE 0 END,status=excluded.status,updated_at=excluded.updated_at,attendance_day_date=excluded.attendance_day_date,saved=CASE WHEN ?=1 THEN agenda_session_participations.saved ELSE excluded.saved END,approval_state=CASE WHEN ?=1 THEN 'approved' WHEN excluded.status='approval_pending' THEN 'pending' WHEN excluded.status='canceled' THEN 'none' ELSE agenda_session_participations.approval_state END,waitlisted_at=CASE WHEN excluded.status='waitlisted' THEN COALESCE(agenda_session_participations.waitlisted_at,excluded.waitlisted_at) ELSE NULL END`,
    )
    .bind(
      userId,
      input.replaceOccurrenceId ?? null,
      participationId,
      userId,
      attendanceMode,
      target,
      target,
      now,
      now,
      target,
      management ? 1 : 0,
      now,
      date,
      input.action,
      occurrenceId,
      eventId,
      requiresReconfirmation ? 1 : 0,
      input.expectedPublishedRevision ?? session.published_revision,
      session.start_at,
      session.timezone,
      session.admission_policy,
      session.prior_participation_id,
      session.prior_status,
      session.approval_state,
      input.action,
      userId,
      input.action,
      input.action,
      userId,
      date,
      date,
      attendanceMode === "physical" ? "in_person" : "virtual",
      target,
      userId,
      target,
      userId,
      attendanceMode,
      management ? 1 : 0,
      keepStar ? 1 : 0,
      management ? 1 : 0,
    );
  const replacement = input.replaceOccurrenceId
    ? [
        db
          .prepare(
            "UPDATE agenda_session_participations SET status='canceled',allocation_revision=allocation_revision+1,updated_at=? WHERE occurrence_id=? AND event_id=? AND user_id=? AND status='reserved' AND changes()=1",
          )
          .bind(now, input.replaceOccurrenceId, eventId, userId),
      ]
    : [];
  const statements = [
    statement,
    ...(requiresReconfirmation
      ? [
          prepareAuthorizationGuard(db, {
            sql: "SELECT 1 WHERE changes()=1",
            bindings: [],
          }),
        ]
      : []),
    ...(management
      ? [
          prepareScopedAuditLogAfterOneChange(
            db,
            { type: "event", id: eventId },
            "user",
            management.actorId,
            "session_participation_added",
            "agenda_session_participation",
            participationId,
            { occurrenceId, userId, attendanceMode, reasonCode: management.reasonCode },
            now,
          ),
        ]
      : []),
    ...replacement,
    ...(management
      ? [
          db
            .prepare(
              "INSERT INTO agenda_session_invitation_audit(id,event_id,occurrence_id,user_id,actor_id,action,reason_code,created_at) SELECT ?,?,?,?,?,'add',?,? WHERE EXISTS(SELECT 1 FROM agenda_session_participations WHERE occurrence_id=? AND user_id=? AND updated_at=?)",
            )
            .bind(
              crypto.randomUUID(),
              eventId,
              occurrenceId,
              userId,
              management.actorId,
              management.reasonCode,
              now,
              occurrenceId,
              userId,
              now,
            ),
        ]
      : []),
    ...preparePersonalCalendarEntries(db, eventId, userId),
    prepareParticipationWork(db, eventId),
    input.replaceOccurrenceId
      ? prepareEventBookingNotifications(db, eventId, userId)
      : prepareBookingNotification(db, eventId, occurrenceId, userId),
  ];
  const response = db
    .prepare(
      "SELECT status,attendance_mode AS attendanceMode FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?",
    )
    .bind(occurrenceId, userId);
  let result;
  let row;
  try {
    const results = await db.batch([...statements, response]);
    result = results[0];
    row = batchFirst(results[results.length - 1]);
  } catch (error) {
    if (requiresReconfirmation && isAuthorizationGuardFailure(error)) {
      const current = await first<{ published_revision: number | null }>(
        db,
        "SELECT published_revision FROM event_agenda_state WHERE event_id=?",
        [eventId],
      );
      if (current?.published_revision !== input.expectedPublishedRevision) throw stalePublication();
    }
    if (isAuditChangeGuardFailure(error) || (requiresReconfirmation && isAuthorizationGuardFailure(error)))
      throw new AppError(
        409,
        "SESSION_PARTICIPATION_CONFLICT",
        "Check your event registration, attendance mode, session access, or overlapping reservations. Any existing reservation has been preserved.",
      );
    throw error;
  }
  if (!result.meta?.changes)
    throw new AppError(
      409,
      "SESSION_PARTICIPATION_CONFLICT",
      "Check your event registration, attendance mode, session access, or overlapping reservations. Any existing reservation has been preserved.",
    );
  return sessionParticipationResponseSchema.parse(row);
}

/**
 * Verified calendar reply context is guarded by its caller in the same batch.
 * A declined invitation means "not attending": it releases any place and unstars the session.
 */
export async function setSessionParticipationFromCalendar(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  userId: string,
  raw: unknown,
) {
  return applySessionParticipation(db, eventId, occurrenceId, userId, raw, { cancelUnstars: true });
}

/** A live session manager must supply the existing actor/reason authority. */
export async function addManagedSessionParticipation(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  userId: string,
  raw: unknown,
  management: { actorId: string; reasonCode: string },
) {
  return applySessionParticipation(db, eventId, occurrenceId, userId, raw, { management });
}
