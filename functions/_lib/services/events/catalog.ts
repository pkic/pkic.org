import {
  EVENT_LIST_SORT_COLUMNS,
  EVENT_MANAGEMENT_LIST_SORT_COLUMNS,
  eventAudienceDetailSchema,
  eventManagementSummarySchema,
  type EventAudienceDetail,
  type EventManagementSummary,
  type EventsListQuery,
  type EventViewerState,
} from "../../../../assets/shared/schemas/event-management";
import { queryPage } from "../../db/pagination";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { activeEffectiveInviteExpirySql, effectiveInviteExpirySql } from "../../invite-validity";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { normalizeEventRegistrationPolicy } from "./detail";
import { buildEventAudiencePredicate, type EventAudienceViewer } from "./visibility";
import { fetchViewerEventState, fetchViewerEventStates } from "./viewer-state";

interface EventAudienceRow {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  profile_key: EventAudienceDetail["profileKey"];
  registration_mode: string;
  visibility: EventAudienceDetail["visibility"];
  settings_json: string;
  links_json: string | null;
  base_path: string | null;
}

const EVENT_AUDIENCE_SELECT = `SELECT event.id, event.slug, event.name, event.timezone,
  event.starts_at, event.ends_at, event.profile_key, event.registration_mode,
  event.visibility, event.settings_json, event.links_json, event.base_path`;

function mapEventAudience(row: EventAudienceRow, viewer: EventViewerState | null): EventAudienceDetail {
  const settings = parseJsonSafe<Record<string, unknown>>(row.settings_json, {});
  return eventAudienceDetailSchema.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    profileKey: row.profile_key,
    registrationPolicy: normalizeEventRegistrationPolicy(row.registration_mode),
    visibility: row.visibility,
    accessLevel: row.visibility === "public" ? "public" : "participant",
    location: typeof settings.location === "string" ? settings.location : null,
    links: parseLinksJson(row.links_json),
    basePath: row.base_path,
    viewer,
  });
}

/**
 * Build the shared WHERE for both event list scopes. Visibility, filters, and
 * search are resolved here so the caller's audience is applied in D1 before
 * any projection, count, or pagination — management and audience callers
 * differ only in the columns they may read, never in the rows.
 */
function buildEventsListPredicate(viewer: EventAudienceViewer, query: EventsListQuery) {
  const audience = buildEventAudiencePredicate("event", viewer);
  const conditions = [audience.sql];
  const bindings: unknown[] = [...audience.bindings];
  if (query.visibility) {
    conditions.push("event.visibility = ?");
    bindings.push(query.visibility);
  }
  if (query.from) {
    conditions.push("COALESCE(event.ends_at, event.starts_at) >= ?");
    bindings.push(query.from);
  }
  if (query.to) {
    conditions.push("COALESCE(event.starts_at, event.ends_at) <= ?");
    bindings.push(query.to);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["event.name", "event.slug"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  return { whereSql: conditions.join(" AND "), bindings };
}

const AUDIENCE_SORT_COLUMNS = {
  name: "event.name COLLATE NOCASE",
  starts_at: "event.starts_at",
  ends_at: "event.ends_at",
} satisfies Record<(typeof EVENT_LIST_SORT_COLUMNS)[number], string>;

export function buildEventsPageQuery(viewer: EventAudienceViewer, query: EventsListQuery) {
  if (query.sort && !isAudienceSortColumn(query.sort)) {
    throw new AppError(400, "INVALID_SORT", "This sort column requires event management permission");
  }
  const { whereSql, bindings } = buildEventsListPredicate(viewer, query);
  return {
    sql: `${EVENT_AUDIENCE_SELECT}
      FROM events event
      WHERE ${whereSql}`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      AUDIENCE_SORT_COLUMNS,
      "COALESCE(event.starts_at, '9999') ASC",
      "event.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

function isAudienceSortColumn(sort: string): boolean {
  return Object.hasOwn(AUDIENCE_SORT_COLUMNS, sort.replace(/^-/, ""));
}

export async function listVisibleEvents(db: DatabaseLike, viewer: EventAudienceViewer, query: EventsListQuery) {
  const page = await queryPage<EventAudienceRow>(db, buildEventsPageQuery(viewer, query));
  const viewerStates = await fetchViewerEventStates(
    db,
    viewer.userId,
    page.rows.map((row) => row.id),
  );
  return {
    events: page.rows.map((row) => mapEventAudience(row, viewerStates.get(row.id) ?? null)),
    total: page.total,
  };
}

const EVENT_MANAGEMENT_SELECT = `SELECT event.id, event.slug, event.name, event.timezone,
  event.starts_at, event.ends_at, event.profile_key, event.source_mode, event.registration_mode,
  event.visibility, event.invite_limit_attendee, event.owner_group_id, event.source_path,
  event.base_path, event.updated_at`;

interface EventManagementRow {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  profile_key: EventManagementSummary["profileKey"];
  source_mode: EventManagementSummary["sourceMode"];
  registration_mode: string;
  visibility: EventManagementSummary["visibility"];
  invite_limit_attendee: number;
  owner_group_id: string | null;
  source_path: string | null;
  base_path: string | null;
  updated_at: string;
}

/**
 * Management page query. It reuses the same audience predicate as the reduced
 * projection, so a management caller never sees rows their live permissions do
 * not already grant.
 */
export function buildManagedEventsPageQuery(viewer: EventAudienceViewer, query: EventsListQuery) {
  const { whereSql, bindings } = buildEventsListPredicate(viewer, query);
  return {
    sql: `${EVENT_MANAGEMENT_SELECT}
      FROM events event
      WHERE ${whereSql}`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        ...AUDIENCE_SORT_COLUMNS,
        registration_mode: "event.registration_mode",
        // Sorting by this aggregate necessarily considers every visible event.
        // The normal path still pages event IDs before loading statistics, and
        // the count query never evaluates this projection.
        total_registrations: "(SELECT COUNT(*) FROM registrations r_sort WHERE r_sort.event_id = event.id)",
      } satisfies Record<(typeof EVENT_MANAGEMENT_LIST_SORT_COLUMNS)[number], string>,
      "COALESCE(event.starts_at, '9999') ASC",
      "event.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

/**
 * Bounded aggregate query for an already selected event page. The canonical
 * JSON-membership filter keeps this at one D1 binding even when the shared
 * list contract returns its maximum 200 rows.
 */
export function buildEventRegistrationStatsQuery(eventIds: readonly string[]) {
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
           JOIN events e ON e.id = i.event_id
          WHERE i.status = 'sent'
            AND i.invite_type = 'attendee'
            AND ${activeEffectiveInviteExpirySql(
              effectiveInviteExpirySql("i", "e"),
              "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            )}
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

interface EventStatsRow {
  event_id: string;
  total_registrations: number;
  confirmed_registrations: number;
  pending_invites: number;
}

export async function listManagedEvents(db: DatabaseLike, viewer: EventAudienceViewer, query: EventsListQuery) {
  const page = await queryPage<EventManagementRow>(db, buildManagedEventsPageQuery(viewer, query));
  const statsByEvent = new Map<string, EventStatsRow>();
  if (page.rows.length > 0) {
    const stats = buildEventRegistrationStatsQuery(page.rows.map((row) => row.id));
    const result = await db
      .prepare(stats.sql)
      .bind(...stats.bindings)
      .all<EventStatsRow>();
    for (const row of result.results) statsByEvent.set(row.event_id, row);
  }
  const events = page.rows.map((row) =>
    eventManagementSummarySchema.parse({
      id: row.id,
      slug: row.slug,
      name: row.name,
      timezone: row.timezone,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      profileKey: row.profile_key,
      sourceMode: row.source_mode,
      registrationPolicy: normalizeEventRegistrationPolicy(row.registration_mode),
      visibility: row.visibility,
      inviteLimitAttendee: row.invite_limit_attendee,
      updatedAt: row.updated_at,
      ownerGroupId: row.owner_group_id,
      sourcePath: row.source_path,
      basePath: row.base_path,
      totalRegistrations: statsByEvent.get(row.id)?.total_registrations ?? 0,
      confirmedRegistrations: statsByEvent.get(row.id)?.confirmed_registrations ?? 0,
      pendingInvites: statsByEvent.get(row.id)?.pending_invites ?? 0,
    }),
  );
  return { events, total: page.total };
}

export async function getVisibleEventAudienceDetail(
  db: DatabaseLike,
  viewer: EventAudienceViewer,
  eventSlug: string,
): Promise<EventAudienceDetail> {
  const audience = buildEventAudiencePredicate("event", viewer);
  const row = await first<EventAudienceRow>(
    db,
    `${EVENT_AUDIENCE_SELECT}
       FROM events event
      WHERE event.slug = ? AND ${audience.sql}`,
    [eventSlug, ...audience.bindings],
  );
  if (!row) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found or not visible to this caller");
  const viewerState = await fetchViewerEventState(db, viewer.userId, row.id);
  return mapEventAudience(row, viewerState);
}
