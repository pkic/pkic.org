import type { EventRecordingMimeType } from "../../../../assets/shared/schemas/event-recordings";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { batchFirst, batchRows } from "../../db/pagination";
import type { DatabaseLike } from "../../types";
import { recordingAcquisitionProgressEvidence, type RecordingAcquisitionClaim } from "./acquisitions";
import type { RecordingTransferPlan } from "./transfer-checkpoints";
import type { RecordingPartReceipt } from "./transfer";

interface TransferStateRow {
  versionId: string | null;
  objectKey: string | null;
  uploadId: string | null;
  sourceEtag: string | null;
  partBytes: number | null;
  totalBytes: number | null;
  objectEtag: string | null;
  verifiedBytes: number;
  checkpoint: string | null;
  sha256: string | null;
  mimeType: EventRecordingMimeType | null;
}
export interface RecordingTransferState {
  plan: RecordingTransferPlan | null;
  parts: RecordingPartReceipt[];
  objectEtag: string | null;
  verifiedBytes: number;
  checkpoint: string | null;
  sha256: string | null;
  mimeType: EventRecordingMimeType | null;
}

/** One live, lease-owned snapshot. Private keys and receipts never enter the catalog DTOs. */
export async function readRecordingTransferState(
  db: DatabaseLike,
  claim: RecordingAcquisitionClaim,
): Promise<RecordingTransferState | null> {
  let results;
  try {
    results = await db.batch([
      prepareAuthorizationGuard(db, recordingAcquisitionProgressEvidence(claim)),
      db
        .prepare(
          `SELECT transfer_version_id AS versionId,transfer_r2_key AS objectKey,
        transfer_upload_id AS uploadId,transfer_source_etag AS sourceEtag,transfer_part_bytes AS partBytes,transfer_total_bytes AS totalBytes,
        verification_object_etag AS objectEtag,verification_offset AS verifiedBytes,
        verification_checkpoint AS checkpoint,verified_digest AS sha256,verified_mime_type AS mimeType
        FROM event_recording_acquisitions WHERE id=? AND event_id=? AND source_id=?`,
        )
        .bind(claim.acquisition.id, claim.acquisition.eventId, claim.acquisition.sourceId),
      db
        .prepare(
          `SELECT part.upload_id AS uploadId,part.part_number AS partNumber,part.etag,
        part.byte_offset AS offset,part.byte_length AS bytes FROM event_recording_parts part
        JOIN event_recording_acquisitions acquisition ON acquisition.id=part.acquisition_id
          AND acquisition.event_id=part.event_id AND acquisition.source_id=part.source_id
          AND acquisition.transfer_upload_id=part.upload_id
        WHERE acquisition.id=? AND acquisition.event_id=? AND acquisition.source_id=?
        ORDER BY part.part_number LIMIT 10000`,
        )
        .bind(claim.acquisition.id, claim.acquisition.eventId, claim.acquisition.sourceId),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) return null;
    throw error;
  }
  const row = results[1] ? batchFirst<TransferStateRow>(results[1]) : null;
  if (!row) return null;
  const plan =
    row.versionId !== null &&
    row.objectKey !== null &&
    row.uploadId !== null &&
    row.sourceEtag !== null &&
    row.partBytes !== null &&
    row.totalBytes !== null
      ? {
          versionId: row.versionId,
          objectKey: row.objectKey,
          uploadId: row.uploadId,
          sourceEtag: row.sourceEtag,
          partBytes: row.partBytes,
          totalBytes: row.totalBytes,
        }
      : null;
  return {
    plan,
    parts: results[2] ? batchRows<RecordingPartReceipt>(results[2]) : [],
    objectEtag: row.objectEtag,
    verifiedBytes: row.verifiedBytes,
    checkpoint: row.checkpoint,
    sha256: row.sha256,
    mimeType: row.mimeType,
  };
}
