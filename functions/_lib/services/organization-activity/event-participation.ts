/**
 * The events an organization's representatives took part in.
 *
 * "Took part in" is two facts the schema keeps apart: a non-cancelled
 * `registrations` row, and an active `event_participants` role. They are
 * unioned into one activity CTE so an event appears once whether the
 * organization attended it, spoke at it, or both — and so the page and its
 * count read the same source.
 */
import {
  ORGANIZATION_EVENTS_SORT_COLUMNS,
  organizationEventsListResponseSchema,
  type OrganizationEventParticipation,
  type OrganizationEventsListQuery,
  type OrganizationEventsListResponse,
} from "../../../../assets/shared/schemas/organization-activity";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  EVENT_PARTICIPANT_ROLES,
  type EventParticipantRole,
} from "../../../../assets/shared/schemas/participant-roles";
import { queryPage, type OffsetPageQuery } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { ORGANIZATION_REPRESENTATIVE_USERS_CTE } from "./representative-users";

interface EventParticipationRow {
  event_id: string;
  event_slug: string;
  event_name: string;
  starts_at: string | null;
  ends_at: string | null;
  registration_count: number;
  participant_roles: string | null;
  upcoming: number;
}

/**
 * An event is upcoming until it has finished; one that never had a schedule is
 * neither upcoming nor past, and the `when` filter excludes it from both sides
 * rather than inventing a date for it. `now` is evaluated in SQL so the page
 * and the count carry the identical binding list.
 */
const EVENT_SCHEDULE_END = "COALESCE(e.ends_at, e.starts_at)";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const EVENT_IS_UPCOMING = `(${EVENT_SCHEDULE_END} IS NOT NULL AND ${EVENT_SCHEDULE_END} >= ${NOW})`;
// Deliberately not `NOT (upcoming)`: an unscheduled event is false for both,
// and negating the upcoming predicate would sweep it into "past".
const EVENT_IS_PAST = `(${EVENT_SCHEDULE_END} IS NOT NULL AND ${EVENT_SCHEDULE_END} < ${NOW})`;

const ORGANIZATION_EVENT_ACTIVITY_WITH = `WITH ${ORGANIZATION_REPRESENTATIVE_USERS_CTE},
  organization_event_activity AS (
    SELECT registration.event_id AS event_id, registration.user_id AS user_id, NULL AS participant_role
      FROM registrations registration
      JOIN organization_representative_users representative ON representative.user_id = registration.user_id
     WHERE registration.status <> 'cancelled'
    UNION ALL
    SELECT participant.event_id, participant.user_id, participant.role
      FROM event_participants participant
      JOIN organization_representative_users representative ON representative.user_id = participant.user_id
     WHERE participant.status = 'active'
  )`;

const ORGANIZATION_EVENTS_FROM = `FROM events e
  JOIN organization_event_activity activity ON activity.event_id = e.id`;

const ORGANIZATION_EVENTS_SELECT = `SELECT e.id AS event_id, e.slug AS event_slug, e.name AS event_name,
         e.starts_at, e.ends_at,
         COUNT(DISTINCT CASE WHEN activity.participant_role IS NULL THEN activity.user_id END) AS registration_count,
         group_concat(DISTINCT activity.participant_role) AS participant_roles,
         CASE WHEN ${EVENT_IS_UPCOMING} THEN 1 ELSE 0 END AS upcoming`;

const ORGANIZATION_EVENTS_SORT_EXPRESSIONS = {
  startsAt: "e.starts_at",
  eventName: "e.name COLLATE NOCASE",
  registrationCount: "registration_count",
} satisfies Record<(typeof ORGANIZATION_EVENTS_SORT_COLUMNS)[number], string>;

/** Exported so `tests/admin-list-query-plans.test.ts` can assert the page/count pair. */
export function buildOrganizationEventsPageQuery(
  organizationId: string,
  query: OrganizationEventsListQuery,
): OffsetPageQuery {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["e.name"]) : null;
  const conditions: string[] = [];
  const bindings: unknown[] = [organizationId];
  if (query.when === "upcoming") conditions.push(EVENT_IS_UPCOMING);
  if (query.when === "past") conditions.push(EVENT_IS_PAST);
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = conditions.length > 0 ? `\n WHERE ${conditions.join(" AND ")}` : "";

  return {
    source: {
      withSql: ORGANIZATION_EVENT_ACTIVITY_WITH,
      selectSql: ORGANIZATION_EVENTS_SELECT,
      fromSql: `${ORGANIZATION_EVENTS_FROM}${where}\n GROUP BY e.id`,
      countSelectSql: "SELECT COUNT(DISTINCT e.id) AS total",
      countFromSql: `${ORGANIZATION_EVENTS_FROM}${where}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      ORGANIZATION_EVENTS_SORT_EXPRESSIONS,
      `${ORGANIZATION_EVENTS_SORT_EXPRESSIONS.startsAt} DESC`,
      "e.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

/**
 * `group_concat` returns the roles in whatever order the scan produced them.
 * The vocabulary has a canonical order, so the badge row reads the same way on
 * every event rather than by accident of insertion.
 */
function participantRoles(concatenated: string | null): EventParticipantRole[] {
  if (!concatenated) return [];
  const present = new Set(concatenated.split(","));
  return EVENT_PARTICIPANT_ROLES.filter((role) => present.has(role));
}

function mapEventParticipation(row: EventParticipationRow): OrganizationEventParticipation {
  return {
    eventId: row.event_id,
    eventSlug: row.event_slug,
    eventName: row.event_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    registrationCount: row.registration_count,
    participantRoles: participantRoles(row.participant_roles),
    upcoming: row.upcoming === 1,
  };
}

export async function listOrganizationEvents(
  db: DatabaseLike,
  organizationId: string,
  query: OrganizationEventsListQuery,
): Promise<OrganizationEventsListResponse> {
  const { rows, total } = await queryPage<EventParticipationRow>(
    db,
    buildOrganizationEventsPageQuery(organizationId, query),
  );
  return organizationEventsListResponseSchema.parse({
    events: rows.map(mapEventParticipation),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}
