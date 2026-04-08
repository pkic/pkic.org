import { describe, expect, it } from "vitest";
import { resolveOgImageType } from "../functions/_lib/utils/og-image-type";

describe("OG image type helper", () => {
  it("uses JPEG when the Images binding is present", () => {
    expect(resolveOgImageType({ IMAGES: {} })).toBe("image/jpeg");
  });

  it("falls back to PNG when the Images binding is missing", () => {
    expect(resolveOgImageType({})).toBe("image/png");
  });
});