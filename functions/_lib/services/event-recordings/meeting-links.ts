import {
  eventRecordingMeetingSchema,
  eventRecordingMeetingsResponseSchema,
  type EventRecordingMeetingLink,
  type EventRecordingMeetingsQuery,
} from "../../../../assets/shared/schemas/event-recording-discovery";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import {
  realtimeKitRecordingConfigurationSchema,
  type RealtimeKitRecordingConfiguration,
} from "../event-series/realtimekit-recording-contracts";
import { getRealtimeKitMeetingMetadata } from "../event-series/realtimekit-meeting-metadata";
import {
  humanRecordingDatabase,
  humanRecordingProviderDatabase,
  recordingProviderManagementEvidence,
} from "./authorization";

export interface RecordingMeetingLinkRow {
  id: string;
  event_id: string;
  native_series_id: string | null;
  native_occurrence_id: string | null;
  provider_type: string;
  provider_account_id: string;
  provider_app_id: string;
  provider_meeting_id: string;
  title: string;
  linked_by_user_id: string;
  linked_at: string;
}
const meetingColumns = `id,event_id,native_series_id,native_occurrence_id,provider_type,
  provider_account_id,provider_app_id,provider_meeting_id,title,linked_by_user_id,linked_at`;
const nativeOwnership = `(meeting.native_occurrence_id IS NULL AND meeting.native_series_id IS NULL)
  OR EXISTS(SELECT 1 FROM event_occurrences occurrence JOIN event_series series ON series.id=occurrence.series_id
    WHERE occurrence.id=meeting.native_occurrence_id AND occurrence.series_id=meeting.native_series_id AND series.event_id=meeting.event_id)`;
export function recordingMeetingMetadata(row: RecordingMeetingLinkRow) {
  return eventRecordingMeetingSchema.parse({
    id: row.id,
    eventId: row.event_id,
    nativeOccurrenceId: row.native_occurrence_id,
    provider: row.provider_type,
    providerMeetingId: row.provider_meeting_id,
    title: row.title,
    linkedAt: row.linked_at,
  });
}

/** Every caller supplies a live guarded database; arbitrary meeting UUIDs never select discovery scope. */
export function readOwnedRecordingMeetingLink(
  db: DatabaseLike,
  eventId: string,
  meetingLinkId: string,
  configuration: RealtimeKitRecordingConfiguration,
) {
  return first<RecordingMeetingLinkRow>(
    db,
    `SELECT ${meetingColumns} FROM event_recording_meetings meeting
     WHERE event_id=? AND id=? AND provider_type='realtimekit' AND provider_account_id=? AND provider_app_id=?
       AND (${nativeOwnership})`,
    [eventId, meetingLinkId, configuration.accountId, configuration.appId],
  );
}
function existingLink(
  db: DatabaseLike,
  eventId: string,
  configuration: RealtimeKitRecordingConfiguration,
  request: EventRecordingMeetingLink,
) {
  return first<RecordingMeetingLinkRow>(
    db,
    `SELECT ${meetingColumns} FROM event_recording_meetings meeting
     WHERE event_id=? AND provider_type='realtimekit' AND provider_account_id=? AND provider_app_id=?
       AND provider_meeting_id=? AND native_occurrence_id IS ? AND (${nativeOwnership})`,
    [
      eventId,
      configuration.accountId,
      configuration.appId,
      request.providerMeetingId,
      request.nativeOccurrenceId ?? null,
    ],
  );
}
function conflict() {
  return new AppError(409, "RECORDING_MEETING_CONFLICT", "The meeting cannot be linked to this event and occurrence.");
}

/** Verify app-owned provider metadata, then atomically persist the manager's explicit event association. */
export async function linkRecordingMeeting(
  db: DatabaseLike,
  eventId: string,
  actor: UserBackedAuthAdmin,
  request: EventRecordingMeetingLink,
  configuration: RealtimeKitRecordingConfiguration | null,
  fetcher: typeof fetch = fetch,
) {
  const guarded = humanRecordingProviderDatabase(db, actor);
  if (!(await first(guarded, "SELECT id FROM events WHERE id=?", [eventId])))
    throw new AppError(404, "EVENT_NOT_FOUND", "Event not found.");
  const config = realtimeKitRecordingConfigurationSchema.safeParse(configuration);
  if (!config.success) throw new AppError(503, "RECORDING_NOT_CONFIGURED", "Recording discovery is not configured.");
  const existing = await existingLink(guarded, eventId, config.data, request);
  if (existing) return recordingMeetingMetadata(existing);
  const native = request.nativeOccurrenceId
    ? await first<{ series_id: string }>(
        guarded,
        `SELECT occurrence.series_id FROM event_occurrences occurrence JOIN event_series series ON series.id=occurrence.series_id
       WHERE occurrence.id=? AND series.event_id=?`,
        [request.nativeOccurrenceId, eventId],
      )
    : null;
  if (request.nativeOccurrenceId && !native)
    throw new AppError(422, "RECORDING_OCCURRENCE_INVALID", "Choose a meeting occurrence belonging to this event.");
  const observed = await getRealtimeKitMeetingMetadata(config.data, request.providerMeetingId, fetcher);
  if (!observed.ok) throw new AppError(503, "RECORDING_DISCOVERY_UNAVAILABLE", "Recording discovery is unavailable.");
  const row: RecordingMeetingLinkRow = {
    id: uuid(),
    event_id: eventId,
    native_series_id: native?.series_id ?? null,
    native_occurrence_id: request.nativeOccurrenceId ?? null,
    provider_type: "realtimekit",
    provider_account_id: config.data.accountId,
    provider_app_id: config.data.appId,
    provider_meeting_id: observed.value.providerMeetingId,
    title: observed.value.title,
    linked_by_user_id: actor.id,
    linked_at: nowIso(),
  };
  try {
    await db.batch([
      prepareAuthorizationGuard(db, recordingProviderManagementEvidence(actor)),
      db
        .prepare(
          `INSERT INTO event_recording_meetings (${meetingColumns})
        SELECT ?,?,?,?,?,?,?,?,?,?,?
        WHERE EXISTS(SELECT 1 FROM events WHERE id=?)
          AND (? IS NULL OR EXISTS(SELECT 1 FROM event_occurrences occurrence JOIN event_series series ON series.id=occurrence.series_id
            WHERE occurrence.id=? AND occurrence.series_id=? AND series.event_id=?))
          AND NOT EXISTS(SELECT 1 FROM event_recording_meetings WHERE event_id=? AND provider_type='realtimekit'
            AND provider_account_id=? AND provider_app_id=? AND provider_meeting_id=? AND native_occurrence_id IS ?)`,
        )
        .bind(
          row.id,
          row.event_id,
          row.native_series_id,
          row.native_occurrence_id,
          row.provider_type,
          row.provider_account_id,
          row.provider_app_id,
          row.provider_meeting_id,
          row.title,
          row.linked_by_user_id,
          row.linked_at,
          eventId,
          row.native_occurrence_id,
          row.native_occurrence_id,
          row.native_series_id,
          eventId,
          eventId,
          row.provider_account_id,
          row.provider_app_id,
          row.provider_meeting_id,
          row.native_occurrence_id,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "event", id: eventId },
        "user",
        actor.id,
        "recording_meeting_linked",
        "event_recording_meeting",
        row.id,
        { providerMeetingId: row.provider_meeting_id, nativeOccurrenceId: row.native_occurrence_id },
        row.linked_at,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(403, "RECORDING_AUTHORIZATION_CHANGED", "Recording management access changed.");
    if (isAuditChangeGuardFailure(error)) {
      const replay = await existingLink(guarded, eventId, config.data, request);
      if (replay) return recordingMeetingMetadata(replay);
      throw conflict();
    }
    throw error;
  }
  return recordingMeetingMetadata(row);
}

export async function listRecordingMeetings(
  db: DatabaseLike,
  eventId: string,
  actor: UserBackedAuthAdmin,
  query: EventRecordingMeetingsQuery,
) {
  const guarded = humanRecordingDatabase(db, actor, eventId);
  const search = query.q ? buildD1TextSearchFilter(query.q, ["title", "provider_meeting_id"]) : null;
  const page = await queryPage<RecordingMeetingLinkRow>(guarded, {
    sql: `SELECT ${meetingColumns} FROM event_recording_meetings meeting WHERE event_id=? AND (${nativeOwnership})
      ${query.nativeOccurrenceId ? "AND native_occurrence_id=?" : ""}${search ? ` AND ${search.sql}` : ""}`,
    bindings: [eventId, ...(query.nativeOccurrenceId ? [query.nativeOccurrenceId] : []), ...(search?.bindings ?? [])],
    orderBy: resolveMappedOrderBy(query.sort, { title: "title", linkedAt: "linked_at" }, "linked_at ASC", "id"),
    limit: query.limit,
    offset: query.offset,
  });
  return eventRecordingMeetingsResponseSchema.parse({
    meetings: page.rows.map(recordingMeetingMetadata),
    page: buildPageInfo(query.limit, query.offset, page.total, page.rows.length),
  });
}
