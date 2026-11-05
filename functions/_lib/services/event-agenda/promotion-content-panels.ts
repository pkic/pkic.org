import type { PromotionPage, PromotionText, PromotionMeasure } from "./promotion-scene";
import { promotionMeasuredLines, promotionSegmentLines } from "./promotion-text";

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

/** Fit the complete abstract before continuing, retaining readable type and balanced overflow. */
export function layoutPromotionAbstract(
  summary: string,
  add: AddPage,
  measure: PromotionMeasure,
  scale: number,
  rightInset: number,
) {
  const width = 904 * scale - rightInset;
  const bodyHeight = 760 * scale;
  const minimumSize = 24 * scale;
  let size = 52 * scale;
  const wrap = () => promotionMeasuredLines(summary, width, (line) => measure(line, size, false));
  let lines = wrap();
  while (size > minimumSize && lines.length * size * 1.25 > bodyHeight) {
    size -= scale;
    lines = wrap();
  }
  const lineHeight = size * 1.25;
  const capacity = Math.max(1, Math.floor(bodyHeight / lineHeight));
  const count = Math.max(1, Math.ceil(lines.length / capacity));
  for (let index = 0; index < count; index++) {
    const offset = Math.floor((index * lines.length) / count);
    const page = add("About this session");
    const body = lines.slice(offset, Math.floor(((index + 1) * lines.length) / count));
    const top = Math.max(210 * scale, 952 * scale - body.length * lineHeight);
    text(
      page,
      offset ? "ABOUT THIS SESSION · CONTINUED" : "ABOUT THIS SESSION",
      88 * scale,
      top - 70 * scale,
      22 * scale,
      "H2",
      true,
    );
    for (const [index, line] of body.entries())
      text(page, line, 88 * scale, top + index * lineHeight, size, "P", false, "session-abstract");
  }
}

/** A high-contrast referral card follows the registration copy without colliding with it. */
export function layoutPromotionRegistrationCard(
  page: PromotionPage,
  registrationUrl: string,
  scale: number,
  rightInset: number,
) {
  const margin = 80 * scale;
  const usable = page.width - margin * 2;
  let url = page.texts.find((value) => value.text === registrationUrl);
  if (!url) {
    text(page, registrationUrl, margin, 0, 28 * scale);
    url = page.texts.at(-1)!;
  }
  const cardTop = 844 * scale;
  // Raise a details grid as one unit so its registration action sits inside the shared content box.
  if (page.title === "When & where") {
    const bottom = Math.max(...page.texts.filter((value) => value !== url).map((value) => value.y));
    const shift = Math.max(0, bottom - 784 * scale);
    for (const value of page.texts) if (value !== url) value.y -= shift;
    for (const bar of page.bars ?? []) bar.y -= shift;
  }
  const cardWidth = Math.min(usable - rightInset, 760 * scale);
  page.registrationCard = { x: margin, y: cardTop, width: cardWidth, height: 108 * scale };
  (page.bars ??= []).push({ ...page.registrationCard, color: "#ffffff" });
  text(page, "Register", margin + 36 * scale, cardTop + 40 * scale, 34 * scale, "P", true);
  page.texts.at(-1)!.color = "#0b0d0c";
  (page.arrows ??= []).push({ x: margin + 220 * scale, y: cardTop + 29 * scale, length: 36 * scale, color: "#0b0d0c" });
  Object.assign(url, {
    x: margin + 36 * scale,
    y: cardTop + 82 * scale,
    size: 28 * scale,
    color: "#0b0d0c",
    mono: true,
  });
}

/** Fit the cover title, event label, and complete metadata fields beside the overlapping portrait. */
export function layoutPromotionCover(
  title: string,
  eyebrow: string,
  byline: string,
  metadata: string,
  add: AddPage,
  measure: PromotionMeasure,
  scale: number,
  rightInset: number,
) {
  const page = add(title);
  const width = 720 * scale - rightInset;
  let size = (title.length > 48 ? 84 : 96) * scale;
  const wrap = () =>
    promotionMeasuredLines(
      title,
      width,
      (line) => measure(line, size, true) - Math.max(0, line.length - 1) * size * 0.035,
    );
  let lines = wrap();
  const labelWidth = (line: string) => measure(line, 26 * scale, false, true) + Array.from(line).length * 3.64 * scale;
  const labelText = eyebrow.toUpperCase();
  const label =
    labelWidth(labelText) <= width
      ? [labelText]
      : labelText.split(" · ").flatMap((section) => promotionMeasuredLines(section, width, labelWidth));
  const meta = promotionSegmentLines(
    metadata.split(" · "),
    904 * scale - rightInset,
    (line) => measure(line, 26 * scale, false, true) + line.length * 2.08 * scale,
  );
  // Keep the complete cover below the logo, including wrapped metadata and the event label.
  while (label.length * 34 + (lines.length * size) / scale + 170 + meta.length * 34 > 752 && size > 32 * scale) {
    size -= 2 * scale;
    lines = wrap();
  }
  let y =
    952 * scale -
    (label.length * 34 + 28 + (lines.length * size) / scale + 28 + 10 + 28 + 48 + 28 + meta.length * 34) * scale;
  for (const line of label) {
    y += 34 * scale;
    text(page, line, 88 * scale, y, 26 * scale);
    Object.assign(page.texts.at(-1)!, { mono: true, weight: 500, letterSpacing: 3.64 * scale });
  }
  y += 28 * scale;
  for (const line of lines) {
    y += size;
    text(page, line, 88 * scale, y, size, "H1", true, "heading");
    page.texts.at(-1)!.letterSpacing = -size * 0.035;
  }
  y += 28 * scale;
  (page.bars ??= []).push({ x: 88 * scale, y, width: 240 * scale, height: 10 * scale, color: "url(#portrait-accent)" });
  y += (10 + 28 + 38) * scale;
  text(page, byline, 88 * scale, y, 38 * scale);
  page.texts.at(-1)!.weight = 500;
  y += 38 * scale;
  for (const line of meta) {
    y += 34 * scale;
    text(page, line, 88 * scale, y, 26 * scale);
    Object.assign(page.texts.at(-1)!, { mono: true, letterSpacing: 2.08 * scale });
  }
  return page;
}
