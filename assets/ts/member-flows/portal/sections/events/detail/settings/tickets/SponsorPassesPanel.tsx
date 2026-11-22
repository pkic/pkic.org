/**
 * Sponsor passes: how many staff passes and customer invitations each sponsor
 * tier gives, and the action that turns them into two codes per sponsor.
 * Editing them opens its own page under the tickets tab.
 */
import { postJson } from "../../../../../../../shared/api-client";
import {
  eventTicketSponsorCodesResponseSchema,
  type EventTicketsConfiguration,
} from "../../../../../../../../shared/schemas/event-tickets";
import { formatNumber } from "../../../../../../../../shared/format-number";
import { DataTable } from "../../../../../../../ui/DataTable";
import { Menu } from "../../../../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { toast } from "../../../../../ui";
import { ticketsEndpoint } from "./tickets-endpoint";

type Tier = EventTicketsConfiguration["sponsorPasses"]["tiers"][number];

export function SponsorPassesPanel({
  slug,
  configuration,
  canWrite,
  editHref,
  onChanged,
}: {
  slug: string;
  configuration: EventTicketsConfiguration;
  canWrite: boolean;
  /** Where the passes are edited. */
  editHref: string;
  onChanged: () => Promise<void>;
}) {
  const saved = configuration.sponsorPasses;
  async function issue() {
    try {
      const result = await postJson(
        `${ticketsEndpoint(slug)}/sponsors/codes`,
        {},
        eventTicketSponsorCodesResponseSchema,
      );
      await onChanged();
      toast(
        result.created || result.raised
          ? `${formatNumber(result.created)} codes created, ${formatNumber(result.raised)} raised.`
          : "Every sponsor already has its codes.",
        "success",
      );
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The codes could not be created. Try again.", "error");
    }
  }
  // Nothing to set up until the event has a sponsor tier.
  if (saved.tiers.length === 0) return null;
  const ticketName = (id: string | null) => configuration.types.find((type) => type.id === id)?.name ?? "Not chosen";
  return (
    <Panel aria-label="Sponsor passes">
      <PanelHeader
        title="Sponsor passes"
        menu={
          canWrite ? (
            <Menu
              label="Sponsor pass actions"
              align="end"
              items={[
                { id: "edit", label: "Edit passes", href: editHref },
                { id: "issue", label: "Create codes for sponsors", onSelect: () => void issue() },
              ]}
            />
          ) : undefined
        }
      />
      <PanelBody flush>
        <DataTable<Tier>
          caption="Sponsor passes by tier"
          rows={saved.tiers}
          rowKey={(row) => row.tierName}
          columns={[
            { id: "tier", header: "Tier", cell: (row) => <strong>{row.tierName}</strong> },
            {
              id: "staff",
              header: "Staff passes",
              width: "fit",
              align: "end",
              cell: (row) => formatNumber(row.staffPasses),
            },
            {
              id: "customers",
              header: "Customer invitations",
              width: "fit",
              align: "end",
              cell: (row) => formatNumber(row.customerPasses),
            },
            {
              id: "sponsors",
              header: "Sponsors",
              width: "fit",
              align: "end",
              cell: (row) => formatNumber(row.sponsors),
            },
            {
              id: "codes",
              header: "With codes",
              width: "fit",
              align: "end",
              cell: (row) => formatNumber(row.sponsorsWithCodes),
            },
          ]}
        />
      </PanelBody>
      <PanelBody>
        <p class="pk-small pk-muted">
          Staff passes give the {ticketName(saved.staffTicketTypeId)} ticket and customer invitations the{" "}
          {ticketName(saved.customerTicketTypeId)} ticket, both free. Each sponsor gets one code per kind.
        </p>
      </PanelBody>
    </Panel>
  );
}
