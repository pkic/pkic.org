import { AppError } from "../../errors";
import { first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { prepareEngagementStatement } from "../engagement";
import { prepareRemoveAllDayWaitlistStatement, resolveCapacityExemptReason } from "./day-waitlist";
import { isAuditOneChangeGuardFailure, prepareAuditLog } from "../audit";
import { prepareFinalizeEmailChange } from "./change-email";
import {
  isStaleInviteTransition,
  prepareAcceptInviteStatements,
  prepareRevokeDuplicateInvitesStatement,
} from "../invites";
import { INVITE_COLUMNS, type InviteRecord } from "../invite-types";
import { signCapabilityToken, verifyDatabaseCapability } from "../capability-links";
import type { DatabaseLike, StatementLike } from "../../types";
import { REGISTRATION_COLUMNS, type RegistrationRecord } from "./types";
import { isRegistrationTransitionConflict, prepareRegistrationTransitionGuard } from "./transition-guard";
import { prepareVerifyPrimaryEmailStatement } from "../email-verification";
import { prepareVerifiedDomainAssociationStatements } from "../organization-representations";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";

export interface PreparedRegistrationConfirmation {
  stage: "confirmed";
  registration: RegistrationRecord;
  manageToken: string;
  recipientEmail: string;
  statements: StatementLike[];
}

export function isStaleRegistrationTransition(error: unknown): boolean {
  return isRegistrationTransitionConflict(error) || isAuditOneChangeGuardFailure(error);
}

export async function prepareConfirmRegistrationByToken(
  db: DatabaseLike,
  payload: {
    token: string;
    registrationId?: string | null;
    eventId?: string | null;
    waitlistClaimWindowHours: number;
    confirmationTtlHours?: number;
    signingSecret: string;
  },
): Promise<PreparedRegistrationConfirmation> {
  const verified = await verifyDatabaseCapability({
    db,
    signingSecret: payload.signingSecret,
    purpose: "registration_confirm",
    token: payload.token,
  });
  if (!verified.ok) {
    throw new AppError(
      verified.reason === "expired" ? 410 : 404,
      verified.reason === "expired" ? "CONFIRM_TOKEN_EXPIRED" : "CONFIRM_TOKEN_INVALID",
      verified.reason === "expired"
        ? "Confirmation link has expired — please request a new one"
        : "Invalid or already-used confirmation token",
    );
  }
  const registration = await first<RegistrationRecord>(
    db,
    `SELECT ${REGISTRATION_COLUMNS} FROM registrations
     WHERE id = ?
       AND status = 'pending_email_confirmation'
       AND (? IS NULL OR id = ?)
       AND (? IS NULL OR event_id = ?)
       AND EXISTS (
         SELECT 1 FROM users
          WHERE users.id = registrations.user_id
            AND users.pii_redacted_at IS NULL
       )`,
    [
      verified.resourceId,
      payload.registrationId ?? null,
      payload.registrationId ?? null,
      payload.eventId ?? null,
      payload.eventId ?? null,
    ],
  );
  if (!registration) {
    throw new AppError(404, "CONFIRM_TOKEN_INVALID", "Invalid or already-used confirmation token");
  }
  const now = nowIso();
  if (registration.pending_confirmation_deadline_at && registration.pending_confirmation_deadline_at < now) {
    throw new AppError(410, "CONFIRM_TOKEN_EXPIRED", "Confirmation link has expired — please request a new one");
  }

  // Finalize any pending email change before confirming registration.
  // If finalization fails (e.g. EMAIL_TAKEN by a squatting account that
  // appeared after initiation), clear the pending_email reservation so the
  // user is not stuck and can retry from the manage URL.
  const emailFinalizeStatements: StatementLike[] = [];
  let finalizedRegistration = registration;
  const user = await first<{
    email: string;
    pending_email: string | null;
    pending_email_change_registration_id: string | null;
    normalized_email: string;
  }>(
    db,
    `SELECT email, pending_email, pending_email_change_registration_id, normalized_email
       FROM users WHERE id = ?`,
    [registration.user_id],
  );
  if (!user) {
    throw new AppError(500, "USER_NOT_FOUND", "Associated user record is missing");
  }
  const ownsPendingEmailChange = Boolean(
    user.pending_email && user.pending_email_change_registration_id === registration.id,
  );

  let inviteEmail = user?.normalized_email ?? null;
  if (ownsPendingEmailChange) {
    try {
      const emailResult = await prepareFinalizeEmailChange(db, {
        userId: registration.user_id,
        eventId: registration.event_id,
        registrationId: registration.id,
        rotateManageLink: false,
      });
      inviteEmail = emailResult.finalEmail;
      finalizedRegistration = emailResult.registration;
      emailFinalizeStatements.push(...emailResult.statements);
    } catch (err) {
      if (err instanceof AppError && err.code === "EMAIL_TAKEN") {
        // Clear the dangling pending_email reservation so the user can pick
        // a different address. Leave the registration in
        // pending_email_confirmation so the manage URL still works.
        await db.batch([
          prepareRegistrationTransitionGuard(db, registration),
          db
            .prepare(
              `UPDATE registrations
                  SET confirmation_link_secret = NULL,
                      pending_confirmation_deadline_at = NULL,
                      confirmation_reminder_sent_at = NULL,
                      updated_at = ?
                WHERE id = ? AND confirmation_link_secret IS ?`,
            )
            .bind(now, registration.id, registration.confirmation_link_secret),
          db
            .prepare(
              `UPDATE users
                  SET pending_email = NULL, pending_email_expires_at = NULL,
                      pending_email_change_registration_id = NULL, updated_at = ?
                WHERE id = ? AND pending_email = ? AND pending_email_change_registration_id = ?`,
            )
            .bind(now, registration.user_id, user.pending_email, registration.id),
          prepareAuditLog(
            db,
            "system",
            null,
            "registration_email_change_failed",
            "registration",
            registration.id,
            { reason: "email_taken_at_confirmation" },
            now,
            `registration_email_change_failed:${registration.id}:${user.pending_email}`,
          ),
        ]);
      }
      throw err;
    }
  }

  const matchingInvite =
    !registration.invite_id && inviteEmail
      ? await first<InviteRecord>(
          db,
          `SELECT ${INVITE_COLUMNS}
           FROM invites
           WHERE event_id = ? AND invitee_email = ? AND invite_type = 'attendee' AND status = 'sent'
           ORDER BY created_at ASC
           LIMIT 1`,
          [registration.event_id, inviteEmail],
        )
      : null;

  const capacityExemptReason = await resolveCapacityExemptReason(db, {
    eventId: registration.event_id,
    userId: registration.user_id,
  });
  const newStatus = "registered";
  const verifiedEmail = inviteEmail ?? user.normalized_email;
  const representationStatements = await prepareVerifiedDomainAssociationStatements(db, {
    userId: registration.user_id,
    normalizedEmail: verifiedEmail,
    at: now,
  });

  const updateStatements: StatementLike[] = [
    prepareRegistrationTransitionGuard(db, registration),
    ...emailFinalizeStatements,
    prepareVerifyPrimaryEmailStatement(db, {
      userId: registration.user_id,
      normalizedEmail: verifiedEmail,
      method: ownsPendingEmailChange ? "email_change_confirmation" : "registration_confirmation",
      verifiedAt: now,
    }),
    ...representationStatements,
    db
      .prepare(
        `UPDATE registrations
         SET status = ?, confirmed_at = ?, confirmation_link_secret = NULL,
             pending_confirmation_deadline_at = NULL, confirmation_reminder_sent_at = NULL,
             manage_link_secret = ?, created_identity_user_id = NULL,
             invite_id = COALESCE(invite_id, ?), capacity_exempt_in_person = ?,
             capacity_exempt_reason = ?, updated_at = ?
         WHERE id = ? AND status = 'pending_email_confirmation'`,
      )
      .bind(
        newStatus,
        now,
        finalizedRegistration.manage_link_secret,
        matchingInvite?.id ?? null,
        capacityExemptReason ? 1 : 0,
        capacityExemptReason,
        now,
        registration.id,
      ),
  ];
  // A role-based attendee does not consume day capacity. Remove any waiting
  // or offered rows atomically with confirmation so a stale row cannot later
  // be promoted as though this registration still needed a seat.
  if (capacityExemptReason) {
    updateStatements.push(
      prepareRemoveAllDayWaitlistStatement(db, {
        registrationId: registration.id,
        reasonCode: "capacity_exempt",
        reasonNote: capacityExemptReason,
      }),
    );
  }
  if (matchingInvite) {
    updateStatements.push(...prepareAcceptInviteStatements(db, matchingInvite));
  }
  if (inviteEmail) {
    updateStatements.push(
      prepareRevokeDuplicateInvitesStatement(db, {
        eventId: registration.event_id,
        inviteeEmail: inviteEmail,
        keepInviteId: registration.invite_id ?? matchingInvite?.id ?? null,
      }),
    );
  }
  updateStatements.push(
    prepareAuditLog(
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
      },
      now,
      `registration_email_confirmed:${registration.id}`,
    ),
    prepareEngagementStatement(db, {
      userId: registration.user_id,
      eventId: registration.event_id,
      subjectType: "registration",
      subjectRef: registration.id,
      actionType: "registration_confirmed",
      points: 5,
      sourceType: "registration",
      sourceRef: registration.id,
      idempotencyKey: `registration_confirmed:registration:${registration.id}`,
    }),
  );
  const updated: RegistrationRecord = {
    ...finalizedRegistration,
    status: newStatus,
    invite_id: registration.invite_id ?? matchingInvite?.id ?? null,
    confirmation_link_secret: null,
    pending_confirmation_deadline_at: null,
    capacity_exempt_in_person: capacityExemptReason ? 1 : 0,
    capacity_exempt_reason: capacityExemptReason,
    confirmed_at: now,
    created_identity_user_id: null,
    transition_revision: registration.transition_revision + 2,
    updated_at: now,
  };
  const manageToken = await signCapabilityToken({
    signingSecret: payload.signingSecret,
    linkSecret: updated.manage_link_secret,
    purpose: "registration_manage",
    resourceId: updated.id,
  });
  return {
    stage: "confirmed",
    registration: updated,
    manageToken,
    recipientEmail: inviteEmail ?? user.normalized_email,
    statements: updateStatements,
  };
}

export async function confirmRegistrationByToken(
  db: DatabaseLike,
  payload: Parameters<typeof prepareConfirmRegistrationByToken>[1],
): Promise<{ registration: RegistrationRecord; manageToken: string }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prepared = await prepareConfirmRegistrationByToken(db, payload);
    try {
      await db.batch(prepared.statements);
    } catch (error) {
      if (isAuthorizationGuardFailure(error)) {
        throw new AppError(410, "INVITE_EXPIRED", "Linked invitation has expired");
      }
      if (isStaleRegistrationTransition(error)) {
        throw new AppError(404, "CONFIRM_TOKEN_INVALID", "Invalid or already-used confirmation token");
      }
      if (isStaleInviteTransition(error) && attempt === 0) continue;
      if (isStaleInviteTransition(error)) {
        throw new AppError(409, "INVITE_CHANGED", "Linked invite state changed; please retry confirmation");
      }
      throw error;
    }
    const registration = await first<RegistrationRecord>(
      db,
      `SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE id = ?`,
      [prepared.registration.id],
    );
    if (!registration) throw new AppError(500, "REGISTRATION_CONFIRM_FAILED", "Registration update failed");
    return { registration, manageToken: prepared.manageToken };
  }
  throw new AppError(409, "INVITE_CHANGED", "Linked invite state changed; please retry confirmation");
}
