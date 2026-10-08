import { describe, expect, it } from "vitest";
import { STANDARD_HEADSHOT_MAX_BYTES } from "../assets/shared/schemas/images";
import { loadValidatedHeadshotDataUrl } from "../functions/_lib/services/og-badge-prerender";
import { renderBadgeSvg } from "../functions/_lib/services/og-badge";
import { socialBadgeRoleSchema } from "../assets/shared/schemas/participant-roles";
import { validPngBytes } from "./helpers/raster-images";

function bucketWith(bytes: Uint8Array, size = bytes.byteLength): R2Bucket {
  return {
    get: async () => ({ arrayBuffer: async () => bytes.buffer, size }),
  } as unknown as R2Bucket;
}

describe("OG sponsor badge rendering", () => {
  it("renders the canonical sponsor role with its blue label and escaped event details", () => {
    const svg = renderBadgeSvg({
      firstName: "Synthetic",
      lastName: "Sponsor",
      role: socialBadgeRoleSchema.parse("sponsor"),
      eventName: "Conference & workshop",
      startsAt: "2026-12-01T09:00:00.000Z",
      endsAt: "2026-12-01T17:00:00.000Z",
    });

    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain('fill="#5a9bd5">is sponsoring</text>');
    expect(svg).toContain(">Sponsor</text>");
    expect(svg).toContain("Conference &amp; workshop");
    expect(svg).not.toContain(">Attendee</text>");
    expect(svg).not.toContain("is attending");
  });
});

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
