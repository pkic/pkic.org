import type { z } from "zod";
import {
  EVENT_OCCURRENCE_SORT_COLUMNS,
  eventOccurrenceCreateSchema,
  eventOccurrenceUpdateSchema,
  eventOccurrencesListQuerySchema,
} from "../../../../assets/shared/schemas/event-series";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditOneChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import type { GroupResourceViewer } from "../resource-grants";
import { commitEventResourceManagementBatch } from "./management";
import { sealProviderJoinUrl } from "./provider-url";
import { type EventOccurrenceRow, toEventOccurrence } from "./record";
import { getAccessibleGroupEventSeries, getGroupEventSeries, getManagedGroupEventSeries } from "./series";

type OccurrenceCreateInput = z.infer<typeof eventOccurrenceCreateSchema>;
type OccurrenceUpdateInput = z.infer<typeof eventOccurrenceUpdateSchema>;
type OccurrenceListQuery = z.infer<typeof eventOccurrencesListQuerySchema>;

const OCCURRENCE_SELECT = `SELECT occurrence.id, occurrence.series_id, occurrence.starts_at,
  occurrence.ends_at, occurrence.status,
  COALESCE(occurrence.location_override, series.location) AS location,
  occurrence.provider_join_url_ciphertext,
  (SELECT COUNT(*) FROM event_occurrence_guests guest
    WHERE guest.series_id = occurrence.series_id
      AND (guest.occurrence_id IS NULL OR guest.occurrence_id = occurrence.id)
      AND guest.revoked_at IS NULL AND guest.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS guest_count,
  (SELECT COUNT(*) FROM event_occurrence_join_confirmations confirmation
    WHERE confirmation.occurrence_id = occurrence.id) AS join_confirmed_count,
  (SELECT COUNT(*) FROM event_occurrence_join_confirmations confirmation
    WHERE confirmation.occurrence_id = occurrence.id
      AND confirmation.attendance_verified_at IS NOT NULL) AS attendance_verified_count,
  occurrence.created_at, occurrence.updated_at`;
const OCCURRENCE_FROM = `FROM event_occurrences occurrence
  JOIN event_series series ON series.id = occurrence.series_id`;

const SORT_EXPRESSIONS = {
  starts_at: "occurrence.starts_at",
  ends_at: "occurrence.ends_at",
  status: "occurrence.status",
} satisfies Record<(typeof EVENT_OCCURRENCE_SORT_COLUMNS)[number], string>;

export async function getSeriesOccurrence(
  db: DatabaseLike,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
): Promise<{
  series: Awaited<ReturnType<typeof getGroupEventSeries>>;
  occurrence: ReturnType<typeof toEventOccurrence>;
}> {
  const series = await getGroupEventSeries(db, groupIdOrSlug, seriesId);
  const row = await first<EventOccurrenceRow>(
    db,
    `${OCCURRENCE_SELECT} ${OCCURRENCE_FROM} WHERE occurrence.id = ? AND occurrence.series_id = ?`,
    [occurrenceId, seriesId],
  );
  if (!row) throw new AppError(404, "EVENT_OCCURRENCE_NOT_FOUND", "Meeting occurrence not found in this series");
  return { series, occurrence: toEventOccurrence(row) };
}

export async function getManagedSeriesOccurrence(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
) {
  const managed = await getManagedGroupEventSeries(db, actor, groupIdOrSlug, seriesId);
  const row = await first<EventOccurrenceRow>(
    db,
    `${OCCURRENCE_SELECT} ${OCCURRENCE_FROM} WHERE occurrence.id = ? AND occurrence.series_id = ?`,
    [occurrenceId, seriesId],
  );
  if (!row) throw new AppError(404, "EVENT_OCCURRENCE_NOT_FOUND", "Meeting occurrence not found in this series");
  return { ...managed, occurrence: toEventOccurrence(row) };
}

export async function listSeriesOccurrences(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupIdOrSlug: string,
  seriesId: string,
  query: OccurrenceListQuery,
) {
  await getAccessibleGroupEventSeries(db, viewer, groupIdOrSlug, seriesId);
  const conditions = ["occurrence.series_id = ?"];
  const bindings: unknown[] = [seriesId];
  if (query.status) {
    conditions.push("occurrence.status = ?");
    bindings.push(query.status);
  }
  if (query.from) {
    conditions.push("occurrence.starts_at >= ?");
    bindings.push(query.from);
  }
  if (query.to) {
    conditions.push("occurrence.starts_at <= ?");
    bindings.push(query.to);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const { rows, total } = await queryPage<EventOccurrenceRow>(db, {
    source: {
      selectSql: OCCURRENCE_SELECT,
      fromSql: `${OCCURRENCE_FROM} ${where}`,
      countFromSql: `FROM event_occurrences occurrence ${where}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(query.sort, SORT_EXPRESSIONS, SORT_EXPRESSIONS.starts_at, "occurrence.id ASC"),
    limit: query.limit,
    offset: query.offset,
  });
  return { occurrences: rows.map(toEventOccurrence), total };
}

export async function createSeriesOccurrence(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  input: OccurrenceCreateInput,
  encryptionSecret: string,
) {
  const { series, context } = await getManagedGroupEventSeries(db, actor, groupIdOrSlug, seriesId);
  const id = uuid();
  const now = nowIso();
  const ciphertext = input.providerJoinUrl ? await sealProviderJoinUrl(input.providerJoinUrl, encryptionSecret) : null;
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", [
      db
        .prepare(
          `INSERT INTO event_occurrences
             (id, series_id, starts_at, ends_at, status, location_override,
              provider_join_url_ciphertext, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
        )
        .bind(id, seriesId, input.startsAt, input.endsAt, input.locationOverride ?? null, ciphertext, now, now),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: context.groupId },
        "admin",
        actor.id,
        "event_occurrence_created",
        "event_occurrence",
        id,
        { seriesId, startsAt: input.startsAt },
      ),
      db
        .prepare(
          `UPDATE events SET
             starts_at = (SELECT MIN(starts_at) FROM event_occurrences WHERE series_id = ? AND status != 'cancelled'),
             ends_at = (SELECT MAX(ends_at) FROM event_occurrences WHERE series_id = ? AND status != 'cancelled'),
             updated_at = ? WHERE id = ?`,
        )
        .bind(seriesId, seriesId, now, series.eventId),
    ]);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "EVENT_OCCURRENCE_CHANGED", "The meeting occurrence changed while it was being saved");
    }
    throw error;
  }
  return (await getSeriesOccurrence(db, series.ownerGroupId, seriesId, id)).occurrence;
}

export async function updateSeriesOccurrence(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
  input: OccurrenceUpdateInput,
  encryptionSecret: string,
) {
  const current = await getManagedSeriesOccurrence(db, actor, groupIdOrSlug, seriesId, occurrenceId);
  const startsAt = input.startsAt ?? current.occurrence.startsAt;
  const endsAt = input.endsAt ?? current.occurrence.endsAt;
  if (endsAt <= startsAt) {
    throw new AppError(422, "EVENT_OCCURRENCE_RANGE_INVALID", "Occurrence must end after it starts");
  }
  const ciphertext = input.providerJoinUrl
    ? await sealProviderJoinUrl(input.providerJoinUrl, encryptionSecret)
    : input.providerJoinUrl === null
      ? null
      : undefined;
  const auditChanges = { ...input };
  delete auditChanges.providerJoinUrl;
  const auditDetails =
    input.providerJoinUrl === undefined
      ? auditChanges
      : { ...auditChanges, providerJoinUrlChanged: true, providerConfigured: input.providerJoinUrl !== null };
  const now = nowIso();
  try {
    await commitEventResourceManagementBatch(db, actor, current.context, "manage", [
      db
        .prepare(
          `UPDATE event_occurrences SET starts_at = ?, ends_at = ?, status = COALESCE(?, status),
             location_override = CASE WHEN ? = 1 THEN ? ELSE location_override END,
             provider_join_url_ciphertext = CASE WHEN ? = 1 THEN ? ELSE provider_join_url_ciphertext END,
             updated_at = ? WHERE id = ? AND series_id = ?`,
        )
        .bind(
          startsAt,
          endsAt,
          input.status ?? null,
          input.locationOverride !== undefined ? 1 : 0,
          input.locationOverride ?? null,
          ciphertext !== undefined ? 1 : 0,
          ciphertext ?? null,
          now,
          occurrenceId,
          seriesId,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: current.context.groupId },
        "admin",
        actor.id,
        "event_occurrence_updated",
        "event_occurrence",
        occurrenceId,
        auditDetails,
      ),
      db
        .prepare(
          `UPDATE events SET
             starts_at = (SELECT MIN(starts_at) FROM event_occurrences WHERE series_id = ? AND status != 'cancelled'),
             ends_at = (SELECT MAX(ends_at) FROM event_occurrences WHERE series_id = ? AND status != 'cancelled'),
             updated_at = ? WHERE id = ?`,
        )
        .bind(seriesId, seriesId, now, current.series.eventId),
    ]);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "EVENT_OCCURRENCE_CHANGED", "The meeting occurrence changed while it was being saved");
    }
    throw error;
  }
  return (await getSeriesOccurrence(db, current.series.ownerGroupId, seriesId, occurrenceId)).occurrence;
}
