import { describe, expect, it } from "vitest";
import { readCachedBadge } from "../functions/_lib/services/og-badge-http";

function cachedBadge(generation?: string) {
  return {
    bucket: {
      get: async () => ({
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        httpMetadata: { contentType: "image/png" },
        customMetadata: generation ? { badgeGeneration: generation } : {},
      }),
    } as unknown as R2Bucket,
    cacheKey: "og-badges/test",
    cacheMetadata: { referralCode: "test", badgeGeneration: "2" },
    isDownload: false,
    downloadName: "",
    fallbackDownloadName: "attendee-badge",
  };
}

describe("badge regeneration cache boundary", () => {
  it("rejects the old cached picture after a new render is requested", async () => {
    expect(await readCachedBadge(cachedBadge("1"))).toBeNull();
    expect(await readCachedBadge(cachedBadge())).toBeNull();
  });
  it("serves the matching generation without regenerating it", async () => {
    const response = await readCachedBadge(cachedBadge("2"));
    expect(response?.headers.get("X-Cache")).toBe("HIT");
    expect(response?.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
