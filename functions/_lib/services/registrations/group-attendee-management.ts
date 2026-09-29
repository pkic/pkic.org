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
import { updateRegistrationByIdWithNotification } from "./update";

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
 * Cancels a registration as a whole (#113). The event manage capability,
 * since ending somebody's place is stronger than moving their days; the
 * canonical registration transition releases the days, drops the waitlist
 * rows and queues the attendee's notice.
 */
export async function cancelGroupManagedEventRegistration(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  registrationId: string,
  appBaseUrl: string,
): Promise<{ registration: EventRegistrationAttendanceDetailResponse; outboxId: string | null }> {
  const { event, context } = await requireManagedEvent(db, actor, groupIdOrSlug, eventId);
  const result = await updateRegistrationByIdWithNotification(
    db,
    {
      eventId: event.id,
      registrationId,
      action: "cancel",
      auditActor: { type: "admin", id: actor.id, action: "registration_cancelled_by_manager" },
      notification: {
        event,
        appBaseUrl,
        templateKey: "registration_updated",
        subject: `Registration cancelled for ${event.name}`,
      },
    },
    actor.id,
    undefined,
    (statements) => commitEventResourceManagementBatch(db, actor, context, "manage", statements),
  );
  const registration = await getEventRegistrationAttendanceDetail(db, event.id, result.registration.id);
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found for this event");
  return { registration, outboxId: result.outboxId };
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
