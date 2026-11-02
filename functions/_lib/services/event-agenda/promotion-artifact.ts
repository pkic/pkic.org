import { promotionPortraits } from "./promotion-portraits";
import { promotionFontMeasure } from "./promotion-text";
import { downloadZip } from "client-zip";
import type { Env } from "../../types";
import { AppError } from "../../errors";
import { ensureResvgWasm } from "../../utils/resvg";
import { fetchStaticAsset, uint8ToBase64 } from "../og-badge-hero-image";
import {
  hasUnsupportedPromotionScript,
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

/**
 * Fonts and the logo are the same for every render, so an isolate working
 * through a queue loads and rasterizes them once. A failed load is forgotten,
 * so the next job tries again.
 */
const sharedInputs = new Map<string, Promise<Uint8Array | undefined>>();
function cachedInput(key: string, load: () => Promise<Uint8Array | undefined>) {
  let value = sharedInputs.get(key);
  if (!value) {
    value = load();
    value.catch(() => sharedInputs.delete(key));
    sharedInputs.set(key, value);
  }
  return value;
}
async function promotionFont(env: Env, origin: string, name: string) {
  const font = await cachedInput(`${origin}/fonts/${name}`, async () => {
    const response = await fetchStaticAsset(env, origin, `/fonts/${name}`);
    if (!response.ok)
      throw new AppError(503, "PROMOTION_FONT_UNAVAILABLE", "Promotion typography is temporarily unavailable.");
    return new Uint8Array(await response.arrayBuffer());
  });
  return font!;
}
async function promotionLogo(env: Env, origin: string, Resvg: Awaited<ReturnType<typeof ensureResvgWasm>>) {
  const bytes = await cachedInput(`${origin}/img/logo.svg`, async () => {
    const response = await fetchStaticAsset(env, origin, "/img/logo.svg");
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
  });
  if (!bytes) return { bytes, png: undefined };
  const png = await cachedInput(`${origin}/img/logo.svg#500`, async () => {
    const renderer = new Resvg(new TextDecoder().decode(bytes), { fitTo: { mode: "width", value: 500 } });
    try {
      return renderer.render().asPng();
    } finally {
      renderer.free();
    }
  });
  return { bytes, png };
}

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
  const text = JSON.stringify([data.occurrence, data.copy, data.agenda.eventName]);
  if (hasUnsupportedPromotionScript(text))
    throw new AppError(
      409,
      "PROMOTION_SCRIPT_UNSUPPORTED",
      "Promotion cards are printed in Latin script. Use the English spelling of names and titles.",
    );
  const fallbackNames = /\p{Extended_Pictographic}/u.test(text) ? ["NotoEmoji-Regular.ttf"] : [];
  const fonts = await Promise.all(
    [
      "PromotionRoboto-Regular.ttf",
      "PromotionRoboto-Bold.ttf",
      "PromotionRobotoMono-Medium.ttf",
      "PromotionRobotoMono-SemiBold.ttf",
      "PromotionRoboto-Medium.ttf",
      ...fallbackNames,
    ].map((name) => promotionFont(env, origin, name)),
  );
  const Resvg = await ensureResvgWasm();
  const logo = await promotionLogo(env, origin, Resvg);
  const fontAssets = { mono: fonts[2]!, monoBold: fonts[3]!, medium: fonts[4]! };
  const source = {
    fontAssets,
    ...data,
    portraits: await promotionPortraits(env, origin, data),
    logoPng: logo.png,
    logoDataUrl: logo.bytes ? `data:image/svg+xml;base64,${uint8ToBase64(logo.bytes)}` : undefined,
    measure: promotionFontMeasure(fonts, fontAssets),
  };
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
