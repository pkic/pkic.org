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
  const font = await pdf.embedFont(fontBytes, { subset: true }),
    bold = await pdf.embedFont(boldBytes, { subset: true });
  const fallbacks = await Promise.all(fallbackBytes.map((bytes) => pdf.embedFont(bytes, { subset: false })));
  const fonts = [font, bold, ...fallbacks],
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
  const scenes = buildPromotionPages(data, "carousel", measure),
    structure = promotionPdfStructure(pdf);
  let mainHeading: import("pdf-lib").PDFDict | undefined;
  const elements = new Map<string, import("pdf-lib").PDFDict>();
  for (const scene of scenes) {
    const scale = 0.5,
      page = pdf.addPage([scene.width * scale, scene.height * scale]),
      tags = structure.page(page);
    if (rasterize) {
      const image = await pdf.embedPng(await rasterize(promotionSceneSvg(data, scene, false)));
      tags.artifact(() => page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() }));
    } else {
      tags.artifact(() => {
        page.drawRectangle({
          x: 0,
          y: 0,
          width: page.getWidth(),
          height: page.getHeight(),
          color: ink(scene.light ? "#ffffff" : "#125c3c"),
        });
      });
      if (data.logoPng && scene.index === 0) {
        const logo = await pdf.embedPng(data.logoPng);
        tags.artifact(() => page.drawImage(logo, { x: 40, y: page.getHeight() - 50, width: 118, height: 31 }));
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
        for (const run of runs(text.text, text.bold ? bold : font)) {
          page.drawText(run.text, {
            x,
            y: (scene.height - text.y) * scale,
            size: text.size * scale,
            font: run.font,
            color: ink(text.color ?? (scene.light ? "#0b0d0c" : "#ffffff")),
          });
          x += run.font.widthOfTextAtSize(run.text, text.size * scale);
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
    const footer = tags.element("P");
    tags.content(footer, () =>
      page.drawText(`${scene.index + 1} / ${scene.total}`, { x: 40, y: 90, size: 11, font, color: rgb(1, 1, 1) }),
    );
    if (scene.index === 0 && scene.total > 1)
      tags.content(footer, () =>
        page.drawText("SWIPE", { x: (scene.width - 380) * scale, y: 90, size: 11, font, color: rgb(1, 1, 1) }),
      );
    if (scene.qr) {
      const qr = tags.element("Figure", undefined, `QR code: register for this event at ${data.registrationUrl}`);
      tags.content(qr, () => {});
    }
    const link = tags.element("Link");
    const annotation = pdf.context.register(
      pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [40, 35, page.getWidth() - 40, 65],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(data.registrationUrl) },
      }),
    );
    page.node.addAnnot(annotation);
    tags.annotation(link, annotation);
    tags.content(link, () =>
      page.drawText(data.registrationUrl, {
        x: 40,
        y: 45,
        size: Math.min(10, (page.getWidth() - 80) / Math.max(1, measure(data.registrationUrl, 1, false))),
        font,
        color: rgb(1, 1, 1),
      }),
    );
  }
  structure.finish();
  return pdf.save();
}
