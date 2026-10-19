import {
  eventRecordingSourceRefreshSchema,
  type EventRecordingSourceRefresh,
} from "../../../../assets/shared/schemas/event-recordings";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { batchFirst } from "../../db/pagination";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import {
  realtimeKitRecordingConfigurationSchema,
  type RealtimeKitRecordingConfiguration,
} from "../event-series/realtimekit-recording-contracts";
import { getRealtimeKitRecordingMetadata } from "../event-series/realtimekit-recording-metadata";
import { humanRecordingDatabase, recordingManagementEvidence } from "./authorization";
import { recordingSourceColumns, recordingSourceMetadata, type RecordingSourceRow } from "./catalog";
import { readOwnedRecordingMeetingLink } from "./meeting-links";

const capturedSource = `json_array(${recordingSourceColumns})`;
const ownedMeeting = `EXISTS(SELECT 1 FROM event_recording_meetings meeting
  WHERE meeting.id=source.meeting_link_id AND meeting.event_id=source.event_id
    AND meeting.provider_type=source.provider_type AND meeting.provider_account_id=source.provider_account_id
    AND meeting.provider_app_id=source.provider_app_id AND meeting.provider_meeting_id=source.provider_meeting_id
    AND meeting.native_series_id IS source.native_series_id AND meeting.native_occurrence_id IS source.native_occurrence_id
    AND ((meeting.native_series_id IS NULL AND meeting.native_occurrence_id IS NULL)
      OR EXISTS(SELECT 1 FROM event_occurrences occurrence JOIN event_series series ON series.id=occurrence.series_id
        WHERE occurrence.id=meeting.native_occurrence_id AND occurrence.series_id=meeting.native_series_id
          AND series.event_id=meeting.event_id)))`;

function conflict() {
  return new AppError(409, "RECORDING_SOURCE_CHANGED", "Recording metadata changed. Refresh the source and try again.");
}

/** Observe one existing immutable provider identity; acquisition and its retries remain explicit and separate. */
export async function refreshRecordingSource(
  db: DatabaseLike,
  eventId: string,
  sourceId: string,
  actor: UserBackedAuthAdmin,
  input: EventRecordingSourceRefresh,
  configuration: RealtimeKitRecordingConfiguration | null,
  fetcher: typeof fetch = fetch,
) {
  const request = eventRecordingSourceRefreshSchema.parse(input);
  const guarded = humanRecordingDatabase(db, actor, eventId);
  const source = await first<RecordingSourceRow & { captured: string }>(
    guarded,
    `SELECT ${recordingSourceColumns},${capturedSource} AS captured FROM event_recording_sources
      WHERE event_id=? AND id=?`,
    [eventId, sourceId],
  );
  if (!source) throw new AppError(404, "RECORDING_SOURCE_NOT_FOUND", "Recording source not found.");
  if (source.disabled_at !== null || source.metadata_revision !== request.expectedMetadataRevision) throw conflict();
  const config = realtimeKitRecordingConfigurationSchema.safeParse(configuration);
  if (!config.success) throw new AppError(503, "RECORDING_NOT_CONFIGURED", "Recording discovery is not configured.");
  if (config.data.accountId !== source.provider_account_id || config.data.appId !== source.provider_app_id)
    throw conflict();
  const meeting = await readOwnedRecordingMeetingLink(guarded, eventId, source.meeting_link_id, config.data);
  if (
    !meeting ||
    meeting.provider_meeting_id !== source.provider_meeting_id ||
    meeting.native_series_id !== source.native_series_id ||
    meeting.native_occurrence_id !== source.native_occurrence_id
  )
    throw conflict();
  const observed = await getRealtimeKitRecordingMetadata(
    config.data,
    {
      recordingId: source.provider_recording_id,
      sessionId: source.provider_session_id,
      meetingId: source.provider_meeting_id,
    },
    fetcher,
  );
  if (!observed.ok) {
    if (observed.error.kind === "identity_mismatch") throw conflict();
    throw new AppError(503, "RECORDING_METADATA_UNAVAILABLE", "Recording metadata is unavailable.");
  }
  const metadata = observed.value;
  const changed =
    source.provider_status !== metadata.status ||
    source.provider_invoked_at !== metadata.invokedAt ||
    source.provider_started_at !== metadata.startedAt ||
    source.provider_stopped_at !== (metadata.stoppedAt ?? null) ||
    source.provider_file_size !== metadata.fileBytes;
  const where = `source.event_id=? AND source.id=? AND source.disabled_at IS NULL
    AND ${capturedSource}=? AND ${ownedMeeting}`;
  if (!changed) {
    // A no-op observes authority and the complete source/link snapshot atomically without inventing a revision.
    const [result] = await guarded.batch([
      guarded
        .prepare(`SELECT ${recordingSourceColumns} FROM event_recording_sources source WHERE ${where}`)
        .bind(eventId, sourceId, source.captured),
    ]);
    const current = result ? batchFirst<RecordingSourceRow>(result) : null;
    if (!current) throw conflict();
    return recordingSourceMetadata(current);
  }
  if (source.metadata_revision >= Number.MAX_SAFE_INTEGER) throw conflict();
  const now = nowIso();
  try {
    const results = await db.batch([
      prepareAuthorizationGuard(db, recordingManagementEvidence(actor, eventId)),
      db
        .prepare(
          `UPDATE event_recording_sources AS source SET provider_status=?,provider_invoked_at=?,
        provider_started_at=?,provider_stopped_at=?,provider_file_size=?,metadata_revision=metadata_revision+1,
        observed_at=?,updated_at=? WHERE ${where}`,
        )
        .bind(
          metadata.status,
          metadata.invokedAt,
          metadata.startedAt,
          metadata.stoppedAt ?? null,
          metadata.fileBytes,
          now,
          now,
          eventId,
          sourceId,
          source.captured,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "event", id: eventId },
        "user",
        actor.id,
        "recording_source_refreshed",
        "event_recording_source",
        sourceId,
        {
          previousMetadataRevision: source.metadata_revision,
          metadataRevision: source.metadata_revision + 1,
          status: metadata.status,
          fileBytes: metadata.fileBytes,
        },
        now,
      ),
      db
        .prepare(`SELECT ${recordingSourceColumns} FROM event_recording_sources WHERE event_id=? AND id=?`)
        .bind(eventId, sourceId),
    ]);
    const result = results[3] ? batchFirst<RecordingSourceRow>(results[3]) : null;
    if (!result) throw conflict();
    return recordingSourceMetadata(result);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(403, "RECORDING_AUTHORIZATION_CHANGED", "Recording management access changed.");
    if (isAuditChangeGuardFailure(error)) throw conflict();
    throw error;
  }
}
