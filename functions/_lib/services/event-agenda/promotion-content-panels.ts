import type { PromotionPage, PromotionText, PromotionMeasure } from "./promotion-scene";
import { promotionMeasuredLines } from "./promotion-text";

type AddPage = (title: string) => PromotionPage;
function text(
  page: PromotionPage,
  value: string,
  x: number,
  y: number,
  size: number,
  role: PromotionText["role"] = "P",
  bold = false,
  group?: string,
) {
  page.texts.push({ text: value, x, y, size, role, bold, ...(group ? { group } : {}) });
}
/** Bottom-aligned editorial list, with a separate numbered accent rail as in the event artwork. */
export function layoutPromotionTakeaways(
  items: string[],
  add: AddPage,
  measure: PromotionMeasure,
  scale: number,
  rightInset: number,
) {
  const width = 820 * scale - rightInset;
  const prepared = items.map((value, index) => ({
    index,
    lines: promotionMeasuredLines(value, width - 112 * scale, (line) => measure(line, 40 * scale, false)),
  }));
  let offset = 0;
  while (offset < prepared.length) {
    let end = offset,
      bodyHeight = 0;
    while (end < prepared.length) {
      const height = prepared[end]!.lines.length * 48 * scale + 32 * scale;
      if (end > offset && bodyHeight + height > 650 * scale) break;
      bodyHeight += height;
      end++;
    }
    const page = add("Key takeaways"),
      top = Math.max(88 * scale, 952 * scale - 160 * scale - bodyHeight);
    text(page, "WHAT YOU’LL TAKE AWAY", 88 * scale, top + 24 * scale, 24 * scale);
    text(page, "Key takeaways", 88 * scale, top + 116 * scale, 72 * scale, "H2", true);
    let y = top + 200 * scale;
    for (const item of prepared.slice(offset, end)) {
      text(page, String(item.index + 1).padStart(2, "0"), 88 * scale, y - 10 * scale, 30 * scale, "P", true);
      (page.bars ??= []).push({
        x: 88 * scale,
        y,
        width: 56 * scale,
        height: 6 * scale,
        color: ["#198754", "#5a9bd5", "#ed7d31"][item.index % 3]!,
      });
      for (const [line, value] of item.lines.entries())
        text(page, value, 200 * scale, y + line * 48 * scale, 40 * scale, "LI", false, `takeaway-${item.index}`);
      y += item.lines.length * 48 * scale + 32 * scale;
    }
    offset = end;
  }
}
export interface PromotionDetail {
  label: string;
  value: string;
  sub?: string;
}
/** Two-column metadata grid with real labels and measured values; long rows continue intact. */
export function layoutPromotionDetails(
  details: PromotionDetail[],
  add: AddPage,
  measure: PromotionMeasure,
  scale: number,
  rightInset: number,
) {
  const width = (904 * scale - rightInset - 48 * scale) / 2;
  const rows = [];
  for (let index = 0; index < details.length; index += 2) {
    const cells = details.slice(index, index + 2).map((detail) => ({
      ...detail,
      lines: promotionMeasuredLines(detail.value, width, (line) => measure(line, 44 * scale, true)),
      subs: promotionMeasuredLines(detail.sub ?? "", width, (line) => measure(line, 28 * scale, false)),
    }));
    rows.push({
      cells,
      height: Math.max(...cells.map((cell) => (76 + cell.lines.length * 49 + cell.subs.length * 36) * scale)),
    });
  }
  let offset = 0;
  while (offset < rows.length) {
    let end = offset,
      height = 0;
    while (end < rows.length && (end === offset || height + rows[end]!.height <= 650 * scale))
      height += rows[end++]!.height;
    const page = add("When & where"),
      top = Math.max(88 * scale, 952 * scale - 206 * scale - height);
    text(page, "WHEN & WHERE", 88 * scale, top + 24 * scale, 24 * scale);
    text(page, "Save your seat", 88 * scale, top + 116 * scale, 72 * scale, "H2", true);
    (page.bars ??= []).push({
      x: 88 * scale,
      y: top + 164 * scale,
      width: 904 * scale - rightInset,
      height: 2 * scale,
      color: "#ffffff",
      opacity: 0.35,
    });
    let y = top + 206 * scale;
    for (const row of rows.slice(offset, end)) {
      for (const [column, cell] of row.cells.entries()) {
        const x = 88 * scale + column * (width + 48 * scale);
        text(page, cell.label.toUpperCase(), x, y + 22 * scale, 22 * scale);
        for (const [line, value] of cell.lines.entries())
          text(page, value, x, y + (76 + line * 49) * scale, 44 * scale, "P", true);
        for (const [line, value] of cell.subs.entries())
          text(page, value, x, y + (76 + cell.lines.length * 49 + line * 36) * scale, 28 * scale);
      }
      y += row.height;
    }
    offset = end;
  }
}
