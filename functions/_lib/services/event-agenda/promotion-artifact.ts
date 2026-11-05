import { preparePromotionArtwork } from "./promotion-artwork-inputs";
import { downloadZip } from "client-zip";
import type { Env } from "../../types";
import { ensureResvgWasm } from "../../utils/resvg";
import {
  renderPromotionSvg,
  renderPromotionPdf,
  promotionCardPages,
  type PromotionRenderData,
} from "./promotion-render";
import { buildPromotionPages } from "./promotion-scene";
import { promotionSceneSvg } from "./promotion-svg";
import type { z } from "zod";
import { promotionFormatSchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import { encodeRenderedPng, THUMBNAIL_OUTPUT, type EncodedImage } from "../../utils/image-encoding";
/** Downloads are photos people post; JPEG keeps them a fraction of a PNG's size. */
const download = { format: "image/jpeg", quality: 88 } as const;

export async function renderPromotionArtifact(
  env: Env,
  origin: string,
  data: PromotionRenderData,
  format: z.infer<typeof promotionFormatSchema>,
): Promise<{
  body: Uint8Array | ReadableStream<Uint8Array>;
  contentType: string;
  count: number;
  thumbnail: EncodedImage;
}> {
  const { fonts, source } = await preparePromotionArtwork(env, origin, data);
  const Resvg = await ensureResvgWasm();
  const rasterize = async (svg: string) => {
    const renderer = new Resvg(svg, { font: { fontBuffers: fonts, defaultFontFamily: "Roboto" } });
    try {
      return renderer.render().asPng();
    } finally {
      renderer.free();
    }
  };
  if (format === "carousel") {
    const [cover] = buildPromotionPages(source, "carousel");
    return {
      body: await renderPromotionPdf(source, fonts[0]!, fonts[1]!, fonts.slice(5), rasterize),
      contentType: "application/pdf",
      count: 1,
      // The first slide, so a gallery shows the carousel's own cover instead of another format.
      thumbnail: await encodeRenderedPng(env, await rasterize(promotionSceneSvg(source, cover!)), THUMBNAIL_OUTPUT),
    };
  }
  const imageFormat = format;
  const pages = promotionCardPages(source, imageFormat);
  const first = await rasterize(renderPromotionSvg(pages[0]!, imageFormat));
  const preview = await encodeRenderedPng(env, first, THUMBNAIL_OUTPUT);
  const encode = async (png: Uint8Array) => encodeRenderedPng(env, png, download);
  if (pages.length > 1) {
    async function* renderPages() {
      for (const [index, page] of pages.entries()) {
        const image = await encode(index === 0 ? first : await rasterize(renderPromotionSvg(page, imageFormat)));
        const extension = image.contentType === "image/jpeg" ? "jpg" : "png";
        yield { name: `session-${imageFormat}-${String(index + 1).padStart(2, "0")}.${extension}`, input: image.bytes };
      }
    }
    const response = downloadZip(renderPages());
    if (!response.body) throw new Error("Promotion archive stream unavailable");
    return { body: response.body, contentType: "application/zip", count: pages.length, thumbnail: preview };
  }
  const image = await encode(first);
  return { body: image.bytes, contentType: image.contentType, count: 1, thumbnail: preview };
}
