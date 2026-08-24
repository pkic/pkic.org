import type { z } from "zod";
import {
  EVENT_SERIES_SORT_COLUMNS,
  eventSeriesCreateSchema,
  eventSeriesListQuerySchema,
  eventSeriesUpdateSchema,
  type EventSeries,
} from "../../../../assets/shared/schemas/event-series";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { parseJsonSafe } from "../../utils/json";
import { prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import { getGroup } from "../groups";
import { requireGroupManagement } from "../groups/governance";
import { EVENT_SERIES_FROM, EVENT_SERIES_SELECT, type EventSeriesRow, toEventSeries } from "./record";

type EventSeriesCreateInput = z.infer<typeof eventSeriesCreateSchema>;
type EventSeriesUpdateInput = z.infer<typeof eventSeriesUpdateSchema>;

const SORT_EXPRESSIONS = {
  event_name: "event.name COLLATE NOCASE",
  next_occurrence_at: "next_occurrence_at",
  created_at: "series.created_at",
} satisfies Record<(typeof EVENT_SERIES_SORT_COLUMNS)[number], string>;

export async function listGroupEventSeries(
  db: DatabaseLike,
  groupIdOrSlug: string,
  query: z.infer<typeof eventSeriesListQuerySchema>,
): Promise<{ series: EventSeries[]; total: number }> {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  const conditions = ["event.owner_group_id = ?"];
  const bindings: unknown[] = [group.id];
  const search = query.q ? buildD1TextSearchFilter(query.q, ["event.name", "event.slug", "series.location"]) : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.active !== undefined) {
    conditions.push("series.active = ?");
    bindings.push(query.active === "true" ? 1 : 0);
  }
  if (query.profileKey) {
    conditions.push("event.profile_key = ?");
    bindings.push(query.profileKey);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const { rows, total } = await queryPage<EventSeriesRow>(db, {
    source: {
      selectSql: EVENT_SERIES_SELECT,
      fromSql: `${EVENT_SERIES_FROM} ${where}`,
      countFromSql: `${EVENT_SERIES_FROM} ${where}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(query.sort, SORT_EXPRESSIONS, SORT_EXPRESSIONS.next_occurrence_at, "series.id ASC"),
    limit: query.limit,
    offset: query.offset,
  });
  return { series: rows.map(toEventSeries), total };
}

export async function getGroupEventSeries(
  db: DatabaseLike,
  groupIdOrSlug: string,
  seriesId: string,
): Promise<EventSeries> {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  const row = await first<EventSeriesRow>(
    db,
    `${EVENT_SERIES_SELECT} ${EVENT_SERIES_FROM} WHERE series.id = ? AND event.owner_group_id = ?`,
    [seriesId, group.id],
  );
  if (!row) throw new AppError(404, "EVENT_SERIES_NOT_FOUND", "Meeting series not found in this group");
  return toEventSeries(row);
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
      db
        .prepare(
          `INSERT INTO events
             (id, slug, name, timezone, starts_at, ends_at, source_path, base_path,
              capacity_in_person, registration_mode, invite_limit_attendee, settings_json,
              created_at, updated_at, owner_group_id, profile_key, source_mode, links_json)
           VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, 0, ?, ?, ?, ?, ?, 'portal', NULL)`,
        )
        .bind(
          eventId,
          slug,
          input.eventName,
          input.timezone,
          `/portal/groups/${group.slug}/meetings`,
          input.policy.registrationPolicy,
          settings,
          now,
          now,
          group.id,
          input.profileKey,
        ),
      db
        .prepare(
          `INSERT INTO event_series
             (id, event_id, recurrence_rule, timezone, duration_minutes, location,
              provider_type, provider_data_json, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
        )
        .bind(
          id,
          eventId,
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
  const existing = await getGroupEventSeries(db, groupIdOrSlug, seriesId);
  await requireGroupManagement(db, actor, existing.ownerGroupId);
  const now = nowIso();
  const currentSettings = await first<{ settings_json: string }>(db, "SELECT settings_json FROM events WHERE id = ?", [
    existing.eventId,
  ]);
  const currentPolicy = parseJsonSafe<Record<string, unknown>>(currentSettings?.settings_json ?? "{}", {});
  const settings = JSON.stringify(
    input.policy
      ? {
          ...currentPolicy,
          memberEligibility: input.policy.memberEligibility,
          guestPolicy: input.policy.guestPolicy,
        }
      : currentPolicy,
  );
  await db.batch([
    db
      .prepare(
        `UPDATE events SET name = COALESCE(?, name), profile_key = COALESCE(?, profile_key),
           registration_mode = COALESCE(?, registration_mode), settings_json = ?,
           timezone = COALESCE(?, timezone), updated_at = ? WHERE id = ?`,
      )
      .bind(
        input.eventName ?? null,
        input.profileKey ?? null,
        input.policy?.registrationPolicy ?? null,
        settings,
        input.timezone ?? null,
        now,
        existing.eventId,
      ),
    db
      .prepare(
        `UPDATE event_series SET recurrence_rule = COALESCE(?, recurrence_rule),
           timezone = COALESCE(?, timezone), duration_minutes = COALESCE(?, duration_minutes),
           location = CASE WHEN ? = 1 THEN ? ELSE location END,
           provider_type = CASE WHEN ? = 1 THEN ? ELSE provider_type END,
           active = COALESCE(?, active), updated_at = ? WHERE id = ?`,
      )
      .bind(
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
      ),
    prepareAuditLogAfterOneChange(db, "admin", actor.id, "event_series_updated", "event_series", seriesId, input),
  ]);
  return getGroupEventSeries(db, existing.ownerGroupId, seriesId);
}
