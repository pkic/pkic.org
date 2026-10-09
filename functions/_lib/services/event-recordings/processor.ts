import type { EventRecordingAcquisitionFailure } from "../../../../assets/shared/schemas/event-recordings";
import { first } from "../../db/queries";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import type { RealtimeKitRecordingConfiguration } from "../event-series/realtimekit-recording-contracts";
import { getRealtimeKitRecordingDownload } from "../event-series/realtimekit-recording-download";
import { prepareStorageDeletion } from "../storage-deletion-outbox";
import {
  claimRecordingAcquisition,
  finishRecordingAcquisitionFailure,
  finishRecordingAcquisitionProgress,
  prepareRecordingAcquisitionCompletion,
  recordingAcquisitionObjectKey,
  type RecordingAcquisitionClaim,
  type VerifiedRecordingAcquisitionVersion,
} from "./acquisitions";
import { terminalizeUnclaimableRecordingAcquisition } from "./acquisition-cleanup";
import {
  beginRecordingTransfer,
  recordRecordingPart,
  recordRecordingObject,
  recordRecordingVerification,
  type RecordingTransferPlan,
} from "./transfer-checkpoints";
import { readRecordingTransferState, type RecordingTransferState } from "./transfer-state";
import { transferRecordingPart, withRecordingDeadline } from "./transfer";
import { verifyRecordingObjectRange } from "./verification";

const stepDeadlineMs = 15_000;
const partBytes = 8 * 1024 ** 2;
const verificationRangeBytes = 8 * 1024 ** 2;
export interface RecordingAcquisitionProcessorDependencies {
  bucket: Pick<R2Bucket, "head" | "get" | "createMultipartUpload" | "resumeMultipartUpload">;
  configuration: RealtimeKitRecordingConfiguration | null;
  configuredOrigins: readonly string[];
  fetcher?: typeof fetch;
}
export interface RecordingAcquisitionProcessorResult {
  status: "skipped" | "progress" | "completed" | "retrying" | "failed" | "lost_lease";
  partsTransferred: number;
  verifiedBytes: number;
}
function result(status: RecordingAcquisitionProcessorResult["status"], partsTransferred = 0, verifiedBytes = 0) {
  return { status, partsTransferred, verifiedBytes };
}
function refusal(code: string) {
  return new AppError(409, code, "Recording acquisition could not advance.");
}
function objectMetadata(claim: RecordingAcquisitionClaim, versionId: string) {
  return {
    eventId: claim.acquisition.eventId,
    sourceId: claim.acquisition.sourceId,
    acquisitionId: claim.acquisition.id,
    versionId,
  };
}
function ownedObject(object: R2Object, key: string, bytes: number, metadata: Record<string, string>) {
  return (
    object.key === key &&
    object.size === bytes &&
    !!object.etag &&
    Object.entries(metadata).every(([name, value]) => object.customMetadata?.[name] === value)
  );
}

async function download(claim: RecordingAcquisitionClaim, dependencies: RecordingAcquisitionProcessorDependencies) {
  const source = claim.source;
  if (
    dependencies.configuration &&
    (dependencies.configuration.accountId !== source.provider_account_id ||
      dependencies.configuration.appId !== source.provider_app_id)
  )
    throw refusal("RECORDING_SOURCE_CHANGED");
  const response = await getRealtimeKitRecordingDownload(
    dependencies.configuration,
    {
      recordingId: source.provider_recording_id,
      sessionId: source.provider_session_id,
      meetingId: source.provider_meeting_id,
      fileBytes: source.provider_file_size,
    },
    { configuredOrigins: dependencies.configuredOrigins, deadlineMs: stepDeadlineMs },
    dependencies.fetcher,
  );
  if (!response.ok) {
    const failure: EventRecordingAcquisitionFailure =
      response.error.kind === "identity_mismatch" ? "source_changed" : "download_unavailable";
    throw new AppError(409, failure, "Recording download is unavailable.", response.error.status);
  }
  return response.value;
}

async function startTransfer(
  db: DatabaseLike,
  claim: RecordingAcquisitionClaim,
  dependencies: RecordingAcquisitionProcessorDependencies,
  sourceEtag: string,
): Promise<RecordingTransferPlan | null> {
  const versionId = crypto.randomUUID();
  const key = recordingAcquisitionObjectKey(claim, versionId);
  const upload = await withRecordingDeadline(stepDeadlineMs, () =>
    dependencies.bucket.createMultipartUpload(key, { customMetadata: objectMetadata(claim, versionId) }),
  );
  const plan: RecordingTransferPlan = {
    versionId,
    objectKey: key,
    uploadId: upload.uploadId,
    sourceEtag,
    partBytes: Math.max(partBytes, Math.ceil(claim.source.provider_file_size / 10000)),
    totalBytes: claim.source.provider_file_size,
  };
  let commitError: unknown;
  try {
    if (await beginRecordingTransfer(db, claim, plan)) return plan;
  } catch (error) {
    commitError = error;
    // A response loss is not evidence that the upload was left unowned.
  }
  const state = await readRecordingTransferState(db, claim);
  if (state?.plan?.uploadId === upload.uploadId && state.plan.objectKey === key) return state.plan;
  if (state) {
    // Only a current, guarded snapshot can prove this upload was never adopted.
    await withRecordingDeadline(stepDeadlineMs, () => upload.abort());
  }
  if (commitError !== undefined && state)
    throw commitError instanceof Error ? commitError : refusal("RECORDING_STORAGE_UNAVAILABLE");
  return state?.plan ?? null;
}

async function completeObject(
  db: DatabaseLike,
  claim: RecordingAcquisitionClaim,
  state: RecordingTransferState,
  plan: RecordingTransferPlan,
  bucket: RecordingAcquisitionProcessorDependencies["bucket"],
): Promise<string> {
  const count = Math.ceil(plan.totalBytes / plan.partBytes);
  if (
    state.parts.length !== count ||
    state.parts.some(
      (part, index) =>
        part.partNumber !== index + 1 ||
        part.uploadId !== plan.uploadId ||
        part.offset !== index * plan.partBytes ||
        part.bytes !== Math.min(plan.partBytes, plan.totalBytes - part.offset),
    )
  )
    throw refusal("RECORDING_PART_PLAN");
  let object = await withRecordingDeadline(stepDeadlineMs, () => bucket.head(plan.objectKey));
  if (!object) {
    try {
      object = await withRecordingDeadline(stepDeadlineMs, () =>
        bucket
          .resumeMultipartUpload(plan.objectKey, plan.uploadId)
          .complete(state.parts.map(({ partNumber, etag }) => ({ partNumber, etag }))),
      );
    } catch {
      // Complete may have succeeded even when the acknowledgment was lost.
      object = await withRecordingDeadline(stepDeadlineMs, () => bucket.head(plan.objectKey));
    }
  }
  if (!object) throw refusal("RECORDING_STORAGE_UNAVAILABLE");
  if (!ownedObject(object, plan.objectKey, plan.totalBytes, objectMetadata(claim, plan.versionId)))
    throw refusal("RECORDING_OBJECT_IDENTITY");
  if (!(await recordRecordingObject(db, claim, plan, object.etag))) throw refusal("RECORDING_LEASE_CHANGED");
  return object.etag;
}

interface VersionRow {
  id: string;
  eventId: string;
  sourceId: string;
  acquisitionId: string;
  version: number;
  sourceMetadataRevision: number;
  r2Key: string;
  digest: string;
  fileBytes: number;
  mimeType: VerifiedRecordingAcquisitionVersion["mimeType"];
  objectETag: string;
  acquiredAt: string;
  deletedAt: string | null;
}
async function completeVersion(
  db: DatabaseLike,
  claim: RecordingAcquisitionClaim,
  plan: RecordingTransferPlan,
  state: RecordingTransferState,
  bucket: RecordingAcquisitionProcessorDependencies["bucket"],
): Promise<boolean> {
  if (!state.sha256 || !state.mimeType || !state.objectEtag || state.verifiedBytes !== plan.totalBytes)
    throw refusal("RECORDING_VERIFICATION_PLAN");
  const existing = await first<VersionRow>(
    db,
    `SELECT id,event_id AS eventId,source_id AS sourceId,acquisition_id AS acquisitionId,
      version_number AS version,source_metadata_revision AS sourceMetadataRevision,r2_key AS r2Key,
      digest,file_size AS fileBytes,mime_type AS mimeType,object_etag AS objectETag,
      acquired_at AS acquiredAt,deleted_at AS deletedAt FROM event_recording_versions
      WHERE event_id=? AND source_id=? AND digest=? AND deleted_at IS NULL LIMIT 1`,
    [claim.acquisition.eventId, claim.acquisition.sourceId, state.sha256],
  );
  const next = await first<{ version: number }>(
    db,
    "SELECT COALESCE(MAX(version_number),0)+1 AS version FROM event_recording_versions WHERE source_id=?",
    [claim.acquisition.sourceId],
  );
  const version: VerifiedRecordingAcquisitionVersion = existing ?? {
    id: plan.versionId,
    eventId: claim.acquisition.eventId,
    sourceId: claim.acquisition.sourceId,
    acquisitionId: claim.acquisition.id,
    version: next?.version ?? 1,
    sourceMetadataRevision: claim.acquisition.expectedMetadataRevision,
    r2Key: plan.objectKey,
    digest: state.sha256,
    fileBytes: plan.totalBytes,
    mimeType: state.mimeType,
    objectETag: state.objectEtag,
    acquiredAt: nowIso(),
    deletedAt: null,
  };
  const key = recordingAcquisitionObjectKey(
    { acquisition: { eventId: version.eventId, sourceId: version.sourceId, id: version.acquisitionId } },
    version.id,
  );
  const object = await withRecordingDeadline(stepDeadlineMs, () => bucket.head(key));
  if (
    !object ||
    version.r2Key !== key ||
    version.fileBytes !== plan.totalBytes ||
    version.mimeType !== state.mimeType ||
    object.etag !== version.objectETag ||
    !ownedObject(object, key, plan.totalBytes, {
      eventId: version.eventId,
      sourceId: version.sourceId,
      acquisitionId: version.acquisitionId,
      versionId: version.id,
    })
  )
    throw refusal("RECORDING_OBJECT_IDENTITY");
  const statements = prepareRecordingAcquisitionCompletion(db, claim, version, existing !== null);
  if (existing && plan.objectKey !== key) {
    const cleanup = prepareStorageDeletion(db, plan.objectKey, nowIso(), "speaker_uploads");
    if (cleanup) statements.push(cleanup);
  }
  try {
    await db.batch(statements);
    return true;
  } catch (error) {
    const committed = await first<{ versionId: string }>(
      db,
      `SELECT completed_version_id AS versionId FROM event_recording_acquisitions
        WHERE id=? AND event_id=? AND source_id=? AND status='completed' AND completed_version_id=?`,
      [claim.acquisition.id, claim.acquisition.eventId, claim.acquisition.sourceId, version.id],
    );
    if (committed) return true;
    if (isAuthorizationGuardFailure(error)) return false;
    throw error;
  }
}

function failureKind(error: unknown): EventRecordingAcquisitionFailure {
  if (isAuthorizationGuardFailure(error)) return "authority_changed";
  if (!(error instanceof AppError)) return "storage_unavailable";
  if (error.code === "source_changed" || error.code === "RECORDING_SOURCE_CHANGED") return "source_changed";
  if (error.code === "download_unavailable") return "download_unavailable";
  if (error.code === "RECORDING_SOURCE_LOCATION") return "download_unavailable";
  if (error.code === "RECORDING_SOURCE_VALIDATOR") return "source_changed";
  if (
    error.code === "RECORDING_LEASE_CHANGED" ||
    error.code === "RECORDING_PART_CHECKPOINT" ||
    error.code === "RECORDING_VERIFICATION_LEASE"
  )
    return "authority_changed";
  if (
    error.code === "RECORDING_OBJECT_IDENTITY" ||
    error.code === "RECORDING_OBJECT_CHANGED" ||
    error.code === "RECORDING_OBJECT_LENGTH" ||
    error.code === "RECORDING_VERIFICATION_CHECKPOINT" ||
    error.code === "RECORDING_CONTAINER_UNSUPPORTED" ||
    error.code === "RECORDING_PART_LENGTH" ||
    error.code === "RECORDING_OBJECT_DIGEST"
  )
    return "integrity_failed";
  return "storage_unavailable";
}

/** A single bounded transfer or SHA range. No signed provider URL, key or lease leaves this worker result. */
export async function processRecordingAcquisition(
  db: DatabaseLike,
  acquisitionId: string,
  dependencies: RecordingAcquisitionProcessorDependencies,
): Promise<RecordingAcquisitionProcessorResult> {
  const claim = await claimRecordingAcquisition(db, acquisitionId);
  if (!claim)
    return result((await terminalizeUnclaimableRecordingAcquisition(db, acquisitionId)) ? "failed" : "skipped");
  try {
    const state = await readRecordingTransferState(db, claim);
    if (!state) return result("lost_lease");
    let plan = state.plan;
    if (!plan || state.parts.length < Math.ceil(plan.totalBytes / plan.partBytes)) {
      const source = await download(claim, dependencies);
      plan ??= await startTransfer(db, claim, dependencies, source.sourceEtag);
      if (!plan) return result("lost_lease");
      if (source.sourceEtag !== plan.sourceEtag) throw refusal("RECORDING_SOURCE_CHANGED");
      const currentPlan = plan;
      const present = new Set(state.parts.map((part) => part.partNumber));
      let partNumber = 1;
      while (present.has(partNumber)) partNumber++;
      const receipt = await transferRecordingPart(
        {
          ...plan,
          sourceUrl: source.sourceUrl,
          configuredOrigins: dependencies.configuredOrigins,
          partNumber,
          leaseToken: claim.lease.token,
        },
        {
          fetcher: dependencies.fetcher ?? fetch,
          storage: dependencies.bucket,
          checkpoint: { recordPart: (part) => recordRecordingPart(db, claim, currentPlan, part) },
        },
        stepDeadlineMs,
      );
      const released = await finishRecordingAcquisitionProgress(db, claim, {
        kind: "part",
        uploadId: receipt.uploadId,
        partNumber: receipt.partNumber,
        etag: receipt.etag,
      });
      return result(released ? "progress" : "lost_lease", 1);
    }
    if (!state.objectEtag) {
      const etag = await completeObject(db, claim, state, plan, dependencies.bucket);
      return result(
        (await finishRecordingAcquisitionProgress(db, claim, { kind: "object", etag })) ? "progress" : "lost_lease",
      );
    }
    if (state.sha256)
      return result((await completeVersion(db, claim, plan, state, dependencies.bucket)) ? "completed" : "lost_lease");
    const objectEtag = state.objectEtag;
    const progress = await verifyRecordingObjectRange(
      {
        objectKey: plan.objectKey,
        objectEtag,
        expectedBytes: plan.totalBytes,
        leaseToken: claim.lease.token,
        priorOffset: state.verifiedBytes,
        checkpoint: state.checkpoint,
        rangeBytes: verificationRangeBytes,
      },
      {
        storage: dependencies.bucket,
        checkpoint: {
          recordVerification: (value) =>
            recordRecordingVerification(db, claim, plan, objectEtag, state.verifiedBytes, value),
        },
      },
      stepDeadlineMs,
    );
    const bytes = progress.status === "verified" ? progress.bytes : progress.verifiedBytes;
    const released = await finishRecordingAcquisitionProgress(db, claim, {
      kind: "verification",
      verifiedBytes: bytes,
      checkpoint: progress.status === "verified" ? null : progress.checkpoint,
      ...(progress.status === "verified" ? { sha256: progress.sha256 } : {}),
    });
    return result(released ? "progress" : "lost_lease", 0, bytes - state.verifiedBytes);
  } catch (error) {
    const failure = failureKind(error);
    const saved = await finishRecordingAcquisitionFailure(
      db,
      claim,
      failure,
      error instanceof AppError && typeof error.details === "number" ? error.details : null,
    );
    const terminal =
      failure === "source_changed" ||
      failure === "authority_changed" ||
      failure === "integrity_failed" ||
      claim.acquisition.attempts >= 10;
    return result(saved ? (terminal ? "failed" : "retrying") : "lost_lease");
  }
}
