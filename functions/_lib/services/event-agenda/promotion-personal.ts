import type { PersonalPromotionImageFormat } from "../../../../assets/shared/personal-promotion-image";
import { personalPromotionRoleStyle } from "../../../../assets/shared/badge-role-colors";
/** A personal social preview is a compact still from the promotion scene system. */
import { formatDateRange } from "../../../../assets/shared/format-date";
import { type SocialBadgeRole } from "../../../../assets/shared/schemas/participant-roles";
import {
  promotionCompositionSchema,
  type EventPromotionDesign,
} from "../../../../assets/shared/schemas/event-promotion-design";
import { renderPromotionSvg } from "./promotion-render";
import type { PromotionMeasure } from "./promotion-scene";

export interface PersonalPromotionData {
  firstName: string;
  lastName: string;
  role: SocialBadgeRole;
  eventName: string;
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string;
  location?: string | null;
  city?: string | null;
  organization?: string | null;
  jobTitle?: string | null;
  headshotDataUrl?: string | null;
  heroImage?: import("../../utils/image-format").EmbeddedRasterImage | null;
  sessions?: { title: string }[];
  format?: PersonalPromotionImageFormat;
  registrationUrl: string;
  design: EventPromotionDesign;
  logoDataUrl?: string;
  measure?: PromotionMeasure;
}
export function renderPersonalPromotionSvg(data: PersonalPromotionData): string {
  const person = {
    userId: "participant",
    displayName: [data.firstName, data.lastName].filter(Boolean).join(" ") || "Event participant",
    affiliation: [data.jobTitle, data.organization].filter(Boolean).join(" · "),
  };
  const style = personalPromotionRoleStyle(data.role);
  return renderPromotionSvg(
    {
      personal: {
        eventName: data.eventName,
        firstName: data.firstName || person.displayName,
        heading: style.label,
        roleStyle: style,
        dates: formatDateRange(data.startsAt, data.endsAt, data.timeZone, { locale: "en-GB", month: "short" }),
        location: data.location ?? "",
        city: data.city ?? "",
        sessions: style.speaking ? (data.sessions ?? []) : [],
        people: [person],
        details: [formatDateRange(data.startsAt, data.endsAt, data.timeZone), data.location]
          .filter(Boolean)
          .join(" · "),
      },
      design: data.design,
      registrationUrl: data.registrationUrl,
      logoDataUrl: data.logoDataUrl,
      measure: data.measure,
      heroImage: data.heroImage,
      composition: promotionCompositionSchema.parse({ panels: ["cover", "speakers", "details"], qrCode: false }),
      portraits: data.headshotDataUrl ? { participant: data.headshotDataUrl } : undefined,
    },
    data.format ?? "landscape",
  );
}
