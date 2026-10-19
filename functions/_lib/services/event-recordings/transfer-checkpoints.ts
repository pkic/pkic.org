import { z } from "zod";
import { recordingSourceEtagSchema } from "./source-validator";
import { eventRecordingMimeTypeSchema } from "../../../../assets/shared/schemas/event-recordings";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import {
  recordingAcquisitionObjectKey,
  recordingAcquisitionProgressEvidence,
  type RecordingAcquisitionClaim,
} from "./acquisitions";
import type { RecordingPartReceipt } from "./transfer";
import { isRecordingVerificationCheckpoint, type RecordingVerificationProgress } from "./verification";

const planSchema = z.strictObject({
  versionId: z.uuid(),
  objectKey: z.string().min(1),
  uploadId: z.string().min(1),
  sourceEtag: recordingSourceEtagSchema,
  partBytes: z
    .number()
    .int()
    .min(5 * 1024 ** 2)
    .max(5 * 1024 ** 3),
  totalBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type RecordingTransferPlan = z.infer<typeof planSchema>;

function planEvidence(claim: RecordingAcquisitionClaim, plan: RecordingTransferPlan): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM event_recording_acquisitions WHERE id=? AND transfer_version_id=?
      AND transfer_r2_key=? AND transfer_upload_id=? AND transfer_source_etag=? AND transfer_part_bytes=? AND transfer_total_bytes=?`,
    bindings: [
      claim.acquisition.id,
      plan.versionId,
      plan.objectKey,
      plan.uploadId,
      plan.sourceEtag,
      plan.partBytes,
      plan.totalBytes,
    ],
  };
}
async function commitProgress(db: DatabaseLike, claim: RecordingAcquisitionClaim, statements: StatementLike[]) {
  try {
    await db.batch([prepareAuthorizationGuard(db, recordingAcquisitionProgressEvidence(claim)), ...statements]);
    return true;
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) return false;
    throw error;
  }
}

/** Call after multipart creation. False leaves the uncommitted upload with its caller's cleanup owner. */
export async function beginRecordingTransfer(
  db: DatabaseLike,
  claim: RecordingAcquisitionClaim,
  input: RecordingTransferPlan,
): Promise<boolean> {
  const plan = planSchema.parse(input);
  if (
    plan.objectKey !== recordingAcquisitionObjectKey(claim, plan.versionId) ||
    plan.totalBytes !== claim.source.provider_file_size ||
    Math.ceil(plan.totalBytes / plan.partBytes) > 10000
  )
    return false;
  return commitProgress(db, claim, [
    db
      .prepare(
        `UPDATE event_recording_acquisitions SET transfer_version_id=?,transfer_r2_key=?,
      transfer_upload_id=?,transfer_source_etag=?,transfer_part_bytes=?,transfer_total_bytes=?,updated_at=?
      WHERE id=? AND transfer_upload_id IS NULL AND transfer_r2_key IS NULL`,
      )
      .bind(
        plan.versionId,
        plan.objectKey,
        plan.uploadId,
        plan.sourceEtag,
        plan.partBytes,
        plan.totalBytes,
        nowIso(),
        claim.acquisition.id,
      ),
    prepareAuthorizationGuard(db, planEvidence(claim, plan)),
  ]);
}

/** An identical part receipt may replay; a different receipt for that part rolls back instead of replacing evidence. */
export async function recordRecordingPart(
  db: DatabaseLike,
  claim: RecordingAcquisitionClaim,
  plan: RecordingTransferPlan,
  receipt: RecordingPartReceipt,
): Promise<boolean> {
  const offset = (receipt.partNumber - 1) * plan.partBytes;
  const expectedBytes = Math.min(plan.partBytes, plan.totalBytes - offset);
  if (
    receipt.uploadId !== plan.uploadId ||
    !Number.isSafeInteger(receipt.partNumber) ||
    receipt.partNumber < 1 ||
    offset >= plan.totalBytes ||
    receipt.offset !== offset ||
    receipt.bytes !== expectedBytes ||
    !receipt.etag
  )
    return false;
  return commitProgress(db, claim, [
    prepareAuthorizationGuard(db, planEvidence(claim, plan)),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM event_recording_acquisitions WHERE id=? AND verification_object_etag IS NULL`,
      bindings: [claim.acquisition.id],
    }),
    db
      .prepare(
        `INSERT INTO event_recording_parts(event_id,source_id,acquisition_id,upload_id,part_number,
      etag,byte_offset,byte_length,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(acquisition_id,upload_id,part_number) DO NOTHING`,
      )
      .bind(
        claim.acquisition.eventId,
        claim.acquisition.sourceId,
        claim.acquisition.id,
        plan.uploadId,
        receipt.partNumber,
        receipt.etag,
        receipt.offset,
        receipt.bytes,
        nowIso(),
      ),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM event_recording_parts WHERE acquisition_id=? AND upload_id=? AND part_number=?
        AND etag=? AND byte_offset=? AND byte_length=? AND event_id=? AND source_id=?`,
      bindings: [
        claim.acquisition.id,
        plan.uploadId,
        receipt.partNumber,
        receipt.etag,
        receipt.offset,
        receipt.bytes,
        claim.acquisition.eventId,
        claim.acquisition.sourceId,
      ],
    }),
  ]);
}

/** Storage completion is factual progress, never publication approval or a completed acquisition version. */
export async function recordRecordingObject(
  db: DatabaseLike,
  claim: RecordingAcquisitionClaim,
  plan: RecordingTransferPlan,
  objectEtag: string,
): Promise<boolean> {
  if (!objectEtag) return false;
  return commitProgress(db, claim, [
    prepareAuthorizationGuard(db, planEvidence(claim, plan)),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 WHERE (SELECT COUNT(*) FROM event_recording_parts WHERE acquisition_id=? AND upload_id=?)=?
        AND (SELECT COALESCE(SUM(byte_length),0) FROM event_recording_parts WHERE acquisition_id=? AND upload_id=?)=?`,
      bindings: [
        claim.acquisition.id,
        plan.uploadId,
        Math.ceil(plan.totalBytes / plan.partBytes),
        claim.acquisition.id,
        plan.uploadId,
        plan.totalBytes,
      ],
    }),
    db
      .prepare(
        `UPDATE event_recording_acquisitions SET verification_object_etag=?,updated_at=?
      WHERE id=? AND (verification_object_etag IS NULL OR verification_object_etag=?)`,
      )
      .bind(objectEtag, nowIso(), claim.acquisition.id, objectEtag),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM event_recording_acquisitions WHERE id=? AND verification_object_etag=?`,
      bindings: [claim.acquisition.id, objectEtag],
    }),
  ]);
}

/** The pending state and final full digest each share one lease/prior-offset compare-and-set. */
export async function recordRecordingVerification(
  db: DatabaseLike,
  claim: RecordingAcquisitionClaim,
  plan: RecordingTransferPlan,
  objectEtag: string,
  priorOffset: number,
  progress: RecordingVerificationProgress,
): Promise<boolean> {
  const final = progress.checkpoint === null;
  if (
    !Number.isSafeInteger(priorOffset) ||
    priorOffset < 0 ||
    !Number.isSafeInteger(progress.verifiedBytes) ||
    progress.verifiedBytes <= priorOffset ||
    progress.verifiedBytes > plan.totalBytes ||
    (final
      ? progress.verifiedBytes !== plan.totalBytes ||
        !/^[a-f0-9]{64}$/.test(progress.sha256) ||
        !eventRecordingMimeTypeSchema.safeParse(progress.mimeType).success
      : !isRecordingVerificationCheckpoint({
          objectKey: plan.objectKey,
          objectEtag,
          expectedBytes: plan.totalBytes,
          priorOffset: progress.verifiedBytes,
          checkpoint: progress.checkpoint,
        }))
  )
    return false;
  return commitProgress(db, claim, [
    prepareAuthorizationGuard(db, planEvidence(claim, plan)),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM event_recording_acquisitions WHERE id=? AND verification_object_etag=?
        AND ((verification_offset=? AND verified_digest IS NULL) OR
          (verification_offset=? AND verification_checkpoint IS ? AND verified_digest IS ? AND verified_mime_type IS ?))`,
      bindings: [
        claim.acquisition.id,
        objectEtag,
        priorOffset,
        progress.verifiedBytes,
        progress.checkpoint,
        final ? progress.sha256 : null,
        final ? progress.mimeType : null,
      ],
    }),
    db
      .prepare(
        `UPDATE event_recording_acquisitions SET verification_offset=?,verification_checkpoint=?,
      verified_digest=?,verified_mime_type=?,updated_at=? WHERE id=? AND verification_offset=? AND verified_digest IS NULL`,
      )
      .bind(
        progress.verifiedBytes,
        progress.checkpoint,
        final ? progress.sha256 : null,
        final ? progress.mimeType : null,
        nowIso(),
        claim.acquisition.id,
        priorOffset,
      ),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM event_recording_acquisitions WHERE id=? AND verification_object_etag=?
        AND verification_offset=? AND verification_checkpoint IS ? AND verified_digest IS ? AND verified_mime_type IS ?`,
      bindings: [
        claim.acquisition.id,
        objectEtag,
        progress.verifiedBytes,
        progress.checkpoint,
        final ? progress.sha256 : null,
        final ? progress.mimeType : null,
      ],
    }),
  ]);
}
