import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import type { ChangeRegistrationEmailParams } from "./change-email";
import { prepareRegistrationEmailChange } from "./change-email";
import { isEventDayCapacityConflict } from "./day-waitlist";
import { getRegistrationById, getRegistrationByManageToken } from "./queries";
import { prepareRegistrationStatusEmail, type RegistrationStatusEmailParams } from "./status-notifications";
import type { RegistrationRecord } from "./types";
import { buildRegistrationUpdate, type RegistrationUpdatePayload } from "./update-plan";

type RegistrationUpdatePlan = Awaited<ReturnType<typeof buildRegistrationUpdate>>;

type UpdateNotification = Omit<
  RegistrationStatusEmailParams,
  "registrationId" | "registration" | "profilePatch" | "dayAttendance" | "dayWaitlist"
>;

type UpdateEmailChange = Omit<ChangeRegistrationEmailParams, "registrationId" | "registrationOverride">;

async function withCapacityRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isEventDayCapacityConflict(error) || attempt === 2) throw error;
    }
  }
  throw new AppError(409, "DAY_CAPACITY_CHANGED", "Day capacity changed; please retry");
}

async function executeRegistrationUpdate<T>(
  db: DatabaseLike,
  payload: RegistrationUpdatePayload,
  load: () => Promise<RegistrationRecord>,
  changedBy: string | undefined,
  commit: (built: RegistrationUpdatePlan) => Promise<T>,
): Promise<T> {
  return withCapacityRetry(async () => {
    const registration = await load();
    return commit(await buildRegistrationUpdate(db, registration, payload, changedBy));
  });
}

async function commitUpdateWithNotification(
  db: DatabaseLike,
  built: RegistrationUpdatePlan,
  payload: RegistrationUpdatePayload & { notification: UpdateNotification },
): Promise<{ registration: RegistrationRecord; outboxId: string }> {
  const email = await prepareRegistrationStatusEmail(db, {
    ...payload.notification,
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
): Promise<{ registration: RegistrationRecord; outboxId: string }> {
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
  payload: { registrationId: string } & RegistrationUpdatePayload,
  changedBy: string,
): Promise<RegistrationRecord> {
  return executeRegistrationUpdate(
    db,
    payload,
    () => getRegistrationById(db, payload.registrationId),
    changedBy,
    async (built) => {
      await db.batch(built.statements);
      return built.registration;
    },
  );
}

export async function updateRegistrationByIdWithNotification(
  db: DatabaseLike,
  payload: { registrationId: string; notification: UpdateNotification } & RegistrationUpdatePayload,
  changedBy: string,
): Promise<{ registration: RegistrationRecord; outboxId: string }> {
  return executeRegistrationUpdate(
    db,
    payload,
    () => getRegistrationById(db, payload.registrationId),
    changedBy,
    (built) => commitUpdateWithNotification(db, built, payload),
  );
}

export async function updateRegistrationByIdWithEmailChange(
  db: DatabaseLike,
  payload: { registrationId: string; emailChange: UpdateEmailChange } & RegistrationUpdatePayload,
  changedBy: string,
): Promise<{ registration: RegistrationRecord; outboxId: string | null }> {
  return executeRegistrationUpdate(
    db,
    payload,
    () => getRegistrationById(db, payload.registrationId),
    changedBy,
    (built) => commitUpdateWithEmailChange(db, built, payload),
  );
}
