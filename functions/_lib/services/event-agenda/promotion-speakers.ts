import { layoutPromotionSpeakerCredit } from "./promotion-speaker-credit";
import { initialsFrom } from "../../../../assets/shared/initials";
import { promotionMeasuredLines } from "./promotion-text";
import type { PromotionMeasure, PromotionPage } from "./promotion-scene";
import type { PromotionRenderData } from "./promotion-render";

type Person = NonNullable<PromotionRenderData["people"]>[number];
/** Keep each person's portrait, name, and affiliations together in an editorial two-column grid. */
export function layoutPromotionPanel(
  people: Person[],
  portraits: Record<string, string>,
  add: (title: string) => PromotionPage,
  measure: PromotionMeasure,
  scale: number,
  rightInset: number,
  label = "ON THE PANEL",
): boolean {
  const columns = people.length <= 3 ? people.length : people.length === 4 ? 2 : 3;
  const columnWidth = (904 * scale - rightInset - 32 * scale * (columns - 1)) / columns;
  const portraitSize = (people.length <= 3 ? 240 : people.length === 4 ? 170 : 150) * scale;
  const nameSize = (people.length <= 4 ? 38 : 32) * scale;
  const prepared = people.map((person) => ({
    person,
    names: promotionMeasuredLines(person.displayName, columnWidth, (line) => measure(line, nameSize, true)),
    affiliations: layoutPromotionSpeakerCredit(person, columnWidth, 26 * scale, measure),
  }));
  const rows = [];
  for (let index = 0; index < prepared.length; index += columns) {
    const cells = prepared.slice(index, index + columns);
    const roleHeight = cells.some((cell) => cell.person.role === "moderator") ? 32 * scale : 0;
    const nameHeight = Math.max(...cells.map((cell) => cell.names.length * nameSize * 1.1));
    const height =
      portraitSize +
      18 * scale +
      roleHeight +
      nameHeight +
      12 * scale +
      Math.max(...cells.map((cell) => cell.affiliations.height)) +
      36 * scale;
    // Exceptional credits use the text-flow layout so no profile text is discarded.
    if (height > 790 * scale) return false;
    rows.push({ cells, height, roleHeight, nameHeight });
  }
  let offset = 0;
  while (offset < rows.length) {
    const page = add("Meet the speakers");
    const text = (value: string, x: number, y: number, size: number, bold = false, role: "H2" | "P" = "P") =>
      page.texts.push({ text: value, x, y, size, bold, role });
    let end = offset,
      bodyHeight = 0;
    while (end < rows.length && (end === offset || bodyHeight + rows[end]!.height <= 660 * scale))
      bodyHeight += rows[end++]!.height;
    const top = 952 * scale - bodyHeight - 172 * scale;
    text(label, 88 * scale, top + 24 * scale, 24 * scale);
    page.texts.at(-1)!.mono = true;
    page.texts.at(-1)!.letterSpacing = 3.36 * scale;
    text("Meet the panel", 88 * scale, top + 112 * scale, 72 * scale, true, "H2");
    let y = top + 172 * scale;
    while (offset < end) {
      const row = rows[offset++]!;
      for (const [column, cell] of row.cells.entries()) {
        const x = 88 * scale + column * (columnWidth + 32 * scale);
        const src = portraits[cell.person.userId] ?? "";
        page.pictures.push({
          src,
          x,
          y,
          width: portraitSize,
          height: portraitSize,
          circle: true,
          ringWidth: 6 * scale,
          alt: cell.person.displayName,
        });
        if (!src)
          text(
            initialsFrom(cell.person.displayName),
            x + portraitSize / 2 - measure(initialsFrom(cell.person.displayName), portraitSize * 0.35, true) / 2,
            y + portraitSize * 0.66,
            portraitSize * 0.35,
            true,
          );
        let baseline = y + portraitSize + 18 * scale;
        if (cell.person.role === "moderator") {
          text("MODERATOR", x, baseline + 24 * scale, 24 * scale);
          Object.assign(page.texts.at(-1)!, { mono: true, letterSpacing: 2.88 * scale, color: "#ffd2b0" });
        }
        baseline += row.roleHeight + nameSize;
        for (const line of cell.names) {
          text(line, x, baseline, nameSize, true, "H2");
          baseline += nameSize * 1.1;
        }
        baseline = y + portraitSize + 18 * scale + row.roleHeight + row.nameHeight + 12 * scale;
        for (const line of cell.affiliations.lines) page.texts.push({ ...line, x, y: baseline + line.y });
      }
      y += row.height;
    }
  }
  return true;
}

/** Personalize the large portrait to the participating downloader, with the moderator as staff fallback. */
export function layoutPromotionFeaturedSpeaker(
  people: Person[],
  data: PromotionRenderData,
  add: (title: string) => PromotionPage,
  measure: PromotionMeasure,
  scale: number,
  rightInset: number,
) {
  const primary =
    people.find((person) => person.userId === data.actorId) ??
    people.find((person) => person.role === "moderator") ??
    people[0]!;
  const width = 904 * scale - rightInset;
  const names = promotionMeasuredLines(primary.displayName, width, (line) => measure(line, 76 * scale, true));
  const affiliation = layoutPromotionSpeakerCredit(primary, width, 34 * scale, measure);
  const bodyHeight = 24 * scale + 14 * scale + names.length * 76 * scale + 14 * scale + affiliation.height;
  if (bodyHeight > 550 * scale) return null;
  const page = add("Featured speaker");
  let y = 952 * scale - bodyHeight;
  page.texts.push({
    text: primary.role === "moderator" ? "MODERATOR" : "SPEAKER",
    x: 88 * scale,
    y: y + 24 * scale,
    size: 24 * scale,
    mono: true,
    letterSpacing: 3.36 * scale,
    bold: false,
    role: "P",
  });
  y += 38 * scale;
  for (const name of names) {
    y += 76 * scale;
    page.texts.push({
      text: name,
      x: 88 * scale,
      y,
      size: 76 * scale,
      bold: true,
      letterSpacing: -2.28 * scale,
      role: "H2",
    });
  }
  y += 14 * scale;
  for (const line of affiliation.lines) page.texts.push({ ...line, x: 88 * scale, y: y + line.y });
  const diameter = Math.min(620 * scale, 952 * scale - bodyHeight - 100 * scale);
  const overlap = (data.composition?.overlap === "bold" ? 280 : 140) * scale;
  const src = data.portraits?.[primary.userId] ?? "";
  page.pictures.push({
    src,
    x: -overlap,
    y: 64 * scale,
    width: diameter,
    height: diameter,
    circle: true,
    ringWidth: 10 * scale,
    alt: primary.displayName,
  });
  const previous = page.index === 1 ? 0 : -1;
  return { primary, picture: page.pictures[0]!, previous };
}
