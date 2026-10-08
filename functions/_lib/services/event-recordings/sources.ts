import {
  eventRecordingSourceBindSchema,
  type EventRecordingSourceBind,
  type EventRecordingSourcesQuery,
  type eventRecordingVersionsQuerySchema,
} from "../../../../assets/shared/schemas/event-recordings";
import { humanRecordingDatabase, recordingManagementEvidence } from "./authorization";
export { humanRecordingDatabase, recordingManagementEvidence } from "./authorization";
import { readOwnedRecordingMeetingLink } from "./meeting-links";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { listRealtimeKitRecordingMetadata } from "../event-series/realtimekit-recording-metadata";
import {
  realtimeKitRecordingConfigurationSchema,
  type RealtimeKitRecordingConfiguration,
} from "../event-series/realtimekit-recording-contracts";
import {
  recordingSourceColumns,
  recordingSourceMetadata,
  listRecordingSources,
  listRecordingVersions,
  type RecordingSourceRow,
} from "./catalog";
import type { z } from "zod";

export async function recordingSources(
  db: DatabaseLike,
  eventId: string,
  actor: UserBackedAuthAdmin,
  query: EventRecordingSourcesQuery,
) {
  return listRecordingSources(humanRecordingDatabase(db, actor, eventId), eventId, query);
}
export async function recordingVersions(
  db: DatabaseLike,
  eventId: string,
  actor: UserBackedAuthAdmin,
  query: z.infer<typeof eventRecordingVersionsQuerySchema>,
) {
  return listRecordingVersions(humanRecordingDatabase(db, actor, eventId), eventId, query);
}

function conflict(): AppError {
  return new AppError(409, "RECORDING_SOURCE_CONFLICT", "The recording cannot be bound to this event and occurrence.");
}
function sameBinding(row: RecordingSourceRow, eventId: string, request: EventRecordingSourceBind) {
  return row.event_id === eventId && row.meeting_link_id === request.meetingLinkId;
}

function sourceForProvider(db: DatabaseLike, config: RealtimeKitRecordingConfiguration, recordingId: string) {
  return first<RecordingSourceRow>(
    db,
    `SELECT ${recordingSourceColumns} FROM event_recording_sources
    WHERE provider_type='realtimekit' AND provider_account_id=? AND provider_app_id=? AND provider_recording_id=?`,
    [config.accountId, config.appId, recordingId],
  );
}

async function existingBinding(
  db: DatabaseLike,
  eventId: string,
  config: RealtimeKitRecordingConfiguration,
  request: EventRecordingSourceBind,
) {
  const row = await sourceForProvider(db, config, request.recordingId);
  if (!row) return null;
  if (!sameBinding(row, eventId, request)) throw conflict();
  // A replay rechecks live access and exact source scope in one batch but records no second creation audit.
  const [result] = await db.batch([
    db
      .prepare(
        `SELECT ${recordingSourceColumns} FROM event_recording_sources WHERE id=? AND event_id=?
      AND meeting_link_id=?`,
      )
      .bind(row.id, eventId, request.meetingLinkId),
  ]);
  const current = result ? batchFirst<RecordingSourceRow>(result) : null;
  if (!current) throw conflict();
  return recordingSourceMetadata(current);
}

/** Bind one exactly discovered provider recording; no publication, download, rights approval or identity inference. */
export async function bindRecordingSource(
  db: DatabaseLike,
  eventId: string,
  actor: UserBackedAuthAdmin,
  input: EventRecordingSourceBind,
  configuration: RealtimeKitRecordingConfiguration | null,
  fetcher: typeof fetch = fetch,
) {
  const request = eventRecordingSourceBindSchema.parse(input);
  const guarded = humanRecordingDatabase(db, actor, eventId);
  if (!(await first(guarded, "SELECT id FROM events WHERE id=?", [eventId])))
    throw new AppError(404, "EVENT_NOT_FOUND", "Event not found.");
  const configured = realtimeKitRecordingConfigurationSchema.safeParse(configuration);
  if (!configured.success)
    throw new AppError(503, "RECORDING_NOT_CONFIGURED", "Recording discovery is not configured.");
  const config = configured.data;
  const existing = await existingBinding(guarded, eventId, config, request);
  if (existing) return existing;
  const meeting = await readOwnedRecordingMeetingLink(guarded, eventId, request.meetingLinkId, config);
  if (!meeting) throw new AppError(404, "RECORDING_MEETING_NOT_FOUND", "Recording meeting link not found.");
  const observed = await listRealtimeKitRecordingMetadata(
    config,
    { meetingId: meeting.provider_meeting_id, page: request.discoveryPage, limit: 100 },
    fetcher,
  );
  if (!observed.ok) throw new AppError(503, "RECORDING_DISCOVERY_UNAVAILABLE", "Recording discovery is unavailable.");
  const metadata = observed.value.rows.find((row) => row.recordingId === request.recordingId);
  if (!metadata) throw new AppError(404, "RECORDING_NOT_FOUND", "Recording not found in the selected meeting page.");
  const timestamp = nowIso(),
    id = uuid();
  const row: RecordingSourceRow = {
    id,
    event_id: eventId,
    meeting_link_id: meeting.id,
    native_series_id: meeting.native_series_id,
    native_occurrence_id: meeting.native_occurrence_id,
    provider_type: "realtimekit",
    provider_account_id: config.accountId,
    provider_app_id: config.appId,
    provider_meeting_id: meeting.provider_meeting_id,
    provider_session_id: metadata.sessionId,
    provider_recording_id: metadata.recordingId,
    provider_status: metadata.status,
    provider_invoked_at: metadata.invokedAt,
    provider_started_at: metadata.startedAt,
    provider_stopped_at: metadata.stoppedAt ?? null,
    provider_file_size: metadata.fileBytes,
    metadata_revision: 1,
    observed_at: timestamp,
    disabled_at: null,
    created_by_user_id: actor.id,
    created_at: timestamp,
    updated_at: timestamp,
  };
  try {
    await db.batch([
      prepareAuthorizationGuard(db, recordingManagementEvidence(actor, eventId)),
      db
        .prepare(
          `INSERT INTO event_recording_sources (${recordingSourceColumns})
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        WHERE EXISTS(SELECT 1 FROM event_recording_meetings link WHERE link.event_id=? AND link.id=?
          AND link.provider_type='realtimekit' AND link.provider_account_id=? AND link.provider_app_id=?
          AND link.provider_meeting_id=? AND link.native_series_id IS ? AND link.native_occurrence_id IS ?)
        AND NOT EXISTS(SELECT 1 FROM event_recording_sources WHERE provider_type='realtimekit'
          AND provider_account_id=? AND provider_app_id=? AND provider_recording_id=?)
        AND (? IS NULL OR EXISTS(SELECT 1 FROM event_occurrences occurrence JOIN event_series series ON series.id=occurrence.series_id
          WHERE occurrence.id=? AND occurrence.series_id=? AND series.event_id=?))`,
        )
        .bind(
          row.id,
          row.event_id,
          row.meeting_link_id,
          row.native_series_id,
          row.native_occurrence_id,
          row.provider_type,
          row.provider_account_id,
          row.provider_app_id,
          row.provider_meeting_id,
          row.provider_session_id,
          row.provider_recording_id,
          row.provider_status,
          row.provider_invoked_at,
          row.provider_started_at,
          row.provider_stopped_at,
          row.provider_file_size,
          row.metadata_revision,
          row.observed_at,
          row.disabled_at,
          row.created_by_user_id,
          row.created_at,
          row.updated_at,
          eventId,
          meeting.id,
          config.accountId,
          config.appId,
          meeting.provider_meeting_id,
          meeting.native_series_id,
          meeting.native_occurrence_id,
          config.accountId,
          config.appId,
          request.recordingId,
          meeting.native_occurrence_id,
          meeting.native_occurrence_id,
          meeting.native_series_id,
          eventId,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "event", id: eventId },
        "user",
        actor.id,
        "recording_source_bound",
        "event_recording_source",
        id,
        { recordingId: metadata.recordingId, nativeOccurrenceId: meeting.native_occurrence_id },
        timestamp,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(403, "RECORDING_AUTHORIZATION_CHANGED", "Recording management access changed.");
    if (isAuditChangeGuardFailure(error)) {
      const retry = await existingBinding(guarded, eventId, config, request);
      if (retry) return retry;
      throw conflict();
    }
    throw error;
  }
  return recordingSourceMetadata(row);
}
