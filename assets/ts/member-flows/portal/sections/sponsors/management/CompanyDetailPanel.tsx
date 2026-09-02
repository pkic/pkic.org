import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import type {
  SponsorshipCompany,
  SponsorshipsListResponse,
} from "../../../../../../shared/schemas/sponsorship-management";
import { Badge } from "../../../../../components/Badge";
import { Button } from "../../../../../ui/Button";
import { PageHeader } from "../../../../../ui/PageHeader";
import { usePortalHashLocation } from "../../../hash-location";
import { DataTable, type DataTableColumn } from "../../../../../ui/DataTable";
import { EmptyState } from "../../../../../ui/EmptyState";
import type { useCompanySponsorships } from "./useCompanySponsorships";

type CompanySponsorship = SponsorshipsListResponse["sponsorships"][number];

/** What a row says it is, used for both the visible cell and the row's name. */
function sponsorshipLabel(sponsorship: CompanySponsorship): string {
  const tier = sponsorship.tier ?? "No tier";
  return sponsorship.eventName ? `${tier} — ${sponsorship.eventName}` : tier;
}

/**
 * One company's sponsorships, and whichever of them is open.
 *
 * The list was a Bootstrap `list-group` whose current item was marked by the
 * `active` class alone — a filled background and nothing else, so which row
 * the detail beside it belonged to was carried entirely by colour. It is now
 * a captioned table whose rows activate through the design system's
 * `rowAction`, with the open row saying "Showing" in words.
 */
export function CompanyDetailPanel({
  selectedCompany,
  company,
}: {
  selectedCompany: SponsorshipCompany;
  company: ReturnType<typeof useCompanySponsorships>;
}) {
  const { companySponsorships, companyPage, companyLoading, companyLoadingMore, companyError, loadMore } = company;

  const columns: ReadonlyArray<DataTableColumn<CompanySponsorship>> = [
    { id: "sponsorship", header: "Sponsorship", cell: (row) => <span class="pk-strong">{sponsorshipLabel(row)}</span> },
    { id: "sponsorType", header: "Type", cell: (row) => row.sponsorType },
    {
      id: "pipelineStage",
      header: "Stage",
      cell: (row) => <Badge status={row.pipelineStage} />,
      cellClass: "pk-nowrap",
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
      {companyLoading && <Spinner label="Loading this company's sponsorships…" />}
      {companyError && <ErrorAlert error={companyError} />}
      {!companyLoading && !companyError && (
        <div class="pk-stack pk-stack--snug">
          {/* A sponsorship is a record with facets, so a row opens its routed
              page rather than expanding a panel beside a table it then has to
              share the width with. */}
          <DataTable
            caption={`${selectedCompany.label} sponsorships`}
            columns={columns}
            rows={companySponsorships}
            rowKey={(row) => row.id}
            rowAction={(row) => ({
              label: `Open ${sponsorshipLabel(row)}`,
              href: `#/sponsors/${encodeURIComponent(row.id)}`,
            })}
            empty={
              <EmptyState
                title="No sponsorships for this company"
                body="Nothing matches the type and stage filters currently applied."
              />
            }
          />
          {companyPage?.hasMore && (
            <div class="pk-cluster pk-cluster--center">
              <Button size="sm" loading={companyLoadingMore} onClick={loadMore}>
                {companyLoadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
