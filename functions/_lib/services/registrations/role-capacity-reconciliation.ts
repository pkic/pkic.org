import { first } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { getRegistrationDayAttendance, listEventDays } from "../event-days";
import { buildRegistrationDayWaitlistSync, prepareRemoveAllDayWaitlistStatement } from "./day-waitlist-plan";
import { roleBasedCapacityExemptReasonAfterParticipantChange } from "./day-waitlist-capacity";
import { registrationColumns, type RegistrationRecord } from "./types";
import { nowIso } from "../../utils/time";
import { prepareRegistrationTransitionGuard } from "./transition-guard";

/**
 * Reconciles an attendee's registration capacity exemption with the intended
 * post-transition proposal participant state. If an exemption is revoked,
 * the existing per-day selections are re-arbitrated in the same D1 batch.
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

  const capacityExemptReason = await roleBasedCapacityExemptReasonAfterParticipantChange(db, input);
  const nextCapacityExempt = capacityExemptReason ? 1 : 0;
  if (
    registration.capacity_exempt_in_person === nextCapacityExempt &&
    registration.capacity_exempt_reason === capacityExemptReason
  ) {
    return [];
  }

  const now = nowIso();
  const updateRegistrationCapacityStatement = db
    .prepare(
      `UPDATE registrations
       SET capacity_exempt_in_person = ?, capacity_exempt_reason = ?, updated_at = ?
       WHERE id = ? AND event_id = ?`,
    )
    .bind(nextCapacityExempt, capacityExemptReason, now, registration.id, input.eventId);
  const statements: StatementLike[] = [prepareRegistrationTransitionGuard(db, registration)];

  if (capacityExemptReason) {
    statements.push(
      updateRegistrationCapacityStatement,
      prepareRemoveAllDayWaitlistStatement(db, {
        registrationId: registration.id,
        reasonCode: "capacity_exempt",
        reasonNote: capacityExemptReason,
      }),
    );
    return statements;
  }

  const [dayAttendance, eventDays] = await Promise.all([
    getRegistrationDayAttendance(db, registration.id),
    listEventDays(db, input.eventId),
  ]);
  const waitlist = await buildRegistrationDayWaitlistSync(db, {
    registrationId: registration.id,
    eventId: input.eventId,
    userId: input.userId,
    selections: dayAttendance,
    capacityExemptReason: null,
    preserveConfirmedEventDayIds: [],
    reArbitrateExistingCapacityRows: true,
    registrationStatus: registration.status,
    configuredEventDays: eventDays,
  });
  statements.push(...waitlist.guardStatements, updateRegistrationCapacityStatement, ...waitlist.statements);
  return statements;
}
