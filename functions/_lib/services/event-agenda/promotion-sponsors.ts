import type { PromotionPage, PromotionText } from "./promotion-scene";
import type { PromotionRenderData } from "./promotion-render";

/** Event-ordered tier groups share a white board; sparse groups can sit beside one another. */
export function layoutPromotionSponsors(
  groups: NonNullable<PromotionRenderData["sponsors"]>,
  add: (title: string, light: boolean) => PromotionPage,
  put: (
    page: PromotionPage,
    text: string,
    y: number,
    size: number,
    bold: boolean,
    role: PromotionText["role"],
    x?: number,
  ) => unknown,
  scale: number,
  footer: number,
) {
  const margin = 104 * scale,
    usable = 872 * scale,
    gap = 48 * scale,
    compact = footer < 600 * scale,
    contentTop = (compact ? 175 : 340) * scale;
  const newPage = () => {
    const page = add("Our sponsors", true);
    put(page, "MADE POSSIBLE BY", (compact ? 90 : 220) * scale, 22 * scale, true, "P", margin);
    put(page, "Our sponsors", (compact ? 150 : 290) * scale, (compact ? 40 : 60) * scale, true, "H2", margin);
    return page;
  };
  let page = newPage(),
    y = contentTop;
  const populated = groups.filter((group) => group.sponsors.length);
  for (let index = 0; index < populated.length; index++) {
    const first = populated[index]!,
      next = populated[index + 1];
    const paired =
      next &&
      (first.sponsors.length + next.sponsors.length <= 5 ||
        (index >= 3 && first.sponsors.length <= 6 && next.sponsors.length <= 6));
    const row = paired ? [first, next] : [first];
    const weights = row.map((group) => (paired ? Math.min(3, group.sponsors.length) : 5));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const logoHeight = (index === 0 ? 64 : index === 1 ? 52 : 40) * scale;
    const columns = row.map((group) =>
      Math.min(paired ? (index < 3 ? group.sponsors.length : 3) : 5, group.sponsors.length),
    );
    const maxRows = Math.max(...row.map((group, i) => Math.ceil(group.sponsors.length / columns[i]!)));
    let offset = 0;
    while (offset < maxRows) {
      const availableRows = Math.floor((footer - y - 80 * scale) / (logoHeight + 24 * scale));
      if (availableRows < 1) {
        page = newPage();
        y = contentTop;
        continue;
      }
      const count = Math.min(availableRows, maxRows - offset);
      (page.rules ??= []).push({ x: margin, y, width: usable });
      let x = margin;
      for (const [groupIndex, group] of row.entries()) {
        const width = ((usable - gap * (row.length - 1)) * weights[groupIndex]!) / total;
        const cell = width / columns[groupIndex]!;
        put(page, (group.label ?? group.tierName).toUpperCase(), y + 35 * scale, 18 * scale, true, "H2", x);
        for (let line = 0; line < count; line++) {
          const entries = group.sponsors.slice(
            (offset + line) * columns[groupIndex]!,
            (offset + line + 1) * columns[groupIndex]!,
          );
          for (const [column, sponsor] of entries.entries()) {
            const aspect =
              sponsor.aspectRatio && Number.isFinite(sponsor.aspectRatio) && sponsor.aspectRatio > 0
                ? sponsor.aspectRatio
                : 2.8;
            const rank = index + groupIndex;
            const area = (rank === 0 ? 9000 : rank === 1 ? 5200 : rank === 2 ? 3200 : 2200) * scale * scale;
            const height = Math.min(logoHeight - 16 * scale, Math.sqrt(area / aspect), (cell - 40 * scale) / aspect);
            const logoWidth = height * aspect;
            page.pictures.push({
              src: `data:image/svg+xml;base64,${sponsor.base64}`,
              x: x + column * cell + (cell - logoWidth) / 2,
              y: y + 60 * scale + line * (logoHeight + 24 * scale) + (logoHeight - height) / 2,
              width: logoWidth,
              height,
              alt: sponsor.name,
            });
          }
        }
        x += width + gap;
      }
      y += 80 * scale + count * (logoHeight + 24 * scale);
      offset += count;
    }
    if (paired) index++;
  }
}
