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
  listConfirmedInPersonEventDayIdsForRegistration,
  listInPersonEventDayIdsForRegistration,
  prepareClaimOfferedDayWaitlistStatements,
  prepareRemoveAllDayWaitlistStatement,
  resolveCapacityExemptReason,
  type DayWaitlistLane,
} from "./day-waitlist";
import { prepareUpsertAttendeeParticipantStatement } from "./participant-registration";
import type { RegistrationRecord } from "./types";

export interface RegistrationUpdatePayload {
  action: "update" | "cancel" | "report_unauthorized";
  attendanceType?: "in_person" | "virtual" | "on_demand";
  dayAttendance?: DayAttendanceSelection[];
  customAnswersJson?: string | null;
  sourceRef?: string | null;
  waitlistClaimWindowHours: number;
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
      prepareUpsertAttendeeParticipantStatement(db, cancelled),
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
      prepareUpsertAttendeeParticipantStatement(db, updated),
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
  const effectiveAttendanceType =
    payload.attendanceType ?? deriveEventAttendanceType(payload.dayAttendance) ?? registration.attendance_type;
  if (!effectiveAttendanceType) {
    throw new AppError(400, "ATTENDANCE_TYPE_REQUIRED", "attendanceType is required for update action");
  }
  const capacityExemptReason = await resolveCapacityExemptReason(db, {
    registrationId: registration.id,
    eventId: registration.event_id,
    userId: registration.user_id,
  });
  const hasPerDayAttendanceInput = Boolean(payload.dayAttendance?.length);
  const hasPerDayAttendanceContext = hasPerDayAttendanceInput || previousInPersonDayIds.length > 0;
  let newStatus = isCancelled ? "registered" : registration.status;
  if (hasPerDayAttendanceContext || capacityExemptReason) {
    newStatus = "registered";
  } else if (effectiveAttendanceType !== registration.attendance_type) {
    if (effectiveAttendanceType === "in_person" || registration.attendance_type === "in_person") {
      newStatus = "registered";
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
      ...(await prepareClaimOfferedDayWaitlistStatements(db, {
        registrationId: registration.id,
        eventId: registration.event_id,
        selections: payload.dayAttendance,
        configuredEventDays,
      })),
    );
    const selectedInPersonDates = new Set(
      payload.dayAttendance
        .filter((selection) => selection.attendanceType === "in_person")
        .map((selection) => selection.dayDate),
    );
    plannedDayAttendance = payload.dayAttendance.map((selection) => ({
      dayDate: selection.dayDate,
      attendanceType: selection.attendanceType,
      label: configuredEventDays.find((day) => day.day_date === selection.dayDate)?.label ?? null,
    }));
    plannedDayWaitlist = waitlist.activeRows.map((row) =>
      row.status === "offered" && selectedInPersonDates.has(row.dayDate)
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
  statements.push(prepareUpsertAttendeeParticipantStatement(db, updated));
  const audit = prepareRegistrationUpdateAudit(db, registration, updated, payload);
  if (audit) statements.push(audit);
  return {
    registration: updated,
    statements,
    dayAttendance: plannedDayAttendance,
    dayWaitlist: plannedDayWaitlist,
  };
}
