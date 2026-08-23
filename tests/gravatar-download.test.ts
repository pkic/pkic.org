import { afterEach, describe, expect, it, vi } from "vitest";
import { validJpegBytes, validPngBytes } from "./helpers/raster-images";
import { downloadGravatar, MAX_GRAVATAR_BYTES } from "../functions/_lib/utils/gravatar";

describe("Gravatar download boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns only a structurally valid raster image with its inspected MIME type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(validPngBytes(), { headers: { "content-type": "image/jpeg" } })),
    );

    await expect(downloadGravatar("avatar@example.test")).resolves.toMatchObject({
      contentType: "image/png",
      buffer: validPngBytes().buffer,
    });
  });

  it("rejects malformed or oversized-dimension images before callers can store them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(validPngBytes(4097, 1), { headers: { "content-type": "image/png" } })),
    );
    await expect(downloadGravatar("avatar@example.test")).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(validJpegBytes().slice(0, 6), { headers: { "content-type": "image/jpeg" } })),
    );
    await expect(downloadGravatar("avatar@example.test")).resolves.toBeNull();
  });

  it("cancels a chunked remote body once it exceeds the shared byte limit", async () => {
    let cancelReason: unknown;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_GRAVATAR_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel(reason) {
        cancelReason = reason;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "image/jpeg" } })),
    );

    await expect(downloadGravatar("avatar@example.test")).resolves.toBeNull();
    expect(cancelReason).toBe("Gravatar exceeds the byte limit");
  });
});
