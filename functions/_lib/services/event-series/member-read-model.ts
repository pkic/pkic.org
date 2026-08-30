/**
 * Cross-group self-participation projection for the sign-in dashboard: every
 * upcoming, non-cancelled occurrence of an active meeting series the caller
 * can reach — through owner-group membership or an `event_group_grants`
 * view/register/attend grant to a group they belong to — evaluated as one
 * set-based D1 query rather than a query per group. Mirrors the shape of
 * `votes/member-read-model.ts`'s `listVisibleVotesForMember`.
 */
import {
  memberMeetingOccurrenceSchema,
  type MemberMeetingOccurrence,
} from "../../../../assets/shared/schemas/member-meetings";
import type { OffsetPageQuery } from "../../db/pagination";
import { queryPage } from "../../db/pagination";
import {
  getResourceGrantDefinition,
  groupResourceCapabilityPredicate,
  memberResourceGrantCapabilitiesFor,
} from "../resource-grants";
import type { DatabaseLike } from "../../types";

const EVENT_GRANT_DEFINITION = getResourceGrantDefinition("event");
// Member-facing occurrence visibility excludes leadership-only `manage`/`manage_attendance`.
const EVENT_VIEW_CAPABILITIES = memberResourceGrantCapabilitiesFor(EVENT_GRANT_DEFINITION, "view");

export interface MemberMeetingsQuery {
  /** ISO instant lower bound, resolved by the route handler — never computed here. */
  from: string;
  to?: string;
  limit: number;
  offset: number;
}

interface MemberMeetingOccurrenceRow {
  occurrence_id: string;
  series_id: string;
  event_id: string;
  group_id: string;
  group_name: string;
  event_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
}

function toMemberMeetingOccurrence(row: MemberMeetingOccurrenceRow): MemberMeetingOccurrence {
  return memberMeetingOccurrenceSchema.parse({
    occurrenceId: row.occurrence_id,
    seriesId: row.series_id,
    eventId: row.event_id,
    groupId: row.group_id,
    groupName: row.group_name,
    eventName: row.event_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
  });
}

/** Canonical page/count query, also used by the D1 EXPLAIN plan regression test. */
export function buildMemberMeetingsPageQuery(userId: string, query: MemberMeetingsQuery): OffsetPageQuery {
  const conditions = ["occurrence.status = 'scheduled'", "series.active = 1", "occurrence.starts_at >= ?"];
  const bindings: unknown[] = [query.from];
  if (query.to) {
    conditions.push("occurrence.starts_at <= ?");
    bindings.push(query.to);
  }
  const membershipPredicate = groupResourceCapabilityPredicate(
    "event",
    "event",
    "membership.group_id",
    EVENT_VIEW_CAPABILITIES,
  );
  conditions.push(
    `EXISTS (
       SELECT 1 FROM group_memberships membership
        WHERE membership.user_id = ?
          AND membership.left_at IS NULL
          AND ${membershipPredicate}
     )`,
  );
  bindings.push(userId);
  return {
    sql: `SELECT occurrence.id AS occurrence_id, occurrence.series_id AS series_id, event.id AS event_id,
            event.owner_group_id AS group_id, owner_group.name AS group_name,
            event.name AS event_name, occurrence.starts_at, occurrence.ends_at, occurrence.status
          FROM event_occurrences occurrence
          JOIN event_series series ON series.id = occurrence.series_id
          JOIN events event ON event.id = series.event_id
          JOIN groups owner_group ON owner_group.id = event.owner_group_id AND owner_group.active = 1
          WHERE ${conditions.join(" AND ")}`,
    bindings,
    orderBy: "ORDER BY occurrence.starts_at ASC, occurrence.id ASC",
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listUpcomingMeetingsForMember(
  db: DatabaseLike,
  userId: string,
  query: MemberMeetingsQuery,
): Promise<{ occurrences: MemberMeetingOccurrence[]; total: number }> {
  const { rows, total } = await queryPage<MemberMeetingOccurrenceRow>(db, buildMemberMeetingsPageQuery(userId, query));
  return { occurrences: rows.map(toMemberMeetingOccurrence), total };
}
