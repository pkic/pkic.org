import {
  eventRecordingAcquisitionsResponseSchema,
  type EventRecordingAcquisitionsQuery,
} from "../../../../assets/shared/schemas/event-recording-acquisition-catalog";
import {
  eventRecordingAcquisitionSchema,
  eventRecordingSourceSchema,
} from "../../../../assets/shared/schemas/event-recordings";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { acquisitionMetadataColumns } from "./acquisitions";
import { humanRecordingDatabase } from "./authorization";

async function sourceMetadata(db: DatabaseLike, eventId: string, sourceId: string) {
  const source = await first(
    db,
    `SELECT id,event_id AS eventId,meeting_link_id AS meetingLinkId,
    native_occurrence_id AS nativeOccurrenceId,provider_type AS provider,provider_meeting_id AS providerMeetingId,
    provider_recording_id AS recordingId,provider_session_id AS sessionId,provider_status AS status,
    provider_invoked_at AS invokedAt,provider_started_at AS startedAt,provider_stopped_at AS stoppedAt,
    provider_file_size AS fileBytes,metadata_revision AS metadataRevision,observed_at AS observedAt,disabled_at AS disabledAt
    FROM event_recording_sources WHERE event_id=? AND id=?`,
    [eventId, sourceId],
  );
  if (!source) throw new AppError(404, "RECORDING_SOURCE_NOT_FOUND", "Recording source not found.");
  return eventRecordingSourceSchema.parse(source);
}

export function getRecordingSource(db: DatabaseLike, eventId: string, sourceId: string, actor: UserBackedAuthAdmin) {
  return sourceMetadata(humanRecordingDatabase(db, actor, eventId), eventId, sourceId);
}

export async function listSourceRecordingAcquisitions(
  db: DatabaseLike,
  eventId: string,
  sourceId: string,
  actor: UserBackedAuthAdmin,
  query: EventRecordingAcquisitionsQuery,
) {
  const guarded = humanRecordingDatabase(db, actor, eventId);
  await sourceMetadata(guarded, eventId, sourceId);
  const filters = ["event_id=?", "source_id=?"],
    bindings: unknown[] = [eventId, sourceId];
  if (query.status) {
    filters.push("status=?");
    bindings.push(query.status);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["id", "operation_id", "last_failure_kind"]);
    filters.push(search.sql);
    bindings.push(...search.bindings);
  }
  const page = await queryPage(guarded, {
    source: {
      selectSql: `SELECT ${acquisitionMetadataColumns}`,
      fromSql: `FROM event_recording_acquisitions WHERE ${filters.join(" AND ")}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { createdAt: "created_at", status: "status", nextAttemptAt: "next_attempt_at" },
      "created_at DESC",
      "id",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return eventRecordingAcquisitionsResponseSchema.parse({
    acquisitions: page.rows.map((row) => eventRecordingAcquisitionSchema.parse(row)),
    page: buildPageInfo(query.limit, query.offset, page.total, page.rows.length),
  });
}
