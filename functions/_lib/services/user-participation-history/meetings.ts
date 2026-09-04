/**
 * The meetings a person joined.
 *
 * Attendance is not asserted by an organizer: a meeting records who joined it
 * through `event_occurrence_join_confirmations`, one row per person per
 * occurrence. From there the chain back to the group that called the meeting
 * is `event_occurrences → event_series → events.owner_group_id → groups`, the
 * same one the attendance summary in `../user-participation` counts along.
 *
 * Cancelled occurrences are excluded rather than listed. A meeting that never
 * took place is not something anybody took part in, and showing it in a
 * personal history would read as an absence the person is answerable for.
 */
import {
  userMeetingParticipationListResponseSchema,
  type ParticipationHistoryListQuery,
  type UserMeetingParticipation,
  type UserMeetingParticipationListResponse,
} from "../../../../assets/shared/schemas/user-participation-history";
import type { EventOccurrenceStatus } from "../../../../assets/shared/schemas/event-series";
import type { OffsetPageQuery } from "../../db/pagination";
import type { DatabaseLike } from "../../types";
import { buildParticipationHistoryPageQuery, loadParticipationHistoryPage } from "./history-page";

interface MeetingParticipationRow {
  occurrence_id: string;
  event_name: string;
  event_slug: string;
  group_id: string | null;
  group_slug: string | null;
  group_name: string | null;
  status: EventOccurrenceStatus;
  confirmed_at: string;
  occurred_at: string;
}

/**
 * The group join is LEFT: `events.owner_group_id` is nullable, and a meeting
 * series on an event no group owns is still a meeting somebody attended.
 */
const MEETING_PARTICIPATION_FROM = `FROM event_occurrence_join_confirmations joined
  JOIN event_occurrences occurrence ON occurrence.id = joined.occurrence_id
  JOIN event_series series ON series.id = occurrence.series_id
  JOIN events event ON event.id = series.event_id
  LEFT JOIN groups owner_group ON owner_group.id = event.owner_group_id`;

/** Exported so `tests/user-participation-history.test.ts` can assert the page/count pair. */
export function buildUserMeetingParticipationPageQuery(
  userId: string,
  query: ParticipationHistoryListQuery,
): OffsetPageQuery {
  return buildParticipationHistoryPageQuery(query, {
    selectSql: `SELECT occurrence.id AS occurrence_id, occurrence.status, occurrence.starts_at AS occurred_at,
         joined.confirmed_at,
         event.name AS event_name, event.slug AS event_slug,
         owner_group.id AS group_id, owner_group.slug AS group_slug, owner_group.name AS group_name`,
    fromSql: MEETING_PARTICIPATION_FROM,
    conditions: ["joined.user_id = ?", "occurrence.status <> 'cancelled'"],
    bindings: [userId],
    searchColumns: ["event.name", "owner_group.name"],
    occurredAtExpression: "occurrence.starts_at",
    tieBreaker: "occurrence.id ASC",
  });
}

function toMeetingParticipation(row: MeetingParticipationRow): UserMeetingParticipation {
  return {
    occurrenceId: row.occurrence_id,
    eventName: row.event_name,
    eventSlug: row.event_slug,
    group:
      row.group_id && row.group_slug && row.group_name
        ? { id: row.group_id, slug: row.group_slug, name: row.group_name }
        : null,
    status: row.status,
    confirmedAt: row.confirmed_at,
    occurredAt: row.occurred_at,
  };
}

export async function listUserMeetingParticipation(
  db: DatabaseLike,
  userId: string,
  query: ParticipationHistoryListQuery,
): Promise<UserMeetingParticipationListResponse> {
  return userMeetingParticipationListResponseSchema.parse(
    await loadParticipationHistoryPage<MeetingParticipationRow, UserMeetingParticipation>(
      db,
      "meetings",
      buildUserMeetingParticipationPageQuery(userId, query),
      toMeetingParticipation,
    ),
  );
}
