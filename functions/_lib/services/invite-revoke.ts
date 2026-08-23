import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { prepareAuditLog } from "./audit";
import type { EventRecord } from "./events";
import { isStaleInviteTransition, prepareInviteTransitionGuard } from "./invite-lifecycle";
import { INVITE_COLUMNS, type InviteRecord } from "./invite-types";

export async function revokeInviteByAdmin(
  db: DatabaseLike,
  payload: { event: EventRecord; inviteId: string; admin: AuthAdmin },
): Promise<void> {
  const invite = await first<InviteRecord>(
    db,
    `SELECT ${INVITE_COLUMNS} FROM invites WHERE id = ? AND event_id = ? LIMIT 1`,
    [payload.inviteId, payload.event.id],
  );
  if (!invite) throw new AppError(404, "INVITE_NOT_FOUND", "Invite not found for this event");
  if (invite.status !== "sent") {
    throw new AppError(409, "INVITE_NOT_ACTIVE", "Invite is no longer pending");
  }

  const now = nowIso();
  try {
    await db.batch([
      prepareInviteTransitionGuard(db, invite),
      db
        .prepare("UPDATE invites SET status = 'revoked' WHERE id = ? AND event_id = ? AND status = 'sent'")
        .bind(invite.id, payload.event.id),
      prepareAuditLog(
        db,
        "admin",
        payload.admin.id,
        "invite_revoked",
        "invite",
        invite.id,
        { eventId: payload.event.id, inviteType: invite.invite_type, recipientEmail: invite.invitee_email },
        now,
      ),
    ]);
  } catch (error) {
    if (!isStaleInviteTransition(error)) throw error;
    throw new AppError(409, "INVITE_CHANGED", "Invite state changed before it could be revoked");
  }
}
