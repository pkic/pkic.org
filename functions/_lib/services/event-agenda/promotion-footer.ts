import type { PromotionMeasure, PromotionPage, PromotionText } from "./promotion-scene";

/** SVG and PDF use the same measured footer positions and typography. */
export function promotionFooterTexts(
  page: PromotionPage,
  registrationUrl: string,
  measure: PromotionMeasure = (text, size) => Array.from(text).length * size * 0.55,
): PromotionText[] {
  if (!page.carousel) return [];
  const base = {
    y: 1094,
    size: 24,
    bold: false,
    mono: true,
    letterSpacing: 2.88,
    role: "P" as const,
    color: "#ffffff",
  };
  const texts: PromotionText[] = [{ ...base, text: `${page.index + 1} / ${page.total}`, x: 88 }];
  if (page.index === 0 && page.total > 1) texts.push({ ...base, text: "SWIPE", x: page.width - 146, anchor: "end" });
  if (page.index === page.total - 1) {
    let size = 18;
    while (measure(registrationUrl, size, false) > page.width - 300 && size > 10) size--;
    texts.push({
      text: registrationUrl,
      x: page.width - 88,
      y: base.y,
      size,
      bold: false,
      role: "P",
      anchor: "end",
      color: "#ffffff",
    });
  }
  return texts;
}

/** Draw the source arrow as artwork because the pinned body fonts do not contain U+2192. */
export function promotionFooterArrows(page: PromotionPage): NonNullable<PromotionPage["arrows"]> {
  return page.carousel && page.index === 0 && page.total > 1
    ? [{ x: page.width - 120, y: 1086, length: 32, color: "#ffffff" }]
    : [];
}
