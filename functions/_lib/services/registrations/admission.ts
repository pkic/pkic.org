import { all } from "../../db/queries";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import { dayNotConfiguredError } from "../event-day-refusals";
import type { DatabaseLike, D1StatementResult, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { configuredAttendanceOptions, listEventDays } from "../event-days";
import { buildRegistrationDayWaitlistSync, roleBasedCapacityExemptReason, withDayCapacityRetry } from "./day-waitlist";
import { ADMIN_DAY_CAPACITY_EXEMPT_REASON_CODE } from "./day-waitlist-policy";
import { getRegistrationById } from "./queries";
import { prepareRegistrationStatusEmail, type RegistrationStatusEmailParams } from "./status-notifications";
import type { RegistrationRecord } from "./types";
import {
  admissionRequiresActiveWaitlist,
  type RegistrationAdmissionMode,
} from "../../../../assets/shared/schemas/event-registration-detail";
import {
  isRegistrationTransitionConflict,
  prepareRegistrationTransitionGuard,
  registrationChangedError,
} from "./transition-guard";
import { outboxIdForOperation } from "../../email/outbox-queue";

interface ExistingAttendanceRow {
  event_day_id: string;
  attendance_type: string;
}

interface AdmissionPayload {
  registrationId: string;
  event: RegistrationStatusEmailParams["event"];
  dayDates?: string[];
  mode: RegistrationAdmissionMode;
  reason: string;
  actorUserId: string;
  appBaseUrl: string;
  commitBatch?: (statements: StatementLike[]) => Promise<D1StatementResult[]>;
  requireActiveWaitlist?: boolean;
}

interface BuiltAdmission {
  registration: RegistrationRecord;
  admittedDayDates: string[];
  statements: StatementLike[];
  outboxId: string | null;
}

/** The caller's own requirement, or the mode's: admitting off the waiting list needs a live entry. */
function requiresActiveWaitlist(payload: AdmissionPayload): boolean {
  return Boolean(payload.requireActiveWaitlist) || admissionRequiresActiveWaitlist(payload.mode);
}

async function buildAdmission(db: DatabaseLike, payload: AdmissionPayload): Promise<BuiltAdmission> {
  const [registration, eventDays] = await Promise.all([
    getRegistrationById(db, payload.registrationId),
    listEventDays(db, payload.event.id),
  ]);
  if (registration.event_id !== payload.event.id) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found for this event");
  }
  if (registration.status === "cancelled") {
    throw new AppError(409, "REGISTRATION_CANCELLED", "Cancelled registrations cannot be admitted");
  }

  const dayByDate = new Map(eventDays.map((day) => [day.day_date, day]));
  const admittedDayDates = payload.dayDates?.length
    ? Array.from(new Set(payload.dayDates))
    : eventDays.map((day) => day.day_date);
  for (const dayDate of admittedDayDates) {
    if (!dayByDate.has(dayDate)) {
      throw dayNotConfiguredError(dayDate);
    }
  }

  if (requiresActiveWaitlist(payload)) {
    const activeWaitlistRows = await all<{ day_date: string }>(
      db,
      `SELECT ed.day_date
         FROM event_day_waitlist_entries waitlist
         JOIN event_days ed ON ed.id = waitlist.event_day_id
        WHERE waitlist.registration_id = ?
          AND ed.event_id = ?
          AND (
            waitlist.status = 'waiting'
            OR (waitlist.status = 'offered'
                AND (waitlist.offer_expires_at IS NULL OR waitlist.offer_expires_at > ?))
          )`,
      [registration.id, payload.event.id, nowIso()],
    );
    const activeWaitlistDates = new Set(activeWaitlistRows.map((row) => row.day_date));
    const unavailableDay = admittedDayDates.find((dayDate) => !activeWaitlistDates.has(dayDate));
    if (unavailableDay) {
      throw new AppError(
        409,
        "REGISTRATION_DAY_NOT_WAITLISTED",
        `Day '${unavailableDay}' is not actively waitlisted for this registration`,
      );
    }
  }

  const existingRows = await all<ExistingAttendanceRow>(
    db,
    `SELECT rda.event_day_id, rda.attendance_type
     FROM registration_day_attendance rda
     JOIN event_days ed ON ed.id = rda.event_day_id
     WHERE rda.registration_id = ? AND ed.event_id = ?`,
    [registration.id, payload.event.id],
  );
  const existingAttendanceByDayId = new Map(existingRows.map((row) => [row.event_day_id, row.attendance_type]));
  if (
    requiresActiveWaitlist(payload) &&
    admittedDayDates.some((date) => !existingAttendanceByDayId.has(dayByDate.get(date)!.id))
  ) {
    throw new AppError(
      409,
      "REGISTRATION_DAY_NOT_WAITLISTED",
      "The selected attendance option is no longer available.",
    );
  }
  const attendanceByDayId = new Map(existingAttendanceByDayId);
  for (const dayDate of admittedDayDates) {
    const dayId = dayByDate.get(dayDate)!.id;
    if (!attendanceByDayId.has(dayId)) {
      const day = dayByDate.get(dayDate)!;
      if (
        !configuredAttendanceOptions(day).some((option) => option.value === "in_person" && option.enabled !== false)
      ) {
        throw new AppError(409, "REGISTRATION_ATTENDANCE_REQUIRED", "Choose an attendance option for this day first.");
      }
      attendanceByDayId.set(dayId, "in_person");
    }
  }
  const dayAttendanceChanged = admittedDayDates.some((date) => {
    const dayId = dayByDate.get(date)!.id;
    return existingAttendanceByDayId.get(dayId) !== attendanceByDayId.get(dayId);
  });
  const selections = eventDays
    .filter((day) => attendanceByDayId.has(day.id))
    .map((day) => ({ dayDate: day.day_date, attendanceType: attendanceByDayId.get(day.id)! }));

  const now = nowIso();
  const roleExemptReason = await roleBasedCapacityExemptReason(db, payload.event.id, registration.user_id);
  const updated: RegistrationRecord = {
    ...registration,
    updated_at: now,
  };
  const waitlist = await buildRegistrationDayWaitlistSync(db, {
    registrationId: registration.id,
    eventId: payload.event.id,
    userId: registration.user_id,
    selections,
    capacityExemptReason: roleExemptReason,
    registrationStatus: registration.status,
    configuredEventDays: eventDays,
  });
  // The canonical planner counts each selected option, including live offers,
  // and excludes this registration. Its revision guards fence the same write.
  if (payload.mode === "within_capacity") {
    const full = waitlist.decisions
      .filter(
        (decision) =>
          admittedDayDates.includes(decision.dayDate) &&
          decision.limit !== null &&
          decision.limit > 0 &&
          decision.seatsReservedBeforeDecision >= decision.limit,
      )
      .map((decision) => dayByDate.get(decision.dayDate)!.label || decision.dayDate);
    if (full.length)
      throw new AppError(409, "DAY_CAPACITY_FULL", `No place is free on ${full.join(", ")}.`, { days: full });
  }
  const statements: StatementLike[] = [
    prepareRegistrationTransitionGuard(db, registration),
    ...(requiresActiveWaitlist(payload)
      ? admittedDayDates.map((dayDate) =>
          prepareAuthorizationGuard(db, {
            sql: `SELECT 1
                    FROM event_day_waitlist_entries waitlist
                    JOIN event_days ed ON ed.id = waitlist.event_day_id
                   WHERE waitlist.registration_id = ?
                     AND ed.event_id = ?
                     AND ed.day_date = ?
                     AND (
                       waitlist.status = 'waiting'
                       OR (waitlist.status = 'offered'
                           AND (waitlist.offer_expires_at IS NULL
                                OR waitlist.offer_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')))
                     )`,
            bindings: [registration.id, payload.event.id, dayDate],
          }),
        )
      : []),
    ...waitlist.guardStatements,
    db
      .prepare(
        `UPDATE registrations
         SET updated_at = ?
         WHERE id = ? AND event_id = ?`,
      )
      .bind(now, registration.id, payload.event.id),
  ];
  const dayOverrideStatements: StatementLike[] = [];
  for (const dayDate of admittedDayDates) {
    const day = dayByDate.get(dayDate)!;
    const fromType = existingRows.find((row) => row.event_day_id === day.id)?.attendance_type ?? "not_attending";
    const toType = attendanceByDayId.get(day.id)!;
    statements.push(
      db
        .prepare(
          `INSERT INTO registration_day_attendance (
             id, registration_id, event_day_id, attendance_type, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(registration_id, event_day_id)
           DO UPDATE SET attendance_type = excluded.attendance_type, updated_at = excluded.updated_at`,
        )
        .bind(uuid(), registration.id, day.id, toType, now, now),
    );
    if (fromType !== toType) {
      statements.push(
        db
          .prepare(
            `INSERT INTO registration_attendance_history (
               id, registration_id, event_day_id, from_type, to_type, changed_by, changed_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(uuid(), registration.id, day.id, fromType, toType, payload.actorUserId, now),
      );
    }
    if (!roleExemptReason || requiresActiveWaitlist(payload)) {
      dayOverrideStatements.push(
        db
          .prepare(
            `INSERT INTO event_day_waitlist_entries (
               id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position,
               offer_expires_at, reason_code, reason_note, created_at, updated_at
             ) VALUES (
               ?, ?, ?, ?, ?, 'general', 'accepted',
               COALESCE((SELECT MAX(position) + 1 FROM event_day_waitlist_entries WHERE event_day_id = ?), 1),
               NULL, ?, ?, ?, ?
             )
             ON CONFLICT(event_day_id, registration_id)
             DO UPDATE SET status = 'accepted', offer_expires_at = NULL,
                           reason_code = excluded.reason_code, reason_note = excluded.reason_note,
                           updated_at = excluded.updated_at`,
          )
          .bind(
            uuid(),
            payload.event.id,
            day.id,
            registration.id,
            registration.user_id,
            day.id,
            payload.mode === "within_capacity" ? null : ADMIN_DAY_CAPACITY_EXEMPT_REASON_CODE,
            `${payload.mode}:${payload.reason}`,
            now,
            now,
          ),
      );
    }
  }
  statements.push(...waitlist.statements, ...dayOverrideStatements);
  const admittedDayDateSet = new Set(admittedDayDates);
  const waitlistAdmissionChanged = waitlist.activeRows.some(
    (row) => admittedDayDateSet.has(row.dayDate) && row.status !== "accepted",
  );
  const changed = dayAttendanceChanged || waitlist.changed || waitlistAdmissionChanged;
  if (!changed) return { registration, admittedDayDates, statements: [], outboxId: null };

  statements.push(
    prepareAuditLog(db, "admin", payload.actorUserId, "registration_admitted", "registration", registration.id, {
      mode: payload.mode,
      reason: payload.reason,
      admittedDayDates,
      capacityExemptReason:
        payload.mode === "within_capacity"
          ? null
          : (roleExemptReason ?? `day:${ADMIN_DAY_CAPACITY_EXEMPT_REASON_CODE}`),
      capacityDecisions: waitlist.decisions
        .filter((decision) => admittedDayDates.includes(decision.dayDate))
        .map((decision) => ({
          ...decision,
          outcome: "admitted",
          reason: roleExemptReason ?? `admin:${payload.mode}`,
        })),
    }),
  );
  const idempotencyKey =
    `registration-admit:${registration.id}:${registration.transition_revision + 1}:` +
    admittedDayDates.slice().sort().join(",");
  const email = await prepareRegistrationStatusEmail(db, {
    event: payload.event,
    registrationId: registration.id,
    registration: updated,
    appBaseUrl: payload.appBaseUrl,
    templateKey: "registration_updated",
    subject: `Registration updated — ${payload.event.name}`,
    noticeKind: "status_update",
    outboxId: await outboxIdForOperation(idempotencyKey),
    idempotencyKey,
    dayAttendance: eventDays
      .filter((day) => attendanceByDayId.has(day.id))
      .map((day) => ({
        dayDate: day.day_date,
        attendanceType: attendanceByDayId.get(day.id)!,
        label: day.label,
        optionLabel:
          configuredAttendanceOptions(day).find((option) => option.value === attendanceByDayId.get(day.id))?.label ??
          null,
      })),
    dayWaitlist: [],
  });
  statements.push(email.statement);
  return { registration: updated, admittedDayDates, statements, outboxId: email.outboxId };
}

export async function admitRegistration(
  db: DatabaseLike,
  payload: AdmissionPayload,
): Promise<{ registration: RegistrationRecord; admittedDayDates: string[]; outboxId: string | null }> {
  try {
    return await withDayCapacityRetry(async () => {
      const built = await buildAdmission(db, payload);
      if (built.statements.length) {
        if (payload.commitBatch) await payload.commitBatch(built.statements);
        else await db.batch(built.statements);
      }
      return {
        registration: built.registration,
        admittedDayDates: built.admittedDayDates,
        outboxId: built.outboxId,
      };
    });
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) throw registrationChangedError();
    if (requiresActiveWaitlist(payload) && isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "REGISTRATION_DAY_WAITLIST_CHANGED",
        "The selected day is no longer actively waitlisted. Reload and retry.",
      );
    }
    throw error;
  }
}
