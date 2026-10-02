import { expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import app from "../functions/router";

it("serves member publication assets without reading D1, including missing profiles", async () => {
  const fetch = vi.fn(
    async (request: Request) =>
      new Response(new URL(request.url).pathname.includes("missing") ? "Not found" : "Approved static member", {
        status: new URL(request.url).pathname.includes("missing") ? 404 : 200,
      }),
  );
  const bindings = {
    ...env,
    ASSETS: undefined,
    ASSETS_PUBLIC: { fetch },
    DB: {
      prepare: () => {
        throw new Error("Member browsing must not read D1");
      },
    },
  };
  for (const path of [
    "/members/",
    "/members/example/",
    "/members/independent/",
    "/members/missing/",
    "/news/",
    "/news/feed.xml",
    "/news/missing/",
  ]) {
    const response = await app.fetch(
      new Request(`https://pkic.org${path}`),
      bindings as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any,
    );
    expect(response.status).toBe(path.includes("missing") ? 404 : 200);
    expect(await response.text()).toBe(path.includes("missing") ? "Not found" : "Approved static member");
  }
  expect(fetch).toHaveBeenCalledTimes(7);
});
