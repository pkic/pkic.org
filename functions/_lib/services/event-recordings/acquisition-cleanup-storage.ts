import type { RecordingAcquisitionCleanupStorage } from "./acquisition-cleanup";
import { recordingAcquisitionObjectKey } from "./acquisitions";
import { withRecordingDeadline } from "./transfer";

function completedOwnedObject(object: R2Object | null, key: string): boolean {
  if (!object || object.key !== key || !object.etag) return false;
  const { eventId, sourceId, acquisitionId, versionId } = object.customMetadata ?? {};
  if (!eventId || !sourceId || !acquisitionId || !versionId) return false;
  try {
    return recordingAcquisitionObjectKey({ acquisition: { eventId, sourceId, id: acquisitionId } }, versionId) === key;
  } catch {
    return false;
  }
}

/** R2 completion evidence or a successful native abort is required; storage errors remain uncertain. */
export function recordingAcquisitionCleanupStorage(
  bucket: Pick<R2Bucket, "head" | "resumeMultipartUpload">,
): RecordingAcquisitionCleanupStorage {
  return {
    abortMultipart: ({ objectKey, uploadId, objectEtag }) =>
      withRecordingDeadline(15_000, async (signal) => {
        // A persisted completion checkpoint already proves that this multipart upload terminated.
        if (objectEtag) return "already_terminated";
        const object = await bucket.head(objectKey);
        signal.throwIfAborted();
        // Recover a completed object when the completion response was lost before its checkpoint.
        if (completedOwnedObject(object, objectKey)) return "already_terminated";
        await bucket.resumeMultipartUpload(objectKey, uploadId).abort();
        signal.throwIfAborted();
        return "aborted";
      }),
  };
}
