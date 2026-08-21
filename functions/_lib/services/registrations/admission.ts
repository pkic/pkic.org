import { all } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { listEventDays } from "../event-days";
import { buildRegistrationDayWaitlistSync, isEventDayCapacityConflict } from "./day-waitlist";
import { getRegistrationById } from "./queries";
import { prepareRegistrationStatusEmail, type RegistrationStatusEmailParams } from "./status-notifications";
import type { RegistrationRecord } from "./types";

interface ExistingAttendanceRow {
  event_day_id: string;
  attendance_type: string;
}

interface AdmissionPayload {
  registrationId: string;
  event: RegistrationStatusEmailParams["event"];
  dayDates?: string[];
  mode: string;
  reason: string;
  actorUserId: string;
  appBaseUrl: string;
}

interface BuiltAdmission {
  registration: RegistrationRecord;
  admittedDayDates: string[];
  statements: StatementLike[];
  outboxId: string;
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
      throw new AppError(400, "DAY_NOT_CONFIGURED", `Day '${dayDate}' is not configured for this event`);
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
  const attendanceByDayId = new Map(existingRows.map((row) => [row.event_day_id, row.attendance_type]));
  for (const dayDate of admittedDayDates) {
    attendanceByDayId.set(dayByDate.get(dayDate)!.id, "in_person");
  }
  const selections = eventDays
    .filter((day) => attendanceByDayId.has(day.id))
    .map((day) => ({ dayDate: day.day_date, attendanceType: attendanceByDayId.get(day.id)! }));

  const now = nowIso();
  const capacityExemptReason = `${payload.mode}:${payload.reason}`;
  const updated: RegistrationRecord = {
    ...registration,
    capacity_exempt_in_person: 1,
    capacity_exempt_reason: capacityExemptReason,
    updated_at: now,
  };
  const waitlist = await buildRegistrationDayWaitlistSync(db, {
    registrationId: registration.id,
    eventId: payload.event.id,
    userId: registration.user_id,
    selections,
    capacityExemptReason,
    registrationStatus: registration.status,
    configuredEventDays: eventDays,
  });
  const statements: StatementLike[] = [
    ...waitlist.guardStatements,
    db
      .prepare(
        `UPDATE registrations
         SET capacity_exempt_in_person = 1, capacity_exempt_reason = ?, updated_at = ?
         WHERE id = ? AND event_id = ?`,
      )
      .bind(capacityExemptReason, now, registration.id, payload.event.id),
  ];
  for (const dayDate of admittedDayDates) {
    const day = dayByDate.get(dayDate)!;
    const fromType = existingRows.find((row) => row.event_day_id === day.id)?.attendance_type ?? "not_attending";
    statements.push(
      db
        .prepare(
          `INSERT INTO registration_day_attendance (
             id, registration_id, event_day_id, attendance_type, created_at, updated_at
           ) VALUES (?, ?, ?, 'in_person', ?, ?)
           ON CONFLICT(registration_id, event_day_id)
           DO UPDATE SET attendance_type = 'in_person', updated_at = excluded.updated_at`,
        )
        .bind(uuid(), registration.id, day.id, now, now),
    );
    if (fromType !== "in_person") {
      statements.push(
        db
          .prepare(
            `INSERT INTO registration_attendance_history (
               id, registration_id, event_day_id, from_type, to_type, changed_by, changed_at
             ) VALUES (?, ?, ?, ?, 'in_person', ?, ?)`,
          )
          .bind(uuid(), registration.id, day.id, fromType, payload.actorUserId, now),
      );
    }
  }
  statements.push(
    ...waitlist.statements,
    prepareAuditLog(db, "admin", payload.actorUserId, "registration_admitted", "registration", registration.id, {
      mode: payload.mode,
      reason: payload.reason,
      admittedDayDates,
      capacityExemptReason,
    }),
  );
  const email = await prepareRegistrationStatusEmail(db, {
    event: payload.event,
    registrationId: registration.id,
    registration: updated,
    appBaseUrl: payload.appBaseUrl,
    templateKey: "registration_updated",
    subject: `In-person registration accepted — ${payload.event.name}`,
    noticeKind: "admin_admit",
    dayAttendance: eventDays
      .filter((day) => attendanceByDayId.has(day.id))
      .map((day) => ({
        dayDate: day.day_date,
        attendanceType: attendanceByDayId.get(day.id)!,
        label: day.label,
      })),
    dayWaitlist: [],
  });
  statements.push(email.statement);
  return { registration: updated, admittedDayDates, statements, outboxId: email.outboxId };
}

export async function admitRegistration(
  db: DatabaseLike,
  payload: AdmissionPayload,
): Promise<{ registration: RegistrationRecord; admittedDayDates: string[]; outboxId: string }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const built = await buildAdmission(db, payload);
    try {
      await db.batch(built.statements);
      return {
        registration: built.registration,
        admittedDayDates: built.admittedDayDates,
        outboxId: built.outboxId,
      };
    } catch (error) {
      if (!isEventDayCapacityConflict(error) || attempt === 2) throw error;
    }
  }
  throw new AppError(409, "DAY_CAPACITY_CHANGED", "Day capacity changed; please retry");
}
