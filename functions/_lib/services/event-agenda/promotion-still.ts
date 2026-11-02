import { layoutPromotionSpeakerCredit } from "./promotion-speaker-credit";
import type { SessionAffiliation } from "../../../../assets/shared/schemas/event-session-history";
/** Standalone session artwork follows the supplied editorial still, independent of carousel pagination. */
import { initialsFrom } from "../../../../assets/shared/initials";
import { plainText } from "../../../../assets/shared/markdown-plain-text";
import type { PromotionComposition } from "../../../../assets/shared/schemas/event-promotion-design";
import type { PromotionDetail } from "./promotion-content-panels";
import type { PromotionRenderData } from "./promotion-render";
import type { PromotionMeasure, PromotionPage, PromotionText } from "./promotion-scene";
import { promotionBalancedLines, promotionMeasuredLines, promotionEllipsisLines } from "./promotion-text";

export interface PromotionStillContent {
  heading: string;
  people: {
    userId: string;
    displayName: string;
    affiliation: string;
    affiliations?: SessionAffiliation[];
    role?: string;
  }[];
  summary?: string;
  details?: string;
  picks?: { title: string }[];
  callToAction?: string;
}
interface SessionStillContent extends Omit<PromotionStillContent, "details"> {
  eyebrow: string;
  dates: string;
  details: PromotionDetail[];
}

export function layoutPromotionStill(
  content: SessionStillContent,
  data: PromotionRenderData,
  width: number,
  height: number,
  measure: PromotionMeasure,
  composition: PromotionComposition,
  add: (title: string) => PromotionPage,
): void {
  const scale = width / 1080;
  const compact = height < 800;
  const square = width === height;
  const densePanel = content.people.length >= 5;
  const margin = (compact ? 80 : 96) * scale;
  const usable = width - 2 * margin;
  const gap = (compact ? 14 : densePanel || square ? 20 : 24) * scale;
  const sponsorGroups = (data.sponsors ?? []).filter((group) => group.sponsors.length);
  const sponsorCount = sponsorGroups.reduce((count, group) => count + group.sponsors.length, 0);
  // The strip carries the leading tiers; the complete sponsor boards retain every eligible logo.
  const sponsors = composition.panels.includes("sponsors")
    ? (sponsorCount > 6 ? sponsorGroups.slice(0, 2) : sponsorGroups).flatMap((group) => group.sponsors).slice(0, 6)
    : [];
  const hasRegistration = composition.panels.includes("register");
  const qrReserve = composition.qrCode ? (compact ? 100 : 150) * scale : 0;
  const bandHeight =
    (sponsors.length
      ? compact
        ? 100
        : square
          ? 180
          : 200
      : hasRegistration || composition.qrCode
        ? compact
          ? 80
          : 140
        : 0) * scale;
  const bandTop = height - bandHeight;
  const bodyBottom = bandTop - (compact ? 8 : densePanel ? (square ? 40 : 64) : square ? 32 : 120) * scale;
  const logoY = (compact ? 28 : 56) * scale;
  const logoHeight = (compact ? 36 : 52) * scale;
  const headingTop = Math.max(
    (compact ? 72 : densePanel ? 120 : square ? 144 : 156) * scale,
    logoY + logoHeight + (compact ? 24 : 32) * scale,
  );
  const pages: PromotionPage[] = [];
  const makeBlock = (
    value: string,
    size: number,
    bold = false,
    mono = false,
    lineHeight = 1.25,
    tracking = 0,
    boxWidth = usable,
    balanced = false,
  ) => {
    const m = measure.metrics?.(size, bold, mono) ?? { ascent: size * 0.93, descent: -size * 0.24, lineGap: 0 };
    const leading = size * lineHeight;
    const split = balanced ? promotionBalancedLines : promotionMeasuredLines;
    return {
      lines: split(
        plainText(value),
        boxWidth,
        (line) => measure(line, size, bold, mono) + tracking * Array.from(line).length,
      ),
      size,
      bold,
      mono,
      tracking,
      leading,
      baseline: m.ascent + (leading - (m.ascent - m.descent)) / 2,
    };
  };
  type Block = ReturnType<typeof makeBlock>;
  const blockHeight = (block: Block) => block.lines.length * block.leading;
  const put = (
    page: PromotionPage,
    block: Block,
    x: number,
    top: number,
    role: PromotionText["role"] = "P",
    group?: string,
    color?: string,
  ) => {
    for (const [index, text] of block.lines.entries())
      page.texts.push({
        text,
        x,
        y: top + block.baseline + index * block.leading,
        size: block.size,
        bold: block.bold,
        mono: block.mono,
        letterSpacing: block.tracking,
        role,
        group,
        color,
      });
  };
  const newPage = () => {
    const page = add(content.heading);
    page.bars = [];
    page.still = {
      bandTop,
      logoY,
      logoHeight,
      motifHeight: compact ? 24 : densePanel ? (square ? 40 : 64) : square ? 32 : 120,
    };
    pages.push(page);
    const dateWidth = usable - (compact ? 230 : 270) * scale;
    let dateSize = (compact ? 14 : 20) * scale;
    let date = makeBlock(content.dates.toUpperCase(), dateSize, false, true, 1.25, dateSize * 0.1, dateWidth);
    while (date.lines.length > 1 && dateSize > 10 * scale) {
      dateSize -= scale;
      date = makeBlock(content.dates.toUpperCase(), dateSize, false, true, 1.25, dateSize * 0.1, dateWidth);
    }
    const dateTextWidth = Math.max(
      0,
      ...date.lines.map((line) => measure(line, date.size, false, true) + date.tracking * Array.from(line).length),
    );
    put(
      page,
      date,
      width - margin - dateTextWidth,
      page.still!.logoY + (page.still!.logoHeight - blockHeight(date)) / 2,
    );

    const actionTop = bandTop + (compact ? 18 : 26) * scale;
    const link = data.registrationUrl.replace(/^https?:\/\//u, "");
    if (hasRegistration) {
      put(page, makeBlock("Register", (compact ? 22 : 30) * scale, true), margin, actionTop, "P", undefined, "#0b0d0c");
      (page.arrows ??= []).push({
        x: margin + (compact ? 110 : 145) * scale,
        y: actionTop + (compact ? 13 : 18) * scale,
        length: 26 * scale,
        color: "#0b0d0c",
      });
      let size = (compact ? 16 : 24) * scale;
      while (measure(link, size, false, true) > usable - 220 * scale - qrReserve && size > 10 * scale) size -= scale;
      const linkBlock = makeBlock(link, size, false, true, 1.25, 0, usable - 220 * scale - qrReserve);
      const linkWidth = Math.max(0, ...linkBlock.lines.map((line) => measure(line, size, false, true)));
      put(page, linkBlock, width - margin - qrReserve - linkWidth, actionTop, "P", undefined, "#0b0d0c");
      page.registrationCard = {
        x: margin,
        y: actionTop,
        width: usable - qrReserve,
        height: (compact ? 28 : 44) * scale,
      };
    }
    if (sponsors.length) {
      const top = bandTop + (compact ? 56 : 98) * scale;
      (page.rules ??= []).push({ x: margin, y: top - 14 * scale, width: usable });
      const labelSize = (compact ? 10 : 14) * scale;
      const label = "SPONSORED BY";
      const labelWidth = measure(label, labelSize, false, true) + Array.from(label).length * scale;
      const maxHeight = (compact ? 22 : 40) * scale;
      const labelBlock = makeBlock(label, labelSize, false, true, 1.4, scale, labelWidth + 2 * scale);
      put(page, labelBlock, margin, top + (maxHeight - blockHeight(labelBlock)) / 2, "P", undefined, "#4a524f");
      const stripX = margin + labelWidth + 40 * scale;
      const cellWidth = (width - margin - qrReserve - stripX) / sponsors.length;
      for (const [index, sponsor] of sponsors.entries()) {
        const ratio = sponsor.aspectRatio && sponsor.aspectRatio > 0 ? sponsor.aspectRatio : 2.8;
        const logoHeight = Math.min(maxHeight, (cellWidth - 40 * scale) / ratio);
        const logoWidth = logoHeight * ratio;
        page.pictures.push({
          src: `data:image/svg+xml;base64,${sponsor.base64}`,
          x: stripX + index * cellWidth + (cellWidth - logoWidth) / 2,
          y: top + (maxHeight - logoHeight) / 2,
          width: logoWidth,
          height: logoHeight,
          alt: sponsor.name,
        });
      }
    }
    page.qr = composition.qrCode;
    return page;
  };
  let page = newPage();
  let y = headingTop;
  const eyebrow = makeBlock(
    content.eyebrow.toUpperCase(),
    (compact ? 14 : 20) * scale,
    false,
    true,
    1.25,
    (compact ? 1.2 : 2.4) * scale,
  );
  put(page, eyebrow, margin, y, "H2");
  y += blockHeight(eyebrow) + (compact ? 12 : 20) * scale;
  let titleSize =
    (compact
      ? content.people.length >= 5
        ? 22
        : content.people.length >= 3
          ? 28
          : 36
      : square
        ? densePanel
          ? 36
          : 50
        : densePanel
          ? 44
          : content.people.length >= 3
            ? 56
            : composition.stillLayout === "expanded"
              ? 72
              : 66) * scale;
  let title = makeBlock(content.heading, titleSize, true, false, 1.06, -0.03 * titleSize, usable, true);
  while (blockHeight(title) > (compact ? 100 : 245) * scale && titleSize > (compact ? 26 : 42) * scale) {
    titleSize -= scale;
    title = makeBlock(content.heading, titleSize, true, false, 1.06, -0.03 * titleSize, usable, true);
  }
  put(page, title, margin, y, "H1");
  y += blockHeight(title) + (compact ? 12 : 20) * scale;
  page.bars!.push({ x: margin, y, width: 160 * scale, height: 6 * scale, color: "url(#title-accent)" });
  y += 6 * scale + gap;

  const details = content.details.map((detail) => {
    const cellWidth = (usable - 3 * 32 * scale) / 4;
    return {
      label: makeBlock(
        detail.label.toUpperCase(),
        (compact ? 13 : 18) * scale,
        false,
        true,
        1.25,
        1.5 * scale,
        cellWidth,
      ),
      value: makeBlock(detail.value, (compact ? 19 : square ? 24 : 28) * scale, true, false, 1.15, 0, cellWidth),
      sub: makeBlock(detail.sub ?? "", (compact ? 14 : square ? 18 : 22) * scale, false, false, 1.25, 0, cellWidth),
    };
  });
  const detailsHeight = details.length
    ? Math.max(
        ...details.map((cell) => blockHeight(cell.label) + blockHeight(cell.value) + blockHeight(cell.sub) + 8 * scale),
      ) + gap
    : 0;
  const contentBottom = bodyBottom - detailsHeight - (details.length ? gap : 0);
  const continuePage = () => {
    page = newPage();
    y = headingTop;
  };
  const flowBlock = (block: Block, role: PromotionText["role"] = "P", group?: string, x = margin) => {
    for (const line of block.lines) {
      if (y + block.leading > contentBottom) continuePage();
      put(page, { ...block, lines: [line] }, x, y, role, group);
      y += block.leading;
    }
  };
  const columns = compact && densePanel ? 3 : content.people.length > 1 ? 2 : 1;
  const columnGap = (compact ? 32 : 48) * scale;
  const columnWidth = (usable - columnGap * (columns - 1)) / columns;
  const preparePeople = (factor: number) =>
    content.people.map((person) => {
      const portraitSize =
        (compact ? 64 : columns === 1 ? (square ? 160 : 200) : densePanel ? (square ? 112 : 128) : 144) * scale;
      const textWidth = columnWidth - portraitSize - 30 * scale;
      const name = makeBlock(
        person.displayName,
        (compact ? 22 : columns === 1 ? 34 : 28) * scale * factor,
        true,
        false,
        1.1,
        0,
        textWidth,
      );
      const affiliation = layoutPromotionSpeakerCredit(
        person,
        textWidth,
        (compact ? 16 : 24) * scale * factor,
        measure,
        compact ? (content.people.length >= 3 ? 1 : 2) : 3,
      );
      const moderator =
        person.role === "moderator"
          ? makeBlock(
              "MODERATOR",
              (compact ? 12 : 20) * scale * factor,
              false,
              true,
              1.25,
              1.8 * scale * factor,
              textWidth,
            )
          : null;
      const textHeight =
        blockHeight(name) +
        (affiliation.lines.length ? 4 * scale + affiliation.height : 0) +
        (moderator ? blockHeight(moderator) + 4 * scale : 0);
      return {
        person,
        portraitSize,
        name,
        affiliation,
        moderator,
        textHeight,
        height: Math.max(portraitSize, textHeight),
      };
    });
  const summaryReserve = content.summary
    ? Math.min(
        blockHeight(makeBlock(content.summary, (compact ? 16 : 22) * scale, false, false, 1.45)),
        (compact ? 48 : 120) * scale,
      ) + gap
    : 0;
  const peopleHeight = (cells: ReturnType<typeof preparePeople>) => {
    let height = 0;
    for (let offset = 0; offset < cells.length; offset += columns)
      height += Math.max(...cells.slice(offset, offset + columns).map((cell) => cell.height)) + gap;
    return height;
  };
  let prepared = preparePeople(1);
  for (const factor of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45]) {
    if (
      peopleHeight(prepared) + summaryReserve <= contentBottom - y ||
      prepared.every((cell) => cell.textHeight <= cell.portraitSize)
    )
      break;
    prepared = preparePeople(factor);
  }
  for (let offset = 0; offset < content.people.length; offset += columns) {
    const cells = prepared.slice(offset, offset + columns);
    const rowHeight = Math.max(...cells.map((cell) => cell.height));
    if (rowHeight > contentBottom - headingTop) {
      // Extremely long canonical credits continue as text; nothing is clipped or shortened.
      for (const cell of cells) {
        flowBlock(makeBlock(cell.person.displayName, cell.name.size, true), "H2");
        y += 4 * scale;
        flowBlock(makeBlock(cell.person.affiliation, cell.affiliation.size));
        y += gap;
      }
      continue;
    }
    if (y + rowHeight > contentBottom) continuePage();
    for (const [column, cell] of cells.entries()) {
      const x = margin + column * (columnWidth + columnGap);
      const photo = data.portraits?.[cell.person.userId] ?? "";
      page.pictures.push({
        src: photo,
        x: x + 5 * scale,
        y: y + (rowHeight - cell.portraitSize) / 2,
        width: cell.portraitSize,
        height: cell.portraitSize,
        ringWidth: 5 * scale,
        circle: true,
        alt: cell.person.displayName,
      });
      if (!photo) {
        const monogram = makeBlock(initialsFrom(cell.person.displayName), cell.portraitSize * 0.28, true);
        put(
          page,
          monogram,
          x + 5 * scale + cell.portraitSize / 2 - measure(monogram.lines[0] ?? "", monogram.size, true) / 2,
          y + (rowHeight - blockHeight(monogram)) / 2,
        );
      }
      const textX = x + cell.portraitSize + 30 * scale;
      let textY = y + (rowHeight - cell.textHeight) / 2;
      const group = `speaker-${offset + column}`;
      if (cell.moderator) {
        put(page, cell.moderator, textX, textY, "P", undefined, "#ffd2b0");
        textY += blockHeight(cell.moderator) + 4 * scale;
      }
      put(page, cell.name, textX, textY, "H2", group);
      textY += blockHeight(cell.name) + 4 * scale;
      for (const line of cell.affiliation.lines) page.texts.push({ ...line, x: textX, y: textY + line.y, group });
    }
    y += rowHeight + gap;
  }
  if (content.summary) {
    let size = (compact ? 18 : 26) * scale;
    let summary = makeBlock(content.summary, size, false, false, 1.45);
    while (blockHeight(summary) > contentBottom - y && size > (compact ? 16 : 22) * scale) {
      size -= scale;
      summary = makeBlock(content.summary, size, false, false, 1.45);
    }
    summary.lines = promotionEllipsisLines(
      summary.lines,
      Math.max(0, Math.floor((contentBottom - y) / summary.leading)),
      usable,
      (line) => measure(line, size, false),
    );
    flowBlock(summary, "P", "session-abstract");
    y += gap;
  }
  for (const pick of content.picks ?? []) {
    flowBlock(makeBlock(pick.title, (compact ? 22 : 30) * scale, true), "P");
    y += gap;
  }
  // The metadata rail stays above the skyline on every standalone card.
  if (details.length)
    for (const current of pages) {
      const top = bodyBottom - detailsHeight;
      current.bars!.push({ x: margin, y: top, width: usable, height: 2 * scale, color: "#ffffff", opacity: 0.35 });
      for (const [index, cell] of details.entries()) {
        const x = margin + (index * (usable + 32 * scale)) / 4;
        let topY = top + gap;
        put(current, cell.label, x, topY);
        topY += blockHeight(cell.label) + 4 * scale;
        put(current, cell.value, x, topY);
        topY += blockHeight(cell.value) + 4 * scale;
        put(current, cell.sub, x, topY);
      }
    }
}
