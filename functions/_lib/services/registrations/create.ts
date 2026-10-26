import type { EventDayCapacityGuardPlan } from "./day-waitlist-capacity";
import { assertRegistrationRestorationAllowed } from "./restoration";
import type { EventParticipantRole } from "../../../../assets/shared/schemas/participant-roles";
import { prepareRoleBasedCapacityExemption } from "./day-waitlist-capacity";
import { prepareRegistrationTransitionGuard } from "./transition-guard";
import { AppError } from "../../errors";
import { batchFirst, batchRows } from "../../db/pagination";
import { prepareRegistrationBySelection } from "./queries";
import { prepareRegistrationDayWaitlistRead } from "./day-waitlist-read";
import { planRegistrationDayWaitlistSync } from "./day-waitlist-plan";
import { uuid } from "../../utils/ids";
import { nowIso, addHours } from "../../utils/time";
import { prepareReferralByCode, planReferralConversionStatements, type ReferralRow } from "../referrals";
import { prepareEngagementStatement } from "../engagement";
import {
  deriveEventAttendanceType,
  prepareEventDays,
  preparePreviousRegistrationDayAttendance,
  planRegistrationDayAttendanceChange,
  type EventDayRecord,
  type PreviousRegistrationDayAttendanceRow,
  type DayAttendanceSelection,
} from "../event-days";
import { withDayCapacityRetry, type PlannedDayWaitlistEntry } from "./day-waitlist";
import { newCapabilityLinkSecret, signedOrQueuedCapability } from "../capability-links";
import type { DatabaseLike, StatementLike } from "../../types";
import type { RegistrationRecord, VerifiedRegistrationIdentityContext } from "./types";
import type { AttendanceType } from "../../../../assets/shared/schemas/registration";

const DEFAULT_PENDING_CONFIRMATION_DEADLINE_HOURS = 14 * 24;

export interface CreateRegistrationPayload {
  /** Trusted role projection for an acceptance in the same atomic batch. */
  acceptedProposalRoles?: readonly EventParticipantRole[];
  sharedCapacityGuards?: EventDayCapacityGuardPlan;
  event: { id: string };
  userId: string;
  attendanceType: AttendanceType;
  dayAttendance?: DayAttendanceSelection[];
  sourceType: string;
  sourceRef?: string | null;
  customAnswersJson?: string | null;
  formPlacementId?: string | null;
  inviteId?: string | null;
  referredByCode?: string | null;
  pendingConfirmationDeadlineHours?: number;
  confirmationTtlHours?: number;
  signingSecret?: string;
  /** True only when this registration transaction creates the user identity. */
  unverifiedEmailCorrectionAllowed?: boolean;
  verifiedIdentity?: VerifiedRegistrationIdentityContext;
  /** The registrant opened the verification link for this address: no confirmation email follows. */
  mailboxVerified?: boolean;
}

function initialRegistrationStatus(
  inviteId: string | null,
  admissionConfirmed: boolean,
): "pending_email_confirmation" | "registered" {
  if (!inviteId && !admissionConfirmed) {
    return "pending_email_confirmation";
  }
  return "registered";
}

export async function createRegistration(
  db: DatabaseLike,
  payload: CreateRegistrationPayload,
): Promise<{
  registration: RegistrationRecord;
  manageToken: string;
  confirmationToken: string | null;
  reactivated: boolean;
}> {
  return withDayCapacityRetry(async () => {
    const built = await buildCreateRegistration(db, payload);
    await db.batch(built.statements);
    return {
      registration: built.registration,
      manageToken: built.manageToken,
      confirmationToken: built.confirmationToken,
      reactivated: built.reactivated,
    };
  });
}

export async function buildCreateRegistration(
  db: DatabaseLike,
  payload: CreateRegistrationPayload,
): Promise<{
  registration: RegistrationRecord;
  manageToken: string;
  confirmationToken: string | null;
  reactivated: boolean;
  statements: StatementLike[];
  plannedDayWaitlist: PlannedDayWaitlistEntry[];
  dayAttendance: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
}> {
  const status = initialRegistrationStatus(
    payload.inviteId ?? null,
    Boolean(payload.verifiedIdentity || payload.mailboxVerified || payload.acceptedProposalRoles?.length),
  );
  const selection = { eventId: payload.event.id, userId: payload.userId };
  const roles = prepareRoleBasedCapacityExemption(db, {
    ...selection,
    activeProposalRoles: payload.acceptedProposalRoles,
  });
  const capacity = prepareRegistrationDayWaitlistRead(db, {
    eventId: payload.event.id,
    registration: selection,
    registrationStatus: status,
  });
  const [existingResult, rolesResult, daysResult, ...details] = await db.batch([
    prepareRegistrationBySelection(db, selection),
    roles.statement,
    prepareEventDays(db, payload.event.id),
    ...capacity.statements,
    preparePreviousRegistrationDayAttendance(db, selection),
    ...(payload.referredByCode ? [prepareReferralByCode(db, payload.referredByCode)] : []),
  ]);
  const existing = batchFirst<RegistrationRecord>(existingResult);
  const configuredEventDays = batchRows<EventDayRecord>(daysResult);
  const capacitySnapshot = capacity.decode(details.slice(0, capacity.statements.length));
  const previousAttendance = batchRows<PreviousRegistrationDayAttendanceRow>(details[capacity.statements.length]);
  if (existing) {
    if (payload.acceptedProposalRoles) assertRegistrationRestorationAllowed(existing);
    if (
      existing.status !== "cancelled" &&
      !(payload.mailboxVerified && existing.status === "pending_email_confirmation")
    ) {
      throw new AppError(409, "REGISTRATION_EXISTS", "This user is already registered for the event");
    }
  }
  const now = nowIso();
  const registrationId = existing?.id ?? uuid();
  const manageLinkSecret = newCapabilityLinkSecret();
  const attendanceType = deriveEventAttendanceType(payload.dayAttendance) ?? payload.attendanceType;
  const capacityExemptReason = roles.decode(batchRows<{ role: string }>(rolesResult));
  let confirmationLinkSecret: string | null = null;
  let pendingConfirmationDeadlineAt: string | null = null;
  if (status === "pending_email_confirmation") {
    confirmationLinkSecret = newCapabilityLinkSecret();
    pendingConfirmationDeadlineAt = addHours(
      now,
      payload.pendingConfirmationDeadlineHours ??
        payload.confirmationTtlHours ??
        DEFAULT_PENDING_CONFIRMATION_DEADLINE_HOURS,
    );
  }
  const registration: RegistrationRecord = {
    id: registrationId,
    event_id: payload.event.id,
    user_id: payload.userId,
    invite_id: payload.inviteId ?? null,
    status,
    attendance_type: attendanceType,
    source_type: payload.sourceType,
    source_ref: payload.sourceRef ?? null,
    custom_answers_json: payload.customAnswersJson ?? null,
    form_placement_id: payload.formPlacementId ?? null,
    registration_group_id:
      payload.verifiedIdentity?.registrationGroupId ??
      (payload.acceptedProposalRoles ? existing?.registration_group_id : null) ??
      null,
    registration_identity_id:
      payload.verifiedIdentity?.selectedIdentity?.id ??
      (payload.acceptedProposalRoles ? existing?.registration_identity_id : null) ??
      null,
    referred_by_code:
      payload.referredByCode ?? (payload.acceptedProposalRoles ? existing?.referred_by_code : null) ?? null,
    confirmation_link_secret: confirmationLinkSecret,
    pending_confirmation_deadline_at: pendingConfirmationDeadlineAt,
    manage_link_secret: manageLinkSecret,
    cancellation_reason_code: null,
    transition_revision: existing?.transition_revision ?? 0,
    created_identity_user_id:
      !existing && status === "pending_email_confirmation" && payload.unverifiedEmailCorrectionAllowed
        ? payload.userId
        : null,
    confirmed_at: status === "registered" ? now : null,
    cancelled_at: null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  const statements: StatementLike[] = [];
  if (existing) {
    statements.push(
      prepareRegistrationTransitionGuard(db, existing),
      db
        .prepare(
          `UPDATE registrations
       SET invite_id = ?, status = ?, attendance_type = ?, source_type = ?, source_ref = ?,
           custom_answers_json = ?, form_placement_id = ?, registration_group_id = ?, registration_identity_id = ?, referred_by_code = ?, confirmation_link_secret = ?,
           pending_confirmation_deadline_at = ?,
           manage_link_secret = ?,
           cancellation_reason_code = NULL, created_identity_user_id = NULL,
           confirmed_at = ?, cancelled_at = NULL, updated_at = ?
       WHERE id = ?`,
        )
        .bind(
          registration.invite_id,
          registration.status,
          registration.attendance_type,
          registration.source_type,
          registration.source_ref,
          registration.custom_answers_json,
          registration.form_placement_id,
          registration.registration_group_id,
          registration.registration_identity_id,
          registration.referred_by_code,
          registration.confirmation_link_secret,
          registration.pending_confirmation_deadline_at,
          registration.manage_link_secret,
          registration.confirmed_at,
          now,
          registration.id,
        ),
    );
  } else {
    statements.push(
      db
        .prepare(
          `INSERT INTO registrations (
      id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
      custom_answers_json, form_placement_id, registration_group_id, registration_identity_id, referred_by_code, confirmation_link_secret,
      pending_confirmation_deadline_at,
      manage_link_secret, cancellation_reason_code,
      created_identity_user_id, confirmed_at, cancelled_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          registration.id,
          registration.event_id,
          registration.user_id,
          registration.invite_id,
          registration.status,
          registration.attendance_type,
          registration.source_type,
          registration.source_ref,
          registration.custom_answers_json,
          registration.form_placement_id,
          registration.registration_group_id,
          registration.registration_identity_id,
          registration.referred_by_code,
          registration.confirmation_link_secret,
          registration.pending_confirmation_deadline_at,
          registration.manage_link_secret,
          registration.cancellation_reason_code,
          registration.created_identity_user_id,
          registration.confirmed_at,
          registration.cancelled_at,
          registration.created_at,
          registration.updated_at,
        ),
    );
  }
  const waitlist = planRegistrationDayWaitlistSync(
    db,
    {
      registrationId: registration.id,
      eventId: registration.event_id,
      userId: registration.user_id,
      selections: payload.dayAttendance,
      capacityExemptReason,
      sharedCapacityGuards: payload.sharedCapacityGuards,
      registrationStatus: registration.status,
      configuredEventDays,
      auditActor: { type: "user", id: registration.user_id },
    },
    { ...capacitySnapshot, eventDays: configuredEventDays },
  );
  statements.unshift(...waitlist.guardStatements);
  statements.push(
    ...planRegistrationDayAttendanceChange(
      db,
      {
        registrationId: registration.id,
        eventId: registration.event_id,
        selections: payload.dayAttendance,
        recordHistory: Boolean(existing),
        configuredEventDays,
      },
      previousAttendance,
      configuredEventDays,
    ),
    ...waitlist.statements,
    prepareEngagementStatement(db, {
      userId: registration.user_id,
      eventId: registration.event_id,
      subjectType: "registration",
      subjectRef: registration.id,
      actionType: "registration_created",
      points: 2,
      sourceType: "registration",
      sourceRef: registration.id,
      idempotencyKey: `registration_created:registration:${registration.id}`,
      data: { status: registration.status, attendanceType: registration.attendance_type },
    }),
  );
  if (payload.referredByCode) {
    statements.push(
      ...planReferralConversionStatements(
        db,
        payload.referredByCode,
        { type: "registration", ref: registration.id },
        batchFirst<ReferralRow>(details[capacity.statements.length + 1]),
      ),
    );
  }
  const manageToken = await signedOrQueuedCapability({
    signingSecret: payload.signingSecret,
    linkSecret: registration.manage_link_secret,
    purpose: "registration_manage",
    resourceId: registration.id,
  });
  const confirmationToken = registration.confirmation_link_secret
    ? await signedOrQueuedCapability({
        signingSecret: payload.signingSecret,
        linkSecret: registration.confirmation_link_secret,
        purpose: "registration_confirm",
        resourceId: registration.id,
        ttlSeconds: payload.confirmationTtlHours != null ? payload.confirmationTtlHours * 3600 : undefined,
      })
    : null;
  return {
    registration,
    manageToken,
    confirmationToken,
    reactivated: Boolean(existing),
    statements,
    plannedDayWaitlist: waitlist.activeRows,
    dayAttendance: (payload.dayAttendance ?? []).map((selection) => {
      const day = configuredEventDays.find((entry) => entry.day_date === selection.dayDate);
      return { dayDate: selection.dayDate, attendanceType: selection.attendanceType, label: day?.label ?? null };
    }),
  };
}
