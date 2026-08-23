import { describe, expect, it, vi } from "vitest";
import { onRequestGet, parseOgCardRequest, publishedOgCardVersion } from "../functions/api/v1/og/card/[...path]";
import type { Env } from "../functions/_lib/types";

const VERSION = "0123456789ab";

function context(url: string, envOverrides: Record<string, unknown>) {
  return {
    req: { raw: new Request(url) },
    env: { APP_BASE_URL: "https://app.test", ...envOverrides },
    executionCtx: { waitUntil: vi.fn() },
  };
}

describe("OG card render authorization", () => {
  it.each([
    ["home", `https://app.test/og/index/og.jpg?v=${VERSION}`, { pagePath: "", contentHash: VERSION }],
    [
      "nested page",
      `https://app.test/og/events/2026/pqc/og.jpg?v=${VERSION}`,
      { pagePath: "events/2026/pqc", contentHash: VERSION },
    ],
    [
      "Unicode author page",
      `https://app.test/og/authors/lukáš-geyer/og.jpg?v=${VERSION}`,
      { pagePath: "authors/luk%C3%A1%C5%A1-geyer", contentHash: VERSION },
    ],
  ])("accepts the canonical %s URL emitted by Hugo", (_label, url, expected) => {
    expect(parseOgCardRequest(new Request(url))).toEqual(expected);
  });

  it.each([
    "https://app.test/og/events/pqc/og.jpg",
    "https://app.test/og/events/pqc/og.jpg?v=not-a-version",
    `https://app.test/og/events%2Fpqc/og.jpg?v=${VERSION}`,
    `https://app.test/og/events%5Cpqc/og.jpg?v=${VERSION}`,
    `https://app.test/og/events%2500pqc/og.jpg?v=${VERSION}`,
    `https://app.test/og/%252e%252e/admin/og.jpg?v=${VERSION}`,
    `https://app.test/og/events//pqc/og.jpg?v=${VERSION}`,
    `https://app.test/og/../admin/og.jpg?v=${VERSION}`,
    `https://app.test/og/events/pqc/og.jpg?v=${VERSION}&v=${VERSION}`,
  ])("rejects non-canonical render input: %s", (url) => {
    expect(parseOgCardRequest(new Request(url))).toBeNull();
  });

  it("reads the generated version marker from the exact static render target", async () => {
    const fetch = vi.fn(
      async (_request: Request) =>
        new Response(`<meta name="pkic-og-card-version" content="${VERSION}">`, {
          headers: { "content-type": "text/html" },
        }),
    );
    const env = { ASSETS_PUBLIC: { fetch } } as unknown as Env;

    await expect(publishedOgCardVersion(env, "https://app.test", "events/pqc")).resolves.toBe(VERSION);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0].url).toBe("https://app.test/events/pqc/og-card.html");
  });

  it("serves only the exact versioned R2 cache key", async () => {
    const jpeg = new Uint8Array([1, 2, 3]).buffer;
    const get = vi.fn(async () => ({
      customMetadata: { contentHash: VERSION, pagePath: "events/pqc" },
      arrayBuffer: async () => jpeg,
    }));
    const response = await onRequestGet(
      context(`https://app.test/og/events/pqc/og.jpg?v=${VERSION}`, {
        ASSETS_BUCKET: { get },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-cache")).toBe("HIT");
    expect(get).toHaveBeenCalledWith(`og-cards/events/pqc/${VERSION}.jpg`);
  });

  it("does not render or fill R2 for an invented version", async () => {
    const get = vi.fn(async () => null);
    const put = vi.fn(async () => undefined);
    const fetch = vi.fn(
      async () =>
        new Response('<meta name="pkic-og-card-version" content="aaaaaaaaaaaa">', {
          headers: { "content-type": "text/html" },
        }),
    );
    const response = await onRequestGet(
      context(`https://app.test/og/events/pqc/og.jpg?v=${VERSION}`, {
        ASSETS_BUCKET: { get, put },
        ASSETS_PUBLIC: { fetch },
        BROWSER: {},
      }),
    );

    expect(response.status).toBe(404);
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects invalid input before consulting R2 or static assets", async () => {
    const get = vi.fn(async () => null);
    const fetch = vi.fn(async () => new Response(""));
    const response = await onRequestGet(
      context("https://app.test/og/events/pqc/og.jpg?v=attacker", {
        ASSETS_BUCKET: { get },
        ASSETS_PUBLIC: { fetch },
      }),
    );

    expect(response.status).toBe(400);
    expect(get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
