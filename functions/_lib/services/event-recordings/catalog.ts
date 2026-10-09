import {
  eventRecordingSourceSchema,
  eventRecordingSourcesResponseSchema,
  eventRecordingVersionsResponseSchema,
  type EventRecordingSourcesQuery,
} from "../../../../assets/shared/schemas/event-recordings";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { queryPage } from "../../db/pagination";
import { resolveMappedOrderBy } from "../../db/sort";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import type { z } from "zod";
import type { eventRecordingVersionsQuerySchema } from "../../../../assets/shared/schemas/event-recordings";

export interface RecordingSourceRow {
  id: string;
  event_id: string;
  meeting_link_id: string;
  native_series_id: string | null;
  native_occurrence_id: string | null;
  provider_type: string;
  provider_account_id: string;
  provider_app_id: string;
  provider_meeting_id: string;
  provider_session_id: string;
  provider_recording_id: string;
  provider_status: string;
  provider_invoked_at: string;
  provider_started_at: string;
  provider_stopped_at: string | null;
  provider_file_size: number;
  metadata_revision: number;
  observed_at: string;
  disabled_at: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export const recordingSourceColumns = `id,event_id,meeting_link_id,native_series_id,native_occurrence_id,provider_type,
 provider_account_id,provider_app_id,provider_meeting_id,provider_session_id,provider_recording_id,
 provider_status,provider_invoked_at,provider_started_at,provider_stopped_at,provider_file_size,
 metadata_revision,observed_at,disabled_at,created_by_user_id,created_at,updated_at`;

export function recordingSourceMetadata(row: RecordingSourceRow) {
  return eventRecordingSourceSchema.parse({
    id: row.id,
    eventId: row.event_id,
    meetingLinkId: row.meeting_link_id,
    nativeOccurrenceId: row.native_occurrence_id,
    provider: row.provider_type,
    providerMeetingId: row.provider_meeting_id,
    recordingId: row.provider_recording_id,
    sessionId: row.provider_session_id,
    status: row.provider_status,
    invokedAt: row.provider_invoked_at,
    startedAt: row.provider_started_at,
    stoppedAt: row.provider_stopped_at,
    fileBytes: row.provider_file_size,
    metadataRevision: row.metadata_revision,
    observedAt: row.observed_at,
    disabledAt: row.disabled_at,
  });
}

/** Internal event-owned row. The caller supplies its guarded database or live command evidence. */
export function readOwnedRecordingSource(db: DatabaseLike, eventId: string, sourceId: string) {
  return first<RecordingSourceRow>(
    db,
    `SELECT ${recordingSourceColumns} FROM event_recording_sources WHERE event_id=? AND id=?`,
    [eventId, sourceId],
  );
}

export async function listRecordingSources(db: DatabaseLike, eventId: string, query: EventRecordingSourcesQuery) {
  const filters = ["event_id=?"],
    bindings: unknown[] = [eventId];
  if (query.status) {
    filters.push("provider_status=?");
    bindings.push(query.status);
  }
  if (query.nativeOccurrenceId) {
    filters.push("native_occurrence_id=?");
    bindings.push(query.nativeOccurrenceId);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, [
      "provider_recording_id",
      "provider_session_id",
      "provider_meeting_id",
    ]);
    filters.push(search.sql);
    bindings.push(...search.bindings);
  }
  const columns: Record<string, string> = {
    invokedAt: "provider_invoked_at",
    startedAt: "provider_started_at",
    status: "provider_status",
  };
  const page = await queryPage<RecordingSourceRow>(db, {
    sql: `SELECT ${recordingSourceColumns} FROM event_recording_sources WHERE ${filters.join(" AND ")}`,
    bindings,
    orderBy: resolveMappedOrderBy(query.sort, columns, "provider_invoked_at DESC", "id"),
    limit: query.limit,
    offset: query.offset,
  });
  return eventRecordingSourcesResponseSchema.parse({
    sources: page.rows.map(recordingSourceMetadata),
    page: buildPageInfo(query.limit, query.offset, page.total, page.rows.length),
  });
}

interface RecordingVersionRow {
  id: string;
  event_id: string;
  source_id: string;
  version_number: number;
  source_metadata_revision: number;
  digest: string;
  file_size: number;
  mime_type: string;
  acquired_at: string;
  deleted_at: string | null;
}

export async function listRecordingVersions(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof eventRecordingVersionsQuerySchema>,
) {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["digest", "mime_type"]) : null;

  const page = await queryPage<RecordingVersionRow>(db, {
    sql: `SELECT id,event_id,source_id,version_number,source_metadata_revision,digest,file_size,mime_type,acquired_at,deleted_at
      FROM event_recording_versions WHERE event_id=?${query.sourceId ? " AND source_id=?" : ""}${search ? ` AND ${search.sql}` : ""}`,
    bindings: [eventId, ...(query.sourceId ? [query.sourceId] : []), ...(search?.bindings ?? [])],
    orderBy: resolveMappedOrderBy(
      query.sort,
      { version: "version_number", acquiredAt: "acquired_at" },
      "acquired_at DESC",
      "id",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return eventRecordingVersionsResponseSchema.parse({
    versions: page.rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      sourceId: row.source_id,
      version: row.version_number,
      sourceMetadataRevision: row.source_metadata_revision,
      digest: row.digest,
      fileBytes: row.file_size,
      mimeType: row.mime_type,
      acquiredAt: row.acquired_at,
      deletedAt: row.deleted_at,
    })),
    page: buildPageInfo(query.limit, query.offset, page.total, page.rows.length),
  });
}
