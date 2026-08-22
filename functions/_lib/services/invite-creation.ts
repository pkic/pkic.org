import { AppError } from "../errors";
import { first } from "../db/queries";
import { queryPage } from "../db/pagination";
import { normalizeEmail } from "../validation";
import { addHours, nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { prepareEngagementStatement } from "./engagement";
import { newCapabilityLinkSecret, signedOrQueuedCapability } from "./capability-links";
import type { DatabaseLike, StatementLike } from "../types";
import { INVITE_COLUMNS, type InviteInviterInfo, type InviteRecord } from "./invite-types";

export function formatInviterList(inviters: InviteInviterInfo[]): string {
  if (inviters.length === 0) return "";

  const label = (i: InviteInviterInfo) => {
    const name = [i.firstName, i.lastName].filter(Boolean).join(" ") || "A colleague";
    return i.organizationName ? `${name} (${i.organizationName})` : name;
  };

  if (inviters.length === 1) return label(inviters[0]);
  if (inviters.length === 2) return `${label(inviters[0])} and ${label(inviters[1])}`;

  const others = inviters.length - 2;
  return `${label(inviters[0])}, ${label(inviters[1])} and ${others} ${others === 1 ? "other" : "others"}`;
}

export async function countInvitesByInviter(
  db: DatabaseLike,
  eventId: string,
  inviterUserId: string,
  inviteType: "attendee" | "speaker" = "attendee",
): Promise<number> {
  // Count only primary invites (invite rows where this user is the original inviter).
  // Co-invites (endorsements of someone already invited) do not consume invite quota
  // since they do not trigger new emails.
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total
     FROM invites
     WHERE event_id = ? AND inviter_user_id = ? AND invite_type = ?`,
    [eventId, inviterUserId, inviteType],
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
    ttlHours?: number | null;
    signingSecret?: string;
  },
  // isNew: true  → fresh invite row created, caller must send the invite email.
  // isNew: false → invitee already has an active invite; this inviter was recorded
  //                as a co-inviter (social proof) but NO new email should be sent.
): Promise<{ invite: InviteRecord; token: string; isNew: boolean }> {
  const inviteeEmail = normalizeEmail(payload.inviteeEmail);
  const now = nowIso();
  const expiresAt = payload.ttlHours == null ? null : addHours(now, payload.ttlHours);

  if (await isUnsubscribed(db, inviteeEmail, payload.eventId)) {
    throw new AppError(409, "INVITEE_UNSUBSCRIBED", "Invitee has unsubscribed from future invitations");
  }

  // Guard: do not send an attendee invite to someone already registered for the event.
  // Speaker invites are allowed regardless of registration status — a registered
  // attendee can also be invited to speak.
  if (payload.inviteType === "attendee") {
    const alreadyRegistered = await first<{ id: string }>(
      db,
      `SELECT r.id
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       WHERE u.normalized_email = ? AND r.event_id = ? AND r.status NOT IN ('cancelled')
       LIMIT 1`,
      [inviteeEmail, payload.eventId],
    );
    if (alreadyRegistered) {
      throw new AppError(409, "INVITEE_ALREADY_REGISTERED", "Invitee is already registered for this event");
    }
  }

  // Guard: do not invite a speaker who already has an active proposal for this event.
  if (payload.inviteType === "speaker") {
    const alreadyProposed = await first<{ id: string }>(
      db,
      `SELECT ps.id
       FROM proposal_speakers ps
       JOIN session_proposals sp ON sp.id = ps.proposal_id
       JOIN users u ON u.id = ps.user_id
       WHERE u.normalized_email = ? AND sp.event_id = ?
         AND sp.status NOT IN ('rejected', 'withdrawn')
         AND ps.status NOT IN ('declined')
       LIMIT 1`,
      [inviteeEmail, payload.eventId],
    );
    if (alreadyProposed) {
      throw new AppError(409, "INVITEE_ALREADY_PROPOSED", "Invitee already has an active proposal for this event");
    }
  }

  // Deduplication: if an active sent invite already exists for this
  // invitee+event+type, record the new inviter as a co-inviter for social proof
  // and return without creating a second invite or sending a second email.
  const existingInvite = await first<InviteRecord>(
    db,
    `SELECT ${INVITE_COLUMNS} FROM invites
     WHERE event_id = ? AND invitee_email = ? AND invite_type = ? AND status = 'sent'
     LIMIT 1`,
    [payload.eventId, inviteeEmail, payload.inviteType],
  );

  if (existingInvite) {
    if (payload.inviterUserId) {
      const existingInviter = await first<{ id: string }>(
        db,
        "SELECT id FROM invite_inviters WHERE invite_id = ? AND inviter_user_id = ?",
        [existingInvite.id, payload.inviterUserId],
      );
      if (existingInviter) return { invite: existingInvite, token: "", isNew: false };
      await db.batch([
        db
          .prepare(
            `INSERT OR IGNORE INTO invite_inviters
           (id, invite_id, inviter_user_id, inviter_registration_id, source_type, invited_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            uuid(),
            existingInvite.id,
            payload.inviterUserId,
            payload.inviterRegistrationId ?? null,
            payload.sourceType ?? "direct",
            now,
          ),
        prepareEngagementStatement(db, {
          userId: payload.inviterUserId,
          eventId: payload.eventId,
          subjectType: "invite",
          subjectRef: existingInvite.id,
          actionType: "invite_sent",
          points: 1,
          sourceType: "invite",
          sourceRef: existingInvite.id,
          idempotencyKey: `invite_sent:${existingInvite.id}:${payload.inviterUserId}`,
        }),
      ]);
    }
    return { invite: existingInvite, token: "", isNew: false };
  }

  const linkSecret = newCapabilityLinkSecret();

  const invite: InviteRecord = {
    id: uuid(),
    event_id: payload.eventId,
    inviter_user_id: payload.inviterUserId ?? null,
    inviter_registration_id: payload.inviterRegistrationId ?? null,
    invitee_email: inviteeEmail,
    invitee_first_name: payload.inviteeFirstName ?? null,
    invitee_last_name: payload.inviteeLastName ?? null,
    invite_type: payload.inviteType,
    link_secret: linkSecret,
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
    transition_revision: 0,
    created_at: now,
  };

  const statements: StatementLike[] = [
    db
      .prepare(
        `INSERT INTO invites (
      id, event_id, inviter_user_id, inviter_registration_id, invitee_email, invitee_first_name, invitee_last_name, invite_type,
      link_secret, status, decline_reason_code, decline_reason_note, unsubscribe_future, reminder_count,
      last_communication_at, reminders_paused_until,
      max_uses, used_count, source_type, expires_at, accepted_at, declined_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        invite.id,
        invite.event_id,
        invite.inviter_user_id,
        invite.inviter_registration_id,
        invite.invitee_email,
        invite.invitee_first_name,
        invite.invitee_last_name,
        invite.invite_type,
        invite.link_secret,
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
      ),
  ];

  if (invite.inviter_user_id) {
    // Record the primary inviter in invite_inviters for social-proof tracking.
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO invite_inviters
         (id, invite_id, inviter_user_id, inviter_registration_id, source_type, invited_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(uuid(), invite.id, invite.inviter_user_id, invite.inviter_registration_id, invite.source_type, now),
      prepareEngagementStatement(db, {
        userId: invite.inviter_user_id,
        eventId: invite.event_id,
        subjectType: "invite",
        subjectRef: invite.id,
        actionType: "invite_sent",
        points: 1,
        sourceType: "invite",
        sourceRef: invite.id,
        idempotencyKey: `invite_sent:${invite.id}:${invite.inviter_user_id}`,
      }),
    );
  }
  await db.batch(statements);

  const token = await signedOrQueuedCapability({
    signingSecret: payload.signingSecret,
    linkSecret,
    purpose: "invite",
    resourceId: invite.id,
  });
  return { invite, token, isNew: true };
}

/**
 * Returns all named users who have invited (or co-invited) the given invitee,
 * ordered by the time they sent their invitation.  Used to build social-proof
 * copy such as "You've been invited by Paul, Sven, Chris and 4 others."
 */
export async function getInviteInviterSummary(
  db: DatabaseLike,
  inviteId: string,
  visibleLimit = 5,
): Promise<{ inviters: InviteInviterInfo[]; total: number }> {
  const result = await queryPage<InviteInviterInfo>(db, {
    sql: `SELECT ii.inviter_user_id AS userId,
                   u.first_name AS firstName,
                   u.last_name AS lastName,
                   u.organization_name AS organizationName
            FROM invite_inviters ii
            JOIN users u ON u.id = ii.inviter_user_id
            WHERE ii.invite_id = ?
            `,
    bindings: [inviteId],
    orderBy: "ORDER BY ii.invited_at ASC, ii.id ASC",
    limit: visibleLimit,
    offset: 0,
  });
  return { inviters: result.rows, total: result.total };
}
