import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { computeGrantsForUser } from "../../auth/permissions";
import { all, first, run } from "../../db/queries";
import {
  isAuthorizationGuardFailure,
  prepareAuthorizationGuard,
  type AuthorizationEvidence,
} from "../../db/authorization-guard";
import { createDurableJobLease, durableRenderRetry } from "../../jobs/lease";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { prepareStorageDeletion } from "../storage-deletion-outbox";
import { recordingAcquisitionObjectKey } from "./acquisitions";
import { recordingManagementEvidence } from "./sources";

interface CleanupIntent {
  id: string;
  eventId: string;
  sourceId: string;
  requesterId: string;
  operationId: string;
  payloadHash: string;
  metadataRevision: number;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  processingToken: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  versionId: string | null;
  objectKey: string | null;
  uploadId: string | null;
  objectEtag: string | null;
  captured: string;
}
// Capture all mutable progress together: a stale observer cannot cancel a successor's intent or upload.
const capturedIntent = `json_array(event_id,source_id,requested_by_user_id,operation_id,payload_hash,
 expected_metadata_revision,status,attempts,next_attempt_at,processing_token,claimed_at,lease_expires_at,
 completed_version_id,completed_at,transfer_version_id,transfer_r2_key,transfer_upload_id,transfer_source_etag,
 transfer_part_bytes,transfer_total_bytes,verification_object_etag,verification_offset,verification_checkpoint,
 verified_digest,verified_mime_type,last_failure_kind,last_provider_status,updated_at)`;
const unreferenced = `NOT EXISTS(SELECT 1 FROM event_recording_versions version
 WHERE version.id=event_recording_acquisitions.transfer_version_id
 OR version.acquisition_id=event_recording_acquisitions.id OR version.r2_key=event_recording_acquisitions.transfer_r2_key)
 AND NOT EXISTS(SELECT 1 FROM site_publication_recording_manifests manifest
 WHERE manifest.version_id=event_recording_acquisitions.transfer_version_id)`;

function readIntent(db: DatabaseLike, id: string) {
  return first<CleanupIntent>(
    db,
    `SELECT id,event_id AS eventId,source_id AS sourceId,
    requested_by_user_id AS requesterId,operation_id AS operationId,payload_hash AS payloadHash,
    expected_metadata_revision AS metadataRevision,status,attempts,next_attempt_at AS nextAttemptAt,
    processing_token AS processingToken,claimed_at AS claimedAt,lease_expires_at AS leaseExpiresAt,
    transfer_version_id AS versionId,transfer_r2_key AS objectKey,transfer_upload_id AS uploadId,
    verification_object_etag AS objectEtag,${capturedIntent} AS captured
    FROM event_recording_acquisitions WHERE id=? AND completed_version_id IS NULL`,
    [id],
  );
}
async function authorityEvidence(db: DatabaseLike, row: CleanupIntent): Promise<AuthorizationEvidence> {
  const user = await first<{ id: string; email: string }>(db, "SELECT id,email FROM users WHERE id=? AND active=1", [
    row.requesterId,
  ]);
  // Re-activation between this read and the write refuses cancellation, rather than guessing the new grants.
  if (!user) return { sql: "SELECT 1 FROM users WHERE id=? AND active=1", bindings: [row.requesterId] };
  return recordingManagementEvidence(
    createUserBackedAuthAdmin({ ...user, grants: await computeGrantsForUser(db, user.id) }),
    row.eventId,
  );
}

/** Retire due intent only while its actual requester or captured source revision remains ineligible. */
export async function terminalizeUnclaimableRecordingAcquisition(db: DatabaseLike, id: string): Promise<boolean> {
  const row = await readIntent(db, id);
  if (!row || !["queued", "retrying", "processing"].includes(row.status)) return false;
  const authority = await authorityEvidence(db, row),
    now = nowIso();
  const source: AuthorizationEvidence = {
    sql: "SELECT 1 FROM event_recording_sources WHERE id=? AND event_id=? AND disabled_at IS NULL AND metadata_revision=? AND provider_status='UPLOADED' AND provider_file_size>0",
    bindings: [row.sourceId, row.eventId, row.metadataRevision],
  };
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE event_recording_acquisitions SET status='failed',
        last_failure_kind=CASE WHEN NOT EXISTS(${authority.sql}) THEN 'authority_changed' ELSE 'source_changed' END,
        last_provider_status=NULL,processing_token=NULL,claimed_at=NULL,lease_expires_at=NULL,next_attempt_at=?,updated_at=?
        WHERE id=? AND ${capturedIntent}=? AND completed_version_id IS NULL
        AND ((status IN('queued','retrying') AND next_attempt_at<=? AND (processing_token IS NULL OR lease_expires_at<=?))
          OR (status='processing' AND lease_expires_at<=?))
        AND (NOT EXISTS(${authority.sql}) OR NOT EXISTS(${source.sql}))`,
        )
        .bind(
          ...authority.bindings,
          now,
          now,
          row.id,
          row.captured,
          now,
          now,
          now,
          ...authority.bindings,
          ...source.bindings,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "event", id: row.eventId },
        "system",
        null,
        "recording_acquisition_cancelled",
        "event_recording_acquisition",
        row.id,
        { sourceId: row.sourceId },
        now,
      ),
    ]);
    return true;
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) return false;
    throw error;
  }
}

export interface RecordingAcquisitionCleanupStorage {
  /** Confirm termination of this exact multipart upload; an uncertain result must reject. */
  abortMultipart(input: {
    objectKey: string;
    uploadId: string;
    objectEtag: string | null;
  }): Promise<"aborted" | "already_terminated">;
}
function cleanupEvidence(row: CleanupIntent, token: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM event_recording_acquisitions WHERE id=? AND event_id=? AND source_id=?
      AND status='failed' AND completed_version_id IS NULL AND processing_token=?
      AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${capturedIntent}=? AND ${unreferenced}`,
    bindings: [row.id, row.eventId, row.sourceId, token, row.captured],
  };
}
async function retryCleanup(db: DatabaseLike, row: CleanupIntent, token: string): Promise<void> {
  const now = nowIso(),
    retry = durableRenderRetry(row.attempts);
  // Keep the terminal reason and complete upload tuple; external exception text never enters the receipt.
  await run(
    db,
    `UPDATE event_recording_acquisitions SET processing_token=NULL,claimed_at=NULL,lease_expires_at=NULL,
    next_attempt_at=?,last_provider_status=NULL,updated_at=? WHERE id=? AND status='failed'
    AND completed_version_id IS NULL AND processing_token=?`,
    [new Date(Date.parse(now) + retry.delaySeconds * 1000).toISOString(), now, row.id, token],
  );
}

/** One owned abort, then an atomic handoff to the existing object-deletion outbox. */
export async function cleanupRecordingAcquisition(
  db: DatabaseLike,
  id: string,
  storage: RecordingAcquisitionCleanupStorage,
): Promise<boolean> {
  const prior = await readIntent(db, id);
  if (!prior || prior.status !== "failed" || !prior.versionId || !prior.objectKey || !prior.uploadId) return false;
  if (
    prior.objectKey !==
    recordingAcquisitionObjectKey(
      { acquisition: { id: prior.id, eventId: prior.eventId, sourceId: prior.sourceId } },
      prior.versionId,
    )
  )
    return false;
  const lease = createDurableJobLease();
  const claimed = await run(
    db,
    `UPDATE event_recording_acquisitions SET processing_token=?,claimed_at=?,lease_expires_at=?,
    attempts=attempts+1,updated_at=? WHERE id=? AND status='failed' AND completed_version_id IS NULL
    AND ${capturedIntent}=? AND next_attempt_at<=? AND (processing_token IS NULL OR lease_expires_at<=?) AND ${unreferenced}`,
    [
      lease.token,
      lease.claimedAt,
      lease.expiresAt,
      lease.claimedAt,
      prior.id,
      prior.captured,
      lease.claimedAt,
      lease.claimedAt,
    ],
  );
  if (claimed.changes !== 1) return false;
  const row = await readIntent(db, id);
  if (!row || row.processingToken !== lease.token || !row.objectKey || !row.uploadId) return false;
  let outcome;
  try {
    outcome = await storage.abortMultipart({
      objectKey: row.objectKey,
      uploadId: row.uploadId,
      objectEtag: row.objectEtag,
    });
  } catch {
    await retryCleanup(db, row, lease.token);
    return false;
  }
  if (outcome !== "aborted" && outcome !== "already_terminated") {
    await retryCleanup(db, row, lease.token);
    return false;
  }
  try {
    const now = nowIso(),
      evidence = cleanupEvidence(row, lease.token);
    const deletion = prepareStorageDeletion(db, row.objectKey, now, "speaker_uploads");
    if (!deletion) throw new Error("Recording cleanup key is unavailable");
    await db.batch([
      prepareAuthorizationGuard(db, evidence),
      deletion,
      db
        .prepare(
          `UPDATE event_recording_acquisitions SET transfer_version_id=NULL,transfer_r2_key=NULL,
        transfer_upload_id=NULL,transfer_source_etag=NULL,transfer_part_bytes=NULL,transfer_total_bytes=NULL,
        verification_object_etag=NULL,verification_offset=0,verification_checkpoint=NULL,verified_digest=NULL,verified_mime_type=NULL,
        processing_token=NULL,claimed_at=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND EXISTS(${evidence.sql})`,
        )
        .bind(now, row.id, ...evidence.bindings),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "event", id: row.eventId },
        "system",
        null,
        "recording_acquisition_cleanup_completed",
        "event_recording_acquisition",
        row.id,
        { sourceId: row.sourceId },
        now,
      ),
    ]);
    return true;
  } catch (error) {
    await retryCleanup(db, row, lease.token);
    if (isAuthorizationGuardFailure(error) || isAuditChangeGuardFailure(error)) return false;
    throw error;
  }
}

/** Existing scheduler owns retries; this bounded read never lists completed or referenced objects. */
export async function dueRecordingAcquisitionCleanupIds(db: DatabaseLike, limit: number): Promise<string[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Recording cleanup limit must be between 1 and 100");
  const now = nowIso();
  const rows = await all<{ id: string }>(
    db,
    `SELECT id FROM event_recording_acquisitions
    WHERE status='failed' AND completed_version_id IS NULL AND transfer_upload_id IS NOT NULL AND transfer_r2_key IS NOT NULL
    AND next_attempt_at<=? AND (processing_token IS NULL OR lease_expires_at<=?) AND ${unreferenced}
    ORDER BY next_attempt_at,created_at,id LIMIT ?`,
    [now, now, limit],
  );
  return rows.map(({ id }) => id);
}
