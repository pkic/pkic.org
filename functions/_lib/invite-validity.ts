import { AppError } from "./errors";
import type { AuthorizationEvidence } from "./db/authorization-guard";
import type { DatabaseLike, StatementLike } from "./types";
import { nowIso } from "./utils/time";

export interface InviteEventWindow {
  starts_at: string | null;
  ends_at: string | null;
}

function instant(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * D1 stores instants as canonical millisecond UTC text. The round-trip check
 * rejects malformed or non-canonical database values before lexical range
 * comparisons are used.
 */
export function canonicalUtcInstantSql(valueSql: string): string {
  return `(${valueSql}) IS NOT NULL
    AND COALESCE((${valueSql}) = strftime('%Y-%m-%dT%H:%M:%fZ', (${valueSql})), 0)`;
}

/** Shared active/inactive predicates for every effective invitation deadline. */
export function activeEffectiveInviteExpirySql(effectiveExpirySql: string, nowSql = "?"): string {
  return `(${effectiveExpirySql}) IS NOT NULL AND (${effectiveExpirySql}) > ${nowSql}`;
}

export function inactiveEffectiveInviteExpirySql(effectiveExpirySql: string, nowSql = "?"): string {
  return `(${effectiveExpirySql}) IS NULL OR (${effectiveExpirySql}) <= ${nowSql}`;
}

/**
 * Resolves the one canonical invitation deadline. New invitations require a
 * finite event window, default to the event start, and may never outlive the
 * event itself.
 */
export function resolveEventInviteExpiry(
  event: InviteEventWindow,
  requestedExpiresAt?: string | null,
  now = nowIso(),
): string {
  const startsAt = instant(event.starts_at);
  const endsAt = instant(event.ends_at);
  if (startsAt === null || endsAt === null || endsAt <= startsAt) {
    throw new AppError(
      409,
      "EVENT_INVITE_WINDOW_REQUIRED",
      "Set a valid event start and end before sending invitations",
    );
  }

  const expiresAt = requestedExpiresAt ?? event.starts_at!;
  const expiresAtTimestamp = instant(expiresAt);
  const nowTimestamp = instant(now);
  if (expiresAtTimestamp === null || nowTimestamp === null) {
    throw new AppError(400, "INVITE_EXPIRY_INVALID", "Invitation deadline must be a valid date and time");
  }
  if (expiresAtTimestamp <= nowTimestamp) {
    throw new AppError(400, "INVITE_EXPIRY_PAST", "Invitation deadline must be in the future");
  }
  if (expiresAtTimestamp > endsAt) {
    throw new AppError(400, "INVITE_EXPIRY_AFTER_EVENT", "Invitation deadline cannot be after the event ends");
  }
  return new Date(expiresAtTimestamp).toISOString();
}

/** SQL expression for the effective deadline of stored and legacy rows. */
export function effectiveInviteExpirySql(inviteAlias = "i", eventAlias = "e"): string {
  return `CASE
    WHEN ${eventAlias}.starts_at IS NULL OR ${eventAlias}.ends_at IS NULL
      OR NOT (${canonicalUtcInstantSql(`${eventAlias}.starts_at`)})
      OR NOT (${canonicalUtcInstantSql(`${eventAlias}.ends_at`)})
      OR ${eventAlias}.ends_at <= ${eventAlias}.starts_at THEN NULL
    WHEN ${inviteAlias}.expires_at IS NULL THEN ${eventAlias}.starts_at
    WHEN NOT (${canonicalUtcInstantSql(`${inviteAlias}.expires_at`)}) THEN NULL
    WHEN ${inviteAlias}.expires_at <= ${eventAlias}.ends_at THEN ${inviteAlias}.expires_at
    ELSE ${eventAlias}.ends_at
  END`;
}

/** SQL expression for proposal-speaker invitation eligibility. */
export function effectiveProposalSpeakerInviteExpirySql(speakerAlias = "ps", eventAlias = "e"): string {
  return `CASE
    WHEN ${eventAlias}.starts_at IS NULL OR ${eventAlias}.ends_at IS NULL
      OR NOT (${canonicalUtcInstantSql(`${eventAlias}.starts_at`)})
      OR NOT (${canonicalUtcInstantSql(`${eventAlias}.ends_at`)})
      OR ${eventAlias}.ends_at <= ${eventAlias}.starts_at THEN NULL
    WHEN ${speakerAlias}.invite_expires_at IS NULL THEN ${eventAlias}.starts_at
    WHEN NOT (${canonicalUtcInstantSql(`${speakerAlias}.invite_expires_at`)}) THEN NULL
    WHEN ${speakerAlias}.invite_expires_at <= ${eventAlias}.ends_at
      THEN ${speakerAlias}.invite_expires_at
    ELSE ${eventAlias}.ends_at
  END`;
}

/**
 * Effective external-guest deadline under the selected occurrence or current
 * materialized series window. Schedule changes therefore take effect without
 * rewriting guest rows.
 */
export function effectiveMeetingGuestInviteExpirySql(
  guestAlias = "guest",
  occurrenceAlias = "guest_occurrence",
  eventAlias = "event",
): string {
  const startsAt = `CASE WHEN ${guestAlias}.occurrence_id IS NULL THEN ${eventAlias}.starts_at ELSE ${occurrenceAlias}.starts_at END`;
  const endsAt = `CASE WHEN ${guestAlias}.occurrence_id IS NULL THEN ${eventAlias}.ends_at ELSE ${occurrenceAlias}.ends_at END`;
  return `CASE
    WHEN (${startsAt}) IS NULL OR (${endsAt}) IS NULL
      OR NOT (${canonicalUtcInstantSql(startsAt)})
      OR NOT (${canonicalUtcInstantSql(endsAt)})
      OR (${endsAt}) <= (${startsAt}) THEN NULL
    WHEN ${guestAlias}.expires_at IS NULL THEN (${startsAt})
    WHEN NOT (${canonicalUtcInstantSql(`${guestAlias}.expires_at`)}) THEN NULL
    WHEN ${guestAlias}.expires_at <= (${endsAt}) THEN ${guestAlias}.expires_at
    ELSE (${endsAt})
  END`;
}

/** Applies the same event cap to existing rows and schedule changes in memory. */
export function effectiveStoredInviteExpiry(event: InviteEventWindow, storedExpiresAt: string | null): string | null {
  const stored = instant(storedExpiresAt ?? event.starts_at);
  const eventStart = instant(event.starts_at);
  const eventEnd = instant(event.ends_at);
  if (stored === null || eventStart === null || eventEnd === null || eventEnd <= eventStart) return null;
  const effective = Math.min(stored, eventEnd);
  return new Date(effective).toISOString();
}

/** Rechecks the event window in the same D1 batch that persists an invite mutation. */
export function eventInviteWindowEvidence(
  eventId: string,
  event: InviteEventWindow,
  expiresAt: string,
  now: string,
): AuthorizationEvidence {
  return {
    sql: `SELECT 1
          FROM events
          WHERE id = ?
            AND starts_at IS ?
            AND ends_at IS ?
            AND starts_at IS NOT NULL
            AND ends_at IS NOT NULL
            AND ${canonicalUtcInstantSql("starts_at")}
            AND ${canonicalUtcInstantSql("ends_at")}
            AND ends_at > starts_at
            AND ? > ?
            AND ? <= ends_at`,
    bindings: [eventId, event.starts_at, event.ends_at, expiresAt, now, expiresAt],
  };
}

/** Rechecks an occurrence-scoped guest deadline in the invitation D1 batch. */
export function eventOccurrenceInviteWindowEvidence(
  seriesId: string,
  occurrenceId: string,
  occurrence: InviteEventWindow,
  expiresAt: string,
  now: string,
): AuthorizationEvidence {
  return {
    sql: `SELECT 1
          FROM event_occurrences
          WHERE id = ?
            AND series_id = ?
            AND starts_at IS ?
            AND ends_at IS ?
            AND ${canonicalUtcInstantSql("starts_at")}
            AND ${canonicalUtcInstantSql("ends_at")}
            AND ends_at > starts_at
            AND ? > ?
            AND ? <= ends_at`,
    bindings: [occurrenceId, seriesId, occurrence.starts_at, occurrence.ends_at, expiresAt, now, expiresAt],
  };
}

/** Rechecks several independently scheduled invitations with one set-based D1 guard. */
export function eventInviteWindowsEvidence(
  rows: ReadonlyArray<{ eventId: string; event: InviteEventWindow; expiresAt: string }>,
  now: string,
): AuthorizationEvidence {
  return {
    sql: `WITH expected AS (
            SELECT json_extract(value, '$.eventId') AS event_id,
                   json_extract(value, '$.startsAt') AS starts_at,
                   json_extract(value, '$.endsAt') AS ends_at,
                   json_extract(value, '$.expiresAt') AS expires_at
            FROM json_each(?)
          )
          SELECT 1
          WHERE EXISTS (SELECT 1 FROM expected)
            AND NOT EXISTS (
              SELECT 1
              FROM expected x
              LEFT JOIN events e ON e.id = x.event_id
              WHERE e.id IS NULL
                 OR e.starts_at IS NOT x.starts_at
                 OR e.ends_at IS NOT x.ends_at
                 OR NOT (${canonicalUtcInstantSql("e.starts_at")})
                 OR NOT (${canonicalUtcInstantSql("e.ends_at")})
                 OR NOT (${canonicalUtcInstantSql("x.expires_at")})
                 OR e.ends_at <= e.starts_at
                 OR x.expires_at <= ?
                 OR x.expires_at > e.ends_at
            )`,
    bindings: [
      JSON.stringify(
        rows.map((row) => ({
          eventId: row.eventId,
          startsAt: row.event.starts_at,
          endsAt: row.event.ends_at,
          expiresAt: row.expiresAt,
        })),
      ),
      now,
    ],
  };
}

/** Ensures an invitation remains active under the current event window at commit time. */
export function activeInviteValidityEvidence(inviteId: string, now: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1
          FROM invites i
          JOIN events e ON e.id = i.event_id
          WHERE i.id = ?
            AND i.status = 'sent'
            AND ${activeEffectiveInviteExpirySql(effectiveInviteExpirySql("i", "e"))}`,
    bindings: [inviteId, now],
  };
}

/**
 * Retires invitations using the same effective deadline used by token
 * validation, listing, recovery, and reminders. This must be committed with
 * a newly-created invitation so a legacy NULL or overlong deadline cannot
 * retain the partial unique index slot for an already-expired invite.
 */
export function prepareExpireEffectiveEventInvites(
  db: DatabaseLike,
  payload: { eventId: string; inviteType: "attendee" | "speaker"; now: string; inviteeEmail?: string },
): StatementLike {
  const emailClause = payload.inviteeEmail ? " AND invites.invitee_email = ?" : "";
  return db
    .prepare(
      `UPDATE invites
       SET status = 'expired'
       WHERE invites.event_id = ?
         AND invites.invite_type = ?
         AND invites.status = 'sent'${emailClause}
         AND EXISTS (
           SELECT 1
           FROM events e
           WHERE e.id = invites.event_id
             AND (
               ${inactiveEffectiveInviteExpirySql(effectiveInviteExpirySql("invites", "e"))}
             )
         )`,
    )
    .bind(payload.eventId, payload.inviteType, ...(payload.inviteeEmail ? [payload.inviteeEmail] : []), payload.now);
}

export function inviteExpirySeconds(expiresAt: string): number {
  return Math.floor(Date.parse(expiresAt) / 1000);
}
