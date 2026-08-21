import { all, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { issueDatabaseCapability } from "./capability-links";
import type { DatabaseLike } from "../types";
import { INVITE_COLUMNS, type InviteRecord } from "./invite-types";

export async function listPendingInviteReminders(db: DatabaseLike): Promise<InviteRecord[]> {
  return all<InviteRecord>(
    db,
    `SELECT ${INVITE_COLUMNS} FROM invites
     WHERE status = 'sent' AND reminder_count < 3 AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at ASC`,
    [nowIso()],
  );
}

export async function refreshInviteToken(db: DatabaseLike, inviteId: string, signingSecret: string): Promise<string> {
  return issueDatabaseCapability({ db, signingSecret, purpose: "invite", resourceId: inviteId });
}

export async function markInviteReminderSent(db: DatabaseLike, inviteId: string): Promise<void> {
  const now = nowIso();
  await run(
    db,
    `UPDATE invites
     SET reminder_count = reminder_count + 1,
         last_communication_at = ?,
         reminders_paused_until = NULL
     WHERE id = ?`,
    [now, inviteId],
  );
}

export async function setInviteRemindersPausedUntil(
  db: DatabaseLike,
  inviteId: string,
  pausedUntilIso: string,
): Promise<void> {
  await run(db, "UPDATE invites SET reminders_paused_until = ? WHERE id = ?", [pausedUntilIso, inviteId]);
}

export async function clearInviteRemindersPause(db: DatabaseLike, inviteId: string): Promise<void> {
  await run(db, "UPDATE invites SET reminders_paused_until = NULL WHERE id = ?", [inviteId]);
}
