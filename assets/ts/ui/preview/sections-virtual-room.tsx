/**
 * The event app's virtual room: the strip of sponsors under the stream, which is always in view and changes
 * by itself so that every sponsor is seen.
 */
import type { SponsorsDisplayResponse } from "../../../shared/schemas/public-sponsors";
import { useState } from "preact/hooks";
import type { EventProductionPartnerCredit } from "../../../shared/schemas/event-production-partners";
import {
  ProductionPartnerEditor,
  type ProductionPartnerDraft,
} from "../../member-flows/portal/sections/events/detail/settings/ProductionPartnerEditor";
import { ProductionPartnersPanel } from "../../member-flows/portal/sections/events/detail/settings/ProductionPartnersSettings";
import { Button } from "../Button";
import { Panel, PanelBody, PanelHeader } from "../Panel";
import { VirtualRoomPartners } from "../../member-flows/portal/sections/events/app/virtual-room/VirtualRoomPartners";
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

const PARTNERS: EventProductionPartnerCredit[] = [
  {
    role: "Camera Technology Provider",
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

/** The partner rows as an organizer edits them, with the second row not yet filled in. */
function PartnerEditorSpecimen() {
  const [partners, setPartners] = useState<ProductionPartnerDraft[]>([
    { role: PARTNERS[0]!.role, organizationId: PARTNERS[0]!.organizationId, name: PARTNERS[0]!.name },
    { role: "", organizationId: "", name: "" },
  ]);
  return (
    <Panel aria-label="Production partners">
      <PanelHeader title="Production partners">
        <Button>Cancel</Button>
        <Button variant="primary">Save partners</Button>
      </PanelHeader>
      <PanelBody class="pk-stack">
        <ProductionPartnerEditor
          partners={partners}
          fieldFor={() => ({})}
          onChange={setPartners}
          loadOrganizations={async (_url, _signal, schema) =>
            schema.parse({ organizations: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } })
          }
        />
      </PanelBody>
    </Panel>
  );
}

export const virtualRoomSections: PreviewSection[] = [
  {
    id: "virtual-room-sponsors",
    title: "Virtual room: sponsors under the stream",
    note: "Always in view, never behind a tab: six logos at a time beside the stream on a desk, three on a phone. They change by themselves every few seconds, and wait while the pointer or the keyboard is on one. The two highest tiers are larger and come back more often than the rest.",
    render: () => <VirtualRoomSponsors sponsors={SPONSORS} />,
  },
  {
    id: "virtual-room-partners",
    title: "Virtual room: production partners under the sponsors",
    note: "Someone who helps produce the stream is credited with what they provide, in front of their logo. They stand apart from the sponsors and never take a turn in the sponsors' strip. A partner without a logo is named in words.",
    render: () => (
      <div class="pk-stack pk-stack--snug">
        <VirtualRoomSponsors sponsors={SPONSORS} />
        <VirtualRoomPartners partners={PARTNERS} />
      </div>
    ),
  },
  {
    id: "production-partners-settings",
    title: "Event settings: production partners",
    note: "On the event's Studio settings. Each partner reads as what it is credited as and the organization's name; the name, website and logo are the organization's own and are never typed here.",
    render: () => (
      <ProductionPartnersPanel
        event={{ slug: "preview", updatedAt: "2026-11-01T00:00:00.000Z", productionPartners: PARTNERS }}
        canEdit
        onUpdated={() => {}}
      />
    ),
  },
  {
    id: "production-partners-editing",
    title: "Event settings: editing the production partners",
    note: "One row per partner: the credit as free text and the organization from the organization list. An organization is listed once.",
    render: () => <PartnerEditorSpecimen />,
  },
];
