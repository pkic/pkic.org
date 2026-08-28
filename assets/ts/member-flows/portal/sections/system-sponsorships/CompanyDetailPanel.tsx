import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import type { SponsorshipCompany } from "../../../../../shared/schemas/sponsorship-management";
import { stageBadgeClass, stageLabel } from "./shared";
import { SponsorshipDetail } from "./SponsorshipDetail";
import type { useCompanySponsorships } from "./useCompanySponsorships";

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

  return (
    <div>
      <button type="button" class="btn btn-link btn-sm ps-0 mb-2" onClick={backToCompanies}>
        ← Back to companies
      </button>
      <h6 class="mb-3">{selectedCompany.label}</h6>
      {companyLoading && <Spinner />}
      {companyError && <ErrorAlert error={companyError} />}
      {!companyLoading && !companyError && (
        <div class="row g-3">
          <div class="col-md-5">
            <div class="list-group">
              {companySponsorships.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  class={`list-group-item list-group-item-action${selectedId === s.id ? " active" : ""}`}
                  onClick={() => setSelectedId(s.id)}
                >
                  <div class="d-flex justify-content-between">
                    <span class="fw-semibold">
                      {s.tier ?? "no tier"}
                      {s.eventName && <> — {s.eventName}</>}
                    </span>
                    <span class={`badge text-capitalize ${stageBadgeClass(s.pipelineStage)}`}>
                      {stageLabel(s.pipelineStage)}
                    </span>
                  </div>
                  <div class="small text-muted">{s.sponsorType}</div>
                </button>
              ))}
            </div>
            {companyPage?.hasMore && (
              <div class="text-center mt-2">
                <button
                  type="button"
                  class="btn btn-outline-secondary btn-sm"
                  disabled={companyLoadingMore}
                  onClick={loadMore}
                >
                  {companyLoadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>
          <div class="col-md-7">
            {selectedId && (
              <SponsorshipDetail key={selectedId} id={selectedId} canWrite={canWrite} onChanged={reload} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
