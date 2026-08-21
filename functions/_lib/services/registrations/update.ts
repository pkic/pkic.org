import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import type { ChangeRegistrationEmailParams } from "./change-email";
import { prepareRegistrationEmailChange } from "./change-email";
import { isEventDayCapacityConflict } from "./day-waitlist";
import { getRegistrationById, getRegistrationByManageToken } from "./queries";
import { prepareRegistrationStatusEmail, type RegistrationStatusEmailParams } from "./status-notifications";
import type { RegistrationRecord } from "./types";
import { buildRegistrationUpdate, type RegistrationUpdatePayload } from "./update-plan";

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

export async function updateRegistrationByManageToken(
  db: DatabaseLike,
  payload: { manageToken: string; signingSecret: string } & RegistrationUpdatePayload,
): Promise<RegistrationRecord> {
  return withCapacityRetry(async () => {
    const registration = await getRegistrationByManageToken(db, payload.manageToken, payload.signingSecret);
    const built = await buildRegistrationUpdate(db, registration, payload);
    await db.batch(built.statements);
    return built.registration;
  });
}

export async function updateRegistrationByManageTokenWithNotification(
  db: DatabaseLike,
  payload: {
    manageToken: string;
    signingSecret: string;
    notification: UpdateNotification;
  } & RegistrationUpdatePayload,
): Promise<{ registration: RegistrationRecord; outboxId: string }> {
  return withCapacityRetry(async () => {
    const registration = await getRegistrationByManageToken(db, payload.manageToken, payload.signingSecret);
    const built = await buildRegistrationUpdate(db, registration, payload);
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
  });
}

export async function updateRegistrationByManageTokenWithEmailChange(
  db: DatabaseLike,
  payload: {
    manageToken: string;
    signingSecret: string;
    emailChange: UpdateEmailChange;
  } & RegistrationUpdatePayload,
): Promise<{ registration: RegistrationRecord; outboxId: string | null }> {
  return withCapacityRetry(async () => {
    const registration = await getRegistrationByManageToken(db, payload.manageToken, payload.signingSecret);
    const built = await buildRegistrationUpdate(db, registration, payload);
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
  });
}

export async function updateRegistrationById(
  db: DatabaseLike,
  payload: { registrationId: string } & RegistrationUpdatePayload,
  changedBy: string,
): Promise<RegistrationRecord> {
  return withCapacityRetry(async () => {
    const registration = await getRegistrationById(db, payload.registrationId);
    const built = await buildRegistrationUpdate(db, registration, payload, changedBy);
    await db.batch(built.statements);
    return built.registration;
  });
}

export async function updateRegistrationByIdWithNotification(
  db: DatabaseLike,
  payload: { registrationId: string; notification: UpdateNotification } & RegistrationUpdatePayload,
  changedBy: string,
): Promise<{ registration: RegistrationRecord; outboxId: string }> {
  return withCapacityRetry(async () => {
    const registration = await getRegistrationById(db, payload.registrationId);
    const built = await buildRegistrationUpdate(db, registration, payload, changedBy);
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
  });
}

export async function updateRegistrationByIdWithEmailChange(
  db: DatabaseLike,
  payload: { registrationId: string; emailChange: UpdateEmailChange } & RegistrationUpdatePayload,
  changedBy: string,
): Promise<{ registration: RegistrationRecord; outboxId: string | null }> {
  return withCapacityRetry(async () => {
    const registration = await getRegistrationById(db, payload.registrationId);
    const built = await buildRegistrationUpdate(db, registration, payload, changedBy);
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
  });
}
