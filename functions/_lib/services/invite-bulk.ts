import { normalizeEmail } from "../validation";
import { chunkJsonRows } from "../db/json-bulk";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { newCapabilityLinkSecret, queuedCapabilityToken } from "./capability-links";
import { sha256Hex } from "../utils/crypto";
import { prepareBulkQueueInviteEmailChunkStatements, type InviteEmailQueueRow } from "../email/outbox-queue";
import type { DatabaseLike, StatementLike } from "../types";
import {
  eventInviteWindowEvidence,
  inviteExpirySeconds,
  resolveEventInviteExpiry,
  type InviteEventWindow,
} from "../invite-validity";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { AppError } from "../errors";

export type BulkInviteOutcome = {
  email: string;
  status: "created" | "endorsed" | "skipped";
  reason?: string;
  inviteId?: string;
  token?: string;
  outboxId?: string;
};

export type BulkInviteInput = {
  inviteeEmail: string;
  inviteeFirstName?: string | null;
  inviteeLastName?: string | null;
  sourceType?: string;
};

export type BulkInvitePayload = {
  event: { id: string } & InviteEventWindow;
  invites: BulkInviteInput[];
  expiresAt?: string;
  buildEmailRow?: (created: {
    inviteId: string;
    token: string;
    email: string;
    invite: BulkInviteInput;
    linkSecretFingerprint: string;
  }) => InviteEmailQueueRow;
  /** Domain statements committed atomically with invite and outbox creation. */
  additionalStatements?: StatementLike[];
  /** Present for peer invites/nominations; omitted for staff and forwarded invites. */
  inviter?: { userId: string; registrationId: string | null };
  /** Maximum primary invites this inviter may own for the event/type. */
  maxPrimaryInvites?: number;
};

const ELIGIBILITY_QUERY = {
  attendee: `SELECT DISTINCT u.normalized_email, 'invitee_already_registered' AS reason
    FROM registrations r
    JOIN users u ON u.id = r.user_id
    WHERE u.normalized_email IN (SELECT value FROM json_each(?1))
      AND r.event_id = ?2
      AND r.status <> 'cancelled'`,
  speaker: `SELECT DISTINCT u.normalized_email, 'invitee_already_proposed' AS reason
    FROM proposal_speakers ps
    JOIN session_proposals sp ON sp.id = ps.proposal_id
    JOIN users u ON u.id = ps.user_id
    WHERE u.normalized_email IN (SELECT value FROM json_each(?1))
      AND sp.event_id = ?2
      AND sp.status NOT IN ('rejected', 'withdrawn')
      AND ps.status <> 'declined'`,
} as const;

const BULK_INVITE_INSERT_SQL = `WITH proposed AS (
    SELECT
      json_extract(value, '$.id') AS id,
      json_extract(value, '$.email') AS email,
      json_extract(value, '$.firstName') AS first_name,
      json_extract(value, '$.lastName') AS last_name,
      json_extract(value, '$.linkSecret') AS link_secret,
      json_extract(value, '$.sourceType') AS source_type,
      json_extract(value, '$.expiresAt') AS expires_at,
      CAST(json_extract(value, '$.ordinal') AS INTEGER) AS ordinal
    FROM json_each(?1)
  )
  INSERT INTO invites (
    id, event_id, inviter_user_id, inviter_registration_id, invitee_email,
    invitee_first_name, invitee_last_name, invite_type, link_secret, status,
    decline_reason_code, decline_reason_note, unsubscribe_future, reminder_count,
    last_communication_at, reminders_paused_until, max_uses, used_count,
    source_type, expires_at, accepted_at, declined_at, created_at
  )
  SELECT p.id, ?2, ?5, ?6, p.email, p.first_name, p.last_name, ?3,
         p.link_secret, 'sent', NULL, NULL, 0, 0, ?4, NULL, 1, 0,
         p.source_type, p.expires_at, NULL, NULL, ?4
  FROM proposed p
  WHERE NOT EXISTS (
    SELECT 1 FROM invites existing
    WHERE existing.event_id = ?2
      AND existing.invite_type = ?3
      AND existing.status = 'sent'
      AND existing.invitee_email = p.email
  )
    AND (
      ?7 IS NULL
      OR p.ordinal <= MAX(0, ?7 - (
        SELECT COUNT(*) FROM invites owned
        WHERE owned.event_id = ?2 AND owned.inviter_user_id = ?5 AND owned.invite_type = ?3
      ))
    )
  RETURNING id`;

const BULK_INVITER_INSERT_SQL = `WITH proposed AS (
    SELECT json_extract(value, '$.id') AS id,
           json_extract(value, '$.email') AS email,
           json_extract(value, '$.sourceType') AS source_type
    FROM json_each(?1)
  )
  INSERT OR IGNORE INTO invite_inviters
    (id, invite_id, inviter_user_id, inviter_registration_id, source_type, invited_at)
  SELECT p.id, i.id, ?4, ?5, p.source_type, ?6
  FROM proposed p
  JOIN invites i
    ON i.event_id = ?2 AND i.invite_type = ?3 AND i.status = 'sent' AND i.invitee_email = p.email`;

const BULK_INVITE_ENGAGEMENT_SQL = `WITH proposed AS (
    SELECT json_extract(value, '$.email') AS email,
           json_extract(value, '$.engagementId') AS engagement_id
    FROM json_each(?1)
  )
  INSERT INTO engagement_events (
    id, user_id, event_id, subject_type, subject_ref, action_type, points,
    source_type, source_ref, data_json, created_at, idempotency_key
  )
  SELECT p.engagement_id, ?4, ?2, 'invite', i.id, 'invite_sent', 1,
         'invite', i.id, NULL, ?5, 'invite_sent:' || i.id || ':' || ?4
  FROM proposed p
  JOIN invites i
    ON i.event_id = ?2 AND i.invite_type = ?3 AND i.status = 'sent' AND i.invitee_email = p.email
  WHERE 1
  ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`;

export async function bulkCreateInvites(
  db: DatabaseLike,
  inviteType: "attendee" | "speaker",
  payload: BulkInvitePayload,
): Promise<BulkInviteOutcome[]> {
  if (payload.invites.length === 0) {
    if (payload.additionalStatements?.length) await db.batch(payload.additionalStatements);
    return [];
  }

  const now = nowIso();
  const expiresAt = resolveEventInviteExpiry(payload.event, payload.expiresAt, now);
  const normalizedEmails = payload.invites.map((invite) => normalizeEmail(invite.inviteeEmail));
  const emailsJson = JSON.stringify([...new Set(normalizedEmails)]);
  const batchResults = (await db.batch([
    db
      .prepare(
        `UPDATE invites
         SET status = 'expired'
         WHERE event_id = ?1 AND invite_type = ?2 AND status = 'sent'
           AND expires_at IS NOT NULL AND unixepoch(expires_at) <= unixepoch(?3)`,
      )
      .bind(payload.event.id, inviteType, now),
    db
      .prepare(
        `SELECT email FROM unsubscribes
         WHERE email IN (SELECT value FROM json_each(?1))
           AND channel = 'invites'
           AND ((scope_type = 'global' AND scope_ref IS NULL) OR (scope_type = 'event' AND scope_ref = ?2))`,
      )
      .bind(emailsJson, payload.event.id),
    db.prepare(ELIGIBILITY_QUERY[inviteType]).bind(emailsJson, payload.event.id),
    db
      .prepare(
        `SELECT invitee_email FROM invites
         WHERE event_id = ?1 AND invite_type = ?2 AND status = 'sent'
           AND invitee_email IN (SELECT value FROM json_each(?3))`,
      )
      .bind(payload.event.id, inviteType, emailsJson),
  ])) as Array<{ results?: Array<Record<string, string>> }>;

  const unsubscribed = new Set((batchResults[1].results ?? []).map((row) => row.email));
  const ineligible = new Map(
    (batchResults[2].results ?? []).map((row) => [row.normalized_email, row.reason ?? "invitee_ineligible"]),
  );
  const alreadyInvited = new Set((batchResults[3].results ?? []).map((row) => row.invitee_email));
  const classified = new Set<string>();
  const outcomes: BulkInviteOutcome[] = [];
  const toCreate: Array<{ outcomeIndex: number; email: string; invite: BulkInviteInput }> = [];

  for (let index = 0; index < payload.invites.length; index += 1) {
    const email = normalizedEmails[index];
    if (unsubscribed.has(email) || ineligible.has(email)) {
      outcomes.push({
        email,
        status: "skipped",
        reason: unsubscribed.has(email) ? "invitee_unsubscribed" : ineligible.get(email),
      });
      continue;
    }
    if (alreadyInvited.has(email) || classified.has(email)) {
      outcomes.push({ email, status: "endorsed" });
      continue;
    }
    classified.add(email);
    outcomes.push({ email, status: "created" });
    toCreate.push({ outcomeIndex: outcomes.length - 1, email, invite: payload.invites[index] });
  }

  const prepared = await Promise.all(
    toCreate.map(async ({ outcomeIndex, email, invite }, ordinal) => {
      const id = uuid();
      const linkSecret = newCapabilityLinkSecret();
      const linkSecretFingerprint = await sha256Hex(linkSecret);
      return {
        outcomeIndex,
        id,
        inviteId: id,
        token: queuedCapabilityToken(
          "invite",
          id,
          Math.max(1, inviteExpirySeconds(expiresAt) - Math.floor(Date.parse(now) / 1000)),
          linkSecretFingerprint,
          inviteExpirySeconds(expiresAt),
        ),
        invite,
        email,
        firstName: invite.inviteeFirstName ?? null,
        lastName: invite.inviteeLastName ?? null,
        linkSecret,
        linkSecretFingerprint,
        sourceType: invite.sourceType ?? "direct",
        expiresAt,
        ordinal: ordinal + 1,
      };
    }),
  );

  const chunks = chunkJsonRows(prepared);
  const emailRows = payload.buildEmailRow
    ? prepared.map((row) => ({ ...payload.buildEmailRow!(row), requiredInviteId: row.id }))
    : [];
  const emailChunks = prepareBulkQueueInviteEmailChunkStatements(db, emailRows, now);
  const outboxIds = emailChunks.flatMap((chunk) => chunk.ids);
  const eligibleByEmail = new Map<string, BulkInviteInput>();
  for (let index = 0; index < normalizedEmails.length; index += 1) {
    const email = normalizedEmails[index];
    if (!unsubscribed.has(email) && !ineligible.has(email) && !eligibleByEmail.has(email)) {
      eligibleByEmail.set(email, payload.invites[index]);
    }
  }
  const inviterRows = payload.inviter
    ? [...eligibleByEmail].map(([email, invite]) => ({
        id: uuid(),
        engagementId: uuid(),
        email,
        sourceType: invite.sourceType ?? "direct",
      }))
    : [];
  const inviterChunks = chunkJsonRows(inviterRows);
  const statements = [
    prepareAuthorizationGuard(db, eventInviteWindowEvidence(payload.event.id, payload.event, expiresAt, now)),
    ...chunks.map((chunk) =>
      db
        .prepare(BULK_INVITE_INSERT_SQL)
        .bind(
          chunk.json,
          payload.event.id,
          inviteType,
          now,
          payload.inviter?.userId ?? null,
          payload.inviter?.registrationId ?? null,
          payload.maxPrimaryInvites ?? null,
        ),
    ),
    ...inviterChunks.map((chunk) =>
      db
        .prepare(BULK_INVITER_INSERT_SQL)
        .bind(chunk.json, payload.event.id, inviteType, payload.inviter!.userId, payload.inviter!.registrationId, now),
    ),
    ...inviterChunks.map((chunk) =>
      db
        .prepare(BULK_INVITE_ENGAGEMENT_SQL)
        .bind(chunk.json, payload.event.id, inviteType, payload.inviter!.userId, now),
    ),
    ...emailChunks.map((chunk) => chunk.statement),
    ...(payload.additionalStatements ?? []),
  ];
  let results;
  try {
    results = await db.batch(statements);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "EVENT_INVITE_WINDOW_CHANGED",
        "The event schedule changed before the invitations could be created. Review the deadline and try again.",
      );
    }
    throw error;
  }
  const insertedIds = new Set(
    results
      .slice(1, chunks.length + 1)
      .flatMap((result) => (result.results ?? []).map((row) => String((row as { id?: unknown }).id ?? ""))),
  );
  for (let index = 0; index < prepared.length; index += 1) {
    const row = prepared[index];
    if (insertedIds.has(row.id)) {
      outcomes[row.outcomeIndex].inviteId = row.id;
      outcomes[row.outcomeIndex].token = row.token;
      outcomes[row.outcomeIndex].outboxId = outboxIds[index];
    }
  }

  // A RETURNING miss can mean either a concurrent winner or a quota rejection.
  // Only those unresolved rows need a follow-up read; the ordinary bulk path
  // stays at three classification reads plus its chunked writes.
  const insertedEmails = new Set(prepared.filter((row) => insertedIds.has(row.id)).map((row) => row.email));
  const finalActive = new Set([...alreadyInvited, ...insertedEmails]);
  const unresolvedEmails = [...new Set(prepared.filter((row) => !insertedIds.has(row.id)).map((row) => row.email))];
  if (unresolvedEmails.length > 0) {
    const active = await db
      .prepare(
        `SELECT invitee_email FROM invites
         WHERE event_id = ?1 AND invite_type = ?2 AND status = 'sent'
           AND invitee_email IN (SELECT value FROM json_each(?3))`,
      )
      .bind(payload.event.id, inviteType, JSON.stringify(unresolvedEmails))
      .all<{ invitee_email: string }>();
    for (const row of active.results) finalActive.add(row.invitee_email);
  }
  const createdEmails = new Set<string>();
  for (const outcome of outcomes) {
    if (outcome.status === "skipped") continue;
    if (!finalActive.has(outcome.email)) {
      outcome.status = "skipped";
      outcome.reason = "invite_limit_exceeded";
    } else if (insertedEmails.has(outcome.email) && !createdEmails.has(outcome.email)) {
      outcome.status = "created";
      createdEmails.add(outcome.email);
    } else {
      outcome.status = "endorsed";
    }
  }
  return outcomes;
}

export type BulkAttendeeOutcome = BulkInviteOutcome;
export type BulkSpeakerOutcome = BulkInviteOutcome;

export function bulkCreateAttendeesAdmin(db: DatabaseLike, payload: BulkInvitePayload): Promise<BulkAttendeeOutcome[]> {
  return bulkCreateInvites(db, "attendee", payload);
}

export function bulkCreateSpeakersAdmin(db: DatabaseLike, payload: BulkInvitePayload): Promise<BulkSpeakerOutcome[]> {
  return bulkCreateInvites(db, "speaker", payload);
}
