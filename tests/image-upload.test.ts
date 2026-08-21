import { describe, expect, it } from "vitest";
import { readValidatedUploadedImage, validateUploadedImageFile } from "../functions/_lib/utils/image-upload";

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
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });

    await expect(readValidatedUploadedImage(request, "Logo")).resolves.toMatchObject({ contentType: "image/png" });
  });

  it("applies the caller's shared size policy after extracting multipart data", async () => {
    const oversized = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "headshot.jpg", {
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
});
