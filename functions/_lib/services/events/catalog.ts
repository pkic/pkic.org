import {
  EVENT_LIST_SORT_COLUMNS,
  eventAudienceDetailSchema,
  type EventAudienceDetail,
  type EventsListQuery,
} from "../../../../assets/shared/schemas/event-management";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { normalizeEventRegistrationPolicy } from "./detail";
import { buildEventAudiencePredicate, type EventAudienceViewer } from "./visibility";

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
}

const EVENT_AUDIENCE_SELECT = `SELECT event.id, event.slug, event.name, event.timezone,
  event.starts_at, event.ends_at, event.profile_key, event.registration_mode,
  event.visibility, event.settings_json, event.links_json`;

function mapEventAudience(row: EventAudienceRow): EventAudienceDetail {
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
  });
}

export function buildEventsPageQuery(viewer: EventAudienceViewer, query: EventsListQuery) {
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
  return {
    sql: `${EVENT_AUDIENCE_SELECT}
      FROM events event
      WHERE ${conditions.join(" AND ")}`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        name: "event.name COLLATE NOCASE",
        starts_at: "event.starts_at",
        ends_at: "event.ends_at",
      } satisfies Record<(typeof EVENT_LIST_SORT_COLUMNS)[number], string>,
      "COALESCE(event.starts_at, '9999') ASC",
      "event.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listVisibleEvents(db: DatabaseLike, viewer: EventAudienceViewer, query: EventsListQuery) {
  const page = await queryPage<EventAudienceRow>(db, buildEventsPageQuery(viewer, query));
  return { events: page.rows.map(mapEventAudience), total: page.total };
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
  return mapEventAudience(row);
}
