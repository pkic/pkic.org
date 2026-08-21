import type { AdminManageDayAttendanceInput } from "../../../../assets/shared/schemas/admin-events";
import { requirePermission } from "../../auth/permissions";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { prepareAuditLog } from "../audit";
import {
  getRegistrationDayAttendance,
  listEventDays,
  prepareReplaceRegistrationDayAttendanceStatements,
} from "../event-days";
import { getEventBySlug } from "../events";
import { prepareRegistrationStatusEmail } from "./status-notifications";

export async function updateAdminRegistrationDayAttendance(
  db: DatabaseLike,
  actor: AuthAdmin,
  input: {
    eventSlug: string;
    registrationId: string;
    change: AdminManageDayAttendanceInput;
    appBaseUrl: string;
  },
): Promise<{ outboxId: string | null }> {
  const event = await getEventBySlug(db, input.eventSlug);
  requirePermission(actor, "events:manage", { type: "event", id: event.id });
  const registration = await first<{ id: string }>(db, "SELECT id FROM registrations WHERE id = ? AND event_id = ?", [
    input.registrationId,
    event.id,
  ]);
  if (!registration) throw new AppError(404, "NOT_FOUND", "Registration not found for this event");

  const [eventDays, current] = await Promise.all([
    listEventDays(db, event.id),
    getRegistrationDayAttendance(db, registration.id),
  ]);
  const configuredDates = new Set(eventDays.map((day) => day.day_date));
  for (const dayDate of input.change.dayDates) {
    if (!configuredDates.has(dayDate)) {
      throw new AppError(400, "DAY_NOT_CONFIGURED", `Day '${dayDate}' is not configured for this event`);
    }
  }
  const next = new Map(current.map((entry) => [entry.dayDate, entry.attendanceType]));
  for (const dayDate of input.change.dayDates) {
    if (input.change.action === "remove") next.delete(dayDate);
    else next.set(dayDate, input.change.action);
  }
  const dayAttendance = eventDays
    .filter((day) => next.has(day.day_date))
    .map((day) => ({
      dayDate: day.day_date,
      attendanceType: next.get(day.day_date)!,
      label: day.label,
    }));
  const statements = await prepareReplaceRegistrationDayAttendanceStatements(db, {
    registrationId: registration.id,
    eventId: event.id,
    selections: dayAttendance,
    changedBy: actor.id,
    configuredEventDays: eventDays,
  });
  statements.push(
    prepareAuditLog(
      db,
      "admin",
      actor.id,
      "registration_day_attendance_updated",
      "registration",
      registration.id,
      input.change,
    ),
  );
  let outboxId: string | null = null;
  if (input.change.action !== "remove") {
    const preparedEmail = await prepareRegistrationStatusEmail(db, {
      event,
      registrationId: registration.id,
      appBaseUrl: input.appBaseUrl,
      templateKey: "registration_updated",
      subject: `Registration updated for ${event.name}`,
      dayAttendance,
    });
    statements.push(preparedEmail.statement);
    outboxId = preparedEmail.outboxId;
  }
  await db.batch(statements);
  return { outboxId };
}
