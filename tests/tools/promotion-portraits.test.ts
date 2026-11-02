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

it("retains photographic WebP portraits within the export budget without flattening transparent sources", async () => {
  const servicePath = "../../functions/_lib/services/event-agenda/promotion-portraits";
  const { promotionPortraits } = await import(servicePath);
  const pixels = new Uint8Array(512 * 512 * 3);
  let seed = 42;
  for (let index = 0; index < pixels.length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[index] = seed >>> 24;
  }
  const photo = await sharp(pixels, { raw: { width: 512, height: 512, channels: 3 } })
    .webp({ quality: 80 })
    .toBuffer();
  expect(photo.length).toBeLessThan(256 * 1024);
  expect((await sharp(photo).png().toBuffer()).length).toBeGreaterThan(256 * 1024);
  const transparent = await sharp(pixels, { raw: { width: 512, height: 512, channels: 3 } })
    .ensureAlpha(0.5)
    .webp({ quality: 80 })
    .toBuffer();
  const cutout = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
  })
    .webp({ lossless: true })
    .toBuffer();
  const sources: Record<string, Buffer> = { photo, transparent, cutout };
  const formats: Record<string, string[]> = {};
  for (const [name, source] of Object.entries(sources)) {
    formats[name] = [];
    const env = {
      ASSETS: { fetch: async () => new Response(new Uint8Array(source)) },
      IMAGES: {
        input: () => ({
          transform: () => ({
            output: async ({ format, quality }: { format: string; quality: number }) => {
              formats[name]!.push(format);
              const bytes = await sharp(source)
                .toFormat(format === "image/png" ? "png" : "jpeg", { quality })
                .toBuffer();
              return { response: () => new Response(bytes) };
            },
          }),
        }),
      },
    };
    const portraits = await promotionPortraits(env, "https://pkic.org", {
      people: [{ userId: name, photoUrl: `/${name}` }],
    } as unknown as PromotionRenderData);
    if (name === "transparent") {
      expect(portraits[name]).toBeUndefined();
      expect(formats[name]).toEqual(["image/png"]);
    } else {
      const embedded = portraits[name]!;
      const bytes = Buffer.from(embedded.split(",")[1]!, "base64");
      expect(bytes.length).toBeLessThanOrEqual(256 * 1024);
      if (name === "photo") {
        expect(embedded).toMatch(/^data:image\/jpeg;/u);
        expect(formats[name]).toEqual(["image/png", "image/jpeg"]);
        expect(await sharp(bytes).metadata()).toMatchObject({ width: 512, height: 512 });
      } else {
        expect(embedded).toMatch(/^data:image\/png;/u);
        const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();
        expect(decoded[3]).toBeCloseTo(128, 0);
      }
    }
  }
});

it("recognizes transparency before choosing an opaque fallback", async () => {
  const servicePath = "../../functions/_lib/utils/image-format";
  const { rasterImageHasTransparency } = await import(servicePath);
  expect(rasterImageHasTransparency(new Uint8Array([1, 2, 3]))).toBeNull();
  for (const format of ["png", "webp", "lossless-webp", "palette-png", "jpeg"] as const) {
    for (const alpha of [false, true]) {
      const image = sharp({
        create: {
          width: 32,
          height: 32,
          channels: alpha ? 4 : 3,
          background: { r: 255, g: 0, b: 0, alpha: alpha ? 0.5 : 1 },
        },
      });
      const bytes = await (
        format === "lossless-webp"
          ? image.webp({ lossless: true })
          : format === "palette-png"
            ? image.png({ palette: true })
            : image.toFormat(format)
      ).toBuffer();
      expect(rasterImageHasTransparency(bytes), `${format} alpha=${alpha}`).toBe(format === "jpeg" ? false : alpha);
    }
  }
});
