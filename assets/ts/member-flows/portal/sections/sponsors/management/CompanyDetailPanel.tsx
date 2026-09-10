import {
  SPONSORSHIP_PIPELINE_STAGES,
  SPONSOR_TYPES,
  sponsorshipsListResponseSchema,
  type SponsorshipCompany,
  type SponsorshipsListResponse,
} from "../../../../../../shared/schemas/sponsorship-management";
import { ApiDataTable } from "../../../../../components/ApiDataTable";
import { Badge, statusLabel } from "../../../../../components/Badge";
import { EmptyState } from "../../../../../components/EmptyState";
import type { Column } from "../../../../../components/Table";
import { PageHeader } from "../../../../../ui/PageHeader";
import { fmtDate } from "../../../ui";
import { usePortalHashLocation } from "../../../hash-location";
import { companyDetailParams } from "./companyKey";

type CompanySponsorship = SponsorshipsListResponse["sponsorships"][number];

/** What a row says it is, used for the name of the control that opens it. */
function sponsorshipLabel(sponsorship: CompanySponsorship): string {
  const tier = sponsorship.tier ?? "No tier";
  return sponsorship.eventName ? `${tier} — ${sponsorship.eventName}` : tier;
}

/**
 * One company's sponsorships.
 *
 * The list used to be its own machinery: a hook that fetched a 200-row page,
 * merged the next one onto it, and guarded the responses against each other,
 * feeding a presentational table with no search box and no sortable column.
 * Every part of that already exists once, in the shared table — and the
 * endpoint behind this list has taken `q`, every sort column below, and both
 * pipeline filters since it was written (#42, the same finding as #31 one
 * list over). So nothing here filters, sorts, or pages anything: the columns
 * say what the query understands, and D1 does the work.
 */
export function CompanyDetailPanel({ selectedCompany }: { selectedCompany: SponsorshipCompany }) {
  const columns: Column<CompanySponsorship>[] = [
    {
      header: "Tier",
      cell: (row) => <span class="pk-strong">{row.tier ?? "No tier"}</span>,
      width: "primary",
      sort: { asc: "tier", desc: "-tier", defaultDirection: "asc" },
    },
    {
      header: "Event",
      cell: (row) => row.eventName ?? <span class="pk-muted">—</span>,
      sort: { asc: "eventName", desc: "-eventName", defaultDirection: "asc" },
    },
    {
      header: "Type",
      cell: (row) => statusLabel(row.sponsorType),
      width: "fit",
      // The endpoint narrows by sponsor type but does not order by it, so the
      // column offers the filter it can honour and claims no sort it cannot.
      filter: {
        param: "type",
        options: [
          { value: "", label: "All types" },
          ...SPONSOR_TYPES.map((type) => ({ value: type, label: statusLabel(type) })),
        ],
      },
    },
    {
      header: "Stage",
      cell: (row) => <Badge status={row.pipelineStage} />,
      width: "fit",
      sort: { asc: "pipelineStage", desc: "-pipelineStage", defaultDirection: "asc" },
      filter: {
        param: "stage",
        options: [
          { value: "", label: "All stages" },
          ...SPONSORSHIP_PIPELINE_STAGES.map((stage) => ({ value: stage, label: statusLabel(stage) })),
        ],
      },
    },
    {
      header: "Renewal",
      // The shared formatter already says "—" for a sponsorship with no
      // renewal date, so the column states no absence of its own.
      cell: (row) => fmtDate(row.renewalDate),
      width: "fit",
      sort: { asc: "renewalDate", desc: "-renewalDate", defaultDirection: "asc" },
    },
  ];

  return (
    <div class="pk pk-stack">
      {/* The trail is the way back: "Sponsors" is a real link to the list,
          which the route reads to leave this company. No back button. */}
      <PageHeader
        trail={[
          { label: "Sponsors", href: usePortalHashLocation.hrefs("/sponsors") },
          { label: selectedCompany.label },
        ]}
        title={selectedCompany.label}
      />
      {/* A sponsorship is a record with facets, so a row opens its routed page
          rather than expanding a panel beside a table it then has to share the
          width with. */}
      <ApiDataTable
        caption={`${selectedCompany.label} sponsorships`}
        urlState="companySponsorships"
        endpoint="/api/v1/sponsors"
        // A company's own page lists every sponsorship it holds: the filters
        // on the companies list narrow which companies appear, not what a
        // company is shown to hold.
        params={{ visibility: "all", ...companyDetailParams(selectedCompany.key) }}
        responseSchema={sponsorshipsListResponseSchema}
        resolve={(data) => data.sponsorships}
        resolvePage={(data) => data.page}
        paginate
        searchPlaceholder="tier, event, contact or staff member"
        columns={columns}
        rowKey={(row) => row.id}
        rowAction={(row) => ({
          label: `Open ${sponsorshipLabel(row)}`,
          href: `#/sponsors/${encodeURIComponent(row.id)}`,
        })}
        empty={
          <EmptyState
            title="No sponsorships for this company"
            body="Nothing matches the search and column filters currently applied."
          />
        }
      />
    </div>
  );
}
