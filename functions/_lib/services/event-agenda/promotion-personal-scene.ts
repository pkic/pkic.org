import { svgLogoDimensions } from "../../utils/svg-logo";
import { bytesToBase64 } from "../../../../assets/shared/base64";
import type { PersonalPromotionRenderData, PromotionMeasure, PromotionPage, PromotionText } from "./promotion-scene";
import { promotionMeasuredLines } from "./promotion-text";

/** The personal still uses the same scene primitives, artwork and export adapters as the carousel. */
export function layoutPersonalPromotion(
  data: PersonalPromotionRenderData,
  width: number,
  height: number,
  measure: PromotionMeasure,
): PromotionPage {
  const scale = width / 1080;
  const margin = 80 * scale;
  const person = data.personal.people[0];
  const portrait = person && data.portraits?.[person.userId];
  const bodyWidth = width - margin * 2 - (portrait ? 320 * scale : 0);
  const page: PromotionPage = {
    title: data.personal.eventName,
    texts: [],
    pictures: [],
    index: 0,
    total: 1,
    width,
    height,
    still: true,
    markX: width - 460 * scale,
  };
  const text = (
    value: string,
    top: number,
    availableHeight: number,
    maximum: number,
    bold: boolean,
    role: PromotionText["role"],
    singleLine = false,
  ) => {
    if (!value) return;
    for (let size = maximum; size >= 1; size -= 1) {
      const lines = promotionMeasuredLines(value, bodyWidth, (line) => measure(line, size, bold));
      if ((singleLine && lines.length !== 1) || lines.length * size * 1.18 > availableHeight) continue;
      lines.forEach((line, index) =>
        page.texts.push({ text: line, x: margin, y: top + size + index * size * 1.18, size, bold, role }),
      );
      return;
    }
    throw new Error("Personal promotion text does not fit the image.");
  };
  text(
    (data.personal.firstName?.trim() || person?.displayName?.trim() || "Event participant").toLocaleUpperCase("en-US"),
    130,
    125,
    115 * scale,
    true,
    "H1",
    true,
  );
  text(data.personal.heading, 264, 42, 30 * scale, false, "H2");
  text(person?.displayName ?? "", 323, 55, 29 * scale, true, "P");
  text(person?.affiliation ?? "", 378, 51, 22 * scale, false, "P");
  text(data.personal.eventName, 436, 61, 27 * scale, true, "H2");
  text(data.personal.details ?? "", 502, height - 95 - 502, 18 * scale, false, "P");
  page.bars = [{ x: margin, y: 308, width: 200 * scale, height: 6 * scale, color: "url(#accent)" }];
  if (portrait)
    page.pictures.push({
      src: portrait,
      x: width - margin - 260 * scale,
      y: 175,
      width: 260 * scale,
      height: 260 * scale,
      circle: true,
      alt: person.displayName,
    });
  const sponsors = data.sponsorGroups?.find((group) => group.sponsors.length)?.sponsors ?? [];
  if (sponsors.length) {
    const shown = sponsors.slice(0, 6);
    const cell = (width - margin * 2 - 110) / shown.length;
    page.footerPictures = shown.map((sponsor, index) => {
      const dimensions = svgLogoDimensions(sponsor.svg);
      const aspect = dimensions ? dimensions.width / dimensions.height : 2.8;
      const logoHeight = Math.min(22, (cell - 32) / aspect);
      const logoWidth = logoHeight * aspect;
      return {
        src: `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(sponsor.svg))}`,
        x: margin + 110 + cell * index + (cell - logoWidth) / 2,
        y: height - 34 + (22 - logoHeight) / 2,
        width: logoWidth,
        height: logoHeight,
        alt: sponsor.name,
      };
    });
  }
  return page;
}
