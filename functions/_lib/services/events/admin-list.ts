import { EVENTS_LIST_SORT_COLUMNS, type AdminEventsListQuery } from "../../../../assets/shared/schemas/admin-events";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveOrderBy } from "../../db/sort";
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

export async function listAdminEvents(db: DatabaseLike, query: AdminEventsListQuery) {
  const orderBy = resolveOrderBy(
    query.sort,
    EVENTS_LIST_SORT_COLUMNS,
    "ORDER BY COALESCE(e.starts_at, '9999') DESC",
    "e.id ASC",
  );
  const search = query.q ? buildD1TextSearchFilter(query.q, ["e.name", "e.slug"]) : null;
  const where = search ? `WHERE ${search.sql}` : "";
  const bindings = search?.bindings ?? [];
  const { rows: events, total } = await queryPage<EventWithStats>(db, {
    sql: `WITH registration_counts AS (
         SELECT event_id,
                COUNT(*) AS total_registrations,
                SUM(CASE WHEN status = 'registered' THEN 1 ELSE 0 END) AS confirmed_registrations
         FROM registrations
         GROUP BY event_id
       ),
       invite_counts AS (
         SELECT event_id, COUNT(*) AS pending_invites
         FROM invites
         WHERE status = 'sent' AND invite_type = 'attendee'
         GROUP BY event_id
       )
       SELECT
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
         e.updated_at,
         COALESCE(registration_counts.total_registrations, 0) AS total_registrations,
         COALESCE(registration_counts.confirmed_registrations, 0) AS confirmed_registrations,
         COALESCE(invite_counts.pending_invites, 0) AS pending_invites
       FROM events e
       LEFT JOIN registration_counts ON registration_counts.event_id = e.id
       LEFT JOIN invite_counts ON invite_counts.event_id = e.id
       ${where}`,
    bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  return {
    events,
    page: buildPageInfo(query.limit, query.offset, total, events.length),
  };
}
