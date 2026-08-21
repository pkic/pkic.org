import { first } from "../db/queries";
import { prepareQueueEmailStatement } from "../email/outbox";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { prepareAuditLog } from "./audit";
import type { EventRecord } from "./events";
import { buildInviteEmailQueueRow } from "./invite-email";
import { isStaleInviteTransition, prepareInviteTransitionGuard } from "./invite-lifecycle";
import { INVITE_COLUMNS, type InviteRecord } from "./invite-types";

export async function resendInviteByAdmin(
  db: DatabaseLike,
  payload: { event: EventRecord; inviteId: string; admin: AuthAdmin; appBaseUrl: string },
): Promise<{ inviteId: string; inviteType: InviteRecord["invite_type"]; resentAt: string; outboxId: string }> {
  const invite = await first<InviteRecord>(
    db,
    `SELECT ${INVITE_COLUMNS} FROM invites WHERE id = ? AND event_id = ? LIMIT 1`,
    [payload.inviteId, payload.event.id],
  );
  if (!invite) throw new AppError(404, "INVITE_NOT_FOUND", "Invite not found for this event");
  if (invite.status === "accepted") {
    throw new AppError(409, "INVITE_ALREADY_ACCEPTED", "Cannot resend an invite that was already accepted");
  }
  if (invite.status === "revoked") throw new AppError(409, "INVITE_REVOKED", "Cannot resend a revoked invite");

  const now = nowIso();
  const subject =
    invite.invite_type === "attendee"
      ? `Invitation: ${payload.event.name}`
      : `Speaker invitation: ${payload.event.name}`;
  const emailPayload = buildInviteEmailQueueRow({
    event: payload.event,
    invite,
    appBaseUrl: payload.appBaseUrl,
    source: invite.invite_type === "attendee" ? "invite_resend" : "speaker_invite_resend",
    subject,
    reminderCount: "manual",
  });
  const queued = prepareQueueEmailStatement(
    db,
    { ...emailPayload, baseUrl: payload.appBaseUrl, messageType: "transactional" },
    now,
  );
  try {
    await db.batch([
      prepareInviteTransitionGuard(db, invite),
      db
        .prepare(
          `UPDATE invites
           SET status = 'sent', decline_reason_code = NULL, decline_reason_note = NULL,
               declined_at = NULL, expires_at = NULL, last_communication_at = ?
           WHERE id = ? AND status NOT IN ('accepted', 'revoked')`,
        )
        .bind(now, invite.id),
      queued.statement,
      prepareAuditLog(
        db,
        "admin",
        payload.admin.id,
        "invite_resent",
        "invite",
        invite.id,
        { eventId: payload.event.id, inviteType: invite.invite_type, recipientEmail: invite.invitee_email },
        now,
      ),
    ]);
  } catch (error) {
    if (!isStaleInviteTransition(error)) throw error;
    throw new AppError(409, "INVITE_CHANGED", "Invite state changed before it could be resent");
  }
  return { inviteId: invite.id, inviteType: invite.invite_type, resentAt: now, outboxId: queued.id };
}
