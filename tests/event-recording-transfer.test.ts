import { describe, expect, it, vi } from "vitest";
import {
  transferRecordingPart,
  verifyRecordingObject,
  type RecordingPartTransfer,
} from "../functions/_lib/services/event-recordings/transfer";

const sourceEtag = '"stable-source"';
function plan(): RecordingPartTransfer {
  return {
    sourceUrl: "https://recordings.example.test/file?signature=download-only",
    configuredOrigins: ["https://recordings.example.test"],
    sourceEtag,
    totalBytes: 4,
    partBytes: 5 * 1024 ** 2,
    partNumber: 1,
    objectKey: "owned/version",
    uploadId: "upload",
    leaseToken: "lease",
  };
}
function partResponse(
  body: Uint8Array = new Uint8Array([1, 2, 3, 4]),
  headers: Record<string, string> = {},
  status = 206,
) {
  return new Response(new Blob([new Uint8Array(body)]), {
    status,
    headers: { "Content-Range": "bytes 0-3/4", "Content-Length": "4", ETag: sourceEtag, ...headers },
  });
}
function partDependencies(response = partResponse()) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const uploadPart = vi.fn(async (partNumber: number, stream: ReadableStream) => {
    await new Response(stream).arrayBuffer();
    return { partNumber, etag: "part-etag" };
  });
  const checkpoint = { recordPart: vi.fn().mockResolvedValue(true) };
  return { fetcher, storage: { resumeMultipartUpload: vi.fn(() => ({ uploadPart })) }, checkpoint, uploadPart };
}
const mp4 = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 109, 112, 52, 50]);
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);
function ownedStorage(data = mp4, size = data.length, etag = "owned-etag") {
  // Structural injection covers transfer policy; actual R2 stream APIs execute in the Worker pool.
  const get = vi.fn().mockResolvedValue({ size, etag, body: new Blob([data]).stream() });
  return { get };
}
const verification = (data = mp4) => ({
  objectKey: "owned/version",
  objectEtag: "owned-etag",
  expectedBytes: data.length,
});

describe("recording multipart transfer", () => {
  it("streams one final part and records its durable leased receipt without forwarding credentials", async () => {
    const d = partDependencies();
    expect(await transferRecordingPart(plan(), d, 2000)).toEqual({
      uploadId: "upload",
      partNumber: 1,
      etag: "part-etag",
      offset: 0,
      bytes: 4,
    });
    expect(d.fetcher).toHaveBeenCalledWith(
      plan().sourceUrl,
      expect.objectContaining({
        redirect: "manual",
        credentials: "omit",
        headers: { Range: "bytes=0-3", "If-Match": sourceEtag, "Accept-Encoding": "identity" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(d.checkpoint.recordPart).toHaveBeenCalledWith(expect.objectContaining({ bytes: 4 }), {
      leaseToken: "lease",
    });
  });
  it.each([
    "http://recordings.example.test/a",
    "https://recordings.example.test.evil/a",
    "https://user:password@recordings.example.test/a",
    "https://recordings.example.test:444/a",
  ])("rejects untrusted location %s before I/O", async (sourceUrl) => {
    const d = partDependencies();
    await expect(transferRecordingPart({ ...plan(), sourceUrl }, d, 2000)).rejects.toMatchObject({
      code: "RECORDING_SOURCE_LOCATION",
    });
    expect(d.fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [302, {}],
    [200, {}],
    [206, { ETag: '"changed"' }],
    [206, { "Content-Range": "bytes 0-3/5" }],
    [206, { "Content-Length": "5" }],
    [206, { "Content-Encoding": "gzip" }],
  ] as const)("rejects status/header mismatch before storage (%s)", async (status, headers) => {
    const d = partDependencies(partResponse(undefined, headers, status));
    await expect(transferRecordingPart(plan(), d, 2000)).rejects.toMatchObject({ code: "RECORDING_SOURCE_CHANGED" });
    expect(d.uploadPart).not.toHaveBeenCalled();
    expect(d.checkpoint.recordPart).not.toHaveBeenCalled();
  });
  it.each([3, 5])("refuses dishonest streamed length %s without a durable receipt", async (size) => {
    const d = partDependencies(partResponse(new Uint8Array(size)));
    await expect(transferRecordingPart(plan(), d, 2000)).rejects.toMatchObject({ code: "RECORDING_PART_TRANSFER" });
    expect(d.checkpoint.recordPart).not.toHaveBeenCalled();
  });
  it("does not claim progress after a lost checkpoint CAS", async () => {
    const d = partDependencies();
    d.checkpoint.recordPart.mockResolvedValue(false);
    await expect(transferRecordingPart(plan(), d, 2000)).rejects.toMatchObject({ code: "RECORDING_PART_CHECKPOINT" });
  });
  it("aborts a stalled download by deadline without recording progress", async () => {
    const d = partDependencies();
    d.fetcher.mockImplementation(
      async (_, init) =>
        new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    await expect(transferRecordingPart(plan(), d, 15)).rejects.toMatchObject({ code: "RECORDING_DEADLINE" });
    expect(d.checkpoint.recordPart).not.toHaveBeenCalled();
  });
  it("accepts a multipart plan above 100MB without a single-PUT admission cap", async () => {
    const input = { ...plan(), totalBytes: 150 * 1024 ** 2 + 4, partNumber: 31 };
    const d = partDependencies(
      partResponse(undefined, {
        "Content-Range": `bytes ${150 * 1024 ** 2}-${150 * 1024 ** 2 + 3}/${input.totalBytes}`,
      }),
    );
    expect(await transferRecordingPart(input, d, 2000)).toMatchObject({ partNumber: 31, bytes: 4 });
  });
});
describe("owned recording verification", () => {
  it.each([
    [mp4, "video/mp4"],
    [webm, "video/webm"],
  ] as const)("hashes every byte and detects binary container %s", async (data, mimeType) => {
    const storage = ownedStorage(data);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    expect(await verifyRecordingObject(verification(data), storage, 2000)).toEqual({
      bytes: data.length,
      sha256: hash,
      mimeType,
    });
    expect(storage.get).toHaveBeenCalledWith("owned/version", { onlyIf: { etagMatches: "owned-etag" } });
    expect(hash).not.toBe("owned-etag");
  });
  it("rejects a changed conditional object", async () => {
    await expect(
      verifyRecordingObject(verification(), ownedStorage(mp4, mp4.length, "different"), 2000),
    ).rejects.toMatchObject({ code: "RECORDING_OBJECT_CHANGED" });
  });
  it.each([
    new TextEncoder().encode("<html>video/mp4 webm</html>"),
    new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x77, 0x65, 0x62, 0x6d]),
  ])("rejects spoofed or malformed containers", async (data) => {
    await expect(verifyRecordingObject(verification(data), ownedStorage(data), 2000)).rejects.toMatchObject({
      code: "RECORDING_CONTAINER_UNSUPPORTED",
    });
  });
  it("requires the complete object to match any supplied SHA256", async () => {
    await expect(
      verifyRecordingObject({ ...verification(), expectedSha256: "0".repeat(64) }, ownedStorage(), 2000),
    ).rejects.toMatchObject({ code: "RECORDING_OBJECT_DIGEST" });
  });
  it("rejects a short full object read even when metadata length matches", async () => {
    await expect(
      verifyRecordingObject(verification(), ownedStorage(mp4.subarray(0, 19), 20), 2000),
    ).rejects.toMatchObject({ code: "RECORDING_OBJECT_LENGTH" });
  });
  it("fails unverified when a complete read cannot finish by deadline", async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({
        size: 20,
        etag: "owned-etag",
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(mp4);
          },
        }),
      }),
    };
    await expect(verifyRecordingObject(verification(), storage, 15)).rejects.toMatchObject({
      code: "RECORDING_DEADLINE",
    });
  });
});
