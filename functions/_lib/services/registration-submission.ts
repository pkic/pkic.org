import { nowIso } from "../utils/time";
import type { EventAffiliationContext } from "./identities/event-affiliation-context";
import { planRegistrationAffiliation } from "./registrations/affiliation-plan";
import type { IdentityRepresentation } from "./identities/selection";
import { findUserEmailOwner } from "./user-emails";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import type { AttendanceType, RegistrationOrganizationOutcome } from "../../../assets/shared/schemas/registration";
import { prepareAuditLog } from "./audit";
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
import { prepareVerifyOwnedEmailStatements } from "./email-verification";
import { normalizeEmail } from "../validation";

export interface PreparedRegistrationSubmission {
  user: UserRecord;
  representation?: IdentityRepresentation;
  organizationOutcome?: RegistrationOrganizationOutcome;
  /** True only when this submission created a new, unprivileged identity. */
  identityWasCreated: boolean;
  registration: RegistrationRecord;
  manageToken: string;
  confirmationToken: string | null;
  reactivated: boolean;
  referralCode: string;
  dayAttendance: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
  plannedDayWaitlist: PlannedDayWaitlistEntry[];
  statements: StatementLike[];
}

export async function prepareRegistrationSubmission(
  db: DatabaseLike,
  payload: {
    eventId: string;
    user: FindOrCreateUserPayload;
    attendanceType: AttendanceType;
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
    pendingConfirmationDeadlineHours: number;
    confirmationTtlHours?: number;
    referralCodeLength: number;
    formRevisionGuard?: StatementLike | null;
    authorizationGuards?: readonly StatementLike[];
    termsSnapshotGuard?: StatementLike | null;
    verifiedIdentity?: VerifiedRegistrationIdentityContext;
    affiliationContext?: EventAffiliationContext;
    /** The registrant opened the verification link for this address; it is recorded as verified with the registration. */
    mailboxVerified?: boolean;
  },
): Promise<PreparedRegistrationSubmission> {
  if (!payload.mailboxVerified && !payload.verifiedIdentity) {
    const claim = await findUserEmailOwner(db, normalizeEmail(payload.user.email));
    if (claim?.kind === "pending" || (claim?.kind === "secondary" && !claim.verified))
      throw new AppError(422, "REGISTRATION_EMAIL_PROOF_REQUIRED", "Verify your email before continuing registration.");
  }
  const preparedUser = await buildFindOrCreateUserStatement(db, {
    ...payload.user,
    mailboxVerified: payload.mailboxVerified,
  });
  if (payload.verifiedIdentity && preparedUser.user.id !== payload.verifiedIdentity.userId) {
    throw new AppError(403, "REGISTRATION_IDENTITY_MISMATCH", "Registration identity does not match the session");
  }
  const affiliation = payload.affiliationContext
    ? await planRegistrationAffiliation(
        db,
        {
          userId: preparedUser.user.id,
          proofEvidence: {
            sql: "SELECT 1 WHERE ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            bindings: [new Date(payload.affiliationContext.exp * 1000).toISOString()],
          },
        },
        payload.affiliationContext.input,
        payload.affiliationContext.basis,
        nowIso(),
      )
    : null;
  const verifiedIdentity = affiliation?.identityId
    ? { ...payload.verifiedIdentity, userId: preparedUser.user.id, selectedIdentity: { id: affiliation.identityId } }
    : payload.verifiedIdentity;
  const builtRegistration = await buildCreateRegistration(db, {
    event: { id: payload.eventId },
    userId: preparedUser.user.id,
    attendanceType: payload.attendanceType,
    dayAttendance: payload.dayAttendance,
    sourceType: payload.sourceType,
    sourceRef: payload.sourceRef,
    customAnswersJson: payload.customAnswersJson,
    formPlacementId: payload.formPlacementId,
    inviteId: payload.invite?.id ?? null,
    referredByCode: payload.referredByCode,
    pendingConfirmationDeadlineHours: payload.pendingConfirmationDeadlineHours,
    confirmationTtlHours: payload.confirmationTtlHours,
    signingSecret: payload.signingSecret,
    unverifiedEmailCorrectionAllowed: preparedUser.created,
    verifiedIdentity,
    mailboxVerified: payload.mailboxVerified,
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
  if (payload.mailboxVerified)
    statements.push(
      ...prepareVerifyOwnedEmailStatements(db, {
        userId: preparedUser.user.id,
        normalizedEmail: normalizeEmail(payload.user.email),
        method: "registration_confirmation",
        excludeRegistrationId: builtRegistration.registration.id,
      }),
    );
  statements.push(
    ...(affiliation?.statements ?? []),
    ...builtRegistration.statements,
    ...(affiliation?.prepareReview?.(builtRegistration.registration.id) ?? []),
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
  if (payload.invite) {
    statements.push(
      ...prepareAcceptInviteStatements(db, payload.invite),
      prepareRevokeDuplicateInvitesStatement(db, {
        eventId: payload.eventId,
        inviteeEmail: preparedUser.user.email,
        keepInviteId: payload.invite.id,
      }),
    );
  }
  if (preparedReferral) statements.push(preparedReferral.statement);
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
        registrationGroupId: payload.verifiedIdentity?.registrationGroupId ?? null,
        registrationIdentityId: verifiedIdentity?.selectedIdentity?.id ?? null,
      },
      undefined,
      null,
      payload.verifiedIdentity?.registrationGroupId
        ? { type: "group", id: payload.verifiedIdentity.registrationGroupId }
        : null,
    ),
  );

  return {
    user: preparedUser.user,
    representation: affiliation?.representation,
    organizationOutcome: affiliation?.outcome,
    identityWasCreated: preparedUser.created,
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
