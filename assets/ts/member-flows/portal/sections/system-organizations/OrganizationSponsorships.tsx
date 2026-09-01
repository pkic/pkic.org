/**
 * One organization's sponsorships, as the sales pipeline knows them.
 *
 * The rows come from the canonical staff sponsorship list, bounded to this
 * organization by the shared `organizationId` filter — the same endpoint the
 * sponsor workspace pages, so there is one query dialect and one projection.
 * Each row opens the sponsorship's own record in the sponsor workspace.
 */
import { usePortalHashLocation } from "../../hash-location";
import { sponsorshipsListResponseSchema, type Sponsorship } from "../../../../../shared/schemas/sponsorship-management";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import type { Column } from "../../../../components/Table";
import { fmtDate } from "../../ui";

const COLUMNS: Column<Sponsorship>[] = [
  {
    header: "Sponsorship",
    // A consortium sponsorship is the organization itself; an event
    // sponsorship carries its own display name. Either way the row leads with
    // what was sponsored, not with a raw type code.
    cell: (sponsorship) => (
      <strong>{sponsorship.organizationName ?? sponsorship.nonMemberName ?? "Sponsorship"}</strong>
    ),
    sort: { asc: "company", desc: "-company" },
  },
  {
    header: "Tier",
    cell: (sponsorship) => sponsorship.tier ?? "—",
    sort: { asc: "tier", desc: "-tier" },
  },
  {
    header: "Event",
    // A consortium sponsorship is not tied to one event; the cell says so in
    // words rather than leaving a blank that reads as missing data.
    cell: (sponsorship) => sponsorship.eventName ?? (sponsorship.sponsorType === "consortium" ? "Consortium" : "—"),
    sort: { asc: "eventName", desc: "-eventName" },
  },
  {
    header: "Status",
    cell: (sponsorship) => <Badge status={sponsorship.pipelineStage} />,
    sort: { asc: "pipelineStage", desc: "-pipelineStage" },
    width: "content",
  },
  {
    header: "Renewal",
    cell: (sponsorship) => (sponsorship.renewalDate ? fmtDate(sponsorship.renewalDate) : "—"),
    sort: { asc: "renewalDate", desc: "-renewalDate" },
    width: "content",
  },
];

export function OrganizationSponsorships({ organizationId }: { organizationId: string }) {
  return (
    <ApiDataTable
      caption="Sponsorships"
      endpoint="/api/v1/sponsors"
      params={{ visibility: "all", organizationId }}
      responseSchema={sponsorshipsListResponseSchema}
      resolve={(data) => data.sponsorships}
      resolvePage={(data) => data.page}
      paginate
      columns={COLUMNS}
      empty={<EmptyState title="No sponsorships" body="This organization has no sponsorships on record." />}
      rowKey={(sponsorship) => sponsorship.id}
      rowAction={(sponsorship) => ({
        label: `Open sponsorship for ${sponsorship.organizationName ?? sponsorship.nonMemberName ?? "this organization"}`,
        href: usePortalHashLocation.hrefs(`/sponsors/${encodeURIComponent(sponsorship.id)}`),
      })}
    />
  );
}
