import { describe, expect, it } from "vitest";
import {
  MAX_RASTER_IMAGE_DIMENSION,
  MAX_RASTER_IMAGE_PIXELS,
  validateRasterImage,
} from "../functions/_lib/utils/image-format";
import {
  readValidatedUploadedImage,
  resizeHeadshot,
  validateUploadedImageFile,
} from "../functions/_lib/utils/image-upload";
import { validJpegBytes, validPngBytes } from "./helpers/raster-images";

function validWebp(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([
    0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00,
    0x00,
  ]);
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  bytes.set([0x00, 0x00, 0x00, 0x00, encodedWidth & 0xff, encodedWidth >> 8, encodedWidth >> 16], 20);
  bytes.set([encodedHeight & 0xff, encodedHeight >> 8, encodedHeight >> 16], 27);
  return bytes;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("canonical image upload validation", () => {
  it("rejects a file whose bytes do not match its declared image MIME type", async () => {
    const spoofed = new File(["<script>alert(1)</script>"], "headshot.jpg", { type: "image/jpeg" });
    await expect(validateUploadedImageFile(spoofed, "Headshot")).rejects.toMatchObject({
      status: 415,
      code: "INVALID_FILE_TYPE",
    });
  });

  it("sniffs a valid generic binary upload and returns its real content type", async () => {
    const request = new Request("https://app.test/upload", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: asArrayBuffer(validPngBytes()),
    });

    await expect(readValidatedUploadedImage(request, "Logo")).resolves.toMatchObject({ contentType: "image/png" });
  });

  it("accepts structurally valid WebP and rejects a declared MIME mismatch", async () => {
    const webp = validWebp();
    await expect(
      readValidatedUploadedImage(
        new Request("https://app.test/upload", {
          method: "POST",
          headers: { "content-type": "image/webp" },
          body: asArrayBuffer(webp),
        }),
        "Logo",
        webp.byteLength,
      ),
    ).resolves.toMatchObject({ contentType: "image/webp" });
    await expect(
      readValidatedUploadedImage(
        new Request("https://app.test/upload", {
          method: "POST",
          headers: { "content-type": "image/png" },
          body: asArrayBuffer(webp),
        }),
        "Logo",
      ),
    ).rejects.toMatchObject({ status: 415, code: "INVALID_FILE_TYPE" });
  });

  it("applies the caller's shared size policy after extracting multipart data", async () => {
    const oversized = new File([asArrayBuffer(validJpegBytes())], "headshot.jpg", {
      type: "image/jpeg",
    });
    await expect(validateUploadedImageFile(oversized, "Headshot", 3)).rejects.toMatchObject({
      status: 413,
      code: "FILE_TOO_LARGE",
    });
  });

  it("bounds a chunked direct upload before retaining the complete body", async () => {
    const request = new Request("https://app.test/upload", {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff]));
          controller.enqueue(new Uint8Array(8));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);

    await expect(readValidatedUploadedImage(request, "Headshot", 4)).rejects.toMatchObject({
      status: 413,
      code: "FILE_TOO_LARGE",
    });
  });

  it("does not retain an invalid optional resize result", async () => {
    const original = asArrayBuffer(validJpegBytes());
    const images = {
      input: () => ({
        transform: () => ({
          output: () => ({ response: async () => new Response(new Uint8Array()) }),
        }),
      }),
    };

    await expect(resizeHeadshot(original, images as any)).resolves.toEqual({
      buffer: original,
      contentType: "image/jpeg",
    });
  });

  it("parses dimensions for every supported format before accepting an upload", () => {
    expect(validateRasterImage(validJpegBytes(640, 480))).toEqual({
      ok: true,
      image: { contentType: "image/jpeg", extension: "jpg", width: 640, height: 480 },
    });
    expect(validateRasterImage(validPngBytes(640, 480))).toEqual({
      ok: true,
      image: { contentType: "image/png", extension: "png", width: 640, height: 480 },
    });
    expect(validateRasterImage(validWebp(640, 480))).toEqual({
      ok: true,
      image: { contentType: "image/webp", extension: "webp", width: 640, height: 480 },
    });
  });

  it("rejects malformed metadata and decoded dimensions beyond the shared limits", async () => {
    expect(validateRasterImage(validJpegBytes().slice(0, 6))).toEqual({ ok: false, reason: "invalid" });
    expect(validateRasterImage(validPngBytes().slice(0, 24))).toEqual({ ok: false, reason: "invalid" });
    expect(validateRasterImage(validWebp().slice(0, 20))).toEqual({ ok: false, reason: "invalid" });
    expect(validateRasterImage(validPngBytes(MAX_RASTER_IMAGE_DIMENSION + 1, 1))).toEqual({
      ok: false,
      reason: "dimensions",
    });
    expect(validateRasterImage(validPngBytes(MAX_RASTER_IMAGE_DIMENSION, MAX_RASTER_IMAGE_DIMENSION))).toEqual({
      ok: false,
      reason: "dimensions",
    });
    expect(validateRasterImage(validPngBytes(4000, MAX_RASTER_IMAGE_PIXELS / 4000))).toEqual({
      ok: true,
      image: { contentType: "image/png", extension: "png", width: 4000, height: MAX_RASTER_IMAGE_PIXELS / 4000 },
    });
    expect(validateRasterImage(validPngBytes(4000, MAX_RASTER_IMAGE_PIXELS / 4000 + 1))).toEqual({
      ok: false,
      reason: "dimensions",
    });

    await expect(
      readValidatedUploadedImage(
        new Request("https://app.test/upload", {
          method: "POST",
          headers: { "content-type": "image/png" },
          body: asArrayBuffer(validPngBytes(MAX_RASTER_IMAGE_DIMENSION, MAX_RASTER_IMAGE_DIMENSION)),
        }),
        "Headshot",
      ),
    ).rejects.toMatchObject({ status: 413, code: "IMAGE_DIMENSIONS_TOO_LARGE" });
  });
});
