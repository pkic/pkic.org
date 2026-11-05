import type { z } from "zod";
import type { promotionArtworkSchema } from "../../../../../../../shared/schemas/event-promotion-kit";
import { PROMOTION_FONTS } from "../../../../../../../shared/promotion-fonts";
import { bytesToBase64 } from "../../../../../../../shared/base64";

export type PromotionArtwork = z.infer<typeof promotionArtworkSchema>;
const fonts = new Map<string, Promise<string>>();

async function fontRule(file: string) {
  const face = PROMOTION_FONTS.find((candidate) => candidate.file === file);
  if (!face) throw new Error("This artwork uses an unavailable font. Refresh and try again.");
  let pending = fonts.get(file);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(`/fonts/${face.file}`);
      if (!response.ok) throw new Error("Could not load the artwork fonts. Try downloading again.");
      const encoded = bytesToBase64(new Uint8Array(await response.arrayBuffer()));
      return `@font-face{font-family:'${face.family}';font-weight:${face.weight};src:url(data:font/ttf;base64,${encoded}) format('truetype')}`;
    })();
    fonts.set(file, pending);
    void pending.catch(() => fonts.delete(file));
  }
  return pending;
}

/** Embedded fonts keep SVG previews and canvas output independent of page fonts and external requests. */
export async function promotionArtworkUrls(artwork: PromotionArtwork): Promise<string[]> {
  const css = (await Promise.all(artwork.fontFiles.map(fontRule))).join("");
  return artwork.pages.map(({ svg }) => {
    const end = svg.indexOf(">");
    const embedded = `${svg.slice(0, end + 1)}<style>${css}</style>${svg.slice(end + 1)}`;
    return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(embedded))}`;
  });
}

async function promotionJpeg(src: string, width: number, height: number): Promise<Blob> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not create this image. Try another browser.");
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not save this image. Try again."))),
        "image/jpeg",
        0.88,
      ),
    );
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/** Render only the selected download, one page at a time; multiple cards retain the complete ZIP export. */
export async function exportPromotionImages(artwork: PromotionArtwork, urls: readonly string[]): Promise<Blob> {
  const renderPage = (index: number) => {
    const page = artwork.pages[index]!;
    return promotionJpeg(urls[index]!, page.width, page.height);
  };
  if (artwork.pages.length === 1) return renderPage(0);
  const { downloadZip } = await import("client-zip");
  async function* images() {
    for (let index = 0; index < artwork.pages.length; index++) {
      yield {
        name: `session-${artwork.format}-${String(index + 1).padStart(2, "0")}.jpg`,
        input: await renderPage(index),
      };
    }
  }
  return downloadZip(images()).blob();
}
