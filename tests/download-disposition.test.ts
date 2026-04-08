import { describe, expect, it } from "vitest";
import { buildDownloadDisposition, contentTypeToFileExtension } from "../functions/_lib/utils/download-disposition";

describe("download disposition helpers", () => {
  it("maps common image content types to stable file extensions", () => {
    expect(contentTypeToFileExtension("image/jpeg")).toBe("jpg");
    expect(contentTypeToFileExtension("image/png")).toBe("png");
    expect(contentTypeToFileExtension("image/webp")).toBe("webp");
    expect(contentTypeToFileExtension("image/svg+xml")).toBe("svg");
  });

  it("builds a download disposition from the response content type", () => {
    expect(buildDownloadDisposition("event-badge.webp", "image/webp", "attendee-badge")).toBe(
      'attachment; filename="event-badge.webp"',
    );
    expect(buildDownloadDisposition("", "image/png", "donation-badge")).toBe(
      'attachment; filename="donation-badge.png"',
    );
  });
});