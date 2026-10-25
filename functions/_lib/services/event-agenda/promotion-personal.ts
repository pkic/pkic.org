/** A personal social preview is a compact still from the promotion scene system. */
import { formatDateRange } from "../../../../assets/shared/format-date";
import { SOCIAL_PROMOTION_HEADLINES, type SocialBadgeRole } from "../../../../assets/shared/schemas/participant-roles";
import {
  promotionCompositionSchema,
  type EventPromotionDesign,
} from "../../../../assets/shared/schemas/event-promotion-design";
import { renderPromotionSvg } from "./promotion-render";

export interface PersonalPromotionData {
  firstName: string;
  lastName: string;
  role: SocialBadgeRole;
  eventName: string;
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string;
  location?: string | null;
  organization?: string | null;
  jobTitle?: string | null;
  headshotDataUrl?: string | null;
  registrationUrl: string;
  design: EventPromotionDesign;
  logoDataUrl?: string;
}
export function renderPersonalPromotionSvg(data: PersonalPromotionData): string {
  const person = {
    userId: "participant",
    displayName: [data.firstName, data.lastName].filter(Boolean).join(" ") || "Event participant",
    affiliation: [data.jobTitle, data.organization].filter(Boolean).join(" · "),
  };
  return renderPromotionSvg(
    {
      personal: {
        eventName: data.eventName,
        heading: SOCIAL_PROMOTION_HEADLINES[data.role],
        people: [person],
        details: [formatDateRange(data.startsAt, data.endsAt, data.timeZone), data.location]
          .filter(Boolean)
          .join(" · "),
      },
      design: data.design,
      registrationUrl: data.registrationUrl,
      logoDataUrl: data.logoDataUrl,
      composition: promotionCompositionSchema.parse({ panels: ["cover", "speakers", "details"], qrCode: false }),
      portraits: data.headshotDataUrl ? { participant: data.headshotDataUrl } : undefined,
    },
    "landscape",
  );
}
