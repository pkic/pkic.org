import type { z } from "zod";
import {
  EVENT_SERIES_SORT_COLUMNS,
  eventSeriesCreateSchema,
  eventSeriesListQuerySchema,
  eventSeriesUpdateSchema,
  type EventSeries,
  type GroupEventSeries,
} from "../../../../assets/shared/schemas/event-series";
import type { EventGroupCapability } from "../../../../assets/shared/schemas/resource-grants";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { parseJsonSafe } from "../../utils/json";
import { isAuditChangeGuardFailure, prepareAuditLog, prepareScopedAuditLogAfterOneChange } from "../audit";
import { getGroup } from "../groups";
import { prepareGroupManagementAuthorizationGuard, requireGroupManagement } from "../groups/governance";
import {
  buildAccessibleGroupResourceIdsCte,
  buildLiveAccessibleGroupResourceIdsCte,
  effectiveResourceCapabilitiesForContext,
  getResourceGrantDefinition,
  isResourceGrantCapability,
  liveGroupResourceContextAccess,
  type GroupResourceContextAccess,
  type GroupResourceViewer,
  type LiveGroupResourceContextAccess,
} from "../resource-grants";
import {
  commitEventResourceManagementBatch,
  requireEventResourceManagementContext,
  type EventResourceManagementContext,
} from "./management";
import { EVENT_SERIES_FROM, EVENT_SERIES_SELECT, type EventSeriesRow, toEventSeries } from "./record";

type ParsedEventSeriesCreateInput = z.infer<typeof eventSeriesCreateSchema>;
type EventSeriesCreateInput = Omit<ParsedEventSeriesCreateInput, "policy"> & {
  policy: Omit<ParsedEventSeriesCreateInput["policy"], "visibility"> & {
    visibility?: ParsedEventSeriesCreateInput["policy"]["visibility"];
  };
};
type ParsedEventSeriesUpdateInput = z.infer<typeof eventSeriesUpdateSchema>;
type EventSeriesUpdateInput = Omit<ParsedEventSeriesUpdateInput, "policy"> & {
  policy?: Omit<NonNullable<ParsedEventSeriesUpdateInput["policy"]>, "visibility"> & {
    visibility?: NonNullable<ParsedEventSeriesUpdateInput["policy"]>["visibility"];
  };
};

interface GroupEventSeriesRow extends EventSeriesRow {
  granted_capabilities: string | null;
  occurrence_count: number;
  member_access: number;
  manager_access: number;
}

function grantedCapabilities(row: GroupEventSeriesRow): EventGroupCapability[] {
  const definition = getResourceGrantDefinition("event");
  return (row.granted_capabilities?.split(",") ?? []).filter((capability): capability is EventGroupCapability =>
    isResourceGrantCapability(definition, capability),
  );
}

function toGroupEventSeries(row: GroupEventSeriesRow, groupId: string): GroupEventSeries {
  const series = toEventSeries(row);
  return {
    ...series,
    occurrenceCount: row.occurrence_count,
    capabilities: effectiveResourceCapabilitiesForContext(getResourceGrantDefinition("event"), {
      owner: series.ownerGroupId === groupId,
      member: row.member_access === 1,
      manager: row.manager_access === 1,
      grantedCapabilities: grantedCapabilities(row),
    }),
  };
}

const SORT_EXPRESSIONS = {
  event_name: "event.name COLLATE NOCASE",
  next_occurrence_at: "next_occurrence_at",
  created_at: "series.created_at",
} satisfies Record<(typeof EVENT_SERIES_SORT_COLUMNS)[number], string>;

/**
 * The group-context series projection: every series the viewer may see
 * through `groupId`, with the grants, occurrence count, and access flags that
 * `toGroupEventSeries` turns into effective capabilities. The list page and
 * the single record both read from it, so a row looks the same wherever it
 * is fetched.
 */
function buildGroupEventSeriesProjection(
  groupId: string,
  access: GroupResourceContextAccess | LiveGroupResourceContextAccess,
): { sql: string; bindings: unknown[]; conditions: string[] } {
  const live = "memberEvidence" in access;
  const accessibleEvents = live
    ? buildLiveAccessibleGroupResourceIdsCte("event", groupId, access, "view")
    : buildAccessibleGroupResourceIdsCte("event", groupId, access, "view");
  const managerAccess = live ? "group_access.manager_access" : access.manager ? "1" : "0";
  return {
    sql: `WITH ${accessibleEvents.sql}
      ${EVENT_SERIES_SELECT},
      GROUP_CONCAT(DISTINCT grant_row.capability) AS granted_capabilities,
      (SELECT COUNT(*) FROM event_occurrences occurrence WHERE occurrence.series_id = series.id) AS occurrence_count,
      ${live ? "group_access.member_access" : access.member ? "1" : "0"} AS member_access,
      ${managerAccess} AS manager_access
      FROM accessible_resource accessible
      JOIN events event ON event.id = accessible.resource_id
      JOIN event_series series ON series.event_id = event.id
      ${live ? "CROSS JOIN group_access" : ""}
      LEFT JOIN event_group_grants grant_row ON grant_row.event_id = event.id AND grant_row.group_id = ?`,
    bindings: [...accessibleEvents.bindings, groupId],
    conditions: ["event.owner_group_id IS NOT NULL", `(${managerAccess} = 1 OR series.active = 1)`],
  };
}

export function buildGroupEventSeriesPageQuery(
  groupId: string,
  access: GroupResourceContextAccess | LiveGroupResourceContextAccess,
  query: z.infer<typeof eventSeriesListQuerySchema>,
) {
  const projection = buildGroupEventSeriesProjection(groupId, access);
  const { conditions, bindings } = projection;
  const search = query.q ? buildD1TextSearchFilter(query.q, ["event.name", "event.slug", "series.location"]) : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.active !== undefined) {
    conditions.push("series.active = ?");
    bindings.push(query.active ? 1 : 0);
  }
  if (query.profileKey) {
    conditions.push("event.profile_key = ?");
    bindings.push(query.profileKey);
  }
  return {
    sql: `${projection.sql}
      WHERE ${conditions.join(" AND ")}
      GROUP BY series.id`,
    bindings,
    orderBy: resolveMappedOrderBy(query.sort, SORT_EXPRESSIONS, SORT_EXPRESSIONS.next_occurrence_at, "series.id ASC"),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listGroupEventSeries(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  query: z.infer<typeof eventSeriesListQuerySchema>,
): Promise<{ series: GroupEventSeries[]; total: number }> {
  const { rows, total } = await queryPage<GroupEventSeriesRow>(
    db,
    buildGroupEventSeriesPageQuery(groupId, liveGroupResourceContextAccess(viewer, groupId), query),
  );
  return { series: rows.map((row) => toGroupEventSeries(row, groupId)), total };
}

/**
 * One series as the viewer sees it through `groupId`: the same projection as
 * a list row, so the record page and the list agree on capabilities and the
 * occurrence count. A series outside the viewer's reach is not found, not
 * forbidden — the list would not have shown it either.
 */
export async function getGroupEventSeriesDetail(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  seriesId: string,
): Promise<GroupEventSeries> {
  const projection = buildGroupEventSeriesProjection(groupId, liveGroupResourceContextAccess(viewer, groupId));
  const row = await first<GroupEventSeriesRow>(
    db,
    `${projection.sql}
      WHERE ${[...projection.conditions, "series.id = ?"].join(" AND ")}
      GROUP BY series.id`,
    [...projection.bindings, seriesId],
  );
  if (!row) {
    throw new AppError(404, "EVENT_SERIES_NOT_FOUND", "Meeting series is not available through this group");
  }
  return toGroupEventSeries(row, groupId);
}

async function getEventSeriesRowById(db: DatabaseLike, seriesId: string): Promise<EventSeriesRow | null> {
  return first<EventSeriesRow>(db, `${EVENT_SERIES_SELECT} ${EVENT_SERIES_FROM} WHERE series.id = ?`, [seriesId]);
}

async function getEventSeriesById(db: DatabaseLike, seriesId: string): Promise<EventSeries | null> {
  const row = await getEventSeriesRowById(db, seriesId);
  return row ? toEventSeries(row) : null;
}

export async function getGroupEventSeries(
  db: DatabaseLike,
  groupIdOrSlug: string,
  seriesId: string,
): Promise<EventSeries> {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  const series = await getEventSeriesById(db, seriesId);
  if (!series || series.ownerGroupId !== group.id) {
    throw new AppError(404, "EVENT_SERIES_NOT_FOUND", "Meeting series not found in this group");
  }
  return series;
}

export async function getAccessibleGroupEventSeries(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  throughGroupId: string,
  seriesId: string,
): Promise<EventSeries> {
  const access = liveGroupResourceContextAccess(viewer, throughGroupId);
  const accessibleEvents = buildLiveAccessibleGroupResourceIdsCte("event", throughGroupId, access, "view");
  const row = await first<EventSeriesRow>(
    db,
    `WITH ${accessibleEvents.sql}
     ${EVENT_SERIES_SELECT}
     FROM accessible_resource accessible
     JOIN events event ON event.id = accessible.resource_id
     JOIN event_series series ON series.event_id = event.id
     CROSS JOIN group_access
     WHERE series.id = ? AND (group_access.manager_access = 1 OR series.active = 1)`,
    [...accessibleEvents.bindings, seriesId],
  );
  if (!row) {
    throw new AppError(404, "EVENT_SERIES_NOT_FOUND", "Meeting series is not available through this group");
  }
  return toEventSeries(row);
}

export async function getManagedGroupEventSeries(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
): Promise<{ series: EventSeries; context: EventResourceManagementContext; settingsJson: string }> {
  const row = await getEventSeriesRowById(db, seriesId);
  if (!row) throw new AppError(404, "EVENT_SERIES_NOT_FOUND", "Meeting series not found");
  const series = toEventSeries(row);
  const context = await requireEventResourceManagementContext(db, actor, groupIdOrSlug, series.eventId, "manage");
  return { series, context, settingsJson: row.settings_json };
}

function normalizedSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new AppError(422, "EVENT_SLUG_INVALID", "Event slug must contain lowercase letters, numbers, and hyphens");
  }
  return slug;
}

export async function createGroupEventSeries(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  input: EventSeriesCreateInput,
): Promise<EventSeries> {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  if (!group.active) throw new AppError(409, "GROUP_INACTIVE", "Meetings cannot be created in an inactive group");
  await requireGroupManagement(db, actor, group.id);
  const id = uuid();
  const eventId = uuid();
  const now = nowIso();
  const slug = normalizedSlug(input.eventSlug);
  const settings = JSON.stringify({
    memberEligibility: input.policy.memberEligibility,
    guestPolicy: input.policy.guestPolicy,
  });
  try {
    await db.batch([
      prepareGroupManagementAuthorizationGuard(db, actor, [group.id]),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM groups WHERE id = ? AND active = 1",
        bindings: [group.id],
      }),
      db
        .prepare(
          `INSERT INTO events
             (id, slug, name, timezone, starts_at, ends_at, source_path, base_path,
              capacity_in_person, registration_mode, invite_limit_attendee, settings_json,
              visibility, created_at, updated_at, owner_group_id, profile_key, source_mode, links_json)
           VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, 0, ?, ?, ?, ?, ?, ?, 'portal', NULL)`,
        )
        .bind(
          eventId,
          slug,
          input.eventName,
          input.timezone,
          `/portal/groups/${group.slug}/meetings`,
          input.policy.registrationPolicy,
          settings,
          input.policy.visibility ?? "group_members",
          now,
          now,
          group.id,
          input.profileKey,
        ),
      db
        .prepare(
          `INSERT INTO event_series
             (id, event_id, starts_at, recurrence_rule, timezone, duration_minutes, location,
              provider_type, provider_data_json, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
        )
        .bind(
          id,
          eventId,
          input.startsAt,
          input.recurrenceRule,
          input.timezone,
          input.durationMinutes,
          input.location ?? null,
          input.providerType ?? null,
          now,
          now,
        ),
      prepareAuditLog(db, "admin", actor.id, "event_series_created", "event_series", id, {
        eventId,
        groupId: group.id,
        profileKey: input.profileKey,
      }),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "EVENT_SERIES_AUTHORIZATION_CHANGED",
        "Group meeting-management authority changed while the series was being created",
      );
    }
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: events.slug")) {
      throw new AppError(409, "EVENT_SLUG_EXISTS", "An event with this slug already exists");
    }
    throw error;
  }
  return getGroupEventSeries(db, group.id, id);
}

export async function updateGroupEventSeries(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  input: EventSeriesUpdateInput,
): Promise<EventSeries> {
  const {
    series: existing,
    context,
    settingsJson,
  } = await getManagedGroupEventSeries(db, actor, groupIdOrSlug, seriesId);
  if (existing.updatedAt !== input.expectedUpdatedAt) {
    throw new AppError(409, "EVENT_SERIES_CHANGED", "The meeting series changed; reload before saving");
  }
  const scheduleChanged =
    input.startsAt !== undefined ||
    input.recurrenceRule !== undefined ||
    input.timezone !== undefined ||
    input.durationMinutes !== undefined;
  if (scheduleChanged) {
    const materialized = await first<{ occurrence_count: number }>(
      db,
      "SELECT COUNT(*) AS occurrence_count FROM event_occurrences WHERE series_id = ?",
      [seriesId],
    );
    if ((materialized?.occurrence_count ?? 0) > 0) {
      throw new AppError(
        409,
        "EVENT_SERIES_SCHEDULE_MATERIALIZED",
        "The recurring schedule cannot be changed after occurrences are materialized; update individual occurrences or create a replacement series",
      );
    }
  }
  const now = nowIso();
  const currentPolicy = parseJsonSafe<Record<string, unknown>>(settingsJson, {});
  const settings = JSON.stringify(
    input.policy
      ? {
          ...currentPolicy,
          memberEligibility: input.policy.memberEligibility,
          guestPolicy: input.policy.guestPolicy,
        }
      : currentPolicy,
  );
  const auditChanges: Record<string, unknown> = { ...input };
  delete auditChanges.expectedUpdatedAt;
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", [
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1
                FROM event_series guarded_series
                JOIN events guarded_event ON guarded_event.id = guarded_series.event_id
               WHERE guarded_series.id = ?
                 AND MAX(guarded_series.updated_at, guarded_event.updated_at) = ?`,
        bindings: [seriesId, input.expectedUpdatedAt],
      }),
      db
        .prepare(
          `UPDATE events SET name = COALESCE(?, name), profile_key = COALESCE(?, profile_key),
             registration_mode = COALESCE(?, registration_mode), visibility = COALESCE(?, visibility), settings_json = ?,
             timezone = COALESCE(?, timezone), updated_at = ? WHERE id = ?`,
        )
        .bind(
          input.eventName ?? null,
          input.profileKey ?? null,
          input.policy?.registrationPolicy ?? null,
          input.policy?.visibility ?? null,
          settings,
          input.timezone ?? null,
          now,
          existing.eventId,
        ),
      db
        .prepare(
          `UPDATE event_series SET starts_at = COALESCE(?, starts_at),
             recurrence_rule = COALESCE(?, recurrence_rule), timezone = COALESCE(?, timezone),
             duration_minutes = COALESCE(?, duration_minutes),
             location = CASE WHEN ? = 1 THEN ? ELSE location END,
             provider_type = CASE WHEN ? = 1 THEN ? ELSE provider_type END,
             active = COALESCE(?, active), updated_at = ?
           WHERE id = ?
             AND (? = 0 OR NOT EXISTS (SELECT 1 FROM event_occurrences WHERE series_id = ?))`,
        )
        .bind(
          input.startsAt ?? null,
          input.recurrenceRule ?? null,
          input.timezone ?? null,
          input.durationMinutes ?? null,
          input.location !== undefined ? 1 : 0,
          input.location ?? null,
          input.providerType !== undefined ? 1 : 0,
          input.providerType ?? null,
          input.active === undefined ? null : input.active ? 1 : 0,
          now,
          seriesId,
          scheduleChanged ? 1 : 0,
          seriesId,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: context.groupId },
        "admin",
        actor.id,
        "event_series_updated",
        "event_series",
        seriesId,
        auditChanges,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "EVENT_SERIES_CHANGED", "The meeting series changed while the update was being saved");
    }
    if (isAuditChangeGuardFailure(error)) {
      if (scheduleChanged) {
        throw new AppError(
          409,
          "EVENT_SERIES_SCHEDULE_MATERIALIZED",
          "The recurring schedule cannot be changed after occurrences are materialized",
        );
      }
      throw new AppError(409, "EVENT_SERIES_CHANGED", "The meeting series changed while the update was being saved");
    }
    throw error;
  }
  const updated = await getEventSeriesById(db, seriesId);
  if (!updated) throw new AppError(404, "EVENT_SERIES_NOT_FOUND", "Meeting series not found");
  return updated;
}
