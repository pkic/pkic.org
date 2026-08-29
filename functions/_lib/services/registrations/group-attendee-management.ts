import type {
  EventRegistrationCapacityAdmitInput,
  EventRegistrationAttendanceDetailResponse,
  EventRegistrationDayAttendanceChange,
} from "../../../../assets/shared/schemas/event-registration-detail";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { getEventById } from "../events";
import {
  guardEventResourceManagementDatabase,
  commitEventResourceManagementBatch,
  requireEventResourceManagementContext,
} from "../event-series/management";
import { getEventRegistrationAttendanceDetail } from "./detail";
import { admitRegistration } from "./admission";
import { updateRegistrationDayAttendance } from "./day-attendance-management";

async function requireManagedEvent(db: DatabaseLike, actor: AuthAdmin, groupIdOrSlug: string, eventId: string) {
  const event = await getEventById(db, eventId);
  const context = await requireEventResourceManagementContext(db, actor, groupIdOrSlug, event.id, "manage_attendance");
  return { event, context };
}

/** Returns the least-privilege attendee projection for a group manager. */
export async function getGroupManagedEventRegistration(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  registrationId: string,
): Promise<EventRegistrationAttendanceDetailResponse> {
  const { event, context } = await requireManagedEvent(db, actor, groupIdOrSlug, eventId);
  const detail = await getEventRegistrationAttendanceDetail(
    guardEventResourceManagementDatabase(db, actor, context, "manage_attendance"),
    event.id,
    registrationId,
  );
  if (!detail) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found for this event");
  return detail;
}

/** Updates per-day attendance through the canonical registration transition. */
export async function updateGroupManagedEventRegistrationDayAttendance(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  registrationId: string,
  change: EventRegistrationDayAttendanceChange,
  appBaseUrl: string,
): Promise<{ outboxId: string | null }> {
  const { event, context } = await requireManagedEvent(db, actor, groupIdOrSlug, eventId);
  return updateRegistrationDayAttendance(db, {
    event,
    registrationId,
    change,
    appBaseUrl,
    actorUserId: actor.id,
    commitBatch: (statements) =>
      commitEventResourceManagementBatch(db, actor, context, "manage_attendance", statements),
  });
}

/** Admits only the requested days and returns the minimal manager projection. */
export async function admitGroupManagedEventRegistration(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  registrationId: string,
  input: EventRegistrationCapacityAdmitInput,
  appBaseUrl: string,
): Promise<{
  registration: EventRegistrationAttendanceDetailResponse["registration"];
  admittedDayDates: string[];
  outboxId: string | null;
}> {
  const { event, context } = await requireManagedEvent(db, actor, groupIdOrSlug, eventId);
  const admitted = await admitRegistration(db, {
    registrationId,
    event,
    dayDates: input.dayDates,
    mode: input.mode,
    reason: input.reason,
    actorUserId: actor.id,
    appBaseUrl,
    requireActiveWaitlist: true,
    commitBatch: (statements) =>
      commitEventResourceManagementBatch(db, actor, context, "manage_attendance", statements),
  });
  const detail = await getEventRegistrationAttendanceDetail(
    guardEventResourceManagementDatabase(db, actor, context, "manage_attendance"),
    event.id,
    registrationId,
  );
  if (!detail) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found for this event");
  return {
    registration: detail.registration,
    admittedDayDates: admitted.admittedDayDates,
    outboxId: admitted.outboxId,
  };
}
