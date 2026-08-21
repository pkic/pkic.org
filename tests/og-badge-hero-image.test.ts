import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchHeroImage,
  imageResponseToDataUrl,
  resolveHeroImageSource,
} from "../functions/_lib/services/og-badge-hero-image";

describe("OG badge hero image boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects malformed destinations and routes same-origin assets through the asset binding", () => {
    expect(resolveHeroImageSource("javascript:alert(1)", "https://pkic.org")).toBeNull();
    expect(resolveHeroImageSource("//evil.test/image.png", "https://pkic.org")).toBeNull();
    expect(resolveHeroImageSource("https://pkic.org/image.png?v=1", "https://pkic.org")).toEqual({
      url: "https://pkic.org/image.png?v=1",
      assetPath: "/image.png?v=1",
    });
    expect(resolveHeroImageSource("https://cdn.example.test/image.png", "https://pkic.org")).toEqual({
      url: "https://cdn.example.test/image.png",
      assetPath: null,
    });
    expect(resolveHeroImageSource("http://cdn.example.test/image.png", "https://pkic.org")).toBeNull();
  });

  it("accepts a small supported image and rejects HTML or oversized bodies without trusting Content-Length", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(
      imageResponseToDataUrl(new Response(bytes, { headers: { "content-type": "image/png" } })),
    ).resolves.toBe(`data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`);
    await expect(
      imageResponseToDataUrl(new Response("<html>", { headers: { "content-type": "text/html" } })),
    ).resolves.toBeNull();
    await expect(
      imageResponseToDataUrl(new Response("<html>", { headers: { "content-type": "image/jpeg" } })),
    ).resolves.toBeNull();
    await expect(
      imageResponseToDataUrl(
        new Response(bytes, { headers: { "content-type": "image/png", "content-length": "9" } }),
        8,
      ),
    ).resolves.toBeNull();

    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    });
    await expect(
      imageResponseToDataUrl(new Response(oversized, { headers: { "content-type": "image/jpeg" } }), 5),
    ).resolves.toBeNull();
  });

  it("accepts the exact byte boundary and rejects a declared MIME mismatch", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(
      imageResponseToDataUrl(new Response(png, { headers: { "content-type": "image/png" } }), png.byteLength),
    ).resolves.toBe(`data:image/png;base64,${btoa(String.fromCharCode(...png))}`);
    await expect(
      imageResponseToDataUrl(new Response(png, { headers: { "content-type": "image/jpeg" } }), png.byteLength),
    ).resolves.toBeNull();
  });

  it("cancels an oversized response body and keeps the caller's null failure policy", async () => {
    let cancelReason: unknown;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
      },
      cancel(reason) {
        cancelReason = reason;
        throw new Error("cancel failed");
      },
    });
    await expect(
      imageResponseToDataUrl(new Response(body, { headers: { "content-type": "image/jpeg" } }), 5),
    ).resolves.toBeNull();
    expect(cancelReason).toBe("Hero image exceeds the byte limit");
  });

  it("aborts a stalled external hero fetch at the configured deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("fetch aborted")), { once: true });
        });
      }),
    );

    await expect(
      fetchHeroImage(JSON.stringify({ heroImageUrl: "https://cdn.example.test/hero.png" }), "https://pkic.org", {}, 5),
    ).resolves.toBeNull();
  });
});
