import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordingAcquisitionCleanupStorage } from "../functions/_lib/services/event-recordings/acquisition-cleanup-storage";
import { recordingAcquisitionObjectKey } from "../functions/_lib/services/event-recordings/acquisitions";

function nativeBucket() {
  const bucket = env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new Error("Native recording storage is unavailable");
  return bucket;
}

function ownership() {
  const metadata = {
    eventId: crypto.randomUUID(),
    sourceId: crypto.randomUUID(),
    acquisitionId: crypto.randomUUID(),
    versionId: crypto.randomUUID(),
  };
  const key = recordingAcquisitionObjectKey(
    {
      acquisition: {
        eventId: metadata.eventId,
        sourceId: metadata.sourceId,
        id: metadata.acquisitionId,
      },
    },
    metadata.versionId,
  );
  return { metadata, key };
}

function uploadWithAbort(
  bucket: R2Bucket,
  key: string,
  uploadId: string,
  abort: () => Promise<void>,
): R2MultipartUpload {
  const upload = bucket.resumeMultipartUpload(key, uploadId);
  return {
    key: upload.key,
    uploadId: upload.uploadId,
    abort,
    uploadPart: (...args) => upload.uploadPart(...args),
    complete: (...args) => upload.complete(...args),
  };
}

describe("owned R2 recording acquisition cleanup adapter", () => {
  afterEach(() => vi.useRealTimers());

  it("confirms an actual completed multipart object after its completion checkpoint was lost", async () => {
    const { metadata, key } = ownership(),
      bucket = nativeBucket();
    const upload = await bucket.createMultipartUpload(key, { customMetadata: metadata });
    const part = await upload.uploadPart(1, new Uint8Array([1, 2, 3, 4]));
    await upload.complete([part]);
    const resume = vi.fn((...args: Parameters<R2Bucket["resumeMultipartUpload"]>) =>
      bucket.resumeMultipartUpload(...args),
    );
    const backend = recordingAcquisitionCleanupStorage({
      head: (...args) => bucket.head(...args),
      resumeMultipartUpload: resume,
    });
    const input = { objectKey: key, uploadId: upload.uploadId, objectEtag: null };
    expect(await backend.abortMultipart(input)).toBe("already_terminated");
    expect(await backend.abortMultipart(input)).toBe("already_terminated");
    expect(resume).not.toHaveBeenCalled();
    expect((await bucket.head(key))?.customMetadata).toEqual(metadata);
  });

  it("aborts an actual owned incomplete multipart upload without inventing completion evidence", async () => {
    const { metadata, key } = ownership(),
      bucket = nativeBucket();
    const upload = await bucket.createMultipartUpload(key, { customMetadata: metadata });
    await upload.uploadPart(1, new Uint8Array([1, 2, 3, 4]));
    expect(
      await recordingAcquisitionCleanupStorage(bucket).abortMultipart({
        objectKey: key,
        uploadId: upload.uploadId,
        objectEtag: null,
      }),
    ).toBe("aborted");
    expect(await bucket.head(key)).toBeNull();
    await expect(upload.complete([{ partNumber: 1, etag: "unknown" }])).rejects.toThrow();
  });

  it("uses the durable exact object completion checkpoint without making another storage request", async () => {
    const head = vi.fn(),
      resumeMultipartUpload = vi.fn();
    expect(
      await recordingAcquisitionCleanupStorage({ head, resumeMultipartUpload }).abortMultipart({
        objectKey: ownership().key,
        uploadId: crypto.randomUUID(),
        objectEtag: "durably-checkpointed-etag",
      }),
    ).toBe("already_terminated");
    expect(head).not.toHaveBeenCalled();
    expect(resumeMultipartUpload).not.toHaveBeenCalled();
  });

  it.each(["absent", "foreign", "invalid version"] as const)(
    "does not infer completion from %s ownership metadata",
    async (variant) => {
      const { metadata, key } = ownership(),
        bucket = nativeBucket();
      const customMetadata =
        variant === "absent" ? {} : { ...metadata, versionId: variant === "foreign" ? crypto.randomUUID() : "invalid" };
      await bucket.put(key, new Uint8Array([1, 2, 3]), { customMetadata });
      const abort = vi.fn(async () => {
        throw new Error("Synthetic uncertain abort");
      });
      const backend = recordingAcquisitionCleanupStorage({
        head: (...args) => bucket.head(...args),
        resumeMultipartUpload: vi.fn((key, uploadId) => uploadWithAbort(bucket, key, uploadId, abort)),
      });
      await expect(
        backend.abortMultipart({ objectKey: key, uploadId: crypto.randomUUID(), objectEtag: null }),
      ).rejects.toThrow("Synthetic uncertain abort");
      expect(abort).toHaveBeenCalledTimes(1);
      expect(await bucket.head(key)).not.toBeNull();
    },
  );

  it("keeps repeated unknown abort errors uncertain rather than guessing an already-terminated upload", async () => {
    const { key } = ownership(),
      bucket = nativeBucket();
    const abort = vi.fn(async () => {
      throw new Error("404 upload missing");
    });
    const backend = recordingAcquisitionCleanupStorage({
      head: (...args) => bucket.head(...args),
      resumeMultipartUpload: vi.fn((key, uploadId) => uploadWithAbort(bucket, key, uploadId, abort)),
    });
    const input = { objectKey: key, uploadId: crypto.randomUUID(), objectEtag: null };
    await expect(backend.abortMultipart(input)).rejects.toThrow("404 upload missing");
    await expect(backend.abortMultipart(input)).rejects.toThrow("404 upload missing");
    expect(abort).toHaveBeenCalledTimes(2);
  });

  it("does not abort after a late head response outlives the complete cleanup deadline", async () => {
    vi.useFakeTimers();
    let finishHead!: (object: null) => void;
    const head = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          finishHead = resolve;
        }),
    );
    const resumeMultipartUpload = vi.fn();
    const pending = recordingAcquisitionCleanupStorage({ head, resumeMultipartUpload }).abortMultipart({
      objectKey: ownership().key,
      uploadId: crypto.randomUUID(),
      objectEtag: null,
    });
    const refusal = expect(pending).rejects.toMatchObject({ code: "RECORDING_DEADLINE" });
    await vi.advanceTimersByTimeAsync(15_000);
    await refusal;
    finishHead(null);
    await Promise.resolve();
    expect(resumeMultipartUpload).not.toHaveBeenCalled();
  });
});
