import type { PromotionCopy } from "../../../../assets/shared/schemas/event-promotion-kit";
import type { AgendaOccurrence, AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import type {
  EventPromotionDesign,
  PromotionComposition,
} from "../../../../assets/shared/schemas/event-promotion-design";
import {
  buildPromotionPages,
  promotionDimensions,
  type PromotionPage,
  type PersonalPromotionRenderData,
  type PromotionMeasure,
} from "./promotion-scene";
import { promotionSceneSvg } from "./promotion-svg";
export { promotionDimensions, buildPromotionPages } from "./promotion-scene";
export { promotionMeasuredLines } from "./promotion-text";
export { renderPromotionPdf } from "./promotion-pdf";
export interface PromotionRenderData {
  heroImage?: import("../../utils/image-format").EmbeddedRasterImage | null;
  agenda: AgendaSnapshot;
  occurrence: AgendaOccurrence;
  copy: PromotionCopy;
  registrationUrl: string;
  sessionUrl?: string;
  actorId?: string;
  audience?: "speaker" | "attendee";
  composition?: PromotionComposition;
  design?: EventPromotionDesign;
  place?: string;
  mediaWording?: string;
  picks?: AgendaOccurrence[];
  people?: { userId: string; displayName: string; affiliation: string; photoUrl: string | null; role: string }[];
  sponsors?: {
    tierName: string;
    label?: string;
    sponsors: { id: string; name: string; base64: string; aspectRatio?: number }[];
  }[];
  logoDataUrl?: string;
  logoPng?: Uint8Array;
  portraits?: Record<string, string>;
  measure?: PromotionMeasure;
  scene?: PromotionPage;
  cardLines?: {
    text: string;
    kind: "title" | "name" | "affiliation" | "narrative";
    initial?: string;
    userId?: string;
  }[];
  cardPage?: number;
  cardPageCount?: number;
}
export function hasUnsupportedPromotionScript(text: string) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
}
export function promotionCardPages(
  data: PromotionRenderData,
  format: Exclude<keyof typeof promotionDimensions, "carousel">,
): PromotionRenderData[] {
  return buildPromotionPages(data, format).map((scene) => ({
    ...data,
    scene,
    cardPage: scene.index + 1,
    cardPageCount: scene.total,
    cardLines: scene.texts.map((t) => ({ text: t.text, kind: t.role === "H1" ? "title" : "narrative" })),
  }));
}
export function renderPromotionSvg(
  data: PromotionRenderData | PersonalPromotionRenderData,
  format: Exclude<keyof typeof promotionDimensions, "carousel">,
): string {
  return promotionSceneSvg(data, data.scene ?? buildPromotionPages(data, format)[0]!);
}
