import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { prepareAuditLog } from "./audit";
import { prepareEngagementStatement } from "./engagement";
import { INVITE_COLUMNS } from "./invite-types";
import { prepareConsentStatements } from "./consent";
import { prepareAcceptInviteStatements, prepareRevokeDuplicateInvitesStatement, type InviteRecord } from "./invites";
import { prepareReferralCodeStatement } from "./referrals";
import { firstReferralCodeQuerySql } from "./referral-code-projection";
import { buildCreateRegistration } from "./registrations/create";
import { isEventDayCapacityConflict, type PlannedDayWaitlistEntry } from "./registrations/day-waitlist";
import type { RegistrationRecord, VerifiedRegistrationIdentityContext } from "./registrations";
import type { DayAttendanceSelection } from "./event-days";
import { buildFindOrCreateUserStatement, type FindOrCreateUserPayload, type UserRecord } from "./users";
import {
  formSubmissionContextChangedError,
  isFormSubmissionContextConflict,
  prepareReplaceContextFormSubmission,
  type ActiveFormDefinition,
  type CustomAnswerValue,
} from "./forms";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { prepareVerifiedRegistrationUserGuard, requireRegistrationUserProfile } from "./registrations/authorization";

export interface PreparedRegistrationSubmission {
  user: UserRecord;
  registration: RegistrationRecord;
  manageToken: string;
  confirmationToken: string | null;
  reactivated: boolean;
  referralCode: string;
  dayAttendance: Array<{
    dayDate: string;
    attendanceType: string;
    label: string | null;
    accessMode: import("../../../assets/shared/event-attendance-access").EventAttendanceAccessMode;
    startsAt: string | null;
    endsAt: string | null;
  }>;
  plannedDayWaitlist: PlannedDayWaitlistEntry[];
  statements: StatementLike[];
}

export async function prepareRegistrationSubmission(
  db: DatabaseLike,
  payload: {
    eventId: string;
    user: FindOrCreateUserPayload;
    dayAttendance?: DayAttendanceSelection[];
    sourceType: string;
    sourceRef?: string | null;
    customAnswersJson?: string | null;
    formPlacementId?: string | null;
    formDefinition?: ActiveFormDefinition | null;
    formAnswers?: Readonly<Record<string, CustomAnswerValue>>;
    referredByCode?: string | null;
    invite?: InviteRecord | null;
    consents: Array<{ termKey: string; version: string }>;
    ip: string | null;
    userAgent: string | null;
    signingSecret: string;
    referralCodeLength: number;
    formRevisionGuard?: StatementLike | null;
    authorizationGuards?: readonly StatementLike[];
    termsSnapshotGuard?: StatementLike | null;
    /** Every registration belongs to a signed-in account whose session proved the mailbox. */
    verifiedIdentity: VerifiedRegistrationIdentityContext;
  },
): Promise<PreparedRegistrationSubmission> {
  const preparedUser = await buildFindOrCreateUserStatement(db, payload.user);
  if (preparedUser.user.id !== payload.verifiedIdentity.userId) {
    throw new AppError(403, "REGISTRATION_IDENTITY_MISMATCH", "Registration identity does not match the session");
  }
  // Registration uses the canonical account, not the submitted name fields.
  // Existing accounts must correct invalid saved names through an owned profile write.
  requireRegistrationUserProfile(preparedUser.user);
  // The session proved the mailbox, so an invitation sent to it is accepted without its link.
  const invite =
    payload.invite ??
    (await first<InviteRecord>(
      db,
      `SELECT ${INVITE_COLUMNS} FROM invites
       WHERE event_id = ? AND invitee_email = ? AND invite_type = 'attendee' AND status = 'sent'
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at ASC LIMIT 1`,
      [payload.eventId, preparedUser.user.normalized_email, new Date().toISOString()],
    ));
  const builtRegistration = await buildCreateRegistration(db, {
    event: { id: payload.eventId },
    userId: preparedUser.user.id,
    dayAttendance: payload.dayAttendance,
    sourceType: payload.sourceType,
    sourceRef: payload.sourceRef,
    customAnswersJson: payload.customAnswersJson,
    formPlacementId: payload.formPlacementId,
    inviteId: invite?.id ?? null,
    referredByCode: payload.referredByCode,
    signingSecret: payload.signingSecret,
    verifiedIdentity: payload.verifiedIdentity,
  });
  const existingReferral = await first<{ code: string }>(db, firstReferralCodeQuerySql("registration", "?"), [
    builtRegistration.registration.id,
  ]);
  const preparedReferral = existingReferral
    ? null
    : await prepareReferralCodeStatement(db, {
        eventId: payload.eventId,
        ownerType: "registration",
        ownerId: builtRegistration.registration.id,
        createdByUserId: preparedUser.user.id,
        length: payload.referralCodeLength,
      });

  const formSubmission = payload.formDefinition
    ? await prepareReplaceContextFormSubmission(
        db,
        payload.formDefinition,
        {
          submittedByUserId: preparedUser.user.id,
          contextType: "registration",
          contextRef: builtRegistration.registration.id,
        },
        payload.formAnswers ?? {},
        builtRegistration.registration.updated_at,
      )
    : null;

  const statements: StatementLike[] = [];
  statements.push(...(payload.authorizationGuards ?? []));
  if (payload.termsSnapshotGuard) statements.push(payload.termsSnapshotGuard);
  if (payload.formRevisionGuard) statements.push(payload.formRevisionGuard);
  statements.push(...preparedUser.statements);
  statements.push(prepareVerifiedRegistrationUserGuard(db, preparedUser.user));
  statements.push(
    ...builtRegistration.statements,
    ...(formSubmission?.statements ?? []),
    ...(await prepareConsentStatements(db, {
      registrationId: builtRegistration.registration.id,
      eventId: payload.eventId,
      userId: preparedUser.user.id,
      audienceType: "attendee",
      accepted: payload.consents,
      ip: payload.ip,
      userAgent: payload.userAgent,
      secret: payload.signingSecret,
    })),
  );
  if (invite) {
    statements.push(
      ...prepareAcceptInviteStatements(db, invite),
      prepareRevokeDuplicateInvitesStatement(db, {
        eventId: payload.eventId,
        inviteeEmail: preparedUser.user.email,
        keepInviteId: invite.id,
      }),
    );
  }
  if (preparedReferral) statements.push(preparedReferral.statement);
  if (builtRegistration.registration.status === "registered")
    statements.push(
      prepareEngagementStatement(db, {
        userId: preparedUser.user.id,
        eventId: payload.eventId,
        subjectType: "registration",
        subjectRef: builtRegistration.registration.id,
        actionType: "registration_confirmed",
        points: 5,
        sourceType: "registration",
        sourceRef: builtRegistration.registration.id,
        idempotencyKey: `registration_confirmed:registration:${builtRegistration.registration.id}`,
      }),
    );
  statements.push(
    prepareAuditLog(
      db,
      "user",
      preparedUser.user.id,
      builtRegistration.reactivated ? "registration_reactivated" : "registration_created",
      "registration",
      builtRegistration.registration.id,
      {
        eventId: payload.eventId,
        status: builtRegistration.registration.status,
        registrationGroupId: payload.verifiedIdentity.registrationGroupId ?? null,
        registrationIdentityId: payload.verifiedIdentity.selectedIdentity?.id ?? null,
      },
      undefined,
      null,
      payload.verifiedIdentity.registrationGroupId
        ? { type: "group", id: payload.verifiedIdentity.registrationGroupId }
        : null,
    ),
  );

  return {
    user: preparedUser.user,
    registration: builtRegistration.registration,
    manageToken: builtRegistration.manageToken,
    confirmationToken: builtRegistration.confirmationToken,
    reactivated: builtRegistration.reactivated,
    referralCode: existingReferral?.code ?? preparedReferral!.code,
    dayAttendance: builtRegistration.dayAttendance,
    plannedDayWaitlist: builtRegistration.plannedDayWaitlist,
    statements,
  };
}

export async function commitRegistrationSubmission(
  db: DatabaseLike,
  prepared: PreparedRegistrationSubmission,
  additionalStatements: StatementLike[] = [],
): Promise<void> {
  try {
    await db.batch([...prepared.statements, ...additionalStatements]);
  } catch (error) {
    if (
      (error instanceof Error && error.message.includes("EVENT_REGISTRATION_CONTEXT_CHANGED")) ||
      isAuthorizationGuardFailure(error)
    ) {
      throw new AppError(
        409,
        "EVENT_REGISTRATION_CONTEXT_CHANGED",
        "Registration configuration or access changed while the registration was being saved; please submit again",
      );
    }
    if (isFormSubmissionContextConflict(error)) {
      throw formSubmissionContextChangedError();
    }
    if (isEventDayCapacityConflict(error)) {
      throw new AppError(
        409,
        "DAY_CAPACITY_CHANGED",
        "Day capacity changed while the registration was being saved; please submit again",
      );
    }
    throw error;
  }
}
