import { AppError } from "../../errors";
import { first, run } from "../../db/queries";
import { randomToken, sha256Hex } from "../../utils/crypto";
import { nowIso } from "../../utils/time";
import { recordEngagement } from "../engagement";
import { resolveCapacityExemptReason } from "./day-waitlist";
import { upsertAttendeeParticipant } from "./participant-registration";
import { writeAuditLog } from "../audit";
import { finalizeEmailChange } from "./change-email";
import { revokeDuplicateInvitesForEmail } from "../invites";
import type { DatabaseLike } from "../../types";
import type { RegistrationRecord } from "./types";

export async function confirmRegistrationByToken(
  db: DatabaseLike,
  payload: { token: string; registrationId?: string | null; waitlistClaimWindowHours: number },
): Promise<{ registration: RegistrationRecord; manageToken: string }> {
  const tokenHash = await sha256Hex(payload.token);
  const registration = await first<RegistrationRecord>(
    db,
    `SELECT * FROM registrations
     WHERE confirmation_token_hash = ?
       AND status = 'pending_email_confirmation'
       AND (? IS NULL OR id = ?)`,
    [tokenHash, payload.registrationId ?? null, payload.registrationId ?? null],
  );
  if (!registration) {
    throw new AppError(404, "CONFIRM_TOKEN_INVALID", "Invalid or already-used confirmation token");
  }
  const now = nowIso();
  if (registration.confirmation_token_expires_at && registration.confirmation_token_expires_at < now) {
    throw new AppError(410, "CONFIRM_TOKEN_EXPIRED", "Confirmation link has expired — please request a new one");
  }

  // Finalize any pending email change before confirming registration.
  // If finalization fails (e.g. EMAIL_TAKEN by a squatting account that
  // appeared after initiation), clear the pending_email reservation so the
  // user is not stuck and can retry from the manage URL.
  let emailMergeNote: { merged: boolean; mergedWithId: string | null } | null = null;
  const user = await first<{ pending_email: string | null; normalized_email: string }>(
    db,
    "SELECT pending_email, normalized_email FROM users WHERE id = ?",
    [registration.user_id],
  );
  let inviteEmail = user?.normalized_email ?? null;
  if (user?.pending_email) {
    try {
      const emailResult = await finalizeEmailChange(db, {
        userId: registration.user_id,
        eventId: registration.event_id,
        registrationId: registration.id,
      });
      emailMergeNote = {
        merged: !!emailResult.mergedWithRegistrationId,
        mergedWithId: emailResult.mergedWithRegistrationId,
      };
      inviteEmail = emailResult.finalEmail;
    } catch (err) {
      if (err instanceof AppError && err.code === "EMAIL_TAKEN") {
        // Clear the dangling pending_email reservation so the user can pick
        // a different address. Leave the registration in
        // pending_email_confirmation so the manage URL still works.
        await run(
          db,
          `UPDATE users SET pending_email = NULL, pending_email_expires_at = NULL, updated_at = ?
            WHERE id = ?`,
          [now, registration.user_id],
        );
        await writeAuditLog(db, "system", null, "registration_email_change_failed", "registration", registration.id, {
          reason: "email_taken_at_confirmation",
        });
      }
      throw err;
    }
  }

  const matchingInvite =
    !registration.invite_id && inviteEmail
      ? await first<{ id: string; inviter_user_id: string | null; invite_type: "attendee" | "speaker" }>(
          db,
          `SELECT id, inviter_user_id, invite_type
           FROM invites
           WHERE event_id = ? AND invitee_email = ? AND invite_type = 'attendee' AND status = 'sent'
           ORDER BY created_at ASC
           LIMIT 1`,
          [registration.event_id, inviteEmail],
        )
      : null;

  const capacityExemptReason = await resolveCapacityExemptReason(db, {
    registrationId: registration.id,
    eventId: registration.event_id,
    userId: registration.user_id,
  });
  const newStatus = "registered";

  const updateStatements = [
    db
      .prepare(
        `UPDATE registrations
         SET status = ?, confirmed_at = ?, confirmation_token_hash = NULL,
           confirmation_token_expires_at = NULL, pending_confirmation_deadline_at = NULL,
             confirmation_reminder_sent_at = NULL, invite_id = COALESCE(invite_id, ?),
             capacity_exempt_in_person = ?, capacity_exempt_reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        newStatus,
        now,
        matchingInvite?.id ?? null,
        capacityExemptReason ? 1 : 0,
        capacityExemptReason,
        now,
        registration.id,
      ),
  ];
  if (matchingInvite) {
    updateStatements.push(
      db
        .prepare(
          `UPDATE invites
           SET status = 'accepted', accepted_at = ?, used_count = used_count + 1
           WHERE id = ? AND status = 'sent'`,
        )
        .bind(now, matchingInvite.id),
    );
  }

  await db.batch(updateStatements);
  await revokeDuplicateInvitesForEmail(db, {
    eventId: registration.event_id,
    inviteeEmail: inviteEmail ?? user?.normalized_email ?? "",
    keepInviteId: registration.invite_id ?? matchingInvite?.id ?? null,
  });
  await upsertAttendeeParticipant(db, {
    ...registration,
    status: newStatus,
  });
  await writeAuditLog(
    db,
    "user",
    registration.user_id,
    "registration_email_confirmed",
    "registration",
    registration.id,
    {
      eventId: registration.event_id,
      status: newStatus,
      attendanceType: registration.attendance_type,
      ...(matchingInvite && {
        inviteId: matchingInvite.id,
        inviteAcceptedVia: "registration_confirmation",
      }),
      ...(emailMergeNote && { emailMerge: emailMergeNote }),
    },
  );
  const updated = await first<RegistrationRecord>(db, "SELECT * FROM registrations WHERE id = ?", [registration.id]);
  if (!updated) {
    throw new AppError(500, "REGISTRATION_CONFIRM_FAILED", "Registration update failed");
  }
  if (matchingInvite?.inviter_user_id) {
    await recordEngagement(db, {
      userId: matchingInvite.inviter_user_id,
      eventId: registration.event_id,
      subjectType: "invite",
      subjectRef: matchingInvite.id,
      actionType: "invite_accepted",
      points: 3,
      sourceType: "invite",
      sourceRef: matchingInvite.id,
      data: { inviteType: matchingInvite.invite_type, acceptedVia: "registration_confirmation" },
    });
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
  }

  // Rotate the manage token so the confirmed email always contains a valid, active link.
  const freshManageToken = randomToken(24);
  const freshManageHash = await sha256Hex(freshManageToken);
  await run(db, "UPDATE registrations SET manage_token_hash = ?, updated_at = ? WHERE id = ?", [
    freshManageHash,
    nowIso(),
    updated.id,
  ]);

  return { registration: { ...updated, manage_token_hash: freshManageHash }, manageToken: freshManageToken };
}
