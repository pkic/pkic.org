import { userSessionRequestAuthorizationEvidence } from "../../auth/user-session-evidence";
import { AppError } from "../../errors";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { isAuditChangeGuardFailure } from "../audit";
import { prepareRegistrationIdentityChange, registrationIdentityChangeEvidence } from "./change-identity";
import type { DatabaseLike, D1StatementResult, StatementLike } from "../../types";
import type { ChangeRegistrationEmailParams } from "./change-email";
import { prepareRegistrationEmailChange } from "./change-email";
import { dayWaitlistOfferUnavailableError, isDayWaitlistOfferUnavailable, withDayCapacityRetry } from "./day-waitlist";
import { getRegistrationByIdForEvent, getRegistrationByManageToken } from "./queries";
import { prepareRegistrationStatusEmail, type RegistrationStatusEmailParams } from "./status-notifications";
import type { RegistrationRecord } from "./types";
import type { ParticipantAuthority } from "../participant-authority";
import { buildRegistrationUpdate, type RegistrationUpdatePayload } from "./update-plan";
import { isRegistrationTransitionConflict, registrationChangedError } from "./transition-guard";
import { emailTakenError, isEmailReservationConflict } from "../user-emails";
import { formSubmissionContextChangedError, isFormSubmissionContextConflict } from "../forms";
import { uuid } from "../../utils/ids";
import { outboxIdForOperation } from "../../email/outbox-queue";

type RegistrationUpdatePlan = Awaited<ReturnType<typeof buildRegistrationUpdate>>;

type UpdateNotification = Omit<
  RegistrationStatusEmailParams,
  "registrationId" | "registration" | "profilePatch" | "dayAttendance" | "dayWaitlist"
>;

type UpdateEmailChange = Omit<ChangeRegistrationEmailParams, "registrationId" | "registrationOverride">;

async function executeRegistrationUpdate<T>(
  db: DatabaseLike,
  payload: RegistrationUpdatePayload,
  load: () => Promise<RegistrationRecord>,
  changedBy: string | undefined,
  commit: (built: RegistrationUpdatePlan, operationId: string) => Promise<T>,
): Promise<T> {
  // One operation key survives capacity retries without changing capability-bound state.
  const operationId = uuid();
  let attemptedRegistrationId: string | undefined;
  try {
    return await withDayCapacityRetry(async () => {
      const registration = await load();
      attemptedRegistrationId = registration.id;
      const built = await buildRegistrationUpdate(db, registration, payload, changedBy);
      if (payload.identityChange) {
        built.statements.push(...prepareRegistrationIdentityChange(db, registration.id, payload.identityChange));
        built.registration = {
          ...built.registration,
          registration_identity_id: payload.identityChange.change.identityId,
        };
        built.notificationChanged = true;
      }
      return commit(built, operationId);
    });
  } catch (error) {
    if (attemptedRegistrationId && payload.identityChange && isAuthorizationGuardFailure(error)) {
      // Diagnose only the refused operation, using the same evidence as its guards.
      const session = userSessionRequestAuthorizationEvidence(payload.identityChange.claims);
      const identity = registrationIdentityChangeEvidence(attemptedRegistrationId, payload.identityChange);
      const current = await db
        .prepare(`SELECT EXISTS (${session.sql}) AS session_active, EXISTS (${identity.sql}) AS identity_available`)
        .bind(...session.bindings, ...identity.bindings)
        .first<{ session_active: number; identity_available: number }>();
      if (!current?.session_active)
        throw new AppError(401, "AUTH_REQUIRED", "Sign in again to change your representation.");
      if (current.identity_available) throw registrationChangedError();
      throw new AppError(
        403,
        "REGISTRATION_IDENTITY_UNAVAILABLE",
        "Choose an active identity on your own registration.",
      );
    }
    if (payload.identityChange && isAuditChangeGuardFailure(error)) throw registrationChangedError();
    if (isFormSubmissionContextConflict(error)) throw formSubmissionContextChangedError();
    if (isEmailReservationConflict(error)) throw emailTakenError();
    if (isRegistrationTransitionConflict(error)) {
      throw registrationChangedError();
    }
    if (isDayWaitlistOfferUnavailable(error)) {
      throw dayWaitlistOfferUnavailableError();
    }
    throw error;
  }
}

async function commitUpdateWithNotification(
  db: DatabaseLike,
  built: RegistrationUpdatePlan,
  payload: RegistrationUpdatePayload & { notification: UpdateNotification },
  operationId: string,
  commitBatch: (statements: StatementLike[]) => Promise<D1StatementResult[]> = (statements) => db.batch(statements),
): Promise<{ registration: RegistrationRecord; outboxId: string | null; outboxIds: string[] }> {
  if (!built.notificationChanged) {
    await commitBatch(built.statements);
    return { registration: built.registration, outboxId: null, outboxIds: [] };
  }
  const idempotencyKey =
    payload.notification.idempotencyKey ??
    `registration-update:${built.registration.id}:${operationId}:` +
      `${payload.notification.templateKey}:${payload.notification.noticeKind ?? "status_update"}`;
  const outboxId = payload.notification.outboxId ?? (await outboxIdForOperation(idempotencyKey));
  const email = await prepareRegistrationStatusEmail(db, {
    ...payload.notification,
    outboxId,
    idempotencyKey,
    registrationId: built.registration.id,
    registration: built.registration,
    profilePatch: payload.profilePatch,
    dayAttendance: built.dayAttendance,
    dayWaitlist: built.dayWaitlist,
  });
  await commitBatch([...built.statements, email.statement]);
  return { registration: built.registration, outboxId: email.outboxId, outboxIds: [email.outboxId] };
}

async function commitUpdateWithEmailChange(
  db: DatabaseLike,
  built: RegistrationUpdatePlan,
  payload: RegistrationUpdatePayload & { emailChange: UpdateEmailChange },
): Promise<{ registration: RegistrationRecord; outboxId: string | null; outboxIds: string[] }> {
  const emailChange = await prepareRegistrationEmailChange(db, {
    ...payload.emailChange,
    registrationId: built.registration.id,
    registrationOverride: built.registration,
    confirmationEmail: payload.emailChange.confirmationEmail
      ? {
          ...payload.emailChange.confirmationEmail,
          profilePatch: payload.profilePatch,
          dayAttendance: built.dayAttendance,
          dayWaitlist: built.dayWaitlist,
        }
      : undefined,
  });
  await db.batch([...built.statements, ...emailChange.statements]);
  return {
    registration: emailChange.registration,
    outboxId: emailChange.outboxId,
    outboxIds: emailChange.outboxIds,
  };
}

export async function updateRegistrationByManageToken(
  db: DatabaseLike,
  payload: { manageToken: ParticipantAuthority; signingSecret: string } & RegistrationUpdatePayload,
): Promise<RegistrationRecord> {
  return executeRegistrationUpdate(
    db,
    payload,
    () => getRegistrationByManageToken(db, payload.manageToken, payload.signingSecret),
    undefined,
    async (built) => {
      await db.batch(built.statements);
      return built.registration;
    },
  );
}

export async function updateRegistrationByManageTokenWithNotification(
  db: DatabaseLike,
  payload: {
    manageToken: ParticipantAuthority;
    signingSecret: string;
    notification: UpdateNotification;
  } & RegistrationUpdatePayload,
): Promise<{ registration: RegistrationRecord; outboxId: string | null; outboxIds: string[] }> {
  return executeRegistrationUpdate(
    db,
    payload,
    () => getRegistrationByManageToken(db, payload.manageToken, payload.signingSecret),
    undefined,
    (built, operationId) => commitUpdateWithNotification(db, built, payload, operationId),
  );
}

export async function updateRegistrationById(
  db: DatabaseLike,
  payload: { eventId: string; registrationId: string } & RegistrationUpdatePayload,
  changedBy: string,
): Promise<RegistrationRecord> {
  return executeRegistrationUpdate(
    db,
    payload,
    () => getRegistrationByIdForEvent(db, payload.eventId, payload.registrationId),
    changedBy,
    async (built) => {
      await db.batch(built.statements);
      return built.registration;
    },
  );
}

export async function updateRegistrationByIdWithNotification(
  db: DatabaseLike,
  payload: { eventId: string; registrationId: string; notification: UpdateNotification } & RegistrationUpdatePayload,
  changedBy: string,
  registrationSnapshot?: RegistrationRecord,
  commitBatch?: (statements: StatementLike[]) => Promise<D1StatementResult[]>,
): Promise<{ registration: RegistrationRecord; outboxId: string | null; outboxIds: string[] }> {
  return executeRegistrationUpdate(
    db,
    payload,
    () =>
      registrationSnapshot
        ? Promise.resolve(registrationSnapshot)
        : getRegistrationByIdForEvent(db, payload.eventId, payload.registrationId),
    changedBy,
    (built, operationId) => commitUpdateWithNotification(db, built, payload, operationId, commitBatch),
  );
}

export async function updateRegistrationByIdWithEmailChange(
  db: DatabaseLike,
  payload: { eventId: string; registrationId: string; emailChange: UpdateEmailChange } & RegistrationUpdatePayload,
  changedBy: string,
): Promise<{ registration: RegistrationRecord; outboxId: string | null; outboxIds: string[] }> {
  return executeRegistrationUpdate(
    db,
    payload,
    () => getRegistrationByIdForEvent(db, payload.eventId, payload.registrationId),
    changedBy,
    (built) => commitUpdateWithEmailChange(db, built, payload),
  );
}
