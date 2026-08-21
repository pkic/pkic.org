import { all } from "../db/queries";
import { prepareBulkQueueInviteEmailChunkStatements } from "../email/outbox";
import type { DatabaseLike, StatementLike } from "../types";
import { stringifyJson } from "../utils/json";
import { nowIso } from "../utils/time";
import { buildInviteEmailQueueRow } from "./invite-email";
import { isStaleInviteTransition, prepareInviteTransitionGuardStatements } from "./invite-lifecycle";
import type { EventRouteRow } from "./reminders-support";

export const INVITE_LINK_RECOVERY_LIMIT = 20;

interface InviteRecoveryMatch {
  id: string;
  invitee_email: string;
  invitee_first_name: string | null;
  invitee_last_name: string | null;
  invite_type: "attendee" | "speaker";
  transition_revision: number;
  event_id: string;
  event_name: string;
  event_slug: string;
  event_base_path: string | null;
  event_timezone: string;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_settings_json: string;
}

type RecoveryEvent = EventRouteRow & { timezone: string; ends_at: string | null };

function recoveryEvent(row: InviteRecoveryMatch): RecoveryEvent {
  return {
    id: row.event_id,
    name: row.event_name,
    slug: row.event_slug,
    base_path: row.event_base_path,
    timezone: row.event_timezone,
    starts_at: row.event_starts_at,
    ends_at: row.event_ends_at,
    settings_json: row.event_settings_json,
  };
}

function prepareRecoveryUpdate(db: DatabaseLike, rows: InviteRecoveryMatch[], recoveredAt: string): StatementLike {
  return db
    .prepare(
      `UPDATE invites
       SET status = 'sent', expires_at = NULL, last_communication_at = ?
       WHERE id IN (SELECT value FROM json_each(?))
         AND status IN ('sent', 'expired')`,
    )
    .bind(recoveredAt, stringifyJson(rows.map((row) => row.id)));
}

async function commitRecoveryRows(
  db: DatabaseLike,
  rows: InviteRecoveryMatch[],
  appBaseUrl: string,
  recoveredAt: string,
): Promise<string[]> {
  if (rows.length === 0) return [];

  const emailChunks = prepareBulkQueueInviteEmailChunkStatements(
    db,
    rows.map((row) => {
      const event = recoveryEvent(row);
      return buildInviteEmailQueueRow({
        event,
        invite: row,
        appBaseUrl,
        source: row.invite_type === "attendee" ? "invite_recovery" : "speaker_invite_recovery",
        subject: row.invite_type === "attendee" ? `Invitation: ${event.name}` : `Speaker invitation: ${event.name}`,
        reminderCount: "recovery",
      });
    }),
    recoveredAt,
  );

  try {
    await db.batch([
      ...prepareInviteTransitionGuardStatements(db, rows),
      prepareRecoveryUpdate(db, rows, recoveredAt),
      ...emailChunks.map((chunk) => chunk.statement),
    ]);
    return emailChunks.flatMap((chunk) => chunk.ids);
  } catch (error) {
    if (!isStaleInviteTransition(error)) throw error;
    if (rows.length === 1) return [];
    const midpoint = Math.floor(rows.length / 2);
    return [
      ...(await commitRecoveryRows(db, rows.slice(0, midpoint), appBaseUrl, recoveredAt)),
      ...(await commitRecoveryRows(db, rows.slice(midpoint), appBaseUrl, recoveredAt)),
    ];
  }
}

/**
 * Atomically refreshes every bounded invitation match and its durable email
 * intent. A concurrent terminal transition suppresses only that invitation;
 * it never leaks an email based on stale state or blocks unrelated matches.
 */
export async function recoverInviteLinksByEmail(
  db: DatabaseLike,
  email: string,
  appBaseUrl: string,
): Promise<string[]> {
  const matches = await all<InviteRecoveryMatch>(
    db,
    `WITH ranked_matches AS (
       SELECT
         i.id,
         i.invitee_email,
         i.invitee_first_name,
         i.invitee_last_name,
         i.invite_type,
         i.transition_revision,
         i.created_at AS invite_created_at,
         e.id AS event_id,
         e.name AS event_name,
         e.slug AS event_slug,
         e.base_path AS event_base_path,
         e.timezone AS event_timezone,
         e.starts_at AS event_starts_at,
         e.ends_at AS event_ends_at,
         e.settings_json AS event_settings_json,
         ROW_NUMBER() OVER (
           PARTITION BY i.event_id, i.invite_type
           ORDER BY CASE WHEN i.status = 'sent' THEN 0 ELSE 1 END, i.created_at DESC, i.id DESC
         ) AS recovery_rank
       FROM invites i
       JOIN events e ON e.id = i.event_id
       WHERE i.invitee_email = ?
         AND i.status IN ('sent', 'expired')
     )
     SELECT
       id, invitee_email, invitee_first_name, invitee_last_name, invite_type,
       transition_revision, event_id, event_name, event_slug, event_base_path,
       event_timezone, event_starts_at, event_ends_at, event_settings_json
     FROM ranked_matches
     WHERE recovery_rank = 1
     ORDER BY invite_created_at DESC, id DESC
     LIMIT ?`,
    [email, INVITE_LINK_RECOVERY_LIMIT],
  );

  return commitRecoveryRows(db, matches, appBaseUrl, nowIso());
}
