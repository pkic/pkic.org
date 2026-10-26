import type { Env } from "../functions/_lib/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchHeroImage,
  imageResponseToDataUrl,
  resolveHeroImageSource,
} from "../functions/_lib/services/og-badge-hero-image";
import { validPngBytes, validJpegBytes, validWebpBytes } from "./helpers/raster-images";

describe("OG badge hero image boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the original raster instead of making a landscape crop before square rendering", async () => {
    const bytes = validPngBytes(1600, 1200);
    const input = vi.fn(() => {
      throw new Error("A pre-crop changes the design perspective");
    });
    const environment = {
      ASSETS: {
        fetch: async () => new Response(bytes, { headers: { "content-type": "image/png" } }),
      } as unknown as Env["ASSETS"],
      IMAGES: { input },
    };
    const image = await fetchHeroImage(
      JSON.stringify({ heroImageUrl: "/event-photo.png" }),
      "https://pkic.org",
      environment,
    );
    expect(image).toMatchObject({ width: 1600, height: 1200 });
    expect(image?.dataUrl).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`);
    expect(input).not.toHaveBeenCalled();
  });
  it("does not ask an external image proxy to crop the source", async () => {
    const bytes = validPngBytes(1600, 1200);
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const image = await fetchHeroImage(
      JSON.stringify({ heroImageUrl: "https://cdn.example.test/hero.png" }),
      "https://pkic.org",
      { HERO_IMAGE_ALLOWED_HOSTS: "cdn.example.test" },
    );
    expect(image).toMatchObject({ width: 1600, height: 1200 });
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("cf");
  });
  it("normalizes WebP without imposing a landscape resize or crop", async () => {
    const transform = vi.fn().mockReturnValue({
      output: async () => ({
        response: async () => new Response(validJpegBytes(1600, 1200), { headers: { "content-type": "image/jpeg" } }),
      }),
    });
    const environment = {
      ASSETS: {
        fetch: async () => new Response(validWebpBytes(1600, 1200), { headers: { "content-type": "image/webp" } }),
      },
      IMAGES: { input: () => ({ transform }) },
    } as unknown as Env;
    const image = await fetchHeroImage(
      JSON.stringify({ heroImageUrl: "/event-photo.webp" }),
      "https://pkic.org",
      environment,
    );
    expect(transform).toHaveBeenCalledWith({});
    expect(image).toMatchObject({ width: 1600, height: 1200, contentType: "image/jpeg" });
  });
  it("allows same-origin assets by default and rejects unapproved external hosts", () => {
    expect(resolveHeroImageSource("javascript:alert(1)", "https://pkic.org")).toBeNull();
    expect(resolveHeroImageSource("//evil.test/image.png", "https://pkic.org")).toBeNull();
    expect(resolveHeroImageSource("https://pkic.org/image.png?v=1", "https://pkic.org")).toEqual({
      url: "https://pkic.org/image.png?v=1",
      assetPath: "/image.png?v=1",
    });
    expect(resolveHeroImageSource("https://cdn.example.test/image.png", "https://pkic.org")).toBeNull();
    expect(resolveHeroImageSource("http://cdn.example.test/image.png", "https://pkic.org")).toBeNull();
  });

  it("allows only explicitly configured external hero-image hosts", () => {
    expect(
      resolveHeroImageSource("https://cdn.example.test/image.png", "https://pkic.org", "cdn.example.test"),
    ).toEqual({
      url: "https://cdn.example.test/image.png",
      assetPath: null,
    });
    expect(
      resolveHeroImageSource("https://other.example.test/image.png", "https://pkic.org", "cdn.example.test"),
    ).toBeNull();
  });

  it("accepts a small supported image and rejects HTML or oversized bodies without trusting Content-Length", async () => {
    const bytes = validPngBytes();
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
    const png = validPngBytes();
    await expect(
      imageResponseToDataUrl(new Response(png, { headers: { "content-type": "image/png" } }), png.byteLength),
    ).resolves.toBe(`data:image/png;base64,${btoa(String.fromCharCode(...png))}`);
    await expect(
      imageResponseToDataUrl(new Response(png, { headers: { "content-type": "image/jpeg" } }), png.byteLength),
    ).resolves.toBeNull();
  });

  it("rejects a byte-bounded image whose decoded dimensions exceed the shared raster policy", async () => {
    const oversized = validPngBytes(4097, 1);
    await expect(
      imageResponseToDataUrl(new Response(oversized, { headers: { "content-type": "image/png" } })),
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
      fetchHeroImage(
        JSON.stringify({ heroImageUrl: "https://cdn.example.test/hero.png" }),
        "https://pkic.org",
        { HERO_IMAGE_ALLOWED_HOSTS: "cdn.example.test" },
        5,
      ),
    ).resolves.toBeNull();
  });

  it("does not follow external hero-image redirects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://internal.test" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchHeroImage(JSON.stringify({ heroImageUrl: "https://cdn.example.test/hero.png" }), "https://pkic.org", {
        HERO_IMAGE_ALLOWED_HOSTS: "cdn.example.test",
      }),
    ).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.example.test/hero.png",
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
