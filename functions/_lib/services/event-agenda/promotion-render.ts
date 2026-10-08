import { promotionPdfStructure } from "./promotion-pdf-structure";
import QRCode from "qrcode";
import { PDFDocument, PDFName, PDFString, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { themes, publicationBrand } from "../../../../assets/design/tokens";
import { formatDateRange } from "../../../../assets/shared/format-date";
import type { PromotionCopy } from "../../../../assets/shared/schemas/event-promotion-kit";
import type { AgendaOccurrence, AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
export interface PromotionRenderData {
  agenda: AgendaSnapshot;
  occurrence: AgendaOccurrence;
  copy: PromotionCopy;
  sessionUrl: string;
  registrationUrl: string;
  logoDataUrl?: string;
  logoPng?: Uint8Array;
  actorId?: string;
  portraits?: Record<string, string>;
  cardLines?: Array<{
    text: string;
    kind: "title" | "name" | "affiliation" | "narrative";
    initial?: string;
    userId?: string;
  }>;
  cardPage?: number;
  cardPageCount?: number;
}
export const promotionDimensions = {
  landscape: [1200, 630],
  square: [1080, 1080],
  portrait: [1080, 1350],
  panel: [1200, 630],
  carousel: [1080, 1350],
} as const;
function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!,
  );
}
export function promotionMeasuredLines(text: string, width: number, measure: (text: string) => number): string[] {
  const result: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line) {
      result.push(line);
      line = "";
    }
    for (const glyph of Array.from(word)) {
      if (line && measure(line + glyph) > width) {
        result.push(line);
        line = "";
      }
      line += glyph;
    }
  }
  if (line) result.push(line);
  return result;
}
export function promotionPdfBodyPages(blocks: string[][], firstCapacity: number, continuedCapacity: number) {
  const pages: string[][] = [];
  let page: string[] = [];
  const capacity = () => (pages.length ? continuedCapacity : firstCapacity);
  const finish = () => {
    pages.push(page);
    page = [];
  };
  for (const block of blocks) {
    let remaining = block;
    if (page.length && page.length + 1 + remaining.length > capacity()) finish();
    // A complete credit that fits a continuation page should not be split by a taller first heading.
    if (!page.length && remaining.length > capacity() && remaining.length <= continuedCapacity) finish();
    while (remaining.length > capacity()) {
      page = remaining.slice(0, capacity());
      remaining = remaining.slice(capacity());
      finish();
    }
    if (remaining.length) {
      if (page.length) page.push("");
      page.push(...remaining);
    }
  }
  if (page.length) finish();
  return pages;
}
function sessionClock(data: PromotionRenderData): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: data.agenda.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${formatter.format(new Date(data.occurrence.startAt!))}–${formatter.format(new Date(data.occurrence.endAt!))}`;
}
export function promotionLines(text: string, maxCharacters: number): string[] {
  const words = text
    .trim()
    .split(/\s+/u)
    .flatMap((word) => {
      const glyphs = Array.from(word);
      const chunks: string[] = [];
      for (let i = 0; i < glyphs.length; i += maxCharacters) chunks.push(glyphs.slice(i, i + maxCharacters).join(""));
      return chunks;
    });
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && Array.from(`${line} ${word}`).length > maxCharacters) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}
function qrSvg(url: string, x: number, y: number, size: number) {
  const code = QRCode.create(url, { errorCorrectionLevel: "M" });
  const scale = size / (code.modules.size + 8);
  let squares = "";
  for (let row = 0; row < code.modules.size; row++)
    for (let col = 0; col < code.modules.size; col++)
      if (code.modules.get(row, col))
        squares += `<rect x="${x + (col + 4) * scale}" y="${y + (row + 4) * scale}" width="${scale}" height="${scale}"/>`;
  return `<g fill="${themes.light.ink}"><rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${themes.light.surface}"/>${squares}</g>`;
}
export function renderPromotionSvg(
  data: PromotionRenderData,
  format: Exclude<keyof typeof promotionDimensions, "carousel">,
): string {
  const [width, height] = promotionDimensions[format];
  const narrow = width === 1080;
  const credits = data.occurrence.history?.appearances.length
    ? data.occurrence.history.appearances
    : data.occurrence.speakers;
  const title = promotionLines(data.occurrence.title, narrow ? 42 : 60);
  const titleSize = Math.max(24, Math.min(48, 144 / title.length));
  const text = (value: string, x: number, y: number, size: number, weight = 400) =>
    `<text x="${x}" y="${y}" font-family="Roboto, Noto Sans SC, Noto Emoji" font-size="${size}" font-weight="${weight}" fill="${themes.dark.ink}">${escape(value)}</text>`;
  let y = 160;
  const titleText = title
    .map((line) => {
      const output = text(line, 64, y, titleSize, 700);
      y += titleSize * 1.2;
      return output;
    })
    .join("");
  y += 28;
  const columns = (!narrow && credits.length > 1) || credits.length > 3 ? 2 : 1;
  let rowHeight = 0;
  const blocks: string[] = [];
  for (const [index, credit] of credits.entries()) {
    const x = 64 + ((index % columns) * (width - 128)) / columns;
    if (index % columns === 0 && index > 0) {
      y += rowHeight + 20;
      rowHeight = 0;
    }
    const top = y;
    let cursor = top;
    const name = promotionLines(credit.displayName, columns === 2 ? 28 : 44)
      .map((line) => {
        const value = text(line, x + 52, cursor, columns === 2 ? 24 : 30, 700);
        cursor += columns === 2 ? 29 : 36;
        return value;
      })
      .join("");
    const affiliation =
      "organizationName" in credit
        ? ["jobTitle" in credit ? credit.jobTitle : null, credit.organizationName].filter(Boolean).join(" · ")
        : "";
    const roles = promotionLines(affiliation, columns === 2 ? 38 : 58)
      .map((line) => {
        const value = text(line, x + 52, cursor, 20);
        cursor += 26;
        return value;
      })
      .join("");
    const initial = Array.from(credit.displayName).slice(0, 1).join("");
    blocks.push(
      `<circle cx="${x + 18}" cy="${top - 10}" r="20" fill="${themes.dark.surface}"/>${text(initial, x + 10, top - 3, 22, 700)}${name}${roles}`,
    );
    rowHeight = Math.max(rowHeight, cursor - top);
  }

  const people = blocks.join("");
  let lineY = 160;
  const paginatedBody = data.cardLines
    ?.map((line) => {
      const size = line.kind === "title" ? 36 : line.kind === "name" ? 28 : line.kind === "narrative" ? 24 : 22;
      const portrait = line.initial
        ? line.userId && data.portraits?.[line.userId]
          ? `<image x="64" y="${lineY - 28}" width="36" height="36" href="${escape(data.portraits[line.userId]!)}"/>`
          : `<circle cx="82" cy="${lineY - 10}" r="18" fill="${themes.dark.surface}"/>${text(line.initial, 73, lineY - 3, 20, 700)}`
        : "";
      const row =
        portrait +
        text(
          line.text,
          line.kind === "name" ? 116 : 64,
          lineY,
          size,
          line.kind === "affiliation" || line.kind === "narrative" ? 400 : 700,
        );
      lineY += size * 1.25;
      return row;
    })
    .join("");
  const band = publicationBrand.accentStops
    .map(
      (color, index) =>
        `<rect x="${(index * width) / publicationBrand.accentStops.length}" y="0" width="${width / publicationBrand.accentStops.length + 1}" height="10" fill="${color}"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(data.occurrence.title)}"><defs><linearGradient id="brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${publicationBrand.accentStops[0]}"/><stop offset="50%" stop-color="${publicationBrand.accentStops[2]}"/><stop offset="100%" stop-color="${publicationBrand.accentStops[4]}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#brand)"/><rect width="${width}" height="${height}" fill="${publicationBrand.background}" opacity="0.72"/>${band}${data.logoDataUrl ? `<image x="64" y="32" width="240" height="62" href="${escape(data.logoDataUrl)}"/>` : text("PKI CONSORTIUM", 64, 70, 26, 700)}${text((data.agenda.eventName ?? "").length > Math.floor((width - 128) / 24) ? "PKI Consortium event" : (data.agenda.eventName ?? "PKI Consortium event"), 64, 115, 24)}${paginatedBody ?? titleText + people}${text(formatDateRange(data.occurrence.startAt, data.occurrence.endAt, data.agenda.timeZone), 64, height - 120, 23)}${text(`${sessionClock(data)} · ${data.agenda.timeZone}`, 64, height - 85, 20)}${text(data.copy.callToAction.length <= Math.floor((width - 300) / 24) ? data.copy.callToAction : "Register for this event", 64, height - 40, 24, 700)}${qrSvg(data.registrationUrl, width - 180, height - 170, 120)}${data.cardPageCount && data.cardPageCount > 1 ? text(`${data.cardPage} / ${data.cardPageCount}`, width - 175, 115, 20) : ""}</svg>`;
}
/** Flow full titles and credits across fixed-aspect cards rather than clipping small type. */
export function promotionCardPages(
  data: PromotionRenderData,
  format: Exclude<keyof typeof promotionDimensions, "carousel">,
): PromotionRenderData[] {
  const [width, height] = promotionDimensions[format];
  const allCredits = data.occurrence.history?.appearances.length
    ? data.occurrence.history.appearances
    : data.occurrence.speakers;
  const credits =
    format === "panel"
      ? allCredits
      : [allCredits.find((credit) => credit.userId === data.actorId) ?? allCredits[0]].filter(
          (credit): credit is NonNullable<typeof credit> => Boolean(credit),
        );
  const lines: NonNullable<PromotionRenderData["cardLines"]> = promotionLines(
    data.occurrence.title,
    Math.floor((width - 128) / 36),
  ).map((text) => ({ text, kind: "title" }));
  if ((data.agenda.eventName ?? "").length > Math.floor((width - 128) / 24))
    lines.unshift(
      ...promotionLines(data.agenda.eventName!, Math.floor((width - 128) / 22)).map((text) => ({
        text,
        kind: "affiliation" as const,
      })),
    );
  for (const credit of credits) {
    lines.push(
      ...promotionLines(credit.displayName, Math.floor((width - 184) / 28)).map((text, index) => ({
        text,
        kind: "name" as const,
        userId: credit.userId,
        ...(index === 0 ? { initial: Array.from(credit.displayName)[0] ?? "" } : {}),
      })),
    );
    if ("organizationName" in credit) {
      const role = ["jobTitle" in credit ? credit.jobTitle : null, credit.organizationName].filter(Boolean).join(" · ");
      lines.push(
        ...promotionLines(role, Math.floor((width - 128) / 22)).map((text) => ({ text, kind: "affiliation" as const })),
      );
    }
  }
  for (const narrative of [
    data.copy.whyAttend,
    ...data.copy.takeaways.map((takeaway, index) => `${index + 1}. ${takeaway}`),
    data.copy.callToAction,
  ]) {
    lines.push(
      ...promotionLines(narrative, Math.floor((width - 128) / 24)).map((text) => ({
        text,
        kind: "narrative" as const,
      })),
    );
  }
  const pages: NonNullable<PromotionRenderData["cardLines"]>[] = [];
  let page: NonNullable<PromotionRenderData["cardLines"]> = [];
  let y = 160;
  for (const line of lines) {
    const size = line.kind === "title" ? 36 : line.kind === "name" ? 28 : line.kind === "narrative" ? 24 : 22;
    if (y + size * 1.25 > height - 175 && page.length) {
      pages.push(page);
      page = [];
      y = 160;
    }
    page.push(line);
    y += size * 1.25;
  }
  if (page.length) pages.push(page);
  return pages.map((cardLines, index) => ({ ...data, cardLines, cardPage: index + 1, cardPageCount: pages.length }));
}
function hexRgb(hex: string) {
  return rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
}
export async function renderPromotionPdf(
  data: PromotionRenderData,
  fontBytes: Uint8Array,
  boldBytes: Uint8Array,
  fallbackBytes: Uint8Array[] = [],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`${data.occurrence.title} · ${data.agenda.eventName ?? "PKI Consortium"}`);
  pdf.setLanguage("en-US");
  pdf.setCreator("PKI Consortium");
  const structure = promotionPdfStructure(pdf);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const fallbacks = await Promise.all(fallbackBytes.map((bytes) => pdf.embedFont(bytes, { subset: false })));
  const characterSets = new Map(
    [font, bold, ...fallbacks].map((candidate) => [candidate, new Set(candidate.getCharacterSet())]),
  );
  function runs(text: string, primary: PDFFont) {
    const result: Array<{ text: string; font: PDFFont }> = [];
    for (const character of text) {
      const code = character.codePointAt(0)!;
      const selected = [primary, ...fallbacks].find((candidate) => characterSets.get(candidate)!.has(code));
      if (!selected) throw new Error(`Unsupported promotion character U+${code.toString(16).toUpperCase()}`);
      const last = result[result.length - 1];
      if (last?.font === selected) last.text += character;
      else result.push({ text: character, font: selected });
    }
    return result;
  }
  const measure = (text: string, primary: PDFFont, size: number) =>
    runs(text, primary).reduce((width, run) => width + run.font.widthOfTextAtSize(run.text, size), 0);
  function draw(page: PDFPage, text: string, primary: PDFFont, size: number, x: number, y: number) {
    for (const run of runs(text, primary)) {
      page.drawText(run.text, { x, y, font: run.font, size, color: hexRgb(themes.dark.ink) });
      x += run.font.widthOfTextAtSize(run.text, size);
    }
  }

  const people = data.occurrence.history?.appearances.length
    ? data.occurrence.history.appearances
    : data.occurrence.speakers;
  const pages = [
    { title: data.occurrence.title, body: data.copy.whyAttend },
    {
      title: "What you will take away",
      body: data.copy.takeaways.map((item, index) => `${index + 1}. ${item}`).join("\n\n"),
    },
    {
      title: people.length > 1 ? "Meet the panel" : "Meet the speaker",
      body: people
        .map((person) =>
          [
            person.displayName,
            "jobTitle" in person ? person.jobTitle : null,
            "organizationName" in person ? person.organizationName : null,
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n\n"),
    },
    {
      title: data.copy.callToAction,
      body: [
        data.agenda.eventName,
        formatDateRange(data.occurrence.startAt, data.occurrence.endAt, data.agenda.timeZone),
        `${sessionClock(data)} · ${data.agenda.timeZone}`,
        "Check the session page for the latest time and location.",
        data.sessionUrl,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
  const flowingPages: Array<{ title: string; body: string }> = [];
  for (const content of pages) {
    const blocks = content.body
      .split("\n\n")
      .map((block) =>
        block
          .split("\n")
          .flatMap((paragraph) => promotionMeasuredLines(paragraph, 468, (text) => measure(text, font, 17))),
      );
    const titleLines = promotionMeasuredLines(content.title, 468, (text) => measure(text, bold, 27));
    let title = titleLines.splice(0, 9).join("\n");
    while (titleLines.length) {
      flowingPages.push({ title, body: "" });
      title = titleLines.splice(0, 9).join("\n");
    }
    const continuedTitle =
      content.title === data.occurrence.title ? "Why attend · continued" : `${content.title} · continued`;
    const capacity = (heading: string) => {
      const titleHeight = promotionMeasuredLines(heading, 468, (text) => measure(text, bold, 27)).length * 34;
      return Math.max(1, Math.floor((570 - titleHeight - 28 - 95) / 34));
    };
    for (const body of promotionPdfBodyPages(blocks, capacity(title), capacity(continuedTitle))) {
      flowingPages.push({ title, body: body.join("\n") });
      title = continuedTitle;
    }
  }
  const logo = data.logoPng ? await pdf.embedPng(data.logoPng) : null;
  const ink = hexRgb(themes.dark.ink);
  for (const [index, content] of flowingPages.entries()) {
    const page = pdf.addPage([540, 675]);
    const semantic = structure.page(page);
    semantic.artifact(() => {
      page.drawRectangle({ x: 0, y: 0, width: 540, height: 675, color: hexRgb(themes.dark.canvas) });
      for (const [i, color] of publicationBrand.accentStops.entries())
        page.drawRectangle({ x: i * 90, y: 669, width: 90, height: 6, color: hexRgb(color) });
      if (logo) {
        page.drawImage(logo, { x: 36, y: 613, width: 180, height: 46 });
      } else page.drawText("PKI CONSORTIUM", { x: 36, y: 630, font: bold, size: 16, color: ink });
    });
    const heading = semantic.element(index === 0 ? "H1" : "H2");
    let y = 570;
    for (const line of promotionMeasuredLines(content.title, 468, (text) => measure(text, bold, 27))) {
      semantic.content(heading, () => draw(page, line, bold, 27, 36, y));
      y -= 34;
    }
    y -= 28;
    const list = content.title.startsWith("What you will take away") ? semantic.element("L") : null;
    let listBody: ReturnType<typeof semantic.element> | null = null;
    for (const paragraph of content.body.split("\n")) {
      if (list && /^\d+\./u.test(paragraph)) listBody = semantic.element("LBody", semantic.element("LI", list));
      const block = listBody ?? semantic.element("P");
      for (const line of promotionMeasuredLines(paragraph, 468, (text) => measure(text, font, 17))) {
        if (y < 95) throw new Error("Promotion copy is too long for this layout. Shorten it before exporting.");
        semantic.content(block, () => draw(page, line, font, 17, 36, y));
        y -= 24;
      }
      y -= 10;
    }
    semantic.artifact(() =>
      page.drawText(`${index + 1} / ${flowingPages.length}`, { x: 462, y: 28, font, size: 10, color: ink }),
    );
    if (index === flowingPages.length - 1) {
      const qrFigure = semantic.element(
        "Figure",
        undefined,
        `QR code: register for this event at ${data.registrationUrl}`,
      );
      semantic.content(qrFigure, () => {
        const qr = QRCode.create(data.registrationUrl, { errorCorrectionLevel: "M" });
        const unit = 84 / (qr.modules.size + 8);
        page.drawRectangle({ x: 420, y: 92, width: 84, height: 84, color: rgb(1, 1, 1) });
        for (let row = 0; row < qr.modules.size; row++)
          for (let col = 0; col < qr.modules.size; col++)
            if (qr.modules.get(row, col))
              page.drawRectangle({
                x: 420 + (col + 4) * unit,
                y: 92 + (qr.modules.size + 3 - row) * unit,
                width: unit,
                height: unit,
                color: rgb(0, 0, 0),
              });
      });
      const link = semantic.element("Link", undefined, "Register for this event");
      const target = pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [36, 45, 504, 78],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(data.registrationUrl) },
      });
      const ref = pdf.context.register(target);
      page.node.set(PDFName.of("Annots"), pdf.context.obj([ref]));
      semantic.annotation(link, ref);
      semantic.content(link, () =>
        page.drawText("Register for this event", { x: 36, y: 58, font: bold, size: 16, color: ink }),
      );
    }
  }
  structure.finish();
  return pdf.save();
}
