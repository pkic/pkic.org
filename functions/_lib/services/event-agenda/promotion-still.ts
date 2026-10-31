/** Content blocks for every still-image surface, including personal social previews. */
import type { PromotionBlock } from "./promotion-scene";
import type { PromotionComposition } from "../../../../assets/shared/schemas/event-promotion-design";

export interface PromotionStillContent {
  heading: string;
  people: { userId: string; displayName: string; affiliation: string }[];
  summary?: string;
  details?: string;
  picks?: { title: string }[];
  callToAction?: string;
}
export function promotionStillBlocks(
  content: PromotionStillContent,
  composition: PromotionComposition,
  scale: number,
  height: number,
  portraits: Record<string, string> = {},
  textScale = 1,
): PromotionBlock[] {
  const size = scale * textScale;
  const blocks: PromotionBlock[] = [
    {
      text: content.heading,
      size: (height < 800 ? 48 : composition.stillLayout === "expanded" ? 76 : 68) * size,
      bold: true,
      role: "H1",
    },
  ];
  for (const person of content.people) {
    blocks.push({
      text: person.displayName,
      size: 32 * size,
      bold: true,
      portrait: portraits[person.userId] ? { src: portraits[person.userId], name: person.displayName } : undefined,
    });
    if (person.affiliation)
      blocks.push({ text: person.affiliation, size: 24 * size, indent: portraits[person.userId] ? 150 * scale : 0 });
  }
  if (content.summary) blocks.push({ text: content.summary, size: 28 * size });
  if (content.details) blocks.push({ text: content.details, size: 23 * size });
  for (const pick of content.picks ?? []) blocks.push({ text: pick.title, size: 30 * size, bold: true });
  if (content.callToAction) blocks.push({ text: content.callToAction, size: 30 * size, bold: true });
  return blocks;
}
