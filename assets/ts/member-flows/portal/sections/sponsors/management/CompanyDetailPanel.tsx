import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import type {
  SponsorshipCompany,
  SponsorshipsListResponse,
} from "../../../../../../shared/schemas/sponsorship-management";
import { Badge } from "../../../../../components/Badge";
import { Badge as ToneBadge } from "../../../../../ui/Badge";
import { Button } from "../../../../../ui/Button";
import { DataTable, type DataTableColumn } from "../../../../../ui/DataTable";
import { EmptyState } from "../../../../../ui/EmptyState";
import { SponsorshipDetail } from "./SponsorshipDetail";
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
  canWrite,
}: {
  selectedCompany: SponsorshipCompany;
  company: ReturnType<typeof useCompanySponsorships>;
  canWrite: boolean;
}) {
  const {
    companySponsorships,
    companyPage,
    companyLoading,
    companyLoadingMore,
    companyError,
    selectedId,
    setSelectedId,
    loadMore,
    backToCompanies,
    reload,
  } = company;

  const columns: ReadonlyArray<DataTableColumn<CompanySponsorship>> = [
    { id: "sponsorship", header: "Sponsorship", cell: (row) => <span class="pk-strong">{sponsorshipLabel(row)}</span> },
    { id: "sponsorType", header: "Type", cell: (row) => row.sponsorType },
    {
      id: "pipelineStage",
      header: "Stage",
      cell: (row) => <Badge status={row.pipelineStage} />,
      cellClass: "pk-nowrap",
    },
    {
      id: "open",
      header: "Currently open",
      headerHidden: true,
      align: "end",
      cell: (row) => (row.id === selectedId ? <ToneBadge tone="accent">Showing</ToneBadge> : null),
      cellClass: "pk-nowrap",
    },
  ];

  return (
    <div class="pk pk-stack">
      <div class="pk-cluster">
        <Button variant="link" size="sm" onClick={backToCompanies}>
          ← Back to companies
        </Button>
      </div>
      <h2>{selectedCompany.label}</h2>
      {companyLoading && <Spinner label="Loading this company's sponsorships…" />}
      {companyError && <ErrorAlert error={companyError} />}
      {!companyLoading && !companyError && (
        <div class="pk-grid pk-grid--roomy">
          <div class="pk-stack pk-stack--snug">
            <DataTable
              caption={`${selectedCompany.label} sponsorships`}
              columns={columns}
              rows={companySponsorships}
              rowKey={(row) => row.id}
              rowAction={(row) => ({
                // Names where the row goes, not what the control is: "Show
                // Gold — Summit", never "View".
                label: `Show ${sponsorshipLabel(row)}`,
                onSelect: () => setSelectedId(row.id),
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
          <div>
            {selectedId && (
              <SponsorshipDetail key={selectedId} id={selectedId} canWrite={canWrite} onChanged={reload} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
