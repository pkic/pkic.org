import { recordingContainerMimeType } from "../../../../assets/shared/session-recording-container";
import { AppError } from "../../errors";
import { recordingSourceEtagSchema } from "./source-validator";

export interface RecordingPartReceipt {
  uploadId: string;
  partNumber: number;
  etag: string;
  offset: number;
  bytes: number;
}
export interface RecordingTransferStorage {
  resumeMultipartUpload(key: string, uploadId: string): Pick<R2MultipartUpload, "uploadPart">;
}
export interface RecordingPartCheckpoint {
  /** Must atomically check the caller's current lease and expected progress. False is not a durable receipt. */
  recordPart(receipt: RecordingPartReceipt, authority: { leaseToken: string }): Promise<boolean>;
}
export interface RecordingPartTransfer {
  sourceUrl: string;
  configuredOrigins: readonly string[];
  sourceEtag: string;
  totalBytes: number;
  partBytes: number;
  partNumber: number;
  objectKey: string;
  uploadId: string;
  leaseToken: string;
}
function refusal(code: string, message: string) {
  return new AppError(409, code, message);
}
function positiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}
function sourceLocation(input: RecordingPartTransfer) {
  let url: URL;
  try {
    url = new URL(input.sourceUrl);
  } catch {
    throw refusal("RECORDING_SOURCE_LOCATION", "The recording download location is not allowed.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !input.configuredOrigins.includes(url.origin)
  )
    throw refusal("RECORDING_SOURCE_LOCATION", "The recording download location is not allowed.");
  if (!recordingSourceEtagSchema.safeParse(input.sourceEtag).success)
    throw refusal("RECORDING_SOURCE_VALIDATOR", "A stable strong recording validator is required.");
  return url;
}
export async function withRecordingDeadline<T>(milliseconds: number, run: (signal: AbortSignal) => Promise<T>) {
  if (!positiveInteger(milliseconds)) throw refusal("RECORDING_DEADLINE", "A transfer deadline is required.");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = refusal("RECORDING_DEADLINE", "Recording work exceeded its deadline; retry is required.");
      controller.abort(error);
      reject(error);
    }, milliseconds);
  });
  try {
    return await Promise.race([run(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** One part only. The caller must durably checkpoint uploadId before entering this function.
 * A failed receipt CAS or ambiguous storage timeout belongs to caller-owned compensation/retry.
 */
export async function transferRecordingPart(
  input: RecordingPartTransfer,
  dependencies: {
    fetcher: typeof fetch;
    storage: RecordingTransferStorage;
    checkpoint: RecordingPartCheckpoint;
  },
  deadlineMs: number,
): Promise<RecordingPartReceipt> {
  const url = sourceLocation(input);
  if (
    !positiveInteger(input.totalBytes) ||
    input.totalBytes > 5 * 1024 ** 4 ||
    !positiveInteger(input.partBytes) ||
    input.partBytes < 5 * 1024 ** 2 ||
    input.partBytes > 5 * 1024 ** 3 ||
    !positiveInteger(input.partNumber) ||
    input.partNumber > 10000 ||
    Math.ceil(input.totalBytes / input.partBytes) > 10000 ||
    !input.objectKey ||
    !input.uploadId ||
    !input.leaseToken
  )
    throw refusal("RECORDING_PART_PLAN", "The recording multipart plan is invalid.");
  const offset = (input.partNumber - 1) * input.partBytes;
  if (offset >= input.totalBytes) throw refusal("RECORDING_PART_PLAN", "The recording multipart plan is invalid.");
  const bytes = Math.min(input.partBytes, input.totalBytes - offset);
  return withRecordingDeadline(deadlineMs, async (signal) => {
    const response = await dependencies.fetcher(url.toString(), {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      headers: {
        Range: `bytes=${offset}-${offset + bytes - 1}`,
        "If-Match": input.sourceEtag,
        "Accept-Encoding": "identity",
      },
      signal,
    });
    const range = response.headers.get("Content-Range");
    const length = response.headers.get("Content-Length");
    const encoding = response.headers.get("Content-Encoding");
    if (
      response.status !== 206 ||
      response.redirected ||
      (response.url && new URL(response.url).origin !== url.origin) ||
      range !== `bytes ${offset}-${offset + bytes - 1}/${input.totalBytes}` ||
      length !== String(bytes) ||
      response.headers.get("ETag") !== input.sourceEtag ||
      (encoding !== null && encoding.toLowerCase() !== "identity") ||
      !response.body
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw refusal("RECORDING_SOURCE_CHANGED", "The source no longer matches the recording transfer plan.");
    }
    let countedBytes = 0;
    const counted = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        countedBytes += chunk.byteLength;
        if (countedBytes > bytes) throw refusal("RECORDING_PART_LENGTH", "The recording part length is incorrect.");
        controller.enqueue(chunk);
      },
      flush() {
        if (countedBytes !== bytes) throw refusal("RECORDING_PART_LENGTH", "The recording part length is incorrect.");
      },
    });
    const fixed = new FixedLengthStream(bytes);
    const upload = dependencies.storage.resumeMultipartUpload(input.objectKey, input.uploadId);
    const partPromise = upload.uploadPart(input.partNumber, fixed.readable);
    const pipeline = response.body.pipeThrough(counted).pipeTo(fixed.writable, { signal });
    let part: R2UploadedPart;
    try {
      [part] = await Promise.all([partPromise, pipeline]);
    } catch {
      throw refusal("RECORDING_PART_TRANSFER", "The recording part could not be transferred; retry is required.");
    }
    signal.throwIfAborted();
    if (part.partNumber !== input.partNumber || !part.etag)
      throw refusal("RECORDING_PART_RECEIPT", "Storage did not acknowledge the expected recording part.");
    const receipt = { uploadId: input.uploadId, partNumber: part.partNumber, etag: part.etag, offset, bytes };
    if (!(await dependencies.checkpoint.recordPart(receipt, { leaseToken: input.leaseToken })))
      throw refusal("RECORDING_PART_CHECKPOINT", "The recording transfer lease changed; no progress was committed.");
    return receipt;
  });
}

export function detectRecordingContainer(prefix: Uint8Array): "video/mp4" | "video/webm" {
  const mimeType = recordingContainerMimeType(prefix);
  if (mimeType) return mimeType;
  throw refusal(
    "RECORDING_CONTAINER_UNSUPPORTED",
    "The recording must contain an MP4 or WebM container; reacquire a supported recording.",
  );
}

/** Reads the entire owned object under one deadline. This is not resumable hashing:
 * an oversized/slow full read fails unverified, and the caller must retry or use another verifier.
 * Multipart ETags are conditional object identities, never content SHA-256 values.
 */
export async function verifyRecordingObject(
  input: { objectKey: string; objectEtag: string; expectedBytes: number; expectedSha256?: string },
  storage: Pick<R2Bucket, "get">,
  deadlineMs: number,
): Promise<{ bytes: number; sha256: string; mimeType: "video/mp4" | "video/webm" }> {
  if (
    !input.objectKey ||
    !input.objectEtag ||
    !positiveInteger(input.expectedBytes) ||
    (input.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.expectedSha256))
  )
    throw refusal("RECORDING_VERIFICATION_PLAN", "The recording verification plan is invalid.");
  return withRecordingDeadline(deadlineMs, async (signal) => {
    const object = await storage.get(input.objectKey, { onlyIf: { etagMatches: input.objectEtag } });
    if (!object || !("body" in object) || object.etag !== input.objectEtag || object.size !== input.expectedBytes) {
      if (object && "body" in object) await object.body.cancel().catch(() => undefined);
      throw refusal("RECORDING_OBJECT_CHANGED", "The owned recording no longer matches the verification plan.");
    }
    const Digest = (crypto as Crypto & { DigestStream: typeof DigestStream }).DigestStream;
    const digest = new Digest("SHA-256"),
      writer = digest.getWriter();
    const digestResult = digest.digest;
    void digestResult.catch(() => undefined);
    const prefix = new Uint8Array(Math.min(65536, input.expectedBytes));
    let prefixBytes = 0,
      bytes = 0;
    try {
      await object.body.pipeTo(
        new WritableStream<Uint8Array>({
          async write(chunk) {
            bytes += chunk.byteLength;
            if (bytes > input.expectedBytes)
              throw refusal("RECORDING_OBJECT_LENGTH", "The owned recording length is incorrect.");
            const take = Math.min(chunk.byteLength, prefix.length - prefixBytes);
            prefix.set(chunk.subarray(0, take), prefixBytes);
            prefixBytes += take;
            await writer.write(chunk);
          },
        }),
        { signal },
      );
      if (bytes !== input.expectedBytes)
        throw refusal("RECORDING_OBJECT_LENGTH", "The owned recording length is incorrect.");
      const mimeType = detectRecordingContainer(prefix.subarray(0, prefixBytes));
      await writer.close();
      const sha256 = Array.from(new Uint8Array(await digestResult), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
      if (input.expectedSha256 && sha256 !== input.expectedSha256)
        throw refusal("RECORDING_OBJECT_DIGEST", "The owned recording does not match the expected SHA-256.");
      signal.throwIfAborted();
      return { bytes, sha256, mimeType };
    } catch (error) {
      await writer.abort(error).catch(() => undefined);
      throw error instanceof AppError
        ? error
        : refusal("RECORDING_OBJECT_VERIFICATION", "The owned recording could not be verified; retry is required.");
    }
  });
}
