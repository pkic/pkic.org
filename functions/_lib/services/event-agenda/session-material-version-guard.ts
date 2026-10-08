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
/** Recheck the owned bytes, latest review and immutable receipts inside the history correction batch. */
export function prepareSessionMaterialVersionGuard(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  materials: SessionMaterial[],
  versions: SessionMaterialVersionEvidence[],
  legacyDownloads: LegacyAgendaDownload[],
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
      ),
    cleanup: db.prepare("DELETE FROM session_presentation_write_guards WHERE id=?").bind(id),
  };
}
