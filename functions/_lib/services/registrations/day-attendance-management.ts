import type { EventRegistrationDayAttendanceChange } from "../../../../assets/shared/schemas/event-registration-detail";
import { AppError } from "../../errors";
import type { DatabaseLike, D1StatementResult, StatementLike } from "../../types";
import { deriveEventAttendanceType, getRegistrationDayAttendance, listEventDays } from "../event-days";
import type { EventRecord } from "../events";
import { getRegistrationByIdForEvent } from "./queries";
import { updateRegistrationByIdWithNotification } from "./update";

export async function updateRegistrationDayAttendance(
  db: DatabaseLike,
  input: {
    event: EventRecord;
    registrationId: string;
    change: EventRegistrationDayAttendanceChange;
    appBaseUrl: string;
    actorUserId: string;
    commitBatch?: (statements: StatementLike[]) => Promise<D1StatementResult[]>;
  },
): Promise<{ outboxId: string | null }> {
  const event = input.event;
  // Keep this aggregate snapshot from before the day-roster read and pass it
  // through to the transition guard below. If another manager changes any day
  // after this point, that update advances transition_revision and this stale
  // plan fails with REGISTRATION_CHANGED instead of replacing their roster.
  const registration = await getRegistrationByIdForEvent(db, event.id, input.registrationId);
  if (registration.status === "cancelled") {
    throw new AppError(
      409,
      "REGISTRATION_CANCELLED",
      "Cancelled registrations cannot be changed through attendance management",
    );
  }

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
    else next.set(dayDate, input.change.action === "waitlist" ? "in_person" : input.change.action);
  }
  const dayAttendance = eventDays
    .filter((day) => next.has(day.day_date))
    .map((day) => ({
      dayDate: day.day_date,
      attendanceType: next.get(day.day_date)!,
      label: day.label,
    }));
  const result = await updateRegistrationByIdWithNotification(
    db,
    {
      eventId: event.id,
      registrationId: registration.id,
      action: "update",
      attendanceType: deriveEventAttendanceType(dayAttendance) ?? registration.attendance_type,
      dayAttendance,
      forceWaitlistDayDates: input.change.action === "waitlist" ? input.change.dayDates : undefined,
      auditActor: { type: "admin", id: input.actorUserId, action: "registration_day_attendance_updated" },
      notification: {
        event,
        appBaseUrl: input.appBaseUrl,
        templateKey: "registration_updated",
        subject: `Registration updated for ${event.name}`,
      },
    },
    input.actorUserId,
    registration,
    input.commitBatch,
  );
  return { outboxId: result.outboxId };
}
