import type { DatabaseLike } from "../../types";
import type { SessionMaterial } from "../../../../assets/shared/schemas/event-session-history";
import type { LegacyAgendaDownload } from "../../../../assets/shared/schemas/event-agenda-legacy-fragments";
export interface SessionMaterialVersionEvidence {
  versionId: string;
  versionNumber: number;
  digest: string;
  bytes: number;
  mimeType: string;
  latestReviewId: string | null;
}
export interface SessionRecordingVersionEvidence {
  versionId: string;
  sourceId: string;
  acquisitionId: string;
  versionNumber: number;
  sourceMetadataRevision: number;
  digest: string;
  bytes: number;
  mimeType: string;
  r2Key: string;
  objectEtag: string;
  acquiredAt: string;
}
/** Recheck the owned bytes, latest review and immutable receipts inside the history correction batch. */
export function prepareSessionMaterialVersionGuard(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  materials: SessionMaterial[],
  versions: SessionMaterialVersionEvidence[],
  legacyDownloads: LegacyAgendaDownload[],
  recordings: SessionRecordingVersionEvidence[] = [],
) {
  const id = crypto.randomUUID();
  return {
    assert: db
      .prepare(
        `INSERT INTO session_presentation_write_guards(id,valid) SELECT ?,CASE WHEN
    COALESCE((SELECT json_array_length(history.metadata_json,'$.legacyDownloads') FROM event_agenda_session_history history WHERE history.occurrence_id=?),0)=json_array_length(?)
    AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(
      SELECT 1 FROM event_agenda_session_history history JOIN json_each(history.metadata_json,'$.legacyDownloads') receipt WHERE history.occurrence_id=?
      AND json_extract(receipt.value,'$.url')=json_extract(expected.value,'$.url')
      AND json_extract(receipt.value,'$.targetUrl')=json_extract(expected.value,'$.targetUrl')
      AND json_extract(receipt.value,'$.sourcePath')=json_extract(expected.value,'$.sourcePath')
      AND json_extract(receipt.value,'$.sourceDigest')=json_extract(expected.value,'$.sourceDigest')
      AND json_extract(receipt.value,'$.sourceLocator')=json_extract(expected.value,'$.sourceLocator')
      AND json_extract(receipt.value,'$.pdfDigest') IS json_extract(expected.value,'$.pdfDigest')
      AND json_extract(receipt.value,'$.pdfBytes') IS json_extract(expected.value,'$.pdfBytes')))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) material WHERE json_extract(material.value,'$.presentationSource')='session' AND json_extract(material.value,'$.presentationVersionId') IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM session_presentation_versions version JOIN json_each(?) evidence ON json_extract(evidence.value,'$.versionId')=version.id
      WHERE version.id=json_extract(material.value,'$.presentationVersionId') AND version.event_id=? AND version.occurrence_id=? AND version.deleted_at IS NULL
      AND version.version_number=json_extract(material.value,'$.version') AND version.version_number=json_extract(evidence.value,'$.versionNumber')
      AND version.source_digest=json_extract(evidence.value,'$.digest') AND version.file_size=json_extract(evidence.value,'$.bytes')
      AND version.mime_type='application/pdf' AND version.mime_type=json_extract(evidence.value,'$.mimeType')
      AND (SELECT review.id FROM session_presentation_reviews review WHERE review.version_id=version.id ORDER BY review.reviewed_at DESC,review.id DESC LIMIT 1) IS json_extract(evidence.value,'$.latestReviewId')
      AND (json_extract(material.value,'$.status')<>'approved' OR (SELECT review.status FROM session_presentation_reviews review WHERE review.version_id=version.id ORDER BY review.reviewed_at DESC,review.id DESC LIMIT 1)='approved')
      AND (json_extract(material.value,'$.legacyDownloadUrl') IS NULL OR EXISTS(SELECT 1 FROM json_each(?) receipt
        WHERE json_extract(receipt.value,'$.url')=json_extract(material.value,'$.legacyDownloadUrl')
        AND json_extract(receipt.value,'$.pdfDigest')=version.source_digest AND json_extract(receipt.value,'$.pdfBytes')=version.file_size))
    ))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) material WHERE json_extract(material.value,'$.recordingVersionId') IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM event_recording_versions version
      JOIN event_recording_sources source ON source.id=version.source_id AND source.event_id=version.event_id
      JOIN event_recording_acquisitions acquisition ON acquisition.id=version.acquisition_id AND acquisition.event_id=version.event_id AND acquisition.source_id=version.source_id
      JOIN json_each(?) evidence ON json_extract(evidence.value,'$.versionId')=version.id
      WHERE version.id=json_extract(material.value,'$.recordingVersionId') AND version.event_id=? AND version.deleted_at IS NULL AND source.disabled_at IS NULL
      AND acquisition.status='completed' AND acquisition.completed_version_id=version.id
      AND acquisition.expected_metadata_revision=version.source_metadata_revision
      AND version.source_id=json_extract(evidence.value,'$.sourceId') AND version.acquisition_id=json_extract(evidence.value,'$.acquisitionId')
      AND version.version_number=json_extract(material.value,'$.version') AND version.version_number=json_extract(evidence.value,'$.versionNumber')
      AND version.source_metadata_revision=json_extract(evidence.value,'$.sourceMetadataRevision')
      AND version.digest=json_extract(evidence.value,'$.digest') AND version.file_size=json_extract(evidence.value,'$.bytes')
      AND version.mime_type=json_extract(evidence.value,'$.mimeType') AND version.r2_key=json_extract(evidence.value,'$.r2Key')
      AND version.object_etag=json_extract(evidence.value,'$.objectEtag') AND version.acquired_at=json_extract(evidence.value,'$.acquiredAt')
    )) THEN 1 ELSE 0 END`,
      )
      .bind(
        id,
        occurrenceId,
        JSON.stringify(legacyDownloads),
        JSON.stringify(legacyDownloads),
        occurrenceId,
        JSON.stringify(materials),
        JSON.stringify(versions),
        eventId,
        occurrenceId,
        JSON.stringify(legacyDownloads),
        JSON.stringify(materials),
        JSON.stringify(recordings),
        eventId,
      ),
    cleanup: db.prepare("DELETE FROM session_presentation_write_guards WHERE id=?").bind(id),
  };
}
