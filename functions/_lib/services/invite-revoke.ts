import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { newCapabilityLinkSecret } from "../auth/capability-links";
import { prepareAuditLog, type AuditScope } from "./audit";
import type { EventRecord } from "./events";
import { isStaleInviteTransition, prepareInviteTransitionGuard } from "./invite-lifecycle";
import { INVITE_COLUMNS, type InviteRecord } from "./invite-types";

export interface EventInviteRevokePayload {
  event: EventRecord;
  inviteId: string;
  actor: AuthAdmin;
  expectedInviteType?: InviteRecord["invite_type"];
  auditScope?: AuditScope;
}

export async function revokeEventInvite(db: DatabaseLike, payload: EventInviteRevokePayload): Promise<void> {
  const invite = await first<InviteRecord>(
    db,
    `SELECT ${INVITE_COLUMNS} FROM invites WHERE id = ? AND event_id = ?${payload.expectedInviteType ? " AND invite_type = ?" : ""} LIMIT 1`,
    [payload.inviteId, payload.event.id, ...(payload.expectedInviteType ? [payload.expectedInviteType] : [])],
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
        .prepare(
          "UPDATE invites SET status = 'revoked', link_secret = ? WHERE id = ? AND event_id = ? AND status = 'sent'",
        )
        .bind(newCapabilityLinkSecret(), invite.id, payload.event.id),
      prepareAuditLog(
        db,
        "admin",
        payload.actor.id,
        "invite_revoked",
        "invite",
        invite.id,
        { eventId: payload.event.id, inviteType: invite.invite_type, recipientEmail: invite.invitee_email },
        now,
        null,
        payload.auditScope ?? null,
      ),
    ]);
  } catch (error) {
    if (!isStaleInviteTransition(error)) throw error;
    throw new AppError(409, "INVITE_CHANGED", "Invite state changed before it could be revoked");
  }
}
