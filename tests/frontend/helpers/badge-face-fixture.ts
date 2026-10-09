import QRCode from "qrcode";
import { createGenericBadgeTemplate } from "../../../assets/shared/badge-generic-template";
import { composeBadgePrintSvg } from "../../../assets/shared/badge-print-svg";
import { badgePrintingResponseSchema } from "../../../assets/shared/schemas/route-contracts-event-badges";
import type { PrintableBadgePrint } from "../../../assets/ts/components/event-badges/badge-print-artifacts";

/** Synthetic badge print context and artifact, shared by the badge face and the attendee ticket tests. */
export const BADGE_FACE_CREDENTIAL = "ABCDEFGHJKLMNPQR";
const sponsorSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#123456"/></svg>';

/** The print context a generic event badge with one sponsor tier prints with. */
export function badgeFacePrinting() {
  const sponsorGroups = [{ key: "tier-gold", tierName: "Gold" }];
  return badgePrintingResponseSchema.parse({
    revision: "a".repeat(64),
    template: createGenericBadgeTemplate({ eventName: "Summit", sponsorGroups }),
    branding: [
      {
        ...sponsorGroups[0],
        sponsors: [{ id: "28a2c3d4-05f6-47ab-89cd-0123456789ef", name: "Synthetic Sponsor", svg: sponsorSvg }],
      },
    ],
  });
}

export async function badgeFaceBadge(): Promise<PrintableBadgePrint> {
  return {
    id: "60000000-0000-4000-8000-000000000001",
    displayName: "Femke de Vries",
    firstName: "Femke",
    lastName: "de Vries",
    organization: "Ministry of the Interior",
    badgeRole: "speaker",
    svg: composeBadgePrintSvg(
      await QRCode.toString(BADGE_FACE_CREDENTIAL, { type: "svg", errorCorrectionLevel: "M", margin: 4 }),
      BADGE_FACE_CREDENTIAL,
    ),
  };
}
