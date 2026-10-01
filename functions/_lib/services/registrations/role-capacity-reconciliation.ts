import { prepareAuditLog } from "../audit";
import { prepareProposalAdmission } from "./proposal-admission";
import { nowIso } from "../../utils/time";
import { first } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { getRegistrationDayAttendance, listEventDays } from "../event-days";
import { buildRegistrationDayWaitlistSync } from "./day-waitlist-plan";
import {
  roleBasedCapacityExemptReason,
  roleBasedCapacityExemptReasonAfterParticipantChange,
  type EventDayCapacityGuardPlan,
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
    ensureRegistration?: boolean;
    eventId: string;
    userId: string;
    activeProposalRoles: readonly import("../../../../assets/shared/schemas/participant-roles").EventParticipantRole[];
    sharedCapacityGuards?: EventDayCapacityGuardPlan;
  },
): Promise<StatementLike[]> {
  const registration = await first<RegistrationRecord>(
    db,
    `SELECT ${registrationColumns("r")}
     FROM registrations r
     WHERE r.event_id = ? AND r.user_id = ?
     ORDER BY CASE r.status WHEN 'registered' THEN 1 ELSE 2 END, r.updated_at DESC
     LIMIT 1`,
    [input.eventId, input.userId],
  );
  if (!registration || registration.status === "cancelled") {
    return input.ensureRegistration
      ? prepareProposalAdmission(db, { ...input, previousRegistration: registration ?? undefined })
      : [];
  }
  const confirm = input.ensureRegistration && registration.status === "pending_email_confirmation";

  const [previousReason, capacityExemptReason] = await Promise.all([
    roleBasedCapacityExemptReason(db, input.eventId, input.userId),
    roleBasedCapacityExemptReasonAfterParticipantChange(db, input),
  ]);
  if (previousReason === capacityExemptReason && !confirm) return [];

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
    registrationStatus: confirm ? "registered" : registration.status,
    configuredEventDays: eventDays,
    sharedCapacityGuards: input.sharedCapacityGuards,
    auditActor: { type: "system", id: null },
  });
  const now = nowIso();
  return [
    prepareRegistrationTransitionGuard(db, registration),
    ...waitlist.guardStatements,
    ...(confirm
      ? [
          db
            .prepare(
              `UPDATE registrations SET status = 'registered', confirmed_at = ?, updated_at = ?,
      confirmation_link_secret = NULL, pending_confirmation_deadline_at = NULL, created_identity_user_id = NULL
      WHERE id = ?`,
            )
            .bind(now, now, registration.id),
          prepareAuditLog(
            db,
            "system",
            null,
            "speaker_registration_confirmed",
            "registration",
            registration.id,
            { status: { from: registration.status, to: "registered" } },
            now,
          ),
        ]
      : []),
    ...waitlist.statements,
  ];
}
