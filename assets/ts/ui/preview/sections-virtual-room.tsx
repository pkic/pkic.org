/**
 * The event app's virtual room: the strip of sponsors under the stream, which is always in view and changes
 * by itself so that every sponsor is seen.
 */
import type { SponsorsDisplayResponse } from "../../../shared/schemas/public-sponsors";
import { VirtualRoomSponsors } from "../../member-flows/portal/sections/events/app/virtual-room/VirtualRoomSponsors";
import "../../member-flows/portal/sections/events/app/virtual-room/VirtualRoom.css";
import type { PreviewSection } from "./PreviewShell";

/** A wordmark on a light page, as a sponsor supplies it: wide or narrow by the length of the name. */
const wordmark = (name: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${name.length * 22 + 20} 48"><text x="10" y="34" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#1c2530">${name}</text></svg>`,
  )}`;

/** A consortium's spread of sponsors: one at the top, a few under it, most in the tiers below. */
const TIERS: ReadonlyArray<[weight: number, tier: string, names: readonly string[]]> = [
  [6, "Diamond", ["Northwind"]],
  [5, "Titanium", ["Aster", "Borealis", "Cobalt", "Delta Trust"]],
  [4, "Platinum", ["Ember", "Fathom", "Granite", "Harbor", "Indigo", "Juniper", "Keystone", "Lumen", "Meridian"]],
  [3, "Gold", ["Nimbus", "Orchard", "Pinnacle", "Quarry", "Ridge", "Summit"]],
  [2, "Silver", ["Tidal", "Umbra", "Vertex", "Willow", "Zenith"]],
  [1, "Bronze", ["Acorn"]],
];
let serial = 0;
// Drawn marks stand in for uploaded logos here, so the fixture is typed, not parsed as a server response.
const SPONSORS: SponsorsDisplayResponse = {
  groups: TIERS.map(([weight, tierName, names]) => ({
    weight,
    tierName,
    sponsors: names.map((name) => {
      serial += 1;
      return {
        id: `c0000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
        name,
        website: `https://${name.toLowerCase().replaceAll(" ", "-")}.example.test/`,
        logoUrl: wordmark(name),
        tier: tierName,
        eventTier: null,
        effectiveTier: tierName,
        weight,
      };
    }),
  })),
  page: { limit: 200, offset: 0, total: 26, hasMore: false },
};

export const virtualRoomSections: PreviewSection[] = [
  {
    id: "virtual-room-sponsors",
    title: "Virtual room: sponsors under the stream",
    note: "Always in view, never behind a tab: six logos at a time beside the stream on a desk, three on a phone. They change by themselves every few seconds, and wait while the pointer or the keyboard is on one. The two highest tiers are larger and come back more often than the rest.",
    render: () => <VirtualRoomSponsors sponsors={SPONSORS} />,
  },
];
