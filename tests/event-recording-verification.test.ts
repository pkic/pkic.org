import { env } from "cloudflare:test";
import { SHA256 } from "@stablelib/sha256";
import { describe, expect, it, vi } from "vitest";
import {
  isRecordingVerificationCheckpoint,
  verifyRecordingObjectRange,
  type RecordingRangeVerification,
  type RecordingVerificationProgress,
} from "../functions/_lib/services/event-recordings/verification";

const mp4 = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 109, 112, 52, 50]);
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
function media(bytes: number) {
  const data = Uint8Array.from({ length: bytes }, (_, index) => index % 251);
  data.set(mp4);
  return data;
}
function plan(bytes: number): RecordingRangeVerification {
  return {
    objectKey: "private/recording/version",
    objectEtag: "multipart-etag-7",
    expectedBytes: bytes,
    leaseToken: "current-lease",
    priorOffset: 0,
    checkpoint: null,
    rangeBytes: 64,
  };
}
function dependencies(data: Uint8Array) {
  const state = { leaseToken: "current-lease", offset: 0, checkpoint: null as string | null };
  const get = vi.fn().mockImplementation(async (key: string, options: R2GetOptions) => {
    const range = options.range as { offset: number; length: number };
    const slice = data.slice(range.offset, range.offset + range.length);
    return {
      key,
      etag: "multipart-etag-7",
      size: data.length,
      range,
      body: new Blob([slice]).stream(),
    };
  });
  const recordVerification = vi
    .fn()
    .mockImplementation(
      async (progress: RecordingVerificationProgress, authority: { leaseToken: string; expectedOffset: number }) => {
        if (authority.leaseToken !== state.leaseToken || authority.expectedOffset !== state.offset) return false;
        state.offset = progress.verifiedBytes;
        state.checkpoint = progress.checkpoint;
        return true;
      },
    );
  return { storage: { get }, checkpoint: { recordVerification }, state };
}
async function finish(input: RecordingRangeVerification, d: ReturnType<typeof dependencies>) {
  for (;;) {
    const result = await verifyRecordingObjectRange(input, d, 2000);
    if (result.status === "verified") return result;
    input = { ...input, priorOffset: result.verifiedBytes, checkpoint: result.checkpoint };
  }
}

describe("serializable SHA-256 implementation", () => {
  it.each([
    { name: "empty", value: "", expected: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
    { name: "abc", value: "abc", expected: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" },
    {
      name: "million a",
      value: "a".repeat(1000000),
      expected: "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    },
  ])("matches the standard vector $name", ({ value, expected }) => {
    const hash = new SHA256();
    hash.update(new TextEncoder().encode(value));
    expect(hex(hash.digest())).toBe(expected);
    hash.clean();
  });
});

describe("bounded owned recording verification", () => {
  it.each([63, 64, 65, 127, 128, 129, 65537])("hashes %s bytes across restored block boundaries", async (bytes) => {
    const data = media(bytes),
      d = dependencies(data);
    const sha256 = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
    expect(await finish({ ...plan(bytes), rangeBytes: bytes > 1024 ? 65536 : 64, expectedSha256: sha256 }, d)).toEqual({
      status: "verified",
      bytes,
      sha256,
      mimeType: "video/mp4",
    });
    expect(d.state).toMatchObject({ offset: bytes, checkpoint: null });
    for (const [, options] of d.storage.get.mock.calls) {
      expect(options.onlyIf).toEqual({ etagMatches: "multipart-etag-7" });
      expect(options.range.length).toBeLessThanOrEqual(65536);
    }
  });
  it("persists only private chaining words and block-aligned progress", async () => {
    const d = dependencies(media(129));
    const result = await verifyRecordingObjectRange(plan(129), d, 2000);
    expect(result.status).toBe("pending");
    if (result.status !== "pending") throw new Error("pending checkpoint required");
    expect(JSON.parse(result.checkpoint)).toEqual({
      version: 1,
      objectKey: plan(129).objectKey,
      objectEtag: plan(129).objectEtag,
      totalBytes: 129,
      verifiedBytes: 64,
      hash: { state: expect.arrayContaining([expect.any(Number)]), bytesHashed: 64, bufferLength: 0 },
    });
    expect(JSON.parse(result.checkpoint).hash.state).toHaveLength(8);
    const persisted = { ...plan(129), priorOffset: result.verifiedBytes, checkpoint: result.checkpoint };
    expect(isRecordingVerificationCheckpoint(persisted)).toBe(true);
    for (const invalid of [
      { checkpoint: null },
      { checkpoint: "{" },
      { priorOffset: 0 },
      { priorOffset: -64 },
      { priorOffset: 63 },
      { priorOffset: 128 },
      { expectedBytes: 64 },
      { objectKey: "foreign-object" },
      { objectEtag: "foreign-etag" },
    ])
      expect(isRecordingVerificationCheckpoint({ ...persisted, ...invalid })).toBe(false);
    expect(d.checkpoint.recordVerification).toHaveBeenCalledWith(
      { verifiedBytes: 64, checkpoint: result.checkpoint },
      { leaseToken: "current-lease", expectedOffset: 0 },
    );
  });
  it.each([
    (saved: Record<string, unknown>) => ({ ...saved, version: 2 }),
    (saved: Record<string, unknown>) => ({ ...saved, objectKey: "different" }),
    (saved: Record<string, unknown>) => ({ ...saved, objectEtag: "different" }),
    (saved: Record<string, unknown>) => ({ ...saved, totalBytes: 130 }),
    (saved: Record<string, unknown>) => ({ ...saved, verifiedBytes: 128 }),
    (saved: Record<string, unknown>) => ({
      ...saved,
      hash: { state: Array(8).fill(0), bytesHashed: 0, bufferLength: 0 },
    }),
    (saved: Record<string, unknown>) => ({
      ...saved,
      hash: { state: Array(7).fill(0), bytesHashed: 64, bufferLength: 0 },
    }),
    (saved: Record<string, unknown>) => ({
      ...saved,
      hash: { state: Array(8).fill(2147483648), bytesHashed: 64, bufferLength: 0 },
    }),
    (saved: Record<string, unknown>) => ({
      ...saved,
      hash: { state: Array(8).fill(0), bytesHashed: 64, bufferLength: 1, buffer: [1] },
    }),
    (saved: Record<string, unknown>) => ({ ...saved, unexpected: true }),
  ])("rejects corrupted or foreign persisted state before R2 I/O", async (corrupt) => {
    const d = dependencies(media(129));
    await verifyRecordingObjectRange(plan(129), d, 2000);
    d.storage.get.mockClear();
    const checkpoint = JSON.stringify(corrupt(JSON.parse(d.state.checkpoint!)));
    expect(isRecordingVerificationCheckpoint({ ...plan(129), priorOffset: 64, checkpoint })).toBe(false);
    await expect(
      verifyRecordingObjectRange({ ...plan(129), priorOffset: 64, checkpoint }, d, 2000),
    ).rejects.toMatchObject({ code: "RECORDING_VERIFICATION_CHECKPOINT" });
    expect(d.storage.get).not.toHaveBeenCalled();
  });
  it.each([
    { key: "foreign-key" },
    { etag: "different" },
    { size: 130 },
    { range: { offset: 1, length: 64 } },
    { range: { offset: 0, length: 63 } },
    { range: undefined },
  ])("rejects changed range metadata without committing progress: %s", async (metadata) => {
    const d = dependencies(media(129));
    d.storage.get.mockResolvedValueOnce({
      key: plan(129).objectKey,
      etag: plan(129).objectEtag,
      size: 129,
      range: { offset: 0, length: 64 },
      body: new Blob([media(64)]).stream(),
      ...metadata,
    });
    await expect(verifyRecordingObjectRange(plan(129), d, 2000)).rejects.toMatchObject({
      code: "RECORDING_OBJECT_CHANGED",
    });
    expect(d.checkpoint.recordVerification).not.toHaveBeenCalled();
  });
  it.each([63, 65])("refuses range body byte count %s", async (bytes) => {
    const d = dependencies(media(129));
    d.storage.get.mockResolvedValueOnce({
      key: plan(129).objectKey,
      etag: plan(129).objectEtag,
      size: 129,
      range: { offset: 0, length: 64 },
      body: new Blob([media(bytes)]).stream(),
    });
    await expect(verifyRecordingObjectRange(plan(129), d, 2000)).rejects.toMatchObject({
      code: "RECORDING_OBJECT_LENGTH",
    });
    expect(d.checkpoint.recordVerification).not.toHaveBeenCalled();
  });
  it.each([null, { key: "private/recording/version", etag: "multipart-etag-7", size: 129 }])(
    "refuses missing or conditionally withheld object bodies",
    async (object) => {
      const d = dependencies(media(129));
      d.storage.get.mockResolvedValueOnce(object);
      await expect(verifyRecordingObjectRange(plan(129), d, 2000)).rejects.toMatchObject({
        code: "RECORDING_OBJECT_CHANGED",
      });
      expect(d.checkpoint.recordVerification).not.toHaveBeenCalled();
    },
  );
  it.each([{ rangeBytes: 63 }, { rangeBytes: 8 * 1024 ** 2 + 64 }, { priorOffset: 1 }])(
    "rejects an invalid invocation budget or unaligned progress before I/O",
    async (invalid) => {
      const d = dependencies(media(129));
      await expect(verifyRecordingObjectRange({ ...plan(129), ...invalid }, d, 2000)).rejects.toMatchObject({
        code: "RECORDING_VERIFICATION_PLAN",
      });
      expect(d.storage.get).not.toHaveBeenCalled();
    },
  );
  it("rereads an interrupted range from its prior checkpoint", async () => {
    const d = dependencies(media(129));
    d.storage.get.mockResolvedValueOnce({
      key: plan(129).objectKey,
      etag: plan(129).objectEtag,
      size: 129,
      range: { offset: 0, length: 64 },
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error("interrupted"));
        },
      }),
    });
    await expect(verifyRecordingObjectRange(plan(129), d, 2000)).rejects.toMatchObject({
      code: "RECORDING_OBJECT_VERIFICATION",
    });
    expect(d.state.offset).toBe(0);
    expect((await finish(plan(129), d)).bytes).toBe(129);
    expect(d.storage.get.mock.calls.slice(0, 2).map(([, options]) => options.range.offset)).toEqual([0, 0]);
  });
  it("rereads after failed CAS and rejects replay after durable progress", async () => {
    const data = media(129),
      d = dependencies(data);
    d.checkpoint.recordVerification.mockResolvedValueOnce(false);
    await expect(verifyRecordingObjectRange(plan(129), d, 2000)).rejects.toMatchObject({
      code: "RECORDING_VERIFICATION_LEASE",
    });
    const pending = await verifyRecordingObjectRange(plan(129), d, 2000);
    await expect(verifyRecordingObjectRange(plan(129), d, 2000)).rejects.toMatchObject({
      code: "RECORDING_VERIFICATION_LEASE",
    });
    if (pending.status !== "pending") throw new Error("pending checkpoint required");
    const result = await finish(
      { ...plan(129), priorOffset: pending.verifiedBytes, checkpoint: pending.checkpoint },
      d,
    );
    expect(result.sha256).toBe(hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data))));
  });
  it("does not publish verification after caller authority is revoked during the read", async () => {
    const d = dependencies(media(64));
    const original = d.storage.get.getMockImplementation()!;
    d.storage.get.mockImplementation(async (...args) => {
      const result = await original(...args);
      d.state.leaseToken = "revoked";
      return result;
    });
    await expect(verifyRecordingObjectRange(plan(64), d, 2000)).rejects.toMatchObject({
      code: "RECORDING_VERIFICATION_LEASE",
    });
    expect(d.state.offset).toBe(0);
  });
  it("fails a stalled range by deadline without durable progress", async () => {
    const d = dependencies(media(64));
    d.storage.get.mockResolvedValueOnce({
      key: plan(64).objectKey,
      etag: plan(64).objectEtag,
      size: 64,
      range: { offset: 0, length: 64 },
      body: new ReadableStream(),
    });
    await expect(verifyRecordingObjectRange(plan(64), d, 15)).rejects.toMatchObject({ code: "RECORDING_DEADLINE" });
    expect(d.checkpoint.recordVerification).not.toHaveBeenCalled();
  });
  it("never treats the multipart ETag as content SHA-256", async () => {
    const d = dependencies(media(64));
    await expect(
      verifyRecordingObjectRange({ ...plan(64), expectedSha256: "0".repeat(64) }, d, 2000),
    ).rejects.toMatchObject({ code: "RECORDING_OBJECT_DIGEST" });
    expect(d.checkpoint.recordVerification).not.toHaveBeenCalled();
  });
  it("advances large objects without a single-invocation admission cap", async () => {
    const expectedBytes = 150 * 1024 ** 2;
    const d = dependencies(media(64));
    d.storage.get.mockResolvedValueOnce({
      key: plan(expectedBytes).objectKey,
      etag: plan(expectedBytes).objectEtag,
      size: expectedBytes,
      range: { offset: 0, length: 64 },
      body: new Blob([media(64)]).stream(),
    });
    expect(await verifyRecordingObjectRange(plan(expectedBytes), d, 2000)).toMatchObject({
      status: "pending",
      verifiedBytes: 64,
    });
  });
  it("refuses a final container read from a changed object", async () => {
    const d = dependencies(media(64)),
      original = d.storage.get.getMockImplementation()!;
    d.storage.get.mockImplementationOnce(original).mockResolvedValueOnce({
      key: plan(64).objectKey,
      etag: "changed",
      size: 64,
      range: { offset: 0, length: 64 },
      body: new Blob([media(64)]).stream(),
    });
    await expect(verifyRecordingObjectRange(plan(64), d, 2000)).rejects.toMatchObject({
      code: "RECORDING_OBJECT_CHANGED",
    });
    expect(d.checkpoint.recordVerification).not.toHaveBeenCalled();
  });
  it("executes conditional range reads against the actual Worker R2 binding", async () => {
    const bucket = env.SPEAKER_UPLOADS_BUCKET;
    if (!bucket) throw new Error("Worker R2 fixture binding is missing");
    const data = media(129),
      key = `verification-test/${crypto.randomUUID()}`;
    const object = await bucket.put(key, data);
    if (!object) throw new Error("fixture not stored");
    const d = dependencies(data);
    d.storage.get = vi
      .fn()
      .mockImplementation((objectKey: string, options: R2GetOptions) => bucket.get(objectKey, options));
    try {
      const result = await finish({ ...plan(data.length), objectKey: key, objectEtag: object.etag }, d);
      expect(result.sha256).toBe(hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data))));
      await expect(
        verifyRecordingObjectRange({ ...plan(data.length), objectKey: key, objectEtag: "different-object" }, d, 2000),
      ).rejects.toMatchObject({ code: "RECORDING_OBJECT_CHANGED" });
    } finally {
      await bucket.delete(key);
    }
  });
});
