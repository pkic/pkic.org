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
import { Badge, statusLabel } from "../../../../../components/Badge";
import { FilterSelect } from "../../../../../components/FilterSelect";
import { Alert } from "../../../../../ui/Alert";
import { Button } from "../../../../../ui/Button";
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
      <div class="pk">
        <Alert tone="warn">
          Viewing sponsorship details requires the <code>sponsorships:read</code> permission.
        </Alert>
      </div>
    );
  }
  return (
    <div class="pk pk-stack pk-stack--snug">
      <div class="pk-cluster">
        <Button variant="link" size="sm" onClick={() => navigate("/sponsors")}>
          ← Back to sponsorships
        </Button>
      </div>
      <SponsorshipDetail id={detailId} canWrite={canWrite} />
    </div>
  );
}

function SponsorshipCreateOnly() {
  const [created, setCreated] = useState(false);
  const [formKey, setFormKey] = useState(0);

  if (created) {
    return (
      <section class="pk pk-stack pk-stack--snug" aria-labelledby="sponsorship-created-heading">
        <h5 id="sponsorship-created-heading">Sponsorship created</h5>
        <p class="pk-small">You do not have permission to view the sponsorship pipeline.</p>
        <div class="pk-cluster">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setCreated(false);
              setFormKey((value) => value + 1);
            }}
          >
            Create another sponsorship
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section class="pk pk-stack pk-stack--snug" aria-labelledby="sponsorship-create-heading">
      <h5 id="sponsorship-create-heading">Create sponsorship</h5>
      <p class="pk-small">You can create a sponsorship without access to the sponsorship pipeline.</p>
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
    { header: "Company", cell: (c) => <span class="pk-strong">{c.label}</span> },
    {
      header: "Stages",
      cell: (c) => (
        <span class="pk-cluster">
          {c.stages.split(",").map((s) => (
            <Badge key={s} status={s} />
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
    <div class="pk pk-stack pk-stack--snug">
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
          caption="Sponsoring companies"
          urlState="sponsorships"
          endpoint="/api/v1/sponsors/companies"
          responseSchema={sponsorshipCompaniesListResponseSchema}
          resolve={(data) => data.companies}
          resolvePage={(data) => data.page}
          paginate
          actionsRef={tableRef}
          createAction={
            canWrite
              ? { label: "Create sponsorship", onSelect: () => setShowCreate(true), disabled: showCreate }
              : undefined
          }
          toolbar={({ resetPage }) => (
            <>
              {/* The list contract's two filters, in the panel head where
                  every other list keeps them; each carries its name in
                  `aria-label` through the shared control. */}
              <FilterSelect
                ariaLabel="Filter by sponsor type"
                value={type}
                options={[
                  { value: "" as typeof type, label: "All types" },
                  ...SPONSOR_TYPES.map((t) => ({ value: t as typeof type, label: statusLabel(t) })),
                ]}
                onChange={(value) => {
                  setType(value);
                  resetPage();
                }}
              />
              <FilterSelect
                ariaLabel="Filter by pipeline stage"
                value={stage}
                options={[
                  { value: "" as typeof stage, label: "All stages" },
                  ...SPONSORSHIP_PIPELINE_STAGES.map((s) => ({ value: s as typeof stage, label: statusLabel(s) })),
                ]}
                onChange={(value) => {
                  setStage(value);
                  resetPage();
                }}
              />
            </>
          )}
          columns={companyColumns}
          params={{ ...(type ? { type } : {}), ...(stage ? { stage } : {}) }}
          rowKey={(c) => c.key}
          rowAction={(c) => ({ label: `View sponsorships for ${c.label}`, onSelect: () => selectCompany(c) })}
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
