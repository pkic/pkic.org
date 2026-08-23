import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { sha256Hex } from "../../utils/crypto";
import { prepareAuditLog } from "../audit";
import { getRegistrationDayAttendance, listEventDays } from "../event-days";
import {
  buildRegistrationDayWaitlistSync,
  listConfirmedInPersonEventDayIdsForRegistration,
  prepareRemoveAllDayWaitlistStatement,
  resolveCapacityExemptReason,
  withDayCapacityRetry,
} from "./day-waitlist";
import { getRegistrationById } from "./queries";
import { prepareRegistrationStatusEmail, type RegistrationStatusEmailParams } from "./status-notifications";
import type { RegistrationRecord } from "./types";
import { prepareClearRegistrationEmailChangeStatement } from "./change-email";
import {
  isRegistrationTransitionConflict,
  prepareRegistrationTransitionGuard,
  registrationChangedError,
} from "./transition-guard";

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
  try {
    return await withDayCapacityRetry(async () => {
      const registration = await getRegistrationById(db, payload.registrationId);
      if (registration.event_id !== payload.eventId) {
        throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
      }
      const [dayAttendance, eventDays, previousConfirmedDayIds] = await Promise.all([
        getRegistrationDayAttendance(db, registration.id),
        listEventDays(db, registration.event_id),
        listConfirmedInPersonEventDayIdsForRegistration(db, registration.id),
      ]);
      const capacityExemptReason =
        payload.status === "cancelled"
          ? registration.capacity_exempt_reason
          : await resolveCapacityExemptReason(db, {
              eventId: registration.event_id,
              userId: registration.user_id,
            });
      const now = nowIso();
      const updated: RegistrationRecord = {
        ...registration,
        status: payload.status,
        capacity_exempt_in_person: capacityExemptReason ? 1 : 0,
        capacity_exempt_reason: capacityExemptReason,
        cancellation_reason_code: null,
        ...(payload.status !== "pending_email_confirmation"
          ? {
              confirmation_link_secret: null,
              pending_confirmation_deadline_at: null,
              created_identity_user_id: null,
            }
          : {}),
        cancelled_at: payload.status === "cancelled" ? (registration.cancelled_at ?? now) : null,
        updated_at: now,
      };
      const waitlist =
        payload.status === "cancelled"
          ? null
          : await buildRegistrationDayWaitlistSync(db, {
              registrationId: registration.id,
              eventId: registration.event_id,
              userId: registration.user_id,
              selections: dayAttendance,
              capacityExemptReason,
              preserveConfirmedEventDayIds: registration.status === "cancelled" ? [] : previousConfirmedDayIds,
              registrationStatus: payload.status,
              configuredEventDays: eventDays,
            });
      const statements: StatementLike[] = [
        prepareRegistrationTransitionGuard(db, registration),
        ...(waitlist?.guardStatements ?? []),
        db
          .prepare(
            `UPDATE registrations
           SET status = ?, capacity_exempt_in_person = ?, capacity_exempt_reason = ?,
               cancellation_reason_code = NULL, cancelled_at = ?,
               confirmation_link_secret = CASE WHEN ? = 1 THEN NULL ELSE confirmation_link_secret END,
               pending_confirmation_deadline_at = CASE
                 WHEN ? = 1 THEN NULL ELSE pending_confirmation_deadline_at END,
               confirmation_reminder_sent_at = CASE
                 WHEN ? = 1 THEN NULL ELSE confirmation_reminder_sent_at END,
               created_identity_user_id = CASE WHEN ? = 1 THEN NULL ELSE created_identity_user_id END,
               updated_at = ?
           WHERE id = ? AND event_id = ?`,
          )
          .bind(
            updated.status,
            updated.capacity_exempt_in_person,
            updated.capacity_exempt_reason,
            updated.cancelled_at,
            payload.status !== "pending_email_confirmation" ? 1 : 0,
            payload.status !== "pending_email_confirmation" ? 1 : 0,
            payload.status !== "pending_email_confirmation" ? 1 : 0,
            payload.status !== "pending_email_confirmation" ? 1 : 0,
            now,
            registration.id,
            payload.eventId,
          ),
      ];
      if (payload.status !== "pending_email_confirmation") {
        statements.push(prepareClearRegistrationEmailChangeStatement(db, registration.id, registration.user_id, now));
      }
      if (payload.status === "cancelled") {
        statements.push(
          prepareRemoveAllDayWaitlistStatement(db, {
            registrationId: registration.id,
            reasonCode: "registration_cancelled",
            reasonNote: "admin_force_status",
          }),
        );
      } else {
        statements.push(...(waitlist?.statements ?? []));
      }
      statements.push(
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
        const idempotencyKey =
          `registration-force-status:${registration.id}:${registration.transition_revision + 1}:` +
          `${payload.status}:${payload.notification.templateKey}`;
        const email = await prepareRegistrationStatusEmail(db, {
          ...payload.notification,
          outboxId: (await sha256Hex(idempotencyKey)).slice(0, 32),
          idempotencyKey,
          registrationId: registration.id,
          registration: updated,
          dayAttendance,
          dayWaitlist: payload.status === "cancelled" ? [] : waitlist?.activeRows,
        });
        statements.push(email.statement);
        outboxId = email.outboxId;
      }
      await db.batch(statements);
      return { registration: updated, outboxId };
    });
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) throw registrationChangedError();
    throw error;
  }
}
