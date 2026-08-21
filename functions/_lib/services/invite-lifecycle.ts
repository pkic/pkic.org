import { AppError } from "../errors";
import { all, first } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { prepareEngagementStatement } from "./engagement";
import { verifyDatabaseCapability } from "./capability-links";
import type { DatabaseLike, StatementLike } from "../types";
import { INVITE_COLUMNS, type InviteRecord } from "./invite-types";

export function prepareInviteTransitionGuard(
  db: DatabaseLike,
  invite: Pick<InviteRecord, "id" | "transition_revision">,
): StatementLike {
  return db
    .prepare(
      `INSERT INTO invite_transition_guards (id, invite_id, expected_revision)
       VALUES (?, ?, ?)`,
    )
    .bind(uuid(), invite.id, invite.transition_revision);
}

export function isStaleInviteTransition(error: unknown): boolean {
  return error instanceof Error && error.message.includes("INVITE_CHANGED");
}

export async function findInviteByToken(
  db: DatabaseLike,
  token: string,
  signingSecret: string,
  inviteId?: string | null,
): Promise<InviteRecord> {
  const verified = await verifyDatabaseCapability({ db, signingSecret, purpose: "invite", token });
  if (!verified.ok) {
    throw new AppError(
      verified.reason === "expired" ? 410 : 404,
      verified.reason === "expired" ? "INVITE_EXPIRED" : "INVITE_NOT_FOUND",
      verified.reason === "expired" ? "Invite link has expired" : "Invite token is invalid",
    );
  }
  const invite = await first<InviteRecord>(
    db,
    `SELECT ${INVITE_COLUMNS} FROM invites WHERE id = ? AND (? IS NULL OR id = ?)`,
    [verified.resourceId, inviteId ?? null, inviteId ?? null],
  );
  if (!invite) {
    throw new AppError(404, "INVITE_NOT_FOUND", "Invite token is invalid");
  }

  if (invite.status !== "sent") {
    throw new AppError(409, "INVITE_NOT_ACTIVE", "Invite is not active anymore");
  }

  return invite;
}

export async function acceptInvite(db: DatabaseLike, inviteId: string): Promise<void> {
  const invite = await first<InviteRecord>(db, `SELECT ${INVITE_COLUMNS} FROM invites WHERE id = ?`, [inviteId]);
  if (!invite) throw new AppError(404, "INVITE_NOT_FOUND", "Invite not found");
  if (invite.status === "accepted") return;
  if (invite.status !== "sent") throw new AppError(409, "INVITE_NOT_ACTIVE", "Invite is not active anymore");
  try {
    await db.batch(prepareAcceptInviteStatements(db, invite));
  } catch (error) {
    if (!isStaleInviteTransition(error)) throw error;
    throw new AppError(409, "INVITE_CHANGED", "Invite state changed; please retry");
  }
}

export function prepareAcceptInviteStatements(db: DatabaseLike, invite: InviteRecord): StatementLike[] {
  const statements: StatementLike[] = [
    prepareInviteTransitionGuard(db, invite),
    db
      .prepare(
        `UPDATE invites
         SET status = 'accepted', accepted_at = ?, used_count = used_count + 1
         WHERE id = ? AND status = 'sent'`,
      )
      .bind(nowIso(), invite.id),
  ];
  if (invite.inviter_user_id) {
    statements.push(
      prepareEngagementStatement(db, {
        userId: invite.inviter_user_id,
        eventId: invite.event_id,
        subjectType: "invite",
        subjectRef: invite.id,
        actionType: "invite_accepted",
        points: 3,
        sourceType: "invite",
        sourceRef: invite.id,
        idempotencyKey: `invite_accepted:invite:${invite.id}`,
        data: { inviteType: invite.invite_type },
      }),
    );
  }
  return statements;
}

export async function revokeDuplicateInvitesForEmail(
  db: DatabaseLike,
  payload: {
    eventId: string;
    inviteeEmail: string;
    keepInviteId?: string | null;
  },
): Promise<string[]> {
  const inviteeEmail = normalizeEmail(payload.inviteeEmail);
  const rows = await all<{ id: string }>(
    db,
    `SELECT id
     FROM invites
     WHERE event_id = ?
       AND invitee_email = ?
       AND status = 'sent'
       AND (? IS NULL OR id != ?)
     ORDER BY created_at ASC`,
    [payload.eventId, inviteeEmail, payload.keepInviteId ?? null, payload.keepInviteId ?? null],
  );

  if (rows.length === 0) {
    return [];
  }

  await db.batch([prepareRevokeDuplicateInvitesStatement(db, payload)]);

  return rows.map((row) => row.id);
}

export function prepareRevokeDuplicateInvitesStatement(
  db: DatabaseLike,
  payload: { eventId: string; inviteeEmail: string; keepInviteId?: string | null },
): StatementLike {
  const inviteeEmail = normalizeEmail(payload.inviteeEmail);
  return db
    .prepare(
      `UPDATE invites
     SET status = 'revoked'
     WHERE event_id = ?
       AND invitee_email = ?
       AND status = 'sent'
       AND (? IS NULL OR id != ?)`,
    )
    .bind(payload.eventId, inviteeEmail, payload.keepInviteId ?? null, payload.keepInviteId ?? null);
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
  const invite = await first<InviteRecord>(db, `SELECT ${INVITE_COLUMNS} FROM invites WHERE id = ?`, [
    payload.inviteId,
  ]);
  if (!invite) throw new AppError(404, "INVITE_NOT_FOUND", "Invite not found");
  if (invite.status === "declined") return;
  if (invite.status !== "sent") throw new AppError(409, "INVITE_NOT_ACTIVE", "Invite is not active anymore");
  try {
    await db.batch(prepareDeclineInviteStatements(db, invite, payload));
  } catch (error) {
    if (!isStaleInviteTransition(error)) throw error;
    throw new AppError(409, "INVITE_CHANGED", "Invite state changed; please retry");
  }
}

export function prepareDeclineInviteStatements(
  db: DatabaseLike,
  invite: InviteRecord,
  payload: {
    inviteId: string;
    reasonCode: string;
    reasonNote?: string | null;
    unsubscribeFuture?: boolean;
    npsScore?: number | null;
  },
): StatementLike[] {
  const now = nowIso();
  const statements: StatementLike[] = [
    prepareInviteTransitionGuard(db, invite),
    db
      .prepare(
        `UPDATE invites
     SET status = 'declined', decline_reason_code = ?, decline_reason_note = ?,
         unsubscribe_future = ?, nps_score = ?, declined_at = ?
     WHERE id = ? AND status = 'sent'`,
      )
      .bind(
        payload.reasonCode,
        payload.reasonNote ?? null,
        payload.unsubscribeFuture ? 1 : 0,
        payload.npsScore ?? null,
        now,
        payload.inviteId,
      ),
  ];
  if (payload.unsubscribeFuture) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO unsubscribes (
        id, email, channel, scope_type, scope_ref, reason, created_at
      ) VALUES (?, ?, 'invites', 'global', NULL, ?, ?)`,
        )
        .bind(uuid(), invite.invitee_email, payload.reasonCode, now),
    );
  }
  return statements;
}
