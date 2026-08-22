import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import {
  deriveEventAttendanceType,
  listEventDays,
  prepareReplaceRegistrationDayAttendanceStatements,
  type DayAttendanceSelection,
} from "../event-days";
import { prepareUserProfileStatement, type UserProfilePatch } from "../users";
import {
  buildRegistrationDayWaitlistSync,
  dayWaitlistOfferUnavailableError,
  listConfirmedInPersonEventDayIdsForRegistration,
  listInPersonEventDayIdsForRegistration,
  prepareRemoveAllDayWaitlistStatement,
  resolveCapacityExemptReason,
  type DayWaitlistLane,
} from "./day-waitlist";
import type { RegistrationRecord } from "./types";
import type { AttendanceType } from "../../../../assets/shared/schemas/registration";
import { prepareClearRegistrationEmailChangeStatement } from "./change-email";

export interface RegistrationUpdatePayload {
  action: "update" | "cancel" | "report_unauthorized";
  attendanceType?: AttendanceType;
  dayAttendance?: DayAttendanceSelection[];
  /** Offered day seats are accepted only when the caller explicitly names them. */
  claimDayWaitlistOffers?: string[];
  /** Admin-only transition that puts selected in-person days at the end of the waitlist. */
  forceWaitlistDayDates?: string[];
  customAnswersJson?: string | null;
  sourceRef?: string | null;
  waitlistClaimWindowHours?: number;
  profilePatch?: UserProfilePatch;
  auditActor?: { type: "admin" | "user"; id: string; action: string };
}

function prepareRegistrationUpdateAudit(
  db: DatabaseLike,
  registration: RegistrationRecord,
  updated: RegistrationRecord,
  payload: RegistrationUpdatePayload,
): StatementLike | null {
  if (!payload.auditActor) return null;
  return prepareAuditLog(
    db,
    payload.auditActor.type,
    payload.auditActor.id,
    payload.auditActor.action,
    "registration",
    registration.id,
    {
      action: { from: null, to: payload.action },
      status: { from: registration.status, to: updated.status },
      attendanceType: { from: registration.attendance_type, to: updated.attendance_type },
      customAnswers: {
        from: parseJsonSafe<Record<string, unknown> | null>(registration.custom_answers_json, null),
        to: parseJsonSafe<Record<string, unknown> | null>(updated.custom_answers_json, null),
      },
    },
  );
}

export interface BuiltRegistrationUpdate {
  registration: RegistrationRecord;
  statements: StatementLike[];
  dayAttendance?: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
  dayWaitlist?: Array<{
    dayDate: string;
    status: string;
    priorityLane: DayWaitlistLane;
    offerExpiresAt: string | null;
  }>;
}

export async function buildRegistrationUpdate(
  db: DatabaseLike,
  registration: RegistrationRecord,
  payload: RegistrationUpdatePayload,
  changedBy = "self",
): Promise<BuiltRegistrationUpdate> {
  if (payload.claimDayWaitlistOffers?.length && (payload.action !== "update" || !payload.dayAttendance)) {
    throw dayWaitlistOfferUnavailableError();
  }
  const isCancelled = registration.status === "cancelled";
  if (payload.action === "cancel") {
    if (isCancelled) throw new AppError(409, "ALREADY_CANCELLED", "Registration is already cancelled");
    const now = nowIso();
    const cancelled: RegistrationRecord = {
      ...registration,
      status: "cancelled",
      cancellation_reason_code: null,
      cancelled_at: now,
      updated_at: now,
    };
    const statements: StatementLike[] = [
      db
        .prepare(
          `UPDATE registrations
           SET status = 'cancelled', cancellation_reason_code = NULL, cancelled_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(now, now, registration.id),
      prepareRemoveAllDayWaitlistStatement(db, {
        registrationId: registration.id,
        reasonCode: "registration_cancelled",
      }),
      prepareClearRegistrationEmailChangeStatement(db, registration.id, registration.user_id, now),
    ];
    const audit = prepareRegistrationUpdateAudit(db, registration, cancelled, payload);
    if (audit) statements.push(audit);
    return { registration: cancelled, statements, dayWaitlist: [] };
  }

  if (payload.action === "report_unauthorized") {
    if (isCancelled) {
      throw new AppError(409, "ALREADY_CANCELLED", "This registration has already been cancelled");
    }
    const now = nowIso();
    const updated: RegistrationRecord = {
      ...registration,
      status: "cancelled",
      cancellation_reason_code: "unauthorized_registration",
      custom_answers_json: null,
      cancelled_at: now,
      updated_at: now,
    };
    const statements: StatementLike[] = [
      db
        .prepare(
          `UPDATE registrations
           SET status = 'cancelled', cancellation_reason_code = 'unauthorized_registration',
               cancelled_at = ?, custom_answers_json = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .bind(now, now, registration.id),
      prepareRemoveAllDayWaitlistStatement(db, {
        registrationId: registration.id,
        reasonCode: "registration_cancelled",
      }),
      prepareClearRegistrationEmailChangeStatement(db, registration.id, registration.user_id, now),
    ];
    const audit = prepareRegistrationUpdateAudit(db, registration, updated, payload);
    if (audit) statements.push(audit);
    return { registration: updated, statements, dayWaitlist: [] };
  }

  const [previousInPersonDayIds, previousConfirmedInPersonDayIds, configuredEventDays] = await Promise.all([
    listInPersonEventDayIdsForRegistration(db, registration.id),
    listConfirmedInPersonEventDayIdsForRegistration(db, registration.id),
    listEventDays(db, registration.event_id),
  ]);
  // Once an event has day-level attendance, that selection is the canonical
  // source of truth. A scalar-only update cannot safely infer whether omitted
  // days should be preserved, removed, or changed, so reject it rather than
  // leaving registration_day_attendance and its waitlist projection stale.
  if (
    payload.attendanceType !== undefined &&
    payload.dayAttendance === undefined &&
    (configuredEventDays.length > 0 || previousInPersonDayIds.length > 0)
  ) {
    throw new AppError(
      400,
      "DAY_ATTENDANCE_REQUIRED",
      "dayAttendance is required when updating attendance for an event with day-level attendance",
    );
  }
  const effectiveAttendanceType =
    payload.attendanceType ?? deriveEventAttendanceType(payload.dayAttendance) ?? registration.attendance_type;
  if (!effectiveAttendanceType) {
    throw new AppError(400, "ATTENDANCE_TYPE_REQUIRED", "attendanceType is required for update action");
  }
  const capacityExemptReason = await resolveCapacityExemptReason(db, {
    eventId: registration.event_id,
    userId: registration.user_id,
  });
  const forceWaitlistDayDates = new Set(payload.forceWaitlistDayDates ?? []);
  if (forceWaitlistDayDates.size > 0) {
    if (capacityExemptReason) {
      throw new AppError(
        409,
        "CAPACITY_EXEMPT_REGISTRATION",
        "A role-based capacity-exempt attendee cannot be placed on the waitlist",
      );
    }
    const selectionByDate = new Map(payload.dayAttendance?.map((entry) => [entry.dayDate, entry.attendanceType]));
    const dayByDate = new Map(configuredEventDays.map((day) => [day.day_date, day]));
    for (const dayDate of forceWaitlistDayDates) {
      const day = dayByDate.get(dayDate);
      if (selectionByDate.get(dayDate) !== "in_person") {
        throw new AppError(400, "WAITLIST_REQUIRES_IN_PERSON", `Day '${dayDate}' must be selected as in-person`);
      }
      if (!day?.in_person_capacity || day.in_person_capacity <= 0) {
        throw new AppError(409, "DAY_CAPACITY_UNLIMITED", `Day '${dayDate}' does not have a finite capacity`);
      }
    }
  }
  const hasPerDayAttendanceInput = Boolean(payload.dayAttendance?.length);
  const hasPerDayAttendanceContext = hasPerDayAttendanceInput || previousInPersonDayIds.length > 0;
  let newStatus = isCancelled ? "registered" : registration.status;
  // Profile and attendance edits must not double as email verification. The
  // confirmation capability is the only self-service transition out of this
  // state; explicit admin status changes use forceRegistrationStatus instead.
  if (registration.status !== "pending_email_confirmation") {
    if (hasPerDayAttendanceContext || capacityExemptReason) {
      newStatus = "registered";
    } else if (effectiveAttendanceType !== registration.attendance_type) {
      if (effectiveAttendanceType === "in_person" || registration.attendance_type === "in_person") {
        newStatus = "registered";
      }
    }
  }
  const now = nowIso();
  const statements: StatementLike[] = [
    db
      .prepare(
        `UPDATE registrations
         SET attendance_type = ?, status = ?, cancellation_reason_code = NULL,
             custom_answers_json = CASE WHEN ? = 1 THEN ? ELSE custom_answers_json END,
             source_ref = CASE WHEN ? = 1 THEN ? ELSE source_ref END,
             capacity_exempt_in_person = ?, capacity_exempt_reason = ?, cancelled_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        effectiveAttendanceType,
        newStatus,
        payload.customAnswersJson !== undefined ? 1 : 0,
        payload.customAnswersJson ?? null,
        payload.sourceRef !== undefined ? 1 : 0,
        payload.sourceRef ?? null,
        capacityExemptReason ? 1 : 0,
        capacityExemptReason,
        isCancelled ? null : registration.cancelled_at,
        now,
        registration.id,
      ),
  ];
  let plannedDayAttendance: BuiltRegistrationUpdate["dayAttendance"];
  let plannedDayWaitlist: BuiltRegistrationUpdate["dayWaitlist"];
  if (payload.dayAttendance) {
    const waitlist = await buildRegistrationDayWaitlistSync(db, {
      registrationId: registration.id,
      eventId: registration.event_id,
      userId: registration.user_id,
      selections: payload.dayAttendance,
      capacityExemptReason,
      preserveConfirmedEventDayIds: isCancelled ? [] : previousConfirmedInPersonDayIds,
      registrationStatus: newStatus,
      configuredEventDays,
      forceWaitlistDayDates: payload.forceWaitlistDayDates,
      claimOfferedDayDates: payload.claimDayWaitlistOffers,
    });
    statements.unshift(...waitlist.guardStatements);
    statements.push(
      ...(await prepareReplaceRegistrationDayAttendanceStatements(db, {
        registrationId: registration.id,
        eventId: registration.event_id,
        selections: payload.dayAttendance,
        changedBy,
        configuredEventDays,
      })),
      ...waitlist.statements,
    );
    const claimedInPersonDates = new Set(
      payload.dayAttendance
        .filter(
          (selection) =>
            selection.attendanceType === "in_person" && payload.claimDayWaitlistOffers?.includes(selection.dayDate),
        )
        .map((selection) => selection.dayDate),
    );
    plannedDayAttendance = payload.dayAttendance.map((selection) => ({
      dayDate: selection.dayDate,
      attendanceType: selection.attendanceType,
      label: configuredEventDays.find((day) => day.day_date === selection.dayDate)?.label ?? null,
    }));
    plannedDayWaitlist = waitlist.activeRows.map((row) =>
      row.status === "offered" && claimedInPersonDates.has(row.dayDate)
        ? { ...row, status: "accepted", offerExpiresAt: null }
        : row,
    );
  }
  const updated: RegistrationRecord = {
    ...registration,
    status: newStatus,
    attendance_type: effectiveAttendanceType,
    cancellation_reason_code: null,
    custom_answers_json:
      payload.customAnswersJson === undefined ? registration.custom_answers_json : payload.customAnswersJson,
    source_ref: payload.sourceRef === undefined ? registration.source_ref : payload.sourceRef,
    capacity_exempt_in_person: capacityExemptReason ? 1 : 0,
    capacity_exempt_reason: capacityExemptReason,
    cancelled_at: isCancelled ? null : registration.cancelled_at,
    updated_at: now,
  };
  if (payload.profilePatch) statements.push(prepareUserProfileStatement(db, updated.user_id, payload.profilePatch));
  const audit = prepareRegistrationUpdateAudit(db, registration, updated, payload);
  if (audit) statements.push(audit);
  return {
    registration: updated,
    statements,
    dayAttendance: plannedDayAttendance,
    dayWaitlist: plannedDayWaitlist,
  };
}
