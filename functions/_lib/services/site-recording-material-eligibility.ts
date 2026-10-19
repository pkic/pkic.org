import { eventRecordingVersionSchema } from "../../../assets/shared/schemas/event-recordings";
import { all } from "../db/queries";
import type { DatabaseLike } from "../types";

export interface RequestedRecordingVersion {
  eventId: string;
  versionId: string;
}
export interface EligibleRecordingVersion {
  event_id: string;
  id: string;
  event_slug: string;
  digest: string;
  file_size: number;
  mime_type: string;
  r2_key: string;
  object_etag: string;
  version_number: number;
  source_id: string;
}
export const recordingEligibilityKey = (eventId: string, versionId: string) => `${eventId}\0${versionId}`;

/** Explicitly selected owned versions only; history approval remains occurrence-specific. */
export async function liveRecordingMaterialVersions(db: DatabaseLike, requested: RequestedRecordingVersion[]) {
  const versions = new Map<string, EligibleRecordingVersion>();
  for (let offset = 0; offset < requested.length; offset += 100) {
    const rows = await all<EligibleRecordingVersion>(
      db,
      `SELECT version.event_id,version.id,event.slug AS event_slug,version.digest,version.file_size,version.mime_type,version.r2_key,version.object_etag,version.version_number,version.source_id
       FROM json_each(?) requested
       JOIN event_recording_versions version ON version.id=json_extract(requested.value,'$.versionId')
         AND version.event_id=json_extract(requested.value,'$.eventId')
       JOIN event_recording_sources source ON source.id=version.source_id AND source.event_id=version.event_id
       JOIN event_recording_acquisitions acquisition ON acquisition.id=version.acquisition_id
         AND acquisition.event_id=version.event_id AND acquisition.source_id=version.source_id
         AND acquisition.completed_version_id=version.id AND acquisition.status='completed'
         AND acquisition.expected_metadata_revision=version.source_metadata_revision
         AND acquisition.completed_at IS NOT NULL
       JOIN events event ON event.id=version.event_id
       WHERE version.deleted_at IS NULL AND source.disabled_at IS NULL
         AND version.file_size>0 AND length(version.digest)=64 AND length(version.r2_key)>0
         AND length(version.object_etag)>0`,
      [JSON.stringify(requested.slice(offset, offset + 100))],
    );
    for (const row of rows) {
      const bytes = eventRecordingVersionSchema.pick({ digest: true, fileBytes: true, mimeType: true }).safeParse({
        digest: row.digest,
        fileBytes: row.file_size,
        mimeType: row.mime_type,
      });
      if (bytes.success) versions.set(recordingEligibilityKey(row.event_id, row.id), row);
    }
  }
  return versions;
}
