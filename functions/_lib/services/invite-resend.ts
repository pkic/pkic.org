import { first } from "../db/queries";
import { prepareQueueEmailStatement } from "../email/outbox";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import { nowIso } from "../utils/time";
import { sha256Hex } from "../utils/crypto";
import { newCapabilityLinkSecret } from "../auth/capability-links";
import { prepareAuditLog, type AuditScope } from "./audit";
import type { EventRecord } from "./events";
import { buildInviteEmailQueueRow } from "./invite-email";
import { isStaleInviteTransition, prepareInviteTransitionGuard } from "./invite-lifecycle";
import { INVITE_COLUMNS, type InviteRecord } from "./invite-types";
import { eventInviteWindowEvidence, resolveEventInviteExpiry } from "../invite-validity";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";

export interface EventInviteResendPayload {
  event: EventRecord;
  inviteId: string;
  actor: AuthAdmin;
  appBaseUrl: string;
  expectedInviteType?: InviteRecord["invite_type"];
  auditScope?: AuditScope;
  expiresAt?: string;
  /** Route-specific live authorization evidence committed with the resend. */
  authorizationStatements?: StatementLike[];
}

export async function resendEventInvite(
  db: DatabaseLike,
  payload: EventInviteResendPayload,
): Promise<{
  inviteId: string;
  inviteType: InviteRecord["invite_type"];
  resentAt: string;
  expiresAt: string;
  outboxId: string;
}> {
  const invite = await first<InviteRecord>(
    db,
    `SELECT ${INVITE_COLUMNS} FROM invites WHERE id = ? AND event_id = ?${payload.expectedInviteType ? " AND invite_type = ?" : ""} LIMIT 1`,
    [payload.inviteId, payload.event.id, ...(payload.expectedInviteType ? [payload.expectedInviteType] : [])],
  );
  if (!invite) throw new AppError(404, "INVITE_NOT_FOUND", "Invite not found for this event");
  if (invite.status === "accepted") {
    throw new AppError(409, "INVITE_ALREADY_ACCEPTED", "Cannot resend an invite that was already accepted");
  }
  if (invite.status === "revoked") throw new AppError(409, "INVITE_REVOKED", "Cannot resend a revoked invite");

  const now = nowIso();
  // Omission deliberately means the event start, exactly as it does for new
  // invitations and reviewed previews. A resend may therefore reactivate a
  // previously expired invitation after the organizer sets a future event
  // schedule, without inheriting its stale historical deadline.
  const expiresAt = resolveEventInviteExpiry(payload.event, payload.expiresAt, now);
  const linkSecret = newCapabilityLinkSecret();
  const subject =
    invite.invite_type === "attendee"
      ? `Invitation: ${payload.event.name}`
      : `Speaker invitation: ${payload.event.name}`;
  const emailPayload = buildInviteEmailQueueRow({
    event: payload.event,
    invite: { ...invite, expires_at: expiresAt },
    appBaseUrl: payload.appBaseUrl,
    source: invite.invite_type === "attendee" ? "invite_resend" : "speaker_invite_resend",
    subject,
    reminderCount: "manual",
    linkSecretFingerprint: await sha256Hex(linkSecret),
  });
  const queued = prepareQueueEmailStatement(
    db,
    { ...emailPayload, baseUrl: payload.appBaseUrl, messageType: "transactional" },
    now,
  );
  try {
    await db.batch([
      prepareAuthorizationGuard(db, eventInviteWindowEvidence(payload.event.id, payload.event, expiresAt, now)),
      prepareInviteTransitionGuard(db, invite),
      ...(payload.authorizationStatements ?? []),
      db
        .prepare(
          `UPDATE invites
           SET status = 'sent', link_secret = ?, decline_reason_code = NULL, decline_reason_note = NULL,
               declined_at = NULL, expires_at = ?, last_communication_at = ?
           WHERE id = ? AND status NOT IN ('accepted', 'revoked')`,
        )
        .bind(linkSecret, expiresAt, now, invite.id),
      queued.statement,
      prepareAuditLog(
        db,
        "admin",
        payload.actor.id,
        "invite_resent",
        "invite",
        invite.id,
        {
          eventId: payload.event.id,
          inviteType: invite.invite_type,
          recipientEmail: invite.invitee_email,
          expiresAt,
        },
        now,
        null,
        payload.auditScope ?? null,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "EVENT_INVITE_WINDOW_CHANGED",
        "The event schedule changed before the invitation could be resent. Review the deadline and try again.",
      );
    }
    if (!isStaleInviteTransition(error)) throw error;
    throw new AppError(409, "INVITE_CHANGED", "Invite state changed before it could be resent");
  }
  return { inviteId: invite.id, inviteType: invite.invite_type, resentAt: now, expiresAt, outboxId: queued.id };
}
