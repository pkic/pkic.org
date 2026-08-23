/**
 * Admin → Sponsorships. Sales pipeline: filterable
 * list, detail panel with stage-advance control + editable
 * tier/assigned-staff/renewal-date/notes, and the full audit trail
 * (sponsorship_events). Staff-only — members never see pipeline stage,
 * only their org's active tier (My Organization, not built here).
 *
 * Split into feature components (PR #1 review, Phase 8) — see
 * useCompanySponsorships, CompanyDetailPanel, SponsorshipDetail,
 * SponsorshipLogo, and CreateSponsorshipForm in this directory. This file
 * is just the filters + companies-table + company-drill-down composition.
 *
 * 2026-07-30 testing feedback: the flat list mixed every sponsor of every
 * type/stage in one scroll, so finding "what does company X sponsor" meant
 * scanning the whole list for name matches. This drills down instead:
 * companies → that company's sponsorships → sponsorship detail. Company
 * grouping/sorting/pagination happens in D1 via `/companies`
 * (`listSponsorshipCompanies`), not by fetching every matching sponsorship
 * into the browser to group client-side (PR #1 review) — the detail panel
 * fetches only the selected company's rows, one server-paginated page at a
 * time, with an explicit "Load more" rather than a single capped fetch
 * rendered as complete (PR #1 review, Phase 7.2).
 */
import { useState, useRef } from "preact/hooks";
import type { Column } from "../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../components/ApiDataTable";
import { SPONSORSHIP_PIPELINE_STAGES } from "../../types";
import { SPONSOR_TYPES, sponsorshipCompaniesListResponseSchema } from "../../../../shared/schemas/admin-sponsorships";
import type { SponsorshipCompany, SponsorshipPipelineStage } from "../../types";
import { stageBadgeClass, stageLabel } from "./shared";
import { CreateSponsorshipForm } from "./CreateSponsorshipForm";
import { CompanyDetailPanel } from "./CompanyDetailPanel";
import { useCompanySponsorships } from "./useCompanySponsorships";

export {
  companyDetailParams,
  buildCompanySponsorshipsUrl,
  mergeCompanySponsorshipsPage,
} from "./companySponsorshipsPage";

export function Sponsorships() {
  const [type, setType] = useState<"" | (typeof SPONSOR_TYPES)[number]>("");
  const [stage, setStage] = useState<"" | SponsorshipPipelineStage>("");
  const [showCreate, setShowCreate] = useState(false);
  const tableRef = useRef<ApiTableActions | null>(null);

  const company = useCompanySponsorships({ type, stage });
  const { selectedCompany, selectCompany, reload: reloadCompany } = company;

  function reloadAll() {
    tableRef.current?.reload();
    reloadCompany();
  }

  const companyColumns: Column<SponsorshipCompany>[] = [
    { header: "Company", cell: (c) => <span class="fw-semibold">{c.label}</span> },
    {
      header: "Stages",
      cell: (c) => (
        <span class="d-flex gap-1 flex-wrap">
          {c.stages.split(",").map((s) => (
            <span key={s} class={`badge text-capitalize ${stageBadgeClass(s as SponsorshipPipelineStage)}`}>
              {stageLabel(s)}
            </span>
          ))}
        </span>
      ),
    },
    {
      header: "Sponsorships",
      cell: (c) => `${c.sponsorshipCount} sponsorship${c.sponsorshipCount === 1 ? "" : "s"}`,
    },
  ];

  return (
    <div>
      <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
        <div class="d-flex gap-2">
          <select
            class="form-select form-select-sm"
            value={type}
            onChange={(e) => setType((e.target as HTMLSelectElement).value as typeof type)}
          >
            <option value="">All types</option>
            {SPONSOR_TYPES.map((t) => (
              <option value={t} key={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            class="form-select form-select-sm"
            value={stage}
            onChange={(e) => setStage((e.target as HTMLSelectElement).value as typeof stage)}
          >
            <option value="">All stages</option>
            {SPONSORSHIP_PIPELINE_STAGES.map((s) => (
              <option value={s} key={s}>
                {stageLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <button type="button" class="btn btn-primary btn-sm" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "Create sponsorship"}
        </button>
      </div>

      {showCreate && (
        <CreateSponsorshipForm
          onCreated={() => {
            setShowCreate(false);
            reloadAll();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {!selectedCompany && (
        <ApiDataTable
          endpoint="/api/v1/admin/sponsorships/companies"
          responseSchema={sponsorshipCompaniesListResponseSchema}
          resolve={(data) => data.companies}
          resolvePage={(data) => data.page}
          paginate
          actionsRef={tableRef}
          columns={companyColumns}
          params={{ ...(type ? { type } : {}), ...(stage ? { stage } : {}) }}
          rowKey={(c) => c.key}
          onRowClick={selectCompany}
          empty="No sponsorships match these filters."
        />
      )}

      {selectedCompany && <CompanyDetailPanel selectedCompany={selectedCompany} company={company} />}
    </div>
  );
}
