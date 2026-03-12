import { AppError } from "../errors";
import { all, first, run } from "../db/queries";
import { normalizeEmail } from "../validation";
import { randomToken, sha256Hex } from "../utils/crypto";
import { nowIso, addHours, isPast } from "../utils/time";
import { uuid } from "../utils/ids";
import { parseJsonSafe } from "../utils/json";
import { recordEngagement } from "./engagement";
import type { DatabaseLike } from "../types";

export interface InviteRecord {
  id: string;
  event_id: string;
  inviter_user_id: string | null;
  inviter_registration_id: string | null;
  invitee_email: string;
  invitee_first_name: string | null;
  invitee_last_name: string | null;
  invite_type: "attendee" | "speaker";
  token_hash: string;
  status: "sent" | "accepted" | "declined" | "expired" | "revoked";
  decline_reason_code: string | null;
  decline_reason_note: string | null;
  unsubscribe_future: number;
  reminder_count: number;
  last_communication_at: string | null;
  reminders_paused_until: string | null;
  max_uses: number;
  used_count: number;
  source_type: string;
  expires_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  created_at: string;
}

export async function countInvitesByInviter(
  db: DatabaseLike,
  eventId: string,
  inviterUserId: string,
): Promise<number> {
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total
     FROM invites
     WHERE event_id = ? AND inviter_user_id = ? AND invite_type = 'attendee'`,
    [eventId, inviterUserId],
  );

  return Number(row?.total ?? 0);
}

export async function isUnsubscribed(db: DatabaseLike, email: string, eventId: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const row = await first<{ id: string }>(
    db,
    `SELECT id
     FROM unsubscribes
     WHERE email = ?
       AND channel = 'invites'
       AND (
         (scope_type = 'global' AND scope_ref IS NULL) OR
         (scope_type = 'event' AND scope_ref = ?)
       )
     LIMIT 1`,
    [normalized, eventId],
  );

  return Boolean(row);
}

export async function createInvite(
  db: DatabaseLike,
  payload: {
    eventId: string;
    inviterUserId?: string | null;
    inviterRegistrationId?: string | null;
    inviteeEmail: string;
    inviteeFirstName?: string | null;
    inviteeLastName?: string | null;
    inviteType: "attendee" | "speaker";
    sourceType?: string;
    ttlHours: number;
  },
): Promise<{ invite: InviteRecord; token: string }> {
  const inviteeEmail = normalizeEmail(payload.inviteeEmail);
  if (await isUnsubscribed(db, inviteeEmail, payload.eventId)) {
    throw new AppError(409, "INVITEE_UNSUBSCRIBED", "Invitee has unsubscribed from future invitations");
  }

  const token = randomToken(24);
  const tokenHash = await sha256Hex(token);
  const now = nowIso();
  let expiresAt = addHours(now, payload.ttlHours);

  const event = await first<{
    starts_at: string | null;
    registration_mode: string;
    settings_json: string;
  }>(
    db,
    "SELECT starts_at, registration_mode, settings_json FROM events WHERE id = ?",
    [payload.eventId],
  );

  const registrationClosesAt = event
    ? (() => {
      const settings = parseJsonSafe<{ registrationClosesAt?: string | null; registration?: { closesAt?: string | null } }>(
        event.settings_json,
        {},
      );
      return settings.registration?.closesAt ?? settings.registrationClosesAt ?? null;
    })()
    : null;

  // Marketing-style invites for open registration remain valid until registration closes.
  if (
    event
    && event.registration_mode !== "invite_only"
    && registrationClosesAt
    && new Date(registrationClosesAt).getTime() > new Date(now).getTime()
  ) {
    expiresAt = new Date(registrationClosesAt).toISOString();
  }

  if (event?.starts_at) {
    const eventStartMs = new Date(event.starts_at).getTime();
    const nowMs = new Date(now).getTime();
    const currentExpiryMs = new Date(expiresAt).getTime();
    if (Number.isFinite(eventStartMs) && eventStartMs > nowMs && eventStartMs < currentExpiryMs) {
      expiresAt = new Date(eventStartMs).toISOString();
    }
  }

  const invite: InviteRecord = {
    id: uuid(),
    event_id: payload.eventId,
    inviter_user_id: payload.inviterUserId ?? null,
    inviter_registration_id: payload.inviterRegistrationId ?? null,
    invitee_email: inviteeEmail,
    invitee_first_name: payload.inviteeFirstName ?? null,
    invitee_last_name: payload.inviteeLastName ?? null,
    invite_type: payload.inviteType,
    token_hash: tokenHash,
    status: "sent",
    decline_reason_code: null,
    decline_reason_note: null,
    unsubscribe_future: 0,
    reminder_count: 0,
    last_communication_at: now,
    reminders_paused_until: null,
    max_uses: 1,
    used_count: 0,
    source_type: payload.sourceType ?? "direct",
    expires_at: expiresAt,
    accepted_at: null,
    declined_at: null,
    created_at: now,
  };

  await run(
    db,
    `INSERT INTO invites (
      id, event_id, inviter_user_id, inviter_registration_id, invitee_email, invitee_first_name, invitee_last_name, invite_type,
      token_hash, status, decline_reason_code, decline_reason_note, unsubscribe_future, reminder_count,
      last_communication_at, reminders_paused_until,
      max_uses, used_count, source_type, expires_at, accepted_at, declined_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invite.id,
      invite.event_id,
      invite.inviter_user_id,
      invite.inviter_registration_id,
      invite.invitee_email,
      invite.invitee_first_name,
      invite.invitee_last_name,
      invite.invite_type,
      invite.token_hash,
      invite.status,
      invite.decline_reason_code,
      invite.decline_reason_note,
      invite.unsubscribe_future,
      invite.reminder_count,
      invite.last_communication_at,
      invite.reminders_paused_until,
      invite.max_uses,
      invite.used_count,
      invite.source_type,
      invite.expires_at,
      invite.accepted_at,
      invite.declined_at,
      invite.created_at,
    ],
  );

  if (invite.inviter_user_id) {
    await recordEngagement(db, {
      userId: invite.inviter_user_id,
      eventId: invite.event_id,
      subjectType: "invite",
      subjectRef: invite.id,
      actionType: "invite_sent",
      points: 1,
      sourceType: "invite",
      sourceRef: invite.id,
    });
  }

  return { invite, token };
}

export async function findInviteByToken(db: DatabaseLike, token: string): Promise<InviteRecord> {
  const tokenHash = await sha256Hex(token);
  const invite = await first<InviteRecord>(db, "SELECT * FROM invites WHERE token_hash = ?", [tokenHash]);
  if (!invite) {
    throw new AppError(404, "INVITE_NOT_FOUND", "Invite token is invalid");
  }

  if (invite.status !== "sent") {
    throw new AppError(409, "INVITE_NOT_ACTIVE", "Invite is not active anymore");
  }

  if (invite.expires_at && isPast(invite.expires_at)) {
    await run(db, "UPDATE invites SET status = 'expired' WHERE id = ?", [invite.id]);
    throw new AppError(410, "INVITE_EXPIRED", "Invite token has expired");
  }

  return invite;
}

export async function acceptInvite(db: DatabaseLike, inviteId: string): Promise<void> {
  const invite = await first<InviteRecord>(db, "SELECT * FROM invites WHERE id = ?", [inviteId]);
  await run(
    db,
    `UPDATE invites
     SET status = 'accepted', accepted_at = ?, used_count = used_count + 1
     WHERE id = ?`,
    [nowIso(), inviteId],
  );

  if (invite?.inviter_user_id) {
    await recordEngagement(db, {
      userId: invite.inviter_user_id,
      eventId: invite.event_id,
      subjectType: "invite",
      subjectRef: invite.id,
      actionType: "invite_accepted",
      points: 3,
      sourceType: "invite",
      sourceRef: invite.id,
      data: { inviteType: invite.invite_type },
    });
  }
}

export async function declineInvite(
  db: DatabaseLike,
  payload: {
    inviteId: string;
    reasonCode: string;
    reasonNote?: string | null;
    unsubscribeFuture?: boolean;
    npsScore?: number | null;
  },
): Promise<void> {
  const now = nowIso();
  await run(
    db,
    `UPDATE invites
     SET status = 'declined', decline_reason_code = ?, decline_reason_note = ?,
         unsubscribe_future = ?, nps_score = ?, declined_at = ?
     WHERE id = ?`,
    [
      payload.reasonCode,
      payload.reasonNote ?? null,
      payload.unsubscribeFuture ? 1 : 0,
      payload.npsScore ?? null,
      now,
      payload.inviteId,
    ],
  );

  const invite = await first<InviteRecord>(db, "SELECT * FROM invites WHERE id = ?", [payload.inviteId]);
  if (invite && payload.unsubscribeFuture) {
    await run(
      db,
      `INSERT OR IGNORE INTO unsubscribes (
        id, email, channel, scope_type, scope_ref, reason, created_at
      ) VALUES (?, ?, 'invites', 'global', NULL, ?, ?)`,
      [uuid(), invite.invitee_email, payload.reasonCode, now],
    );
  }
}

export async function listPendingInviteReminders(db: DatabaseLike): Promise<InviteRecord[]> {
  return all<InviteRecord>(
    db,
    `SELECT * FROM invites
     WHERE status = 'sent' AND reminder_count < 3 AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at ASC`,
    [nowIso()],
  );
}

export async function refreshInviteToken(db: DatabaseLike, inviteId: string): Promise<string> {
  const token = randomToken(24);
  const tokenHash = await sha256Hex(token);
  await run(db, "UPDATE invites SET token_hash = ? WHERE id = ?", [tokenHash, inviteId]);
  return token;
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
