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
