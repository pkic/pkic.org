import { promotionFooterTexts, promotionFooterArrows } from "./promotion-footer";
import { PDFDocument, PDFString, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { buildPromotionPages } from "./promotion-scene";
import { promotionSceneSvg } from "./promotion-svg";
import { promotionPdfStructure } from "./promotion-pdf-structure";
import type { PromotionRenderData } from "./promotion-render";
const ink = (hex: string) =>
  rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
/** Raster decorations, real tagged text and referral annotations share one measured scene. */
export async function renderPromotionPdf(
  data: PromotionRenderData,
  fontBytes: Uint8Array,
  boldBytes: Uint8Array,
  fallbackBytes: Uint8Array[] = [],
  rasterize?: (svg: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`${data.occurrence.title} · ${data.agenda.eventName ?? "PKI Consortium"}`);
  pdf.setLanguage("en-US");
  pdf.setCreator("PKI Consortium");
  // English uses base glyphs: localized alternates are absent from pdf-lib’s CID width table.
  const font = await pdf.embedFont(fontBytes, {
      subset: false,
      features: { locl: false, liga: false, clig: false, calt: false },
    }),
    bold = await pdf.embedFont(boldBytes, {
      subset: false,
      features: { locl: false, liga: false, clig: false, calt: false },
    });
  const fallbacks = await Promise.all(
    fallbackBytes.map((bytes) =>
      pdf.embedFont(bytes, { subset: false, features: { locl: false, liga: false, clig: false, calt: false } }),
    ),
  );
  const mono = data.fontAssets
    ? await pdf.embedFont(data.fontAssets.mono, {
        subset: false,
        features: { locl: false, liga: false, clig: false, calt: false },
      })
    : font;
  const monoBold = data.fontAssets
    ? await pdf.embedFont(data.fontAssets.monoBold, {
        subset: false,
        features: { locl: false, liga: false, clig: false, calt: false },
      })
    : bold;
  const medium = data.fontAssets
    ? await pdf.embedFont(data.fontAssets.medium, {
        subset: false,
        features: { locl: false, liga: false, clig: false, calt: false },
      })
    : font;
  const fonts = [font, bold, mono, monoBold, medium, ...fallbacks],
    sets = new Map(fonts.map((f) => [f, new Set(f.getCharacterSet())]));
  const runs = (text: string, primary: PDFFont) => {
    const result: { text: string; font: PDFFont }[] = [];
    for (const char of text) {
      const selected = [primary, ...fallbacks].find((f) => sets.get(f)!.has(char.codePointAt(0)!));
      if (!selected) throw new Error(`Unsupported promotion character U+${char.codePointAt(0)!.toString(16)}`);
      const previous = result.at(-1);
      if (previous?.font === selected) previous.text += char;
      else result.push({ text: char, font: selected });
    }
    return result;
  };
  const measure = (text: string, size: number, strong: boolean) =>
    runs(text, strong ? bold : font).reduce((width, run) => width + run.font.widthOfTextAtSize(run.text, size), 0);
  const scenes = buildPromotionPages(data, "carousel", data.measure ?? measure),
    structure = promotionPdfStructure(pdf);
  let mainHeading: import("pdf-lib").PDFDict | undefined;
  const elements = new Map<string, import("pdf-lib").PDFDict>();
  const scale = 0.5;
  // Each PDF page is a clipped frame of the shared panorama, preserving its global artwork coordinates.
  for (const scene of scenes) {
    const page = pdf.addPage([scene.width * scale, scene.height * scale]);
    const tags = structure.page(page);
    if (rasterize) {
      const image = await pdf.embedPng(await rasterize(promotionSceneSvg(data, scene, false)));
      tags.artifact(() => page.drawImage(image, { x: 0, y: 0, width: scene.width * scale, height: page.getHeight() }));
    } else {
      tags.artifact(() => {
        page.drawRectangle({
          x: 0,
          y: 0,
          width: scene.width * scale,
          height: page.getHeight(),
          color: ink(scene.light ? "#ffffff" : "#125c3c"),
        });
      });
      for (const arrow of promotionFooterArrows(scene))
        tags.artifact(() => {
          const x = arrow.x * scale,
            y = (scene.height - arrow.y) * scale,
            end = x + arrow.length * scale;
          const options = { thickness: 2 * scale, color: ink(arrow.color) };
          page.drawLine({ start: { x, y }, end: { x: end, y }, ...options });
          page.drawLine({ start: { x: end - 5 * scale, y: y + 5 * scale }, end: { x: end, y }, ...options });
          page.drawLine({ start: { x: end - 5 * scale, y: y - 5 * scale }, end: { x: end, y }, ...options });
        });
      if (data.logoPng && scene.index === 0) {
        const logo = await pdf.embedPng(data.logoPng);
        tags.artifact(() => page.drawImage(logo, { x: 44, y: page.getHeight() - 74, width: 118, height: 31 }));
      }
    }
    const drawText = (text: (typeof scene.texts)[number]) => {
      const key = text.role === "H1" ? "heading" : text.group;
      let node = key ? elements.get(key) : undefined;
      if (!node) {
        if (text.role === "H1") node = mainHeading ??= tags.element("H1");
        else if (text.role === "LI") {
          const list = tags.element("L"),
            item = tags.element("LI", list);
          node = tags.element("LBody", item);
        } else node = tags.element(text.role);
        if (key) elements.set(key, node);
      }
      tags.content(node, () => {
        let x = text.x * scale;
        const primary = text.mono
          ? text.bold
            ? monoBold
            : mono
          : text.weight === 500
            ? medium
            : text.bold
              ? bold
              : font;
        const tracking = (text.letterSpacing ?? 0) * scale;
        const laidOut = runs(text.text, primary).flatMap((run) =>
          tracking ? Array.from(run.text).map((character) => ({ text: character, font: run.font })) : [run],
        );
        const textWidth =
          laidOut.reduce((width, run) => width + run.font.widthOfTextAtSize(run.text, text.size * scale), 0) +
          Math.max(0, laidOut.length - 1) * tracking;
        if (text.anchor === "end") x -= textWidth;
        else if (text.anchor === "middle") x -= textWidth / 2;
        for (const run of laidOut) {
          page.drawText(run.text, {
            x,
            y: (scene.height - text.y) * scale,
            size: text.size * scale,
            font: run.font,
            color: ink(text.color ?? (scene.light ? "#0b0d0c" : "#ffffff")),
          });
          x += run.font.widthOfTextAtSize(run.text, text.size * scale) + tracking;
        }
      });
    };
    // A continued semantic paragraph belongs before new elements on this page.
    // Paint order does not change its measured visual coordinates.
    const existing = scene.texts.filter((text) => elements.has(text.role === "H1" ? "heading" : (text.group ?? "")));
    const order = [...elements.keys()];
    existing.sort(
      (a, b) =>
        order.indexOf(a.role === "H1" ? "heading" : a.group!) - order.indexOf(b.role === "H1" ? "heading" : b.group!),
    );
    for (const text of existing) drawText(text);
    for (const picture of scene.pictures) {
      const figure = tags.element("Figure", undefined, picture.alt);
      tags.content(figure, () => {});
    }
    for (const text of scene.texts) if (!existing.includes(text)) drawText(text);
    for (const text of promotionFooterTexts(scene, data.registrationUrl, data.measure ?? measure)) drawText(text);
    if (scene.qr) {
      const qr = tags.element("Figure", undefined, `QR code: register for this event at ${data.registrationUrl}`);
      tags.content(qr, () => {});
    }
    const link = tags.element("Link");
    const card = scene.registrationCard;
    const annotation = pdf.context.register(
      pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: card
          ? [
              card.x * scale,
              (scene.height - card.y - card.height) * scale,
              (card.x + card.width) * scale,
              (scene.height - card.y) * scale,
            ]
          : [44, 124, scene.width * scale - 44, 144],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(data.registrationUrl) },
      }),
    );
    page.node.addAnnot(annotation);
    tags.annotation(link, annotation);
  }
  structure.finish();
  return pdf.save();
}
