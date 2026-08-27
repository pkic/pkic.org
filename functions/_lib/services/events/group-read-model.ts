import {
  GROUP_EVENTS_SORT_COLUMNS,
  groupEventDetailResponseSchema,
  groupEventSchema,
  type GroupEvent,
  type GroupEventsListQuery,
} from "../../../../assets/shared/schemas/group-events";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import type { EventGroupCapability } from "../../../../assets/shared/schemas/resource-grants";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import {
  effectiveResourceCapabilitiesForContext,
  buildAccessibleGroupResourceIdsCte,
  buildLiveAccessibleGroupResourceIdsCte,
  getResourceGrantDefinition,
  isResourceGrantCapability,
  type GroupResourceContextAccess,
  type LiveGroupResourceContextAccess,
  type GroupResourceViewer,
} from "../resource-grants";
import { liveEventResourceContextAccess } from "../event-series/read-access";

interface GroupEventRow {
  event_id: string;
  owner_group_id: string;
  series_id: string | null;
  event_slug: string;
  event_base_path: string | null;
  event_name: string;
  event_timezone: string;
  event_starts_at: string | null;
  event_ends_at: string | null;
  profile_key: GroupEvent["profileKey"];
  source_mode: GroupEvent["sourceMode"];
  registration_policy: GroupEvent["registrationPolicy"];
  invite_limit_attendee: number;
  location: string | null;
  links_json: string | null;
  next_occurrence_at: string | null;
  event_created_at: string;
  event_updated_at: string;
  granted_capabilities: string | null;
  member_access: number;
  manager_access: number;
}

const NEXT_OCCURRENCE_CTE = `next_occurrence AS (
  SELECT occurrence.series_id, MIN(occurrence.starts_at) AS next_occurrence_at
    FROM event_occurrences occurrence
   WHERE occurrence.status = 'scheduled'
     AND unixepoch(occurrence.ends_at) >= unixepoch()
   GROUP BY occurrence.series_id
)`;
const EVENT_LOCATION = `COALESCE(series.location,
  CASE WHEN json_valid(event.settings_json) THEN json_extract(event.settings_json, '$.location') END)`;
const EVENT_SELECT = `SELECT event.id AS event_id, event.owner_group_id, series.id AS series_id,
  event.slug AS event_slug, event.base_path AS event_base_path, event.name AS event_name, event.timezone AS event_timezone,
  event.starts_at AS event_starts_at, event.ends_at AS event_ends_at,
  event.profile_key, event.source_mode, event.registration_mode AS registration_policy,
  event.invite_limit_attendee,
  ${EVENT_LOCATION} AS location, event.links_json, next_occurrence.next_occurrence_at,
  event.created_at AS event_created_at, event.updated_at AS event_updated_at,
  GROUP_CONCAT(DISTINCT grant_row.capability) AS granted_capabilities`;
function grantedCapabilities(row: Pick<GroupEventRow, "granted_capabilities">): EventGroupCapability[] {
  const definition = getResourceGrantDefinition("event");
  return (row.granted_capabilities?.split(",") ?? []).filter((capability): capability is EventGroupCapability =>
    isResourceGrantCapability(definition, capability),
  );
}

function mapGroupEvent(row: GroupEventRow, groupId: string): GroupEvent {
  const effectiveCapabilities = effectiveResourceCapabilitiesForContext(getResourceGrantDefinition("event"), {
    owner: row.owner_group_id === groupId,
    member: row.member_access === 1,
    manager: row.manager_access === 1,
    grantedCapabilities: grantedCapabilities(row),
  });
  return groupEventSchema.parse({
    id: row.event_id,
    ownerGroupId: row.owner_group_id,
    seriesId: row.series_id,
    slug: row.event_slug,
    basePath: row.event_base_path,
    name: row.event_name,
    timezone: row.event_timezone,
    startsAt: row.event_starts_at,
    endsAt: row.event_ends_at,
    profileKey: row.profile_key,
    sourceMode: row.source_mode,
    registrationPolicy: row.registration_policy,
    inviteLimitAttendee: row.invite_limit_attendee,
    location: row.location,
    links: parseLinksJson(row.links_json),
    nextOccurrenceAt: row.next_occurrence_at,
    updatedAt: row.event_updated_at,
    capabilities:
      row.registration_policy === "no_registration"
        ? effectiveCapabilities.filter((capability) => capability !== "register")
        : effectiveCapabilities,
  });
}

export function buildGroupEventsPageQuery(
  groupId: string,
  access: GroupResourceContextAccess | LiveGroupResourceContextAccess,
  query: GroupEventsListQuery,
) {
  const live = "memberEvidence" in access;
  const accessibleEvents = live
    ? buildLiveAccessibleGroupResourceIdsCte("event", groupId, access, "view")
    : buildAccessibleGroupResourceIdsCte("event", groupId, access, "view");
  const conditions = ["event.owner_group_id IS NOT NULL"];
  const bindings: unknown[] = [...accessibleEvents.bindings, groupId];
  if (query.profileKey) {
    conditions.push("event.profile_key = ?");
    bindings.push(query.profileKey);
  }
  if (query.registrationPolicy) {
    conditions.push("event.registration_mode = ?");
    bindings.push(query.registrationPolicy);
  }
  if (query.sourceMode) {
    conditions.push("event.source_mode = ?");
    bindings.push(query.sourceMode);
  }
  if (query.from) {
    conditions.push("COALESCE(next_occurrence.next_occurrence_at, event.starts_at, event.ends_at) >= ?");
    bindings.push(query.from);
  }
  if (query.to) {
    conditions.push("COALESCE(next_occurrence.next_occurrence_at, event.starts_at, event.ends_at) <= ?");
    bindings.push(query.to);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["event.name", "event.slug", "event.timezone", EVENT_LOCATION]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  return {
    sql: `WITH ${NEXT_OCCURRENCE_CTE},
      ${accessibleEvents.sql}
      ${EVENT_SELECT},
      ${live ? "group_access.member_access" : access.member ? "1" : "0"} AS member_access,
      ${live ? "group_access.manager_access" : access.manager ? "1" : "0"} AS manager_access
      FROM accessible_resource accessible
      JOIN events event ON event.id = accessible.resource_id
      LEFT JOIN event_series series ON series.event_id = event.id
      LEFT JOIN next_occurrence ON next_occurrence.series_id = series.id
      ${live ? "CROSS JOIN group_access" : ""}
      LEFT JOIN event_group_grants grant_row ON grant_row.event_id = event.id AND grant_row.group_id = ?
      WHERE ${conditions.join(" AND ")}
      GROUP BY event.id`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        name: "event_name COLLATE NOCASE",
        starts_at: "event_starts_at",
        next_occurrence_at: "next_occurrence_at",
        created_at: "event_created_at",
      } satisfies Record<(typeof GROUP_EVENTS_SORT_COLUMNS)[number], string>,
      "COALESCE(next_occurrence_at, event_starts_at, '9999') ASC",
      "event_id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listGroupEvents(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  query: GroupEventsListQuery,
): Promise<{ events: GroupEvent[]; total: number }> {
  const page = await queryPage<GroupEventRow>(
    db,
    buildGroupEventsPageQuery(groupId, liveEventResourceContextAccess(viewer, groupId), query),
  );
  return { events: page.rows.map((row) => mapGroupEvent(row, groupId)), total: page.total };
}

export async function getGroupEvent(db: DatabaseLike, viewer: GroupResourceViewer, groupId: string, eventId: string) {
  const access = liveEventResourceContextAccess(viewer, groupId);
  const accessibleEvents = buildLiveAccessibleGroupResourceIdsCte("event", groupId, access, "view");
  const row = await first<GroupEventRow>(
    db,
    `WITH ${NEXT_OCCURRENCE_CTE},
     ${accessibleEvents.sql}
     ${EVENT_SELECT}, group_access.member_access, group_access.manager_access
       FROM accessible_resource accessible
       JOIN events event ON event.id = accessible.resource_id
       LEFT JOIN event_series series ON series.event_id = event.id
       LEFT JOIN next_occurrence ON next_occurrence.series_id = series.id
       CROSS JOIN group_access
       LEFT JOIN event_group_grants grant_row ON grant_row.event_id = event.id AND grant_row.group_id = ?
      WHERE event.id = ? AND event.owner_group_id IS NOT NULL
     GROUP BY event.id`,
    [...accessibleEvents.bindings, groupId, eventId],
  );
  if (!row) throw new AppError(404, "EVENT_NOT_FOUND", "The event is not available through this group");
  const event = mapGroupEvent(row, groupId);
  if (!event.capabilities.includes("view")) {
    throw new AppError(404, "EVENT_NOT_FOUND", "The event is not available through this group");
  }
  return groupEventDetailResponseSchema.parse({ event });
}
