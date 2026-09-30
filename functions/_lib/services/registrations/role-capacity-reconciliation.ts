import { first } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { getRegistrationDayAttendance, listEventDays } from "../event-days";
import { buildRegistrationDayWaitlistSync } from "./day-waitlist-plan";
import {
  roleBasedCapacityExemptReason,
  roleBasedCapacityExemptReasonAfterParticipantChange,
} from "./day-waitlist-capacity";
import { registrationColumns, type RegistrationRecord } from "./types";
import { prepareRegistrationTransitionGuard } from "./transition-guard";

/**
 * Reconciles day admission with the intended post-transition participant roles.
 * The roles are authoritative; no copy is stored on the registration.
 */
export async function prepareRoleCapacityReconciliationStatements(
  db: DatabaseLike,
  input: {
    eventId: string;
    userId: string;
    activeProposalRoles: readonly import("../../../../assets/shared/schemas/participant-roles").EventParticipantRole[];
  },
): Promise<StatementLike[]> {
  const registration = await first<RegistrationRecord>(
    db,
    `SELECT ${registrationColumns("r")}
     FROM registrations r
     WHERE r.event_id = ? AND r.user_id = ? AND r.status IN ('pending_email_confirmation', 'registered')
     ORDER BY CASE r.status WHEN 'registered' THEN 1 ELSE 2 END, r.updated_at DESC
     LIMIT 1`,
    [input.eventId, input.userId],
  );
  if (!registration) return [];

  const [previousReason, capacityExemptReason] = await Promise.all([
    roleBasedCapacityExemptReason(db, input.eventId, input.userId),
    roleBasedCapacityExemptReasonAfterParticipantChange(db, input),
  ]);
  if (previousReason === capacityExemptReason) return [];

  const [dayAttendance, eventDays] = await Promise.all([
    getRegistrationDayAttendance(db, registration.id),
    listEventDays(db, input.eventId),
  ]);
  const waitlist = await buildRegistrationDayWaitlistSync(db, {
    registrationId: registration.id,
    eventId: input.eventId,
    userId: input.userId,
    selections: dayAttendance,
    capacityExemptReason,
    preserveConfirmedEventDayIds: [],
    reArbitrateExistingCapacityRows: !capacityExemptReason,
    registrationStatus: registration.status,
    configuredEventDays: eventDays,
    auditActor: { type: "system", id: null },
  });
  return [prepareRegistrationTransitionGuard(db, registration), ...waitlist.guardStatements, ...waitlist.statements];
}
