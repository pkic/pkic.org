import type {
  EventRegistrationSelectedDayAdmitInput,
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
  type EventResourceManagementCapability,
} from "../event-series/management";
import { getEventRegistrationAttendanceDetail } from "./detail";
import { admitRegistration } from "./admission";
import { updateRegistrationDayAttendance } from "./day-attendance-management";

async function requireManagedEvent(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  capability: EventResourceManagementCapability = "manage_attendance",
) {
  const event = await getEventById(db, eventId);
  const context = await requireEventResourceManagementContext(db, actor, groupIdOrSlug, event.id, capability);
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

/**
 * Applies one explicitly selected admission mode and returns the minimal
 * manager projection. Waitlist admission requires manage_attendance; the
 * capacity-bypassing VIP override requires the stronger manage capability.
 */
export async function admitGroupManagedEventRegistration(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  registrationId: string,
  input: EventRegistrationSelectedDayAdmitInput,
  appBaseUrl: string,
): Promise<{
  registration: EventRegistrationAttendanceDetailResponse["registration"];
  admittedDayDates: string[];
  outboxId: string | null;
}> {
  const capability: EventResourceManagementCapability = input.mode === "vip" ? "manage" : "manage_attendance";
  const { event, context } = await requireManagedEvent(db, actor, groupIdOrSlug, eventId, capability);
  const admitted = await admitRegistration(db, {
    registrationId,
    event,
    dayDates: input.dayDates,
    mode: input.mode,
    reason: input.reason,
    actorUserId: actor.id,
    appBaseUrl,
    requireActiveWaitlist: input.mode === "capacity_exempt",
    commitBatch: (statements) => commitEventResourceManagementBatch(db, actor, context, capability, statements),
  });
  const detail = await getEventRegistrationAttendanceDetail(
    guardEventResourceManagementDatabase(db, actor, context, capability),
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
