/**
 * System → Sponsorships. Sales pipeline: filterable
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
import { usePortalHashLocation } from "../../../hash-location";
import type { Column } from "../../../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../../../../components/ApiDataTable";
import { EmptyState } from "../../../../../components/EmptyState";
import { SPONSORSHIP_PIPELINE_STAGES } from "../../../../../../shared/schemas/sponsorship-management";
import {
  SPONSOR_TYPES,
  sponsorshipCompaniesListResponseSchema,
  type SponsorshipCompany,
  type SponsorshipPipelineStage,
} from "../../../../../../shared/schemas/sponsorship-management";
import { stageBadgeClass, stageLabel } from "./shared";
import { CreateSponsorshipForm } from "./CreateSponsorshipForm";
import { CompanyDetailPanel } from "./CompanyDetailPanel";
import { useCompanySponsorships } from "./useCompanySponsorships";
import { SponsorshipDetail } from "./SponsorshipDetail";

export {
  companyDetailParams,
  buildCompanySponsorshipsUrl,
  mergeCompanySponsorshipsPage,
} from "./companySponsorshipsPage";

function SponsorshipDetailPage({
  detailId,
  canRead,
  canWrite,
}: {
  detailId: string;
  canRead: boolean;
  canWrite: boolean;
}) {
  const [, navigate] = usePortalHashLocation();
  if (!canRead) {
    return (
      <div class="alert alert-warning" role="alert">
        Viewing sponsorship details requires the <code>sponsorships:read</code> permission.
      </div>
    );
  }
  return (
    <div>
      <button type="button" class="btn btn-link btn-sm ps-0 mb-2" onClick={() => navigate("/sponsors")}>
        ← Back to sponsorships
      </button>
      <SponsorshipDetail id={detailId} canWrite={canWrite} />
    </div>
  );
}

function SponsorshipCreateOnly() {
  const [created, setCreated] = useState(false);
  const [formKey, setFormKey] = useState(0);

  if (created) {
    return (
      <section aria-labelledby="sponsorship-created-heading">
        <h5 id="sponsorship-created-heading" class="mb-2">
          Sponsorship created
        </h5>
        <p class="text-muted small">You do not have permission to view the sponsorship pipeline.</p>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          onClick={() => {
            setCreated(false);
            setFormKey((value) => value + 1);
          }}
        >
          Create another sponsorship
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="sponsorship-create-heading">
      <h5 id="sponsorship-create-heading" class="mb-2">
        Create sponsorship
      </h5>
      <p class="text-muted small">You can create a sponsorship without access to the sponsorship pipeline.</p>
      <CreateSponsorshipForm
        key={formKey}
        onCreated={() => setCreated(true)}
        onCancel={() => undefined}
        showCancel={false}
      />
    </section>
  );
}

export function Sponsorships({
  canRead = true,
  canWrite,
  detailId,
}: {
  canRead?: boolean;
  canWrite: boolean;
  detailId?: string;
}) {
  if (!canRead) {
    return canWrite ? <SponsorshipCreateOnly /> : null;
  }
  if (detailId) return <SponsorshipDetailPage detailId={detailId} canRead={canRead} canWrite={canWrite} />;

  const [type, setType] = useState<"" | (typeof SPONSOR_TYPES)[number]>("");
  const [stage, setStage] = useState<"" | SponsorshipPipelineStage>("");
  const [showCreate, setShowCreate] = useState(false);
  const tableRef = useRef<ApiTableActions | null>(null);

  const company = useCompanySponsorships({ type, stage });
  const { selectedCompany, selectCompany, reload: reloadCompany } = company;

  function reloadAll() {
    void tableRef.current?.reload();
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
      <div class="d-flex flex-wrap gap-2 mb-3">
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

      {canWrite && showCreate && (
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
          urlState="sponsorships"
          endpoint="/api/v1/sponsors/companies"
          responseSchema={sponsorshipCompaniesListResponseSchema}
          resolve={(data) => data.companies}
          resolvePage={(data) => data.page}
          paginate
          actionsRef={tableRef}
          createAction={canWrite ? { label: "Create sponsorship", onSelect: () => setShowCreate(true) } : undefined}
          columns={companyColumns}
          params={{ ...(type ? { type } : {}), ...(stage ? { stage } : {}) }}
          rowKey={(c) => c.key}
          onRowClick={selectCompany}
          empty={
            canWrite ? (
              <EmptyState title="No sponsorships found" body="Create a sponsorship, or adjust the filters above." />
            ) : (
              "No sponsorships match these filters."
            )
          }
        />
      )}

      {selectedCompany && (
        <CompanyDetailPanel selectedCompany={selectedCompany} company={company} canWrite={canWrite} />
      )}
    </div>
  );
}
