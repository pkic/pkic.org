/**
 * The events a person took part in.
 *
 * `event_participants` records one row per role, and its uniqueness key is
 * (event, user, role, subrole) — so somebody who spoke at a conference and
 * also helped organize it has two rows for one event. The page groups them
 * back to one line per event and carries the roles as a set, because a
 * history of events is read as a list of events, not of role grants.
 *
 * Only `status = 'active'` counts. The other three states are not
 * participation: `invited` is an unanswered offer, `waitlisted` is a place in
 * a queue, and `inactive` is a role that was taken away.
 */
import {
  userEventParticipationListResponseSchema,
  type ParticipationHistoryListQuery,
  type UserEventParticipation,
  type UserEventParticipationListResponse,
} from "../../../../assets/shared/schemas/user-participation-history";
import {
  EVENT_PARTICIPANT_ROLES,
  type EventParticipantRole,
} from "../../../../assets/shared/schemas/participant-roles";
import type { OffsetPageQuery } from "../../db/pagination";
import type { DatabaseLike } from "../../types";
import { buildParticipationHistoryPageQuery, loadParticipationHistoryPage } from "./history-page";

interface EventParticipationRow {
  event_id: string;
  event_slug: string;
  event_name: string;
  starts_at: string | null;
  roles: string;
  occurred_at: string;
}

/**
 * An event with no schedule still happened to the person on it, so it falls
 * back to when the earliest of their roles was recorded rather than dropping
 * out of the history or sorting as if it had no date at all.
 */
const EVENT_OCCURRED_AT = "COALESCE(event.starts_at, MIN(participant.created_at))";

const EVENT_PARTICIPATION_FROM = `FROM event_participants participant
  JOIN events event ON event.id = participant.event_id`;

/** Exported so `tests/user-participation-history.test.ts` can assert the page/count pair. */
export function buildUserEventParticipationPageQuery(
  userId: string,
  query: ParticipationHistoryListQuery,
): OffsetPageQuery {
  return buildParticipationHistoryPageQuery(query, {
    selectSql: `SELECT event.id AS event_id, event.slug AS event_slug, event.name AS event_name,
         event.starts_at,
         group_concat(DISTINCT participant.role) AS roles,
         ${EVENT_OCCURRED_AT} AS occurred_at`,
    fromSql: EVENT_PARTICIPATION_FROM,
    conditions: ["participant.user_id = ?", "participant.status = 'active'"],
    bindings: [userId],
    searchColumns: ["event.name", "event.slug"],
    groupBySql: "GROUP BY event.id",
    countSelectSql: "SELECT COUNT(DISTINCT event.id) AS total",
    occurredAtExpression: "occurred_at",
    tieBreaker: "event.id ASC",
  });
}

/**
 * `group_concat` emits the roles in whatever order the scan produced. The
 * vocabulary has a canonical order, so the badge row reads the same way on
 * every event instead of by accident of insertion.
 */
function participantRoles(concatenated: string): EventParticipantRole[] {
  const present = new Set(concatenated.split(","));
  return EVENT_PARTICIPANT_ROLES.filter((role) => present.has(role));
}

function toEventParticipation(row: EventParticipationRow): UserEventParticipation {
  return {
    eventId: row.event_id,
    eventSlug: row.event_slug,
    eventName: row.event_name,
    roles: participantRoles(row.roles),
    startsAt: row.starts_at,
    occurredAt: row.occurred_at,
  };
}

export async function listUserEventParticipation(
  db: DatabaseLike,
  userId: string,
  query: ParticipationHistoryListQuery,
): Promise<UserEventParticipationListResponse> {
  return userEventParticipationListResponseSchema.parse(
    await loadParticipationHistoryPage<EventParticipationRow, UserEventParticipation>(
      db,
      "events",
      buildUserEventParticipationPageQuery(userId, query),
      toEventParticipation,
    ),
  );
}
