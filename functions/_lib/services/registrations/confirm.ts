import { AppError } from "../../errors";
import { first, run } from "../../db/queries";
import { randomToken, sha256Hex } from "../../utils/crypto";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { addToWaitlist } from "./waitlist";
import { recordEngagement } from "../engagement";
import {
  listInPersonEventDayIdsForRegistration,
  promoteDayWaitlistForEventDays,
  resolveCapacityExemptReason,
} from "./day-waitlist";
import { upsertAttendeeParticipant } from "./participant-registration";
import type { DatabaseLike } from "../../types";
import type { RegistrationRecord } from "./types";

export async function confirmRegistrationByToken(
  db: DatabaseLike,
  payload: { token: string; waitlistClaimWindowHours: number },
): Promise<{ registration: RegistrationRecord; manageToken: string }> {
  const tokenHash = await sha256Hex(payload.token);
  const registration = await first<RegistrationRecord>(
    db,
    `SELECT * FROM registrations
     WHERE confirmation_token_hash = ? AND status = 'pending_email_confirmation'`,
    [tokenHash],
  );
  if (!registration) {
    throw new AppError(404, "CONFIRM_TOKEN_INVALID", "Invalid or already-used confirmation token");
  }
  const now = nowIso();
  if (
    registration.confirmation_token_expires_at &&
    registration.confirmation_token_expires_at < now
  ) {
    throw new AppError(410, "CONFIRM_TOKEN_EXPIRED", "Confirmation link has expired — please request a new one");
  }
  const dayEventIds = await listInPersonEventDayIdsForRegistration(db, registration.id);
  const capacityExemptReason = await resolveCapacityExemptReason(db, {
    registrationId: registration.id,
    eventId: registration.event_id,
    userId: registration.user_id,
  });
  const hasPerDayAttendance = dayEventIds.length > 0;
  let newStatus = "registered";
  if (
    registration.attendance_type === "in_person"
    && !hasPerDayAttendance
    && !capacityExemptReason
  ) {
    const event = await first<{ capacity_in_person: number | null }>(
      db,
      "SELECT capacity_in_person FROM events WHERE id = ?",
      [registration.event_id],
    );
    const capacity = Number(event?.capacity_in_person ?? 0);
    if (capacity > 0) {
      const row = await first<{ total: number }>(
        db,
        `SELECT COUNT(*) AS total
         FROM registrations
         WHERE event_id = ?
           AND status = 'registered'
           AND attendance_type = 'in_person'
           AND capacity_exempt_in_person = 0`,
        [registration.event_id],
      );
      if (Number(row?.total ?? 0) >= capacity) {
        newStatus = "waitlisted";
      }
    }
  }

  await run(
    db,
    `UPDATE registrations
     SET status = ?, confirmed_at = ?, confirmation_token_hash = NULL,
         confirmation_token_expires_at = NULL, capacity_exempt_in_person = ?,
         capacity_exempt_reason = ?, updated_at = ?
     WHERE id = ?`,
    [newStatus, now, capacityExemptReason ? 1 : 0, capacityExemptReason, now, registration.id],
  );
  await upsertAttendeeParticipant(db, {
    ...registration,
    status: newStatus,
  });
  if (newStatus === "waitlisted") {
    await addToWaitlist(db, registration.event_id, registration.id);
  }
  const updated = await first<RegistrationRecord>(db, "SELECT * FROM registrations WHERE id = ?", [registration.id]);
  if (!updated) {
    throw new AppError(500, "REGISTRATION_CONFIRM_FAILED", "Registration update failed");
  }
  if (newStatus === "registered") {
    await recordEngagement(db, {
      userId: registration.user_id,
      eventId: registration.event_id,
      subjectType: "registration",
      subjectRef: registration.id,
      actionType: "registration_confirmed",
      points: 5,
      sourceType: "registration",
      sourceRef: registration.id,
    });
    if (hasPerDayAttendance) {
      await promoteDayWaitlistForEventDays(db, {
        eventId: updated.event_id,
        eventDayIds: dayEventIds,
        claimWindowHours: payload.waitlistClaimWindowHours,
      });
    }
  }

  // Rotate the manage token so the confirmed email always contains a valid, active link.
  const freshManageToken = randomToken(24);
  const freshManageHash = await sha256Hex(freshManageToken);
  await run(db, "UPDATE registrations SET manage_token_hash = ?, updated_at = ? WHERE id = ?", [freshManageHash, nowIso(), updated.id]);

  return { registration: { ...updated, manage_token_hash: freshManageHash }, manageToken: freshManageToken };
}
