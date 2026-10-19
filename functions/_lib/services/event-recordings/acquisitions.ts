import { z } from "zod";
import {
  eventRecordingAcquireSchema,
  eventRecordingAcquisitionSchema,
  eventRecordingAcquisitionFailureSchema,
  eventRecordingVersionSchema,
  type EventRecordingAcquire,
  type EventRecordingAcquisition,
  type EventRecordingAcquisitionFailure,
  type EventRecordingVersion,
} from "../../../../assets/shared/schemas/event-recordings";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { computeGrantsForUser, guardPermissionDatabase, requirePermission } from "../../auth/permissions";
import {
  prepareAuthorizationGuard,
  isAuthorizationGuardFailure,
  type AuthorizationEvidence,
} from "../../db/authorization-guard";
import { first, all, run } from "../../db/queries";
import { AppError } from "../../errors";
import { createDurableJobLease, durableRenderRetry, type DurableJobLease } from "../../jobs/lease";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { readOwnedRecordingSource, type RecordingSourceRow } from "./catalog";
import { recordingManagementEvidence } from "./authorization";

interface AcquisitionRow extends EventRecordingAcquisition {
  payloadHash: string;
  requestedByUserId: string;
  processingToken: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
}
export const acquisitionMetadataColumns = `id,event_id AS eventId,source_id AS sourceId,operation_id AS operationId,
 expected_metadata_revision AS expectedMetadataRevision,status,attempts,next_attempt_at AS nextAttemptAt,
 last_failure_kind AS failure,last_provider_status AS providerStatus,completed_version_id AS versionId,
 completed_at AS completedAt,created_at AS createdAt,updated_at AS updatedAt`;
const acquisitionColumns = `${acquisitionMetadataColumns},payload_hash AS payloadHash,
 requested_by_user_id AS requestedByUserId,processing_token AS processingToken,
 claimed_at AS claimedAt,lease_expires_at AS leaseExpiresAt`;

function acquisitionMetadata(row: AcquisitionRow): EventRecordingAcquisition {
  const {
    payloadHash: _hash,
    requestedByUserId: _user,
    processingToken: _token,
    claimedAt: _claim,
    leaseExpiresAt: _lease,
    ...metadata
  } = row;
  return eventRecordingAcquisitionSchema.parse(metadata);
}
function operationConflict() {
  return new AppError(
    409,
    "RECORDING_ACQUISITION_CONFLICT",
    "This operation was already used for another recording request.",
  );
}
function changed() {
  return new AppError(409, "RECORDING_ACQUISITION_CHANGED", "The recording source or acquisition changed.");
}
function humanDatabase(db: DatabaseLike, actor: UserBackedAuthAdmin, eventId: string) {
  if (!actor.sessionId) throw new AppError(403, "RECORDING_SESSION_REQUIRED", "A current user session is required.");
  requirePermission(actor, "events:manage", { type: "event", id: eventId });
  return guardPermissionDatabase(
    db,
    actor,
    [{ permission: "events:manage", context: { type: "event", id: eventId } }],
    () => new AppError(403, "RECORDING_AUTHORIZATION_CHANGED", "Recording management access changed."),
  );
}
function readAcquisition(db: DatabaseLike, id: string) {
  return first<AcquisitionRow>(db, `SELECT ${acquisitionColumns} FROM event_recording_acquisitions WHERE id=?`, [id]);
}

/** Human polling rechecks live session authority and reveals only the exact event-owned receipt. */
export async function getRecordingAcquisition(
  db: DatabaseLike,
  eventId: string,
  sourceId: string,
  acquisitionId: string,
  actor: UserBackedAuthAdmin,
): Promise<EventRecordingAcquisition> {
  const guarded = humanDatabase(db, actor, eventId);
  const row = await first<AcquisitionRow>(
    guarded,
    `SELECT ${acquisitionColumns} FROM event_recording_acquisitions WHERE event_id=? AND source_id=? AND id=?`,
    [eventId, sourceId, acquisitionId],
  );
  if (!row) throw new AppError(404, "RECORDING_ACQUISITION_NOT_FOUND", "Recording acquisition not found.");
  return acquisitionMetadata(row);
}

function sourceEvidence(source: RecordingSourceRow, revision: number) {
  return {
    sql: `SELECT 1 FROM event_recording_sources WHERE id=? AND event_id=? AND disabled_at IS NULL
      AND metadata_revision=? AND provider_status='UPLOADED' AND provider_file_size=? AND provider_file_size>0
      AND provider_type=? AND provider_account_id=? AND provider_app_id=? AND provider_meeting_id=?
      AND provider_session_id=? AND provider_recording_id=?`,
    bindings: [
      source.id,
      source.event_id,
      revision,
      source.provider_file_size,
      source.provider_type,
      source.provider_account_id,
      source.provider_app_id,
      source.provider_meeting_id,
      source.provider_session_id,
      source.provider_recording_id,
    ],
  };
}
async function replay(db: DatabaseLike, eventId: string, operationId: string, hash: string) {
  const row = await first<AcquisitionRow>(
    db,
    `SELECT ${acquisitionColumns} FROM event_recording_acquisitions WHERE event_id=? AND operation_id=?`,
    [eventId, operationId],
  );
  if (!row) return null;
  if (row.payloadHash !== hash) throw operationConflict();
  return acquisitionMetadata(row);
}

/** Human intent and identical replay both recheck the actual browser session and event-management grant. */
export async function requestRecordingAcquisition(
  db: DatabaseLike,
  eventId: string,
  sourceId: string,
  actor: UserBackedAuthAdmin,
  input: EventRecordingAcquire,
): Promise<EventRecordingAcquisition> {
  const request = eventRecordingAcquireSchema.parse(input);
  const guarded = humanDatabase(db, actor, eventId);
  const source = await readOwnedRecordingSource(guarded, eventId, sourceId);
  if (!source) throw new AppError(404, "RECORDING_SOURCE_NOT_FOUND", "Recording source not found.");
  const hash = await sha256Hex(
    JSON.stringify([
      eventId,
      sourceId,
      actor.id,
      request.expectedMetadataRevision,
      source.provider_type,
      source.provider_account_id,
      source.provider_app_id,
      source.provider_meeting_id,
      source.provider_session_id,
      source.provider_recording_id,
    ]),
  );
  const prior = await replay(guarded, eventId, request.operationId, hash);
  if (prior) return prior;
  if (
    source.disabled_at ||
    source.metadata_revision !== request.expectedMetadataRevision ||
    source.provider_status !== "UPLOADED" ||
    !Number.isSafeInteger(source.provider_file_size) ||
    source.provider_file_size <= 0
  )
    throw changed();
  const id = uuid(),
    now = nowIso();
  try {
    await guarded.batch([
      prepareAuthorizationGuard(db, sourceEvidence(source, request.expectedMetadataRevision)),
      db
        .prepare(
          `INSERT INTO event_recording_acquisitions
        (id,event_id,source_id,operation_id,payload_hash,expected_metadata_revision,requested_by_user_id,
         status,attempts,next_attempt_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'queued',0,?,?,?)`,
        )
        .bind(
          id,
          eventId,
          sourceId,
          request.operationId,
          hash,
          request.expectedMetadataRevision,
          actor.id,
          now,
          now,
          now,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "event", id: eventId },
        "user",
        actor.id,
        "recording_acquisition_requested",
        "event_recording_acquisition",
        id,
        { sourceId, operationId: request.operationId, metadataRevision: request.expectedMetadataRevision },
        now,
      ),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      /UNIQUE constraint failed: event_recording_acquisitions\.event_id, event_recording_acquisitions\.operation_id(?:\s|:|$)/.test(
        error.message,
      )
    ) {
      const same = await replay(guarded, eventId, request.operationId, hash);
      if (same) return same;
    }
    if (isAuthorizationGuardFailure(error) || isAuditChangeGuardFailure(error)) throw changed();
    throw error;
  }
  const result = await readAcquisition(guarded, id);
  if (!result) throw changed();
  return acquisitionMetadata(result);
}

export interface RecordingAcquisitionClaim {
  acquisition: AcquisitionRow;
  source: RecordingSourceRow;
  requester: UserBackedAuthAdmin;
  lease: DurableJobLease;
}
async function currentRequester(db: DatabaseLike, userId: string): Promise<UserBackedAuthAdmin | null> {
  const user = await first<{ id: string; email: string }>(db, "SELECT id,email FROM users WHERE id=? AND active=1", [
    userId,
  ]);
  return user ? createUserBackedAuthAdmin({ ...user, grants: await computeGrantsForUser(db, user.id) }) : null;
}

/** Only durable intent authorizes a worker; live user grants are rechecked without an obsolete browser session. */
export async function claimRecordingAcquisition(
  db: DatabaseLike,
  id: string,
): Promise<RecordingAcquisitionClaim | null> {
  const acquisition = await readAcquisition(db, id);
  if (!acquisition || acquisition.versionId) return null;
  const source = await readOwnedRecordingSource(db, acquisition.eventId, acquisition.sourceId);
  const requester = await currentRequester(db, acquisition.requestedByUserId);
  if (!source || !requester) return null;
  const evidence = recordingManagementEvidence(requester, acquisition.eventId);
  const basis = sourceEvidence(source, acquisition.expectedMetadataRevision),
    lease = createDurableJobLease();
  const claimed = await run(
    db,
    `UPDATE event_recording_acquisitions
    SET status='processing',attempts=attempts+1,processing_token=?,claimed_at=?,lease_expires_at=?,updated_at=?
    WHERE id=? AND event_id=? AND source_id=? AND requested_by_user_id=? AND payload_hash=?
      AND expected_metadata_revision=? AND completed_version_id IS NULL
      AND ((status IN ('queued','retrying') AND next_attempt_at<=?) OR (status='processing' AND lease_expires_at<=?))
      AND EXISTS(${basis.sql}) AND EXISTS(${evidence.sql})`,
    [
      lease.token,
      lease.claimedAt,
      lease.expiresAt,
      lease.claimedAt,
      id,
      acquisition.eventId,
      acquisition.sourceId,
      acquisition.requestedByUserId,
      acquisition.payloadHash,
      acquisition.expectedMetadataRevision,
      lease.claimedAt,
      lease.claimedAt,
      ...basis.bindings,
      ...evidence.bindings,
    ],
  );
  if (claimed.changes !== 1) return null;
  const owned = await readAcquisition(db, id);
  if (!owned || owned.processingToken !== lease.token || owned.status !== "processing") return null;
  return { acquisition: owned, source, requester, lease };
}

function claimEvidence(claim: RecordingAcquisitionClaim) {
  const row = claim.acquisition;
  return {
    sql: `SELECT 1 FROM event_recording_acquisitions WHERE id=? AND event_id=? AND source_id=?
      AND requested_by_user_id=? AND payload_hash=? AND expected_metadata_revision=? AND attempts=? AND status='processing'
      AND processing_token=? AND claimed_at=? AND lease_expires_at=?
      AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND completed_version_id IS NULL`,
    bindings: [
      row.id,
      row.eventId,
      row.sourceId,
      row.requestedByUserId,
      row.payloadHash,
      row.expectedMetadataRevision,
      row.attempts,
      claim.lease.token,
      claim.lease.claimedAt,
      claim.lease.expiresAt,
    ],
  };
}

/** Shared live predicate for lease-owned transfer, verification and completion progress. */
export function recordingAcquisitionProgressEvidence(claim: RecordingAcquisitionClaim): AuthorizationEvidence {
  const row = claim.acquisition;
  if (
    claim.requester.id !== row.requestedByUserId ||
    claim.source.id !== row.sourceId ||
    claim.source.event_id !== row.eventId
  )
    throw changed();
  const lease = claimEvidence(claim),
    source = sourceEvidence(claim.source, row.expectedMetadataRevision),
    authority = recordingManagementEvidence(claim.requester, row.eventId);
  return {
    sql: `SELECT 1 WHERE EXISTS(${lease.sql}) AND EXISTS(${source.sql}) AND EXISTS(${authority.sql})`,
    bindings: [...lease.bindings, ...source.bindings, ...authority.bindings],
  };
}

export type VerifiedRecordingAcquisitionVersion = EventRecordingVersion & {
  acquisitionId: string;
  r2Key: string;
  objectETag: string;
};
export function recordingAcquisitionObjectKey(
  claim: { acquisition: Pick<RecordingAcquisitionClaim["acquisition"], "eventId" | "sourceId" | "id"> },
  versionId: string,
) {
  const id = eventRecordingVersionSchema.shape.id.parse(versionId);
  return `event-recordings/${claim.acquisition.eventId}/${claim.acquisition.sourceId}/${claim.acquisition.id}/${id}`;
}

/** Caller verifies owned bytes/object first and includes these statements in its compensated storage commit. */
export function prepareRecordingAcquisitionCompletion(
  db: DatabaseLike,
  claim: RecordingAcquisitionClaim,
  input: VerifiedRecordingAcquisitionVersion,
  reuse = false,
): StatementLike[] {
  const { acquisitionId, r2Key, objectETag, ...metadata } = input;
  const version = eventRecordingVersionSchema.parse(metadata),
    row = claim.acquisition;
  if (
    version.eventId !== row.eventId ||
    version.sourceId !== row.sourceId ||
    version.deletedAt !== null ||
    claim.requester.id !== row.requestedByUserId ||
    claim.source.id !== row.sourceId ||
    claim.source.event_id !== row.eventId ||
    version.fileBytes !== claim.source.provider_file_size ||
    !objectETag ||
    !r2Key ||
    (!reuse &&
      (acquisitionId !== row.id ||
        version.sourceMetadataRevision !== row.expectedMetadataRevision ||
        r2Key !== recordingAcquisitionObjectKey(claim, version.id)))
  )
    throw changed();
  const now = nowIso(),
    statements = [prepareAuthorizationGuard(db, recordingAcquisitionProgressEvidence(claim))];
  if (reuse) {
    statements.push(
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM event_recording_versions WHERE id=? AND event_id=? AND source_id=? AND acquisition_id=?
        AND version_number=? AND source_metadata_revision=? AND r2_key=? AND digest=? AND file_size=?
        AND mime_type=? AND object_etag=? AND acquired_at=? AND deleted_at IS NULL`,
        bindings: [
          version.id,
          row.eventId,
          row.sourceId,
          acquisitionId,
          version.version,
          version.sourceMetadataRevision,
          r2Key,
          version.digest,
          version.fileBytes,
          version.mimeType,
          objectETag,
          version.acquiredAt,
        ],
      }),
    );
  } else {
    statements.push(
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 WHERE (SELECT COALESCE(MAX(version_number),0) FROM event_recording_versions WHERE source_id=?)=?",
        bindings: [row.sourceId, version.version - 1],
      }),
      db
        .prepare(
          `INSERT INTO event_recording_versions(id,event_id,source_id,acquisition_id,version_number,
      source_metadata_revision,r2_key,digest,file_size,mime_type,object_etag,acquired_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          version.id,
          row.eventId,
          row.sourceId,
          acquisitionId,
          version.version,
          version.sourceMetadataRevision,
          r2Key,
          version.digest,
          version.fileBytes,
          version.mimeType,
          objectETag,
          version.acquiredAt,
        ),
    );
  }
  const evidence = claimEvidence(claim);
  statements.push(
    db
      .prepare(
        `UPDATE event_recording_acquisitions SET status='completed',completed_version_id=?,
    completed_at=?,last_failure_kind=NULL,last_provider_status=NULL,processing_token=NULL,claimed_at=NULL,
    lease_expires_at=NULL,updated_at=? WHERE id=? AND EXISTS(${evidence.sql})`,
      )
      .bind(version.id, now, now, row.id, ...evidence.bindings),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "event", id: row.eventId },
      "user",
      row.requestedByUserId,
      "recording_acquisition_completed",
      "event_recording_acquisition",
      row.id,
      { sourceId: row.sourceId, versionId: version.id, digest: version.digest },
      now,
    ),
  );
  return statements;
}

/** A failure may end its own live lease, never a successor lease or a completed recording. */
export async function finishRecordingAcquisitionFailure(
  db: DatabaseLike,
  claim: RecordingAcquisitionClaim,
  failure: EventRecordingAcquisitionFailure,
  providerStatus: EventRecordingAcquisition["providerStatus"] = null,
): Promise<boolean> {
  const kind = eventRecordingAcquisitionFailureSchema.parse(failure),
    statusCode = eventRecordingAcquisitionSchema.shape.providerStatus.parse(providerStatus),
    retry = durableRenderRetry(claim.acquisition.attempts),
    terminal = ["source_changed", "authority_changed", "integrity_failed"].includes(kind),
    now = nowIso();
  const evidence = claimEvidence(claim);
  const result = await run(
    db,
    `UPDATE event_recording_acquisitions SET status=?,next_attempt_at=?,
    last_failure_kind=?,last_provider_status=?,processing_token=NULL,claimed_at=NULL,lease_expires_at=NULL,updated_at=?
    WHERE id=? AND EXISTS(${evidence.sql})`,
    [
      terminal ? "failed" : retry.status,
      new Date(Date.parse(now) + retry.delaySeconds * 1000).toISOString(),
      kind,
      statusCode,
      now,
      claim.acquisition.id,
      ...evidence.bindings,
    ],
  );
  return result.changes === 1;
}

const progressProofSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("part"),
    uploadId: z.string().min(1),
    partNumber: z.number().int().min(1).max(10000),
    etag: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal("object"), etag: z.string().min(1) }),
  z
    .strictObject({
      kind: z.literal("verification"),
      verifiedBytes: eventRecordingVersionSchema.shape.fileBytes,
      checkpoint: z.string().min(1).nullable(),
      sha256: eventRecordingVersionSchema.shape.digest.optional(),
    })
    .refine((proof) => (proof.checkpoint === null) === (proof.sha256 !== undefined)),
]);
export type RecordingAcquisitionProgressProof = z.infer<typeof progressProofSchema>;

/** Continue only from factual stored progress. Attempts count consecutive tries since the last successful step. */
export async function finishRecordingAcquisitionProgress(
  db: DatabaseLike,
  claim: RecordingAcquisitionClaim,
  input: RecordingAcquisitionProgressProof,
): Promise<boolean> {
  const parsed = progressProofSchema.safeParse(input);
  if (!parsed.success) return false;
  const proof = parsed.data,
    row = claim.acquisition;
  let progress: AuthorizationEvidence;
  if (proof.kind === "part")
    progress = {
      sql: `SELECT 1 FROM event_recording_parts part JOIN event_recording_acquisitions acquisition
      ON acquisition.id=part.acquisition_id AND acquisition.event_id=part.event_id
      AND acquisition.source_id=part.source_id AND acquisition.transfer_upload_id=part.upload_id
      WHERE acquisition.id=? AND part.upload_id=? AND part.part_number=? AND part.etag=? AND part.byte_length>0`,
      bindings: [row.id, proof.uploadId, proof.partNumber, proof.etag],
    };
  else if (proof.kind === "object")
    progress = {
      sql: "SELECT 1 FROM event_recording_acquisitions WHERE id=? AND verification_object_etag=? AND transfer_r2_key IS NOT NULL",
      bindings: [row.id, proof.etag],
    };
  else
    progress = {
      sql: `SELECT 1 FROM event_recording_acquisitions WHERE id=? AND verification_object_etag IS NOT NULL
      AND verification_offset=? AND verification_checkpoint IS ? AND verified_digest IS ?`,
      bindings: [row.id, proof.verifiedBytes, proof.checkpoint, proof.sha256 ?? null],
    };
  const authority = recordingAcquisitionProgressEvidence(claim),
    now = nowIso();
  const result = await run(
    db,
    `UPDATE event_recording_acquisitions SET status='queued',attempts=0,
    next_attempt_at=?,processing_token=NULL,claimed_at=NULL,lease_expires_at=NULL,
    last_failure_kind=NULL,last_provider_status=NULL,updated_at=?
    WHERE id=? AND EXISTS(${authority.sql}) AND EXISTS(${progress.sql})`,
    [now, now, row.id, ...authority.bindings, ...progress.bindings],
  );
  return result.changes === 1;
}

/** Bounded due IDs for the existing scheduler; claiming still performs exact current ownership checks. */
export async function dueRecordingAcquisitionIds(db: DatabaseLike, limit: number): Promise<string[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Recording job limit must be between 1 and 100");
  const now = nowIso();
  const rows = await all<{ id: string }>(
    db,
    `SELECT id FROM (
    SELECT id,next_attempt_at AS due_at,created_at FROM event_recording_acquisitions
      WHERE status IN ('queued','retrying') AND next_attempt_at<=? AND completed_version_id IS NULL
    UNION ALL SELECT id,lease_expires_at AS due_at,created_at FROM event_recording_acquisitions
      WHERE status='processing' AND lease_expires_at<=? AND completed_version_id IS NULL)
    ORDER BY due_at,created_at,id LIMIT ?`,
    [now, now, limit],
  );
  return rows.map((row) => row.id);
}
