import { describe, expect, it } from "vitest";
import { STANDARD_HEADSHOT_MAX_BYTES } from "../assets/shared/schemas/images";
import { loadValidatedHeadshotDataUrl } from "../functions/_lib/services/og-badge-prerender";
import { validPngBytes } from "./helpers/raster-images";

function bucketWith(bytes: Uint8Array, size = bytes.byteLength): R2Bucket {
  return {
    get: async () => ({ arrayBuffer: async () => bytes.buffer, size }),
  } as unknown as R2Bucket;
}

describe("OG badge legacy headshot boundary", () => {
  it("embeds structurally valid stored images using their inspected MIME type", async () => {
    const bytes = validPngBytes();
    await expect(loadValidatedHeadshotDataUrl("headshots/user/legacy.jpg", bucketWith(bytes))).resolves.toBe(
      `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`,
    );
  });

  it("does not embed a stored image with truncated or oversized dimensions", async () => {
    await expect(
      loadValidatedHeadshotDataUrl("headshots/user/legacy.png", bucketWith(validPngBytes().slice(0, 24))),
    ).resolves.toBeNull();

    const oversized = validPngBytes();
    new DataView(oversized.buffer).setUint32(16, 4097);
    await expect(loadValidatedHeadshotDataUrl("headshots/user/legacy.png", bucketWith(oversized))).resolves.toBeNull();

    await expect(
      loadValidatedHeadshotDataUrl(
        "headshots/user/legacy.png",
        bucketWith(validPngBytes(), STANDARD_HEADSHOT_MAX_BYTES + 1),
      ),
    ).resolves.toBeNull();
  });
});
