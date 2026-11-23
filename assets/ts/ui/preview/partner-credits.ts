/** Sample logos and production partner credits shared by the gallery's room and agenda specimens. */
import type { EventProductionPartnerCredit } from "../../../shared/schemas/event-production-partners";

/** A wordmark on a light page, as a sponsor supplies it: wide or narrow by the length of the name. */
export const wordmark = (name: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${name.length * 22 + 20} 48"><text x="10" y="34" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#1c2530">${name}</text></svg>`,
  )}`;

export const PARTNERS: EventProductionPartnerCredit[] = [
  {
    role: "Camera technology provider",
    organizationId: "00000000-0000-4000-8000-0000000000a1",
    name: "Northlight Cameras",
    website: "https://northlight.example.test/",
    logoUrl: wordmark("Northlight"),
  },
  {
    role: "Captioning",
    organizationId: "00000000-0000-4000-8000-0000000000a2",
    name: "Clearline",
    website: null,
    logoUrl: null,
  },
];
