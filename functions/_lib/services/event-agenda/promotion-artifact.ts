import { promotionPortraits } from "./promotion-portraits";
import { downloadZip } from "client-zip";
import type { Env } from "../../types";
import { AppError } from "../../errors";
import { ensureResvgWasm } from "../../utils/resvg";
import { fetchStaticAsset, uint8ToBase64 } from "../og-badge-hero-image";
import {
  renderPromotionSvg,
  renderPromotionPdf,
  promotionCardPages,
  type PromotionRenderData,
} from "./promotion-render";
import type { z } from "zod";
import { promotionFormatSchema } from "../../../../assets/shared/schemas/event-promotion-kit";
export async function renderPromotionArtifact(
  env: Env,
  origin: string,
  data: PromotionRenderData,
  format: z.infer<typeof promotionFormatSchema>,
): Promise<{
  body: Uint8Array | ReadableStream<Uint8Array>;
  contentType: string;
  count: number;
  preview?: Uint8Array;
}> {
  const text = JSON.stringify([data.occurrence, data.copy, data.agenda.eventName]);
  const fallbackNames = [
    ...(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)
      ? ["NotoSansSC-Regular.ttf"]
      : []),
    ...(/\p{Extended_Pictographic}/u.test(text) ? ["NotoEmoji-Regular.ttf"] : []),
  ];
  const fonts = await Promise.all(
    ["Roboto-Regular.ttf", "Roboto-Bold.ttf", ...fallbackNames].map(async (name) => {
      const response = await fetchStaticAsset(env, origin, `/fonts/${name}`);
      if (!response.ok)
        throw new AppError(503, "PROMOTION_FONT_UNAVAILABLE", "Promotion typography is temporarily unavailable.");
      return new Uint8Array(await response.arrayBuffer());
    }),
  );
  const logoResponse = await fetchStaticAsset(env, origin, "/img/logo.svg");
  const logoBytes = logoResponse.ok ? new Uint8Array(await logoResponse.arrayBuffer()) : undefined;
  const Resvg = await ensureResvgWasm();
  let logoPng: Uint8Array | undefined;
  if (logoBytes) {
    const renderer = new Resvg(new TextDecoder().decode(logoBytes), { fitTo: { mode: "width", value: 500 } });
    try {
      logoPng = renderer.render().asPng();
    } finally {
      renderer.free();
    }
  }
  const source = {
    ...data,
    portraits: await promotionPortraits(env, origin, data),
    logoPng,
    logoDataUrl: logoBytes ? `data:image/svg+xml;base64,${uint8ToBase64(logoBytes)}` : undefined,
  };
  if (format === "carousel")
    return {
      body: await renderPromotionPdf(source, fonts[0]!, fonts[1]!, fonts.slice(2)),
      contentType: "application/pdf",
      count: 1,
    };
  const imageFormat = format;
  const pages = promotionCardPages(source, imageFormat);
  const previewRenderer = new Resvg(renderPromotionSvg(pages[0]!, imageFormat), {
    font: { fontBuffers: fonts, defaultFontFamily: "Roboto" },
  });
  let preview: Uint8Array;
  try {
    preview = previewRenderer.render().asPng();
  } finally {
    previewRenderer.free();
  }
  async function* renderPages() {
    for (const [index, page] of pages.entries()) {
      if (index === 0) {
        yield { name: `session-${imageFormat}-01.png`, input: preview };
        continue;
      }
      const renderer = new Resvg(renderPromotionSvg(page, imageFormat), {
        font: { fontBuffers: fonts, defaultFontFamily: "Roboto" },
      });
      try {
        yield { name: `session-${format}-${String(index + 1).padStart(2, "0")}.png`, input: renderer.render().asPng() };
      } finally {
        renderer.free();
      }
    }
  }
  if (pages.length > 1) {
    const response = downloadZip(renderPages());
    if (!response.body) throw new Error("Promotion archive stream unavailable");
    return { body: response.body, contentType: "application/zip", count: pages.length, preview };
  }
  return { body: preview, contentType: "image/png", count: 1 };
}
