import { SHA256 } from "@stablelib/sha256";
import { z } from "zod";
import type { EventRecordingMimeType } from "../../../../assets/shared/schemas/event-recordings";
import { AppError } from "../../errors";
import { detectRecordingContainer, withRecordingDeadline } from "./transfer";

const blockBytes = 64;
const maximumRangeBytes = 8 * 1024 ** 2;
const safeBytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// This is private durable state, never a transport contract or media buffer.
const checkpointSchema = z.strictObject({
  version: z.literal(1),
  objectKey: z.string().min(1),
  objectEtag: z.string().min(1),
  totalBytes: safeBytes.positive(),
  verifiedBytes: safeBytes,
  hash: z.strictObject({
    state: z.array(z.number().int().min(-2147483648).max(2147483647)).length(8),
    bytesHashed: safeBytes,
    bufferLength: z.literal(0),
  }),
});

export interface RecordingRangeVerification {
  objectKey: string;
  objectEtag: string;
  expectedBytes: number;
  expectedSha256?: string;
  leaseToken: string;
  priorOffset: number;
  checkpoint: string | null;
  /** A per-invocation budget, in whole SHA-256 blocks; never an object admission limit. */
  rangeBytes: number;
}
export type RecordingVerificationProgress =
  | { verifiedBytes: number; checkpoint: string; sha256?: never; mimeType?: never }
  | { verifiedBytes: number; checkpoint: null; sha256: string; mimeType: EventRecordingMimeType };
export interface RecordingVerificationCheckpoint {
  /** Atomically require the current lease, prior offset, and eligible acquisition state.
   * The final digest, MIME, complete offset, and cleared checkpoint share this CAS.
   */
  recordVerification(
    progress: RecordingVerificationProgress,
    authority: { leaseToken: string; expectedOffset: number },
  ): Promise<boolean>;
}
export type RecordingRangeVerificationResult =
  | { status: "pending"; verifiedBytes: number; checkpoint: string }
  | { status: "verified"; bytes: number; sha256: string; mimeType: EventRecordingMimeType };

function refusal(code: string, message: string) {
  return new AppError(409, code, message);
}
type RecordingVerificationState = Pick<
  RecordingRangeVerification,
  "objectKey" | "objectEtag" | "expectedBytes" | "priorOffset" | "checkpoint"
>;
function restoreHash(input: RecordingVerificationState): SHA256 {
  const hash = new SHA256();
  if (input.checkpoint === null) {
    if (input.priorOffset === 0) return hash;
    throw refusal("RECORDING_VERIFICATION_CHECKPOINT", "The recording verification checkpoint is invalid.");
  }
  let saved: z.infer<typeof checkpointSchema>;
  try {
    if (input.checkpoint.length > 16384) throw new Error("checkpoint size");
    saved = checkpointSchema.parse(JSON.parse(input.checkpoint));
  } catch {
    throw refusal("RECORDING_VERIFICATION_CHECKPOINT", "The recording verification checkpoint is invalid.");
  }
  if (
    saved.objectKey !== input.objectKey ||
    saved.objectEtag !== input.objectEtag ||
    saved.totalBytes !== input.expectedBytes ||
    saved.verifiedBytes !== input.priorOffset ||
    saved.hash.bytesHashed !== input.priorOffset ||
    input.priorOffset === 0
  )
    throw refusal("RECORDING_VERIFICATION_CHECKPOINT", "The recording verification checkpoint is invalid.");
  return hash.restoreState({
    state: Int32Array.from(saved.hash.state),
    bytesHashed: saved.hash.bytesHashed,
    bufferLength: 0,
    buffer: undefined,
  });
}

/** Validate a pending checkpoint at the persistence boundary with the same
 * codec used by the verifier. Initial and completed progress have no saved state.
 */
export function isRecordingVerificationCheckpoint(input: RecordingVerificationState): boolean {
  if (
    !input.objectKey ||
    new TextEncoder().encode(input.objectKey).length > 1024 ||
    !input.objectEtag ||
    input.objectEtag.length > 1024 ||
    !Number.isSafeInteger(input.expectedBytes) ||
    input.expectedBytes <= 0 ||
    input.expectedBytes > 5 * 1024 ** 4 ||
    !Number.isSafeInteger(input.priorOffset) ||
    input.priorOffset <= 0 ||
    input.priorOffset >= input.expectedBytes ||
    input.priorOffset % blockBytes !== 0 ||
    input.checkpoint === null
  )
    return false;
  try {
    const hash = restoreHash(input);
    hash.clean();
    return true;
  } catch {
    return false;
  }
}
function saveCheckpoint(input: RecordingRangeVerification, hash: SHA256, verifiedBytes: number): string {
  const saved = hash.saveState();
  try {
    if (saved.bufferLength !== 0 || saved.buffer !== undefined || saved.bytesHashed !== verifiedBytes)
      throw refusal("RECORDING_VERIFICATION_CHECKPOINT", "The recording verification checkpoint is invalid.");
    return JSON.stringify(
      checkpointSchema.parse({
        version: 1,
        objectKey: input.objectKey,
        objectEtag: input.objectEtag,
        totalBytes: input.expectedBytes,
        verifiedBytes,
        hash: { state: Array.from(saved.state), bytesHashed: saved.bytesHashed, bufferLength: 0 },
      }),
    );
  } finally {
    hash.cleanSavedState(saved);
  }
}
async function consumeRange(
  input: RecordingRangeVerification,
  storage: Pick<R2Bucket, "get">,
  offset: number,
  length: number,
  signal: AbortSignal,
  consume: (chunk: Uint8Array) => void,
): Promise<void> {
  const object = await storage.get(input.objectKey, {
    onlyIf: { etagMatches: input.objectEtag },
    range: { offset, length },
  });
  if (
    !object ||
    !("body" in object) ||
    object.key !== input.objectKey ||
    object.etag !== input.objectEtag ||
    object.size !== input.expectedBytes ||
    !object.range ||
    !("offset" in object.range) ||
    object.range.offset !== offset ||
    object.range.length !== length
  ) {
    if (object && "body" in object) await object.body.cancel().catch(() => undefined);
    throw refusal("RECORDING_OBJECT_CHANGED", "The owned recording no longer matches the verification range.");
  }
  let counted = 0;
  await object.body.pipeTo(
    new WritableStream<Uint8Array>({
      write(chunk) {
        signal.throwIfAborted();
        counted += chunk.byteLength;
        if (counted > length) throw refusal("RECORDING_OBJECT_LENGTH", "The owned recording length is incorrect.");
        consume(chunk);
      },
    }),
    { signal },
  );
  if (counted !== length) throw refusal("RECORDING_OBJECT_LENGTH", "The owned recording length is incorrect.");
  signal.throwIfAborted();
}

/** Hash one bounded range of the owned object. A failed read/CAS leaves the prior
 * checkpoint authoritative: the next invocation rereads the uncommitted range.
 * Multipart ETags identify the object; the final SHA-256 covers all object bytes.
 */
export async function verifyRecordingObjectRange(
  input: RecordingRangeVerification,
  dependencies: { storage: Pick<R2Bucket, "get">; checkpoint: RecordingVerificationCheckpoint },
  deadlineMs: number,
): Promise<RecordingRangeVerificationResult> {
  if (
    !input.objectKey ||
    new TextEncoder().encode(input.objectKey).length > 1024 ||
    !input.objectEtag ||
    input.objectEtag.length > 1024 ||
    !input.leaseToken ||
    !Number.isSafeInteger(input.expectedBytes) ||
    input.expectedBytes <= 0 ||
    input.expectedBytes > 5 * 1024 ** 4 ||
    !Number.isSafeInteger(input.priorOffset) ||
    input.priorOffset < 0 ||
    input.priorOffset >= input.expectedBytes ||
    input.priorOffset % blockBytes !== 0 ||
    !Number.isSafeInteger(input.rangeBytes) ||
    input.rangeBytes < blockBytes ||
    input.rangeBytes > maximumRangeBytes ||
    input.rangeBytes % blockBytes !== 0 ||
    (input.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.expectedSha256))
  )
    throw refusal("RECORDING_VERIFICATION_PLAN", "The recording verification plan is invalid.");
  const hash = restoreHash(input);
  try {
    return await withRecordingDeadline(deadlineMs, async (signal) => {
      const length = Math.min(input.rangeBytes, input.expectedBytes - input.priorOffset);
      await consumeRange(input, dependencies.storage, input.priorOffset, length, signal, (chunk) => hash.update(chunk));
      const verifiedBytes = input.priorOffset + length;
      let progress: RecordingVerificationProgress;
      let result: RecordingRangeVerificationResult;
      if (verifiedBytes < input.expectedBytes) {
        const checkpoint = saveCheckpoint(input, hash, verifiedBytes);
        progress = { verifiedBytes, checkpoint };
        result = { status: "pending", verifiedBytes, checkpoint };
      } else {
        const sha256 = Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, "0")).join("");
        if (input.expectedSha256 !== undefined && sha256 !== input.expectedSha256)
          throw refusal("RECORDING_OBJECT_DIGEST", "The owned recording does not match the expected SHA-256.");
        const prefix = new Uint8Array(Math.min(65536, input.expectedBytes));
        let prefixBytes = 0;
        await consumeRange(input, dependencies.storage, 0, prefix.length, signal, (chunk) => {
          prefix.set(chunk, prefixBytes);
          prefixBytes += chunk.byteLength;
        });
        const mimeType = detectRecordingContainer(prefix);
        progress = { verifiedBytes, checkpoint: null, sha256, mimeType };
        result = { status: "verified", bytes: verifiedBytes, sha256, mimeType };
      }
      signal.throwIfAborted();
      if (
        !(await dependencies.checkpoint.recordVerification(progress, {
          leaseToken: input.leaseToken,
          expectedOffset: input.priorOffset,
        }))
      )
        throw refusal(
          "RECORDING_VERIFICATION_LEASE",
          "The recording verification lease changed; no progress was committed.",
        );
      return result;
    });
  } catch (error) {
    throw error instanceof AppError
      ? error
      : refusal("RECORDING_OBJECT_VERIFICATION", "The owned recording could not be verified; retry is required.");
  } finally {
    hash.clean();
  }
}
