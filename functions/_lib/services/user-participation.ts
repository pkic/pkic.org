/**
 * What a person has taken part in: the groups they sit in, how reliably they
 * attend each one, and the headline figures a record shows at a glance.
 *
 * The join that makes attendance possible runs
 * `groups → events.owner_group_id → event_series → event_occurrences →
 * event_occurrence_join_confirmations`, which is where a meeting records who
 * actually joined it. Both counts are computed in SQL and bounded to the
 * person's own memberships: the frontend renders what it is given and never
 * counts rows itself.
 *
 * `held` counts only occurrences that have already started AND began after the
 * person joined the group. Counting the whole series would charge a new member
 * for every meeting held before they arrived, which reads as an attendance
 * problem rather than a joining date.
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
  title: string | null;
  joined_at: string;
  attended: number;
  held: number;
  last_attended_at: string | null;
}

interface EventCountRow {
  event_count: number;
}

/**
 * Occurrences that count as "held" for one membership: already started, not
 * cancelled, and on or after the day the person joined.
 */
const HELD_OCCURRENCES = `
  SELECT occurrence.id
    FROM event_occurrences occurrence
    JOIN event_series series ON series.id = occurrence.series_id
    JOIN events event ON event.id = series.event_id
   WHERE event.owner_group_id = membership.group_id
     AND occurrence.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
     AND occurrence.starts_at >= membership.joined_at
     AND occurrence.status <> 'cancelled'
`;

export async function getUserParticipation(db: DatabaseLike, userId: string): Promise<UserParticipation> {
  const [groupsResult, eventsResult] = await db.batch([
    db
      .prepare(
        `SELECT g.id AS group_id, g.slug, g.name, g.type_key,
                type.singular_label AS type_singular_label,
                type.plural_label AS type_plural_label,
                membership.title, membership.joined_at,
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
                    AND event.owner_group_id = membership.group_id) AS last_attended_at
           FROM group_memberships membership
           JOIN groups g ON g.id = membership.group_id
           JOIN group_types type ON type.key = g.type_key
          WHERE membership.user_id = ?
            AND membership.left_at IS NULL
          ORDER BY g.name COLLATE NOCASE, g.id`,
      )
      .bind(userId),
    db
      .prepare(
        /* Events the person was a participant of, which is a different thing
           from a meeting of a group they sit in — a plenary they attended
           counts here, a working-group call counts above. */
        `SELECT COUNT(DISTINCT participant.event_id) AS event_count
           FROM event_participants participant
          WHERE participant.user_id = ?`,
      )
      .bind(userId),
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
    title: row.title,
    joinedAt: row.joined_at,
    attended: row.attended,
    held: row.held,
    lastAttendedAt: row.last_attended_at,
  }));

  const events = batchRows<EventCountRow>(eventsResult)[0]?.event_count ?? 0;

  return {
    groups,
    summary: {
      groupCount: groups.length,
      eventCount: events,
      meetingsAttended: groups.reduce((total, entry) => total + entry.attended, 0),
      meetingsHeld: groups.reduce((total, entry) => total + entry.held, 0),
    },
  };
}
