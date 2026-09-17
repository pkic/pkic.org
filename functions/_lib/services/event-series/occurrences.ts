import { meetingRecurrenceId } from "../../../../assets/shared/meeting-calendar-policy";
import { prepareCalendarRevision } from "./calendar-schedule";
import type { z } from "zod";
import {
  EVENT_OCCURRENCE_SORT_COLUMNS,
  eventOccurrenceCreateSchema,
  eventOccurrenceUpdateSchema,
  eventOccurrencesListQuerySchema,
} from "../../../../assets/shared/schemas/event-series";
import {
  batchFirst,
  buildOffsetPageStatements,
  decodeOffsetPageResults,
  type OffsetPageQuery,
} from "../../db/pagination";
import { first } from "../../db/queries";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import { activeEffectiveInviteExpirySql, effectiveMeetingGuestInviteExpirySql } from "../../invite-validity";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import {
  buildLiveAccessibleGroupResourceIdsCte,
  liveGroupResourceContextAccess,
  type GroupResourceViewer,
  type LiveGroupResourceContextAccess,
} from "../resource-grants";
import { commitEventResourceManagementBatch } from "./management";
import {
  prepareOccurrenceChangeNotifications,
  type OccurrenceChange,
  type OccurrenceNotificationOptions,
} from "./occurrence-notifications";
import { sealProviderJoinUrl } from "./provider-url";
import { type EventOccurrenceRow, toEventOccurrence } from "./record";
import { getGroupEventSeries, getManagedGroupEventSeries } from "./series";

type OccurrenceCreateInput = z.infer<typeof eventOccurrenceCreateSchema>;
type OccurrenceUpdateInput = z.infer<typeof eventOccurrenceUpdateSchema>;
type OccurrenceListQuery = z.infer<typeof eventOccurrencesListQuerySchema>;

const OCCURRENCE_SELECT = `SELECT occurrence.id, occurrence.series_id, occurrence.starts_at,
  occurrence.ends_at, occurrence.status,
  occurrence.location_override,
  COALESCE(occurrence.location_override, series.location) AS location,
  occurrence.provider_join_url_ciphertext,
  (SELECT COUNT(*) FROM event_occurrence_guests guest
    WHERE guest.series_id = occurrence.series_id
      AND (guest.occurrence_id IS NULL OR guest.occurrence_id = occurrence.id)
      AND guest.revoked_at IS NULL
      AND ${activeEffectiveInviteExpirySql(
        effectiveMeetingGuestInviteExpirySql("guest", "occurrence", "event"),
        "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      )}) AS guest_count,
  (SELECT COUNT(*) FROM event_occurrence_join_confirmations confirmation
    WHERE confirmation.occurrence_id = occurrence.id) AS join_confirmed_count,
  (SELECT COUNT(*) FROM event_occurrence_join_confirmations confirmation
    WHERE confirmation.occurrence_id = occurrence.id
      AND confirmation.attendance_verified_at IS NOT NULL) AS attendance_verified_count,
  occurrence.invitations_round, occurrence.invitations_sent_at,
  (SELECT COUNT(DISTINCT invited.recipient_email) FROM meeting_occurrence_invitations invited
    WHERE invited.occurrence_id = occurrence.id) AS invited_count,
  (SELECT COUNT(DISTINCT invited.recipient_email) FROM meeting_occurrence_invitations invited
    LEFT JOIN event_occurrence_rsvps rsvp ON rsvp.occurrence_id = occurrence.id AND rsvp.attendee_email = invited.recipient_email
    LEFT JOIN event_series_rsvps series_rsvp ON series_rsvp.series_id = occurrence.series_id AND series_rsvp.attendee_email = invited.recipient_email
    WHERE invited.occurrence_id = occurrence.id AND COALESCE(rsvp.response_status, series_rsvp.response_status) = 'accepted') AS rsvp_accepted_count,
  (SELECT COUNT(DISTINCT invited.recipient_email) FROM meeting_occurrence_invitations invited
    LEFT JOIN event_occurrence_rsvps rsvp ON rsvp.occurrence_id = occurrence.id AND rsvp.attendee_email = invited.recipient_email
    LEFT JOIN event_series_rsvps series_rsvp ON series_rsvp.series_id = occurrence.series_id AND series_rsvp.attendee_email = invited.recipient_email
    WHERE invited.occurrence_id = occurrence.id AND COALESCE(rsvp.response_status, series_rsvp.response_status) = 'declined') AS rsvp_declined_count,
  (SELECT COUNT(DISTINCT invited.recipient_email) FROM meeting_occurrence_invitations invited
    LEFT JOIN event_occurrence_rsvps rsvp ON rsvp.occurrence_id = occurrence.id AND rsvp.attendee_email = invited.recipient_email
    LEFT JOIN event_series_rsvps series_rsvp ON series_rsvp.series_id = occurrence.series_id AND series_rsvp.attendee_email = invited.recipient_email
    WHERE invited.occurrence_id = occurrence.id AND COALESCE(rsvp.response_status, series_rsvp.response_status) = 'tentative') AS rsvp_tentative_count,
  occurrence.calendar_sequence,
  occurrence.created_at, occurrence.updated_at`;
const OCCURRENCE_FROM = `FROM event_occurrences occurrence
  JOIN event_series series ON series.id = occurrence.series_id
  JOIN events event ON event.id = series.event_id`;

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

/**
 * One occurrence as a viewer sees it: the same access rule as the list, so a
 * copied URL opens exactly the record the row did.
 */
export async function getAccessibleSeriesOccurrence(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
) {
  const access = liveGroupResourceContextAccess(viewer, groupIdOrSlug);
  const accessibleEvents = buildLiveAccessibleGroupResourceIdsCte("event", groupIdOrSlug, access, "view");
  const row = await first<EventOccurrenceRow>(
    db,
    `WITH ${accessibleEvents.sql}
     ${OCCURRENCE_SELECT} ${OCCURRENCE_FROM}
     JOIN accessible_resource accessible ON accessible.resource_id = event.id
     CROSS JOIN group_access
     WHERE occurrence.id = ? AND occurrence.series_id = ?
       AND (group_access.manager_access = 1 OR series.active = 1)`,
    [...accessibleEvents.bindings, occurrenceId, seriesId],
  );
  if (!row) throw new AppError(404, "EVENT_OCCURRENCE_NOT_FOUND", "Meeting occurrence not found in this series");
  return toEventOccurrence(row);
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
  const access = liveGroupResourceContextAccess(viewer, groupIdOrSlug);
  const pageQuery = buildSeriesOccurrencesPageQuery(groupIdOrSlug, access, seriesId, query);
  const accessibleEvents = buildLiveAccessibleGroupResourceIdsCte("event", groupIdOrSlug, access, "view");
  const [pageResult, countResult, accessResult] = await db.batch([
    ...buildOffsetPageStatements(db, pageQuery),
    db
      .prepare(
        `WITH ${accessibleEvents.sql}
         SELECT 1 AS authorized
           FROM accessible_resource accessible
           JOIN events event ON event.id = accessible.resource_id
           JOIN event_series series ON series.event_id = event.id
           CROSS JOIN group_access
          WHERE series.id = ? AND (group_access.manager_access = 1 OR series.active = 1)
          LIMIT 1`,
      )
      .bind(...accessibleEvents.bindings, seriesId),
  ]);
  if (!batchFirst<{ authorized: number }>(accessResult)) {
    throw new AppError(404, "EVENT_SERIES_NOT_FOUND", "Meeting series is not available through this group");
  }
  const { rows, total } = decodeOffsetPageResults<EventOccurrenceRow>(pageResult, countResult);
  return { occurrences: rows.map(toEventOccurrence), total };
}

/** Canonical page/count query for occurrences, also used by D1 EXPLAIN tests. */
export function buildSeriesOccurrencesPageQuery(
  groupId: string,
  access: LiveGroupResourceContextAccess,
  seriesId: string,
  query: OccurrenceListQuery,
): OffsetPageQuery {
  const accessibleEvents = buildLiveAccessibleGroupResourceIdsCte("event", groupId, access, "view");
  const conditions = ["occurrence.series_id = ?"];
  const bindings: unknown[] = [...accessibleEvents.bindings, seriesId];
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
  return {
    sql: `WITH ${accessibleEvents.sql}
      ${OCCURRENCE_SELECT}
      ${OCCURRENCE_FROM}
      JOIN accessible_resource accessible ON accessible.resource_id = event.id
      CROSS JOIN group_access
      WHERE ${conditions.join(" AND ")}
        AND (group_access.manager_access = 1 OR series.active = 1)`,
    bindings,
    orderBy: resolveMappedOrderBy(query.sort, SORT_EXPRESSIONS, SORT_EXPRESSIONS.starts_at, "occurrence.id ASC"),
    limit: query.limit,
    offset: query.offset,
  };
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
             (id, series_id, starts_at, recurrence_id, ends_at, status, location_override,
              provider_join_url_ciphertext, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
        )
        .bind(
          id,
          seriesId,
          input.startsAt,
          meetingRecurrenceId(input.startsAt),
          input.endsAt,
          input.locationOverride ?? null,
          ciphertext,
          now,
          now,
        ),
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
      ...prepareCalendarRevision(db, seriesId),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "EVENT_OCCURRENCE_CHANGED", "The meeting occurrence changed while it was being saved");
    }
    if (
      error instanceof Error &&
      /UNIQUE constraint failed: event_occurrences\.series_id, event_occurrences\.(starts_at|recurrence_id)/.test(
        error.message,
      )
    ) {
      throw new AppError(409, "EVENT_OCCURRENCE_EXISTS", "An occurrence already exists at this calendar time");
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
  /** Where the change is announced from; without it the invited are not told. */
  notify?: OccurrenceNotificationOptions,
) {
  const current = await getManagedSeriesOccurrence(db, actor, groupIdOrSlug, seriesId, occurrenceId);
  if (current.occurrence.updatedAt !== input.expectedUpdatedAt) {
    throw new AppError(409, "EVENT_OCCURRENCE_CHANGED", "The meeting occurrence changed; reload before saving");
  }
  const startsAt = input.startsAt ?? current.occurrence.startsAt;
  const endsAt = input.endsAt ?? current.occurrence.endsAt;
  if (endsAt <= startsAt) {
    throw new AppError(422, "EVENT_OCCURRENCE_RANGE_INVALID", "Occurrence must end after it starts");
  }
  const status = input.status ?? current.occurrence.status;
  const location =
    input.locationOverride !== undefined
      ? (input.locationOverride ?? current.series.location)
      : current.occurrence.location;
  /*
   * What the invited are told, if anything. A meeting that moves, or is
   * called off, or is put back on after being called off, reaches every
   * calendar that holds it; a change of provider link or a completion does
   * not, since neither changes what the calendar shows.
   */
  const change: OccurrenceChange | null =
    status === "cancelled" && current.occurrence.status !== "cancelled"
      ? "cancelled"
      : status === "scheduled" &&
          (current.occurrence.status !== "scheduled" ||
            startsAt !== current.occurrence.startsAt ||
            endsAt !== current.occurrence.endsAt ||
            location !== current.occurrence.location)
        ? "updated"
        : null;
  const notifications =
    change && notify
      ? await prepareOccurrenceChangeNotifications(
          db,
          {
            occurrenceId,
            eventId: current.series.eventId,
            eventName: current.series.eventName,
            startsAt,
            endsAt,
            location,
            sequence: current.occurrence.calendarSequence + 1,
            previousStartsAt: current.occurrence.startsAt,
            previousEndsAt: current.occurrence.endsAt,
            previousLocation: current.occurrence.location,
            restored: current.occurrence.status === "cancelled",
          },
          change,
          notify,
        )
      : [];
  const ciphertext = input.providerJoinUrl
    ? await sealProviderJoinUrl(input.providerJoinUrl, encryptionSecret)
    : input.providerJoinUrl === null
      ? null
      : undefined;
  const auditChanges: Record<string, unknown> = { ...input };
  delete auditChanges.expectedUpdatedAt;
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
          `UPDATE event_occurrences SET recurrence_id = COALESCE(recurrence_id, starts_at), starts_at = ?, ends_at = ?, status = COALESCE(?, status),
             location_override = CASE WHEN ? = 1 THEN ? ELSE location_override END,
             provider_join_url_ciphertext = CASE WHEN ? = 1 THEN ? ELSE provider_join_url_ciphertext END,
             calendar_sequence = calendar_sequence + ?,
             updated_at = ? WHERE id = ? AND series_id = ? AND updated_at = ?`,
        )
        .bind(
          startsAt,
          endsAt,
          input.status ?? null,
          input.locationOverride !== undefined ? 1 : 0,
          input.locationOverride ?? null,
          ciphertext !== undefined ? 1 : 0,
          ciphertext ?? null,
          change ? 1 : 0,
          now,
          occurrenceId,
          seriesId,
          input.expectedUpdatedAt,
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
      ...notifications,
      ...(change ? prepareCalendarRevision(db, seriesId) : []),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "EVENT_OCCURRENCE_CHANGED", "The meeting occurrence changed while it was being saved");
    }
    throw error;
  }
  return (await getSeriesOccurrence(db, current.series.ownerGroupId, seriesId, occurrenceId)).occurrence;
}
