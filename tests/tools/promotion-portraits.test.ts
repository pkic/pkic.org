import { it, expect, vi } from "vitest";
import sharp from "sharp";
import type { PromotionRenderData } from "../../functions/_lib/services/event-agenda/promotion-render";
it("uses bounded approved raster portraits and rejects oversized decode/fetch failures", async () => {
  // Keep Workers-only global binding types outside this Node/DOM test compilation.
  const servicePath = "../../functions/_lib/services/event-agenda/promotion-portraits";
  const { promotionPortraits } = await import(servicePath);
  const small = await sharp({ create: { width: 64, height: 64, channels: 3, background: "green" } })
    .png()
    .toBuffer();
  const large = await sharp({ create: { width: 600, height: 600, channels: 3, background: "green" } })
    .png()
    .toBuffer();
  const fetch = vi.fn(
    async (request: Request) =>
      new Response(request.url.endsWith("large.png") ? large : small, { headers: { "content-type": "image/png" } }),
  );
  const env = { ASSETS: { fetch } };
  const data = {
    occurrence: {
      history: {
        appearances: [
          { userId: "small", photoUrl: "/small.png" },
          { userId: "large", photoUrl: "/large.png" },
          { userId: "unapproved-host", photoUrl: "https://private.example.test/image.png" },
        ],
      },
    },
  } as unknown as PromotionRenderData;
  const portraits = await promotionPortraits(env, "https://pkic.org", data);
  expect(portraits.small).toMatch(/^data:image\/png;base64,/u);
  expect(portraits.large).toBeUndefined();
  expect(portraits["unapproved-host"]).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("normalizes WebP portraits through Images before the real export renderer draws them", async () => {
  const { readFileSync } = await import("node:fs");
  const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
  await initWasm(readFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
  const servicePath = "../../functions/_lib/services/event-agenda/promotion-portraits";
  const { promotionPortraits } = await import(servicePath);
  const sources = Object.fromEntries(
    await Promise.all(
      ["png", "jpeg", "webp"].map(async (format) => [
        format,
        await sharp({ create: { width: 64, height: 64, channels: 4, background: "#f00" } })
          .toFormat(format as "png" | "jpeg" | "webp")
          .toBuffer(),
      ]),
    ),
  );
  const output = vi.fn(async ({ format }: { format: string }) => ({
    response: () =>
      new Response(sources[format === "image/png" ? "png" : "jpeg"]!, { headers: { "content-type": format } }),
  }));
  const env = {
    ASSETS: { fetch: async (request: Request) => new Response(sources[new URL(request.url).pathname.slice(1)]!) },
    IMAGES: { input: () => ({ transform: () => ({ output }) }) },
  };
  const data = {
    people: ["png", "jpeg", "webp"].map((format) => ({ userId: format, photoUrl: `/${format}` })),
  } as unknown as PromotionRenderData;
  const portraits = await promotionPortraits(env, "https://pkic.org", data);
  expect(output).toHaveBeenCalledOnce();
  for (const format of ["png", "jpeg", "webp"]) {
    expect(portraits[format]).toMatch(/^data:image\/(png|jpeg);base64,/u);
    const renderer = new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="blue"/><image href="${portraits[format]}" width="64" height="64"/></svg>`,
    );
    try {
      const pixels = await sharp(renderer.render().asPng()).ensureAlpha().raw().toBuffer();
      const center = (32 * 64 + 32) * 4;
      expect(pixels[center]).toBeGreaterThan(240);
      expect(pixels[center + 2]).toBeLessThan(15);
    } finally {
      renderer.free();
    }
  }
  const missing = await promotionPortraits({ ASSETS: env.ASSETS }, "https://pkic.org", data);
  expect(missing.webp).toBeUndefined();
  const invalid = await promotionPortraits(
    {
      ...env,
      IMAGES: {
        input: () => ({ transform: () => ({ output: async () => ({ response: () => new Response(sources.webp!) }) }) }),
      },
    },
    "https://pkic.org",
    data,
  );
  expect(invalid.webp).toBeUndefined();
});
