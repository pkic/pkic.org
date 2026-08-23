import { EVENTS_LIST_SORT_COLUMNS, type AdminEventsListQuery } from "../../../../assets/shared/schemas/admin-events";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";

interface EventWithStats {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  source_path: string | null;
  base_path: string | null;
  registration_mode: string;
  invite_limit_attendee: number;
  settings_json: string;
  created_at: string;
  updated_at: string;
  total_registrations: number;
  confirmed_registrations: number;
  pending_invites: number;
}

type EventPageRow = Omit<EventWithStats, "total_registrations" | "confirmed_registrations" | "pending_invites">;

interface EventStatsRow {
  event_id: string;
  total_registrations: number;
  confirmed_registrations: number;
  pending_invites: number;
}

/**
 * Build the event-list source independently from its aggregates. This keeps
 * the count query on the indexed events predicate and lets the stats query
 * restrict aggregation to the already paged IDs.
 */
export function buildAdminEventsPageQuery(query: AdminEventsListQuery) {
  const orderBy = resolveMappedOrderBy(
    query.sort,
    {
      name: "e.name",
      starts_at: "e.starts_at",
      registration_mode: "e.registration_mode",
      // Sorting by this aggregate necessarily considers all events. The
      // normal path still pages event IDs before loading registration/invite
      // statistics, and the count query never evaluates this projection.
      total_registrations: "(SELECT COUNT(*) FROM registrations r_sort WHERE r_sort.event_id = e.id)",
    } satisfies Record<(typeof EVENTS_LIST_SORT_COLUMNS)[number], string>,
    "COALESCE(e.starts_at, '9999') DESC",
    "e.id ASC",
  );
  const search = query.q ? buildD1TextSearchFilter(query.q, ["e.name", "e.slug"]) : null;
  return {
    source: {
      selectSql: `SELECT
         e.id,
         e.slug,
         e.name,
         e.timezone,
         e.starts_at,
         e.ends_at,
         e.source_path,
         e.base_path,
         e.registration_mode,
         e.invite_limit_attendee,
         e.settings_json,
         e.created_at,
         e.updated_at`,
      fromSql: `FROM events e${search ? `\n       WHERE ${search.sql}` : ""}`,
      bindings: search?.bindings ?? [],
    },
    orderBy,
    limit: query.limit,
    offset: query.offset,
  };
}

/**
 * Build the bounded aggregate query for an already selected event page.
 * The canonical JSON-membership filter keeps the query at one D1 binding
 * even when the shared list contract returns its maximum 200 rows.
 */
export function buildAdminEventStatsQuery(eventIds: readonly string[]) {
  const eventFilter = buildD1JsonMembershipFilter("e.id", eventIds);
  return {
    sql: `WITH page_events AS (
         SELECT e.id AS event_id
           FROM events e
          WHERE ${eventFilter.sql}
       ),
       registration_counts AS (
         SELECT r.event_id,
                COUNT(*) AS total_registrations,
                SUM(CASE WHEN r.status = 'registered' THEN 1 ELSE 0 END) AS confirmed_registrations
           FROM registrations r
           JOIN page_events pe ON pe.event_id = r.event_id
          GROUP BY r.event_id
       ),
       invite_counts AS (
         SELECT i.event_id, COUNT(*) AS pending_invites
           FROM invites i
           JOIN page_events pe ON pe.event_id = i.event_id
          WHERE i.status = 'sent' AND i.invite_type = 'attendee'
          GROUP BY i.event_id
       )
       SELECT pe.event_id,
              COALESCE(rc.total_registrations, 0) AS total_registrations,
              COALESCE(rc.confirmed_registrations, 0) AS confirmed_registrations,
              COALESCE(ic.pending_invites, 0) AS pending_invites
         FROM page_events pe
         LEFT JOIN registration_counts rc ON rc.event_id = pe.event_id
         LEFT JOIN invite_counts ic ON ic.event_id = pe.event_id`,
    bindings: eventFilter.bindings,
  };
}

export async function listAdminEvents(db: DatabaseLike, query: AdminEventsListQuery) {
  const pageQuery = buildAdminEventsPageQuery(query);
  const [pageStatement, countStatement] = buildOffsetPageStatements(db, pageQuery);
  const [pageResult, countResult] = await db.batch([pageStatement, countStatement]);
  const { rows: pageRows, total } = decodeOffsetPageResults<EventPageRow>(pageResult, countResult);

  const statsByEvent = new Map<string, EventStatsRow>();
  if (pageRows.length > 0) {
    const statsQuery = buildAdminEventStatsQuery(pageRows.map((event) => event.id));
    const statsResult = await db
      .prepare(statsQuery.sql)
      .bind(...statsQuery.bindings)
      .all<EventStatsRow>();
    for (const row of statsResult.results) statsByEvent.set(row.event_id, row);
  }
  const events: EventWithStats[] = pageRows.map((event) => ({
    ...event,
    total_registrations: statsByEvent.get(event.id)?.total_registrations ?? 0,
    confirmed_registrations: statsByEvent.get(event.id)?.confirmed_registrations ?? 0,
    pending_invites: statsByEvent.get(event.id)?.pending_invites ?? 0,
  }));
  return {
    events,
    page: buildPageInfo(query.limit, query.offset, total, events.length),
  };
}
