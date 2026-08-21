import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { prepareRemoveAllDayWaitlistStatement } from "./day-waitlist";
import { prepareUpsertAttendeeParticipantStatement } from "./participant-registration";
import { getRegistrationById } from "./queries";
import { prepareRegistrationStatusEmail, type RegistrationStatusEmailParams } from "./status-notifications";
import type { RegistrationRecord } from "./types";

type ForceStatusNotification = Omit<
  RegistrationStatusEmailParams,
  "registrationId" | "registration" | "profilePatch" | "dayAttendance" | "dayWaitlist"
>;

export async function forceRegistrationStatus(
  db: DatabaseLike,
  payload: {
    registrationId: string;
    eventId: string;
    status: "pending_email_confirmation" | "registered" | "cancelled";
    actorUserId: string;
    notification?: ForceStatusNotification;
  },
): Promise<{ registration: RegistrationRecord; outboxId: string | null }> {
  const registration = await getRegistrationById(db, payload.registrationId);
  if (registration.event_id !== payload.eventId) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  }
  const now = nowIso();
  const updated: RegistrationRecord = {
    ...registration,
    status: payload.status,
    cancellation_reason_code: null,
    cancelled_at: payload.status === "cancelled" ? (registration.cancelled_at ?? now) : null,
    updated_at: now,
  };
  const statements: StatementLike[] = [
    db
      .prepare(
        `UPDATE registrations
         SET status = ?, cancellation_reason_code = NULL, cancelled_at = ?, updated_at = ?
         WHERE id = ? AND event_id = ?`,
      )
      .bind(updated.status, updated.cancelled_at, now, registration.id, payload.eventId),
  ];
  if (payload.status === "cancelled") {
    statements.push(
      prepareRemoveAllDayWaitlistStatement(db, {
        registrationId: registration.id,
        reasonCode: "registration_cancelled",
        reasonNote: "admin_force_status",
      }),
    );
  }
  statements.push(
    prepareUpsertAttendeeParticipantStatement(db, updated),
    prepareAuditLog(
      db,
      "admin",
      payload.actorUserId,
      "admin_registration_force_status",
      "registration",
      registration.id,
      { eventId: payload.eventId, from: registration.status, to: payload.status },
    ),
  );
  let outboxId: string | null = null;
  if (payload.notification && registration.status !== payload.status) {
    const email = await prepareRegistrationStatusEmail(db, {
      ...payload.notification,
      registrationId: registration.id,
      registration: updated,
      dayWaitlist: payload.status === "cancelled" ? [] : undefined,
    });
    statements.push(email.statement);
    outboxId = email.outboxId;
  }
  await db.batch(statements);
  return { registration: updated, outboxId };
}
