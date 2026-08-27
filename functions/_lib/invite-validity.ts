import { AppError } from "./errors";
import type { AuthorizationEvidence } from "./db/authorization-guard";
import type { EventRecord } from "./services/event-types";
import type { DatabaseLike, StatementLike } from "./types";
import { nowIso } from "./utils/time";

export type InviteEventWindow = Pick<EventRecord, "starts_at" | "ends_at">;

function instant(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
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
      OR unixepoch(${eventAlias}.starts_at) IS NULL OR unixepoch(${eventAlias}.ends_at) IS NULL
      OR unixepoch(${eventAlias}.ends_at) <= unixepoch(${eventAlias}.starts_at) THEN NULL
    WHEN ${inviteAlias}.expires_at IS NULL THEN ${eventAlias}.starts_at
    WHEN unixepoch(${inviteAlias}.expires_at) IS NULL THEN NULL
    WHEN unixepoch(${inviteAlias}.expires_at) <= unixepoch(${eventAlias}.ends_at) THEN ${inviteAlias}.expires_at
    ELSE ${eventAlias}.ends_at
  END`;
}

/** SQL expression for proposal-speaker invitation eligibility. */
export function effectiveProposalSpeakerInviteExpirySql(speakerAlias = "ps", eventAlias = "e"): string {
  return `CASE
    WHEN ${eventAlias}.starts_at IS NULL OR ${eventAlias}.ends_at IS NULL
      OR unixepoch(${eventAlias}.starts_at) IS NULL OR unixepoch(${eventAlias}.ends_at) IS NULL
      OR unixepoch(${eventAlias}.ends_at) <= unixepoch(${eventAlias}.starts_at) THEN NULL
    WHEN ${speakerAlias}.invite_expires_at IS NULL THEN ${eventAlias}.starts_at
    WHEN unixepoch(${speakerAlias}.invite_expires_at) IS NULL THEN NULL
    WHEN unixepoch(${speakerAlias}.invite_expires_at) <= unixepoch(${eventAlias}.ends_at)
      THEN ${speakerAlias}.invite_expires_at
    ELSE ${eventAlias}.ends_at
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
            AND unixepoch(starts_at) IS NOT NULL
            AND unixepoch(ends_at) IS NOT NULL
            AND unixepoch(ends_at) > unixepoch(starts_at)
            AND unixepoch(?) > unixepoch(?)
            AND unixepoch(?) <= unixepoch(ends_at)`,
    bindings: [eventId, event.starts_at, event.ends_at, expiresAt, now, expiresAt],
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
                 OR unixepoch(e.starts_at) IS NULL
                 OR unixepoch(e.ends_at) IS NULL
                 OR unixepoch(e.ends_at) <= unixepoch(e.starts_at)
                 OR unixepoch(x.expires_at) <= unixepoch(?)
                 OR unixepoch(x.expires_at) > unixepoch(e.ends_at)
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
            AND ${effectiveInviteExpirySql("i", "e")} IS NOT NULL
            AND unixepoch(${effectiveInviteExpirySql("i", "e")}) > unixepoch(?)`,
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
               ${effectiveInviteExpirySql("invites", "e")} IS NULL
               OR unixepoch(${effectiveInviteExpirySql("invites", "e")}) <= unixepoch(?)
             )
         )`,
    )
    .bind(payload.eventId, payload.inviteType, ...(payload.inviteeEmail ? [payload.inviteeEmail] : []), payload.now);
}

export function inviteExpirySeconds(expiresAt: string): number {
  return Math.floor(Date.parse(expiresAt) / 1000);
}
