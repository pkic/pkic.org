import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import type { AttendanceType } from "../../../assets/shared/schemas/registration";
import { prepareAuditLog } from "./audit";
import { prepareConsentStatements } from "./consent";
import { prepareAcceptInviteStatements, prepareRevokeDuplicateInvitesStatement, type InviteRecord } from "./invites";
import { prepareReferralCodeStatement } from "./referrals";
import { firstReferralCodeQuerySql } from "./referral-code-projection";
import { buildCreateRegistration } from "./registrations/create";
import { isEventDayCapacityConflict, type PlannedDayWaitlistEntry } from "./registrations/day-waitlist";
import type { RegistrationRecord } from "./registrations";
import type { DayAttendanceSelection } from "./event-days";
import { buildFindOrCreateUserStatement, type FindOrCreateUserPayload, type UserRecord } from "./users";

export interface PreparedRegistrationSubmission {
  user: UserRecord;
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
    referredByCode?: string | null;
    invite?: InviteRecord | null;
    consents: Array<{ termKey: string; version: string }>;
    ip: string | null;
    userAgent: string | null;
    signingSecret: string;
    pendingConfirmationDeadlineHours: number;
    confirmationTtlHours?: number;
    referralCodeLength: number;
  },
): Promise<PreparedRegistrationSubmission> {
  const preparedUser = await buildFindOrCreateUserStatement(db, payload.user);
  const builtRegistration = await buildCreateRegistration(db, {
    event: { id: payload.eventId },
    userId: preparedUser.user.id,
    attendanceType: payload.attendanceType,
    dayAttendance: payload.dayAttendance,
    sourceType: payload.sourceType,
    sourceRef: payload.sourceRef,
    customAnswersJson: payload.customAnswersJson,
    inviteId: payload.invite?.id ?? null,
    referredByCode: payload.referredByCode,
    pendingConfirmationDeadlineHours: payload.pendingConfirmationDeadlineHours,
    confirmationTtlHours: payload.confirmationTtlHours,
    signingSecret: payload.signingSecret,
    unverifiedEmailCorrectionAllowed: preparedUser.created,
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

  const statements: StatementLike[] = [];
  if (preparedUser.statement) statements.push(preparedUser.statement);
  statements.push(
    ...builtRegistration.statements,
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
      { eventId: payload.eventId, status: builtRegistration.registration.status },
    ),
  );

  return {
    user: preparedUser.user,
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
