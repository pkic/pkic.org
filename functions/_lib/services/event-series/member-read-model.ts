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
  memberMeetingSeriesSchema,
  type MemberMeetingOccurrence,
  type MemberMeetingSeries,
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
  seriesId?: string;
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

const MEMBER_MEETING_FROM_SQL = `FROM event_occurrences occurrence
          JOIN event_series series ON series.id = occurrence.series_id
          JOIN events event ON event.id = series.event_id
          JOIN groups owner_group ON owner_group.id = event.owner_group_id AND owner_group.active = 1`;

function memberMeetingScope(userId: string, query: MemberMeetingsQuery, includeRunning = false) {
  const conditions = [
    "occurrence.status = 'scheduled'",
    "series.active = 1",
    query.seriesId || includeRunning ? "occurrence.ends_at >= ?" : "occurrence.starts_at >= ?",
  ];
  const bindings: unknown[] = [query.from];
  if (query.to) {
    conditions.push("occurrence.starts_at <= ?");
    bindings.push(query.to);
  }
  if (query.seriesId) {
    conditions.push("occurrence.series_id = ?");
    bindings.push(query.seriesId);
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
  return { conditions, bindings };
}

/** Canonical page/count query, also used by the D1 EXPLAIN plan regression test. */
export function buildMemberMeetingsPageQuery(userId: string, query: MemberMeetingsQuery): OffsetPageQuery {
  const { conditions, bindings } = memberMeetingScope(userId, query);
  return {
    sql: `SELECT occurrence.id AS occurrence_id, occurrence.series_id AS series_id, event.id AS event_id,
            event.owner_group_id AS group_id, owner_group.name AS group_name,
            event.name AS event_name, occurrence.starts_at, occurrence.ends_at, occurrence.status
          ${MEMBER_MEETING_FROM_SQL}
          WHERE ${conditions.join(" AND ")}`,
    bindings,
    orderBy: "ORDER BY occurrence.starts_at ASC, occurrence.id ASC",
    limit: query.limit,
    offset: query.offset,
  };
}

interface MemberMeetingSeriesRow {
  series_id: string;
  event_id: string;
  group_id: string;
  group_name: string;
  event_name: string;
  starts_at: string;
  recurrence_rule: string;
  timezone: string;
  next_occurrence_id: string;
  next_starts_at: string;
  next_ends_at: string;
  can_join: number;
}

/** Page the next scheduled occurrence of each visible series after grouping in D1. */
export function buildMemberMeetingSeriesPageQuery(userId: string, query: MemberMeetingsQuery): OffsetPageQuery {
  const { conditions, bindings } = memberMeetingScope(userId, query, true);
  return {
    sql: `WITH visible_occurrences AS (
            SELECT series.id AS series_id, event.id AS event_id,
                   event.owner_group_id AS group_id, owner_group.name AS group_name,
                   event.name AS event_name, series.starts_at, series.recurrence_rule, series.timezone,
                   occurrence.id AS next_occurrence_id, occurrence.starts_at AS next_starts_at,
                   occurrence.ends_at AS next_ends_at,
                   CASE WHEN COALESCE(occurrence.provider_join_url_ciphertext,
                                     json_extract(series.provider_data_json, '$.joinUrlCiphertext')) IS NOT NULL
                         AND EXISTS (
                           SELECT 1 FROM current_event_occurrence_subject_eligibility eligibility
                            WHERE eligibility.occurrence_id = occurrence.id AND eligibility.user_id = ?
                         ) THEN 1 ELSE 0 END AS can_join,
                   ROW_NUMBER() OVER (PARTITION BY series.id ORDER BY occurrence.starts_at, occurrence.id) AS series_rank
            ${MEMBER_MEETING_FROM_SQL}
            WHERE ${conditions.join(" AND ")}
          )
          SELECT series_id, event_id, group_id, group_name, event_name, starts_at,
                 recurrence_rule, timezone, next_occurrence_id, next_starts_at, next_ends_at, can_join
          FROM visible_occurrences WHERE series_rank = 1`,
    bindings: [userId, ...bindings],
    orderBy: "ORDER BY next_starts_at ASC, series_id ASC",
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listUpcomingMeetingSeriesForMember(
  db: DatabaseLike,
  userId: string,
  query: MemberMeetingsQuery,
): Promise<{ series: MemberMeetingSeries[]; total: number }> {
  const { rows, total } = await queryPage<MemberMeetingSeriesRow>(db, buildMemberMeetingSeriesPageQuery(userId, query));
  return {
    series: rows.map((row) =>
      memberMeetingSeriesSchema.parse({
        seriesId: row.series_id,
        eventId: row.event_id,
        groupId: row.group_id,
        groupName: row.group_name,
        eventName: row.event_name,
        startsAt: row.starts_at,
        recurrenceRule: row.recurrence_rule,
        timezone: row.timezone,
        nextOccurrenceId: row.next_occurrence_id,
        nextStartsAt: row.next_starts_at,
        nextEndsAt: row.next_ends_at,
        canJoin: row.can_join === 1,
      }),
    ),
    total,
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
