import type { DatabaseLike } from "../../types";
import type { ChangeRegistrationEmailParams } from "./change-email";
import { prepareRegistrationEmailChange } from "./change-email";
import { dayWaitlistOfferUnavailableError, isDayWaitlistOfferUnavailable, withDayCapacityRetry } from "./day-waitlist";
import { getRegistrationByIdForEvent, getRegistrationByManageToken } from "./queries";
import { prepareRegistrationStatusEmail, type RegistrationStatusEmailParams } from "./status-notifications";
import type { RegistrationRecord } from "./types";
import { buildRegistrationUpdate, type RegistrationUpdatePayload } from "./update-plan";
import { isRegistrationTransitionConflict, registrationChangedError } from "./transition-guard";
import { sha256Hex } from "../../utils/crypto";

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
  commit: (built: RegistrationUpdatePlan) => Promise<T>,
): Promise<T> {
  try {
    return await withDayCapacityRetry(async () => {
      const registration = await load();
      return commit(await buildRegistrationUpdate(db, registration, payload, changedBy));
    });
  } catch (error) {
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
): Promise<{ registration: RegistrationRecord; outboxId: string | null }> {
  if (!built.notificationChanged) {
    await db.batch(built.statements);
    return { registration: built.registration, outboxId: null };
  }
  const idempotencyKey =
    payload.notification.idempotencyKey ??
    `registration-status:${built.registration.id}:${built.notificationRevision}:` +
      `${payload.notification.templateKey}:${payload.notification.noticeKind ?? "status_update"}`;
  const outboxId = payload.notification.outboxId ?? (await sha256Hex(idempotencyKey)).slice(0, 32);
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
  await db.batch([...built.statements, email.statement]);
  return { registration: built.registration, outboxId: email.outboxId };
}

async function commitUpdateWithEmailChange(
  db: DatabaseLike,
  built: RegistrationUpdatePlan,
  payload: RegistrationUpdatePayload & { emailChange: UpdateEmailChange },
): Promise<{ registration: RegistrationRecord; outboxId: string | null }> {
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
  return { registration: emailChange.registration, outboxId: emailChange.outboxId };
}

export async function updateRegistrationByManageToken(
  db: DatabaseLike,
  payload: { manageToken: string; signingSecret: string } & RegistrationUpdatePayload,
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
    manageToken: string;
    signingSecret: string;
    notification: UpdateNotification;
  } & RegistrationUpdatePayload,
): Promise<{ registration: RegistrationRecord; outboxId: string | null }> {
  return executeRegistrationUpdate(
    db,
    payload,
    () => getRegistrationByManageToken(db, payload.manageToken, payload.signingSecret),
    undefined,
    (built) => commitUpdateWithNotification(db, built, payload),
  );
}

export async function updateRegistrationByManageTokenWithEmailChange(
  db: DatabaseLike,
  payload: {
    manageToken: string;
    signingSecret: string;
    emailChange: UpdateEmailChange;
  } & RegistrationUpdatePayload,
): Promise<{ registration: RegistrationRecord; outboxId: string | null }> {
  return executeRegistrationUpdate(
    db,
    payload,
    () => getRegistrationByManageToken(db, payload.manageToken, payload.signingSecret),
    undefined,
    (built) => commitUpdateWithEmailChange(db, built, payload),
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
): Promise<{ registration: RegistrationRecord; outboxId: string | null }> {
  return executeRegistrationUpdate(
    db,
    payload,
    () =>
      registrationSnapshot
        ? Promise.resolve(registrationSnapshot)
        : getRegistrationByIdForEvent(db, payload.eventId, payload.registrationId),
    changedBy,
    (built) => commitUpdateWithNotification(db, built, payload),
  );
}

export async function updateRegistrationByIdWithEmailChange(
  db: DatabaseLike,
  payload: { eventId: string; registrationId: string; emailChange: UpdateEmailChange } & RegistrationUpdatePayload,
  changedBy: string,
): Promise<{ registration: RegistrationRecord; outboxId: string | null }> {
  return executeRegistrationUpdate(
    db,
    payload,
    () => getRegistrationByIdForEvent(db, payload.eventId, payload.registrationId),
    changedBy,
    (built) => commitUpdateWithEmailChange(db, built, payload),
  );
}
