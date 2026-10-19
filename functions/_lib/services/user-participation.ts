import { persistedUtcInstant } from "../utils/time";
import { seatLeadershipJoinSql } from "./groups/seat-leadership";
/**
 * What a person has taken part in: every seat they hold or held in a group
 * (one per membership row, as one identity), how reliably they attended each
 * one while seated, and the headline figures a record shows at a glance.
 *
 * The join that makes attendance possible runs
 * `groups → events.owner_group_id → event_series → event_occurrences →
 * event_occurrence_join_confirmations`, which is where a meeting records who
 * actually joined it. Both counts are computed in SQL and bounded to the
 * person's own memberships: the frontend renders what it is given and never
 * counts rows itself.
 *
 * `held` counts only occurrences that have already started AND fall inside the
 * seat's interval: after the person joined, and, for a past seat, no later than
 * they left. Counting the whole series would charge a member for meetings held
 * before they arrived or after they left, which reads as an attendance problem
 * rather than a date. A rejoin is a second seat with its own interval.
 *
 * The summary covers current seats only, counting each group once.
 */
import { batchRows } from "../db/pagination";
import type { DatabaseLike } from "../types";
import type { UserGroupParticipation, UserParticipation } from "../../../assets/shared/schemas/user-participation";

interface GroupParticipationRow {
  group_id: string;
  slug: string;
  name: string;
  type_key: string;
  type_singular_label: string;
  type_plural_label: string;
  identity_id: string;
  title: string | null;
  joined_at: string;
  left_at: string | null;
  attended: number;
  held: number;
  last_attended_at: string | null;
}

interface EventCountRow {
  event_count: number;
}

/**
 * Occurrences that count as "held" for one seat: already started, not
 * cancelled, and inside the seat's interval (on or after it began, and, once it
 * has ended, no later than the day it ended).
 */
const HELD_OCCURRENCES = `
  SELECT occurrence.id
    FROM event_occurrences occurrence
    JOIN event_series series ON series.id = occurrence.series_id
    JOIN events event ON event.id = series.event_id
   WHERE event.owner_group_id = membership.group_id
     AND occurrence.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
     AND occurrence.starts_at >= membership.joined_at
     AND (membership.left_at IS NULL OR occurrence.starts_at <= membership.left_at)
     AND occurrence.status <> 'cancelled'
`;

export async function getUserParticipation(db: DatabaseLike, userId: string): Promise<UserParticipation> {
  const [groupsResult, eventsResult] = await db.batch([
    db
      .prepare(
        `WITH seats AS (
           SELECT membership.id, membership.group_id, membership.user_id, membership.identity_id,
                  strftime('%Y-%m-%dT%H:%M:%fZ', membership.joined_at) AS joined_at,
                  strftime('%Y-%m-%dT%H:%M:%fZ', membership.left_at) AS left_at,
                  CASE WHEN membership.left_at IS NULL THEN leadership.title ELSE membership.title END AS title
             FROM group_memberships membership ${seatLeadershipJoinSql("membership", "user")}
            WHERE membership.user_id = ?
         ) SELECT g.id AS group_id, g.slug, g.name, g.type_key,
                type.singular_label AS type_singular_label,
                type.plural_label AS type_plural_label,
                membership.identity_id, membership.title, membership.joined_at, membership.left_at,
                (SELECT COUNT(*)
                   FROM event_occurrence_join_confirmations joined
                  WHERE joined.user_id = membership.user_id
                    AND joined.occurrence_id IN (${HELD_OCCURRENCES})) AS attended,
                (SELECT COUNT(*) FROM (${HELD_OCCURRENCES})) AS held,
                (SELECT MAX(occurrence.starts_at)
                   FROM event_occurrence_join_confirmations joined
                   JOIN event_occurrences occurrence ON occurrence.id = joined.occurrence_id
                   JOIN event_series series ON series.id = occurrence.series_id
                   JOIN events event ON event.id = series.event_id
                  WHERE joined.user_id = membership.user_id
                    AND event.owner_group_id = membership.group_id
                    AND occurrence.starts_at >= membership.joined_at
                    AND (membership.left_at IS NULL OR occurrence.starts_at <= membership.left_at)) AS last_attended_at
           FROM seats membership
           JOIN groups g ON g.id = membership.group_id
           JOIN group_types type ON type.key = g.type_key
          ORDER BY membership.left_at IS NOT NULL, membership.left_at DESC,
                   g.name COLLATE NOCASE, g.id, membership.joined_at, membership.id`,
      )
      .bind(userId, userId),
    db
      .prepare(
        /* Events the person takes part in, which is a different thing from a
           meeting of a group they sit in — a plenary they attended counts
           here, a working-group call counts above. A live registration is
           taking part as much as a participant role is: an attendee who
           registered and holds no other role counted zero events before. */
        `SELECT COUNT(*) AS event_count
           FROM (SELECT participant.event_id
                   FROM event_participants participant
                  WHERE participant.user_id = ?
                 UNION
                 SELECT registration.event_id
                   FROM registrations registration
                  WHERE registration.user_id = ? AND registration.status <> 'cancelled')`,
      )
      .bind(userId, userId),
  ]);

  const groups: UserGroupParticipation[] = batchRows<GroupParticipationRow>(groupsResult).map((row) => ({
    group: {
      id: row.group_id,
      slug: row.slug,
      name: row.name,
      type: {
        key: row.type_key,
        singularLabel: row.type_singular_label,
        pluralLabel: row.type_plural_label,
      },
    },
    identityId: row.identity_id,
    title: row.title,
    joinedAt: persistedUtcInstant(row.joined_at),
    leftAt: persistedUtcInstant(row.left_at),
    attended: row.attended,
    held: row.held,
    lastAttendedAt: persistedUtcInstant(row.last_attended_at),
  }));

  const events = batchRows<EventCountRow>(eventsResult)[0]?.event_count ?? 0;

  // The summary describes where the person sits now. Seats in the same group
  // count that group once, at its larger figure, and a past seat counts for nothing.
  const currentByGroup = new Map<string, UserGroupParticipation>();
  for (const entry of groups) {
    if (entry.leftAt !== null) continue;
    const seen = currentByGroup.get(entry.group.id);
    if (!seen || entry.held > seen.held) currentByGroup.set(entry.group.id, entry);
  }
  const current = [...currentByGroup.values()];

  return {
    groups,
    summary: {
      groupCount: currentByGroup.size,
      eventCount: events,
      meetingsAttended: current.reduce((total, entry) => total + entry.attended, 0),
      meetingsHeld: current.reduce((total, entry) => total + entry.held, 0),
    },
  };
}
