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
import { useEffect, useRef, useState } from "preact/hooks";
import { readHashQueryParam } from "../../../../../shared/hash-query";
import type { Column } from "../../../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../../../../components/ApiDataTable";
import { EmptyState } from "../../../../../components/EmptyState";
import { SPONSORSHIP_PIPELINE_STAGES } from "../../../../../../shared/schemas/sponsorship-management";
import {
  SPONSOR_TYPES,
  sponsorshipCompaniesListResponseSchema,
  type SponsorshipCompany,
} from "../../../../../../shared/schemas/sponsorship-management";
import { Badge, statusLabel } from "../../../../../components/Badge";
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
  if (!canRead) {
    return (
      <div class="pk">
        <Alert tone="warn">
          Viewing sponsorship details requires the <code>sponsorships:read</code> permission.
        </Alert>
      </div>
    );
  }
  return <SponsorshipDetail id={detailId} canWrite={canWrite} />;
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

  const [showCreate, setShowCreate] = useState(false);
  const tableRef = useRef<ApiTableActions | null>(null);

  const company = useCompanySponsorships();
  const { selectedCompany, selectCompany, backToCompanies, reload: reloadCompany } = company;
  // The company view is addressed by `?company=<key>` on the sponsors route,
  // so the trail's "Sponsors" crumb is a real link back: when the query goes,
  // the view goes with it. The portal's location hook strips the query, so
  // the key is read from the hash directly and re-read when the hash changes.
  const [companyKey, setCompanyKey] = useState(() => readHashQueryParam("company"));
  useEffect(() => {
    const sync = () => setCompanyKey(readHashQueryParam("company"));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    if (!companyKey && selectedCompany) backToCompanies();
  }, [companyKey, selectedCompany, backToCompanies]);
  function openCompany(next: SponsorshipCompany) {
    selectCompany(next);
    // Remembered here as well as in the address: `replaceState` announces no
    // hashchange, and the effect above would otherwise read the stale key
    // and send the view straight back to the list.
    setCompanyKey(next.key);
    // The address names the company without announcing a navigation: a
    // hashchange here would re-render the route and drop the selection just
    // made. The trail's crumb back to `#/sponsors` does fire one, and that
    // fresh render is exactly the list it should land on.
    history.replaceState(history.state, "", `#/sponsors?company=${encodeURIComponent(next.key)}`);
  }

  function reloadAll() {
    void tableRef.current?.reload();
    reloadCompany();
  }

  // The list contract's two filters live in the columns they narrow: the
  // stage filter on the stages column, the type filter on the count of
  // sponsorships — which is, once narrowed, the count of that type.
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
      filter: {
        param: "stage",
        options: [
          { value: "", label: "All stages" },
          ...SPONSORSHIP_PIPELINE_STAGES.map((s) => ({ value: s, label: statusLabel(s) })),
        ],
      },
    },
    {
      header: "Sponsorships",
      cell: (c) => `${c.sponsorshipCount} sponsorship${c.sponsorshipCount === 1 ? "" : "s"}`,
      width: "fit",
      filter: {
        param: "type",
        options: [
          { value: "", label: "All types" },
          ...SPONSOR_TYPES.map((t) => ({ value: t, label: statusLabel(t) })),
        ],
      },
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
          columns={companyColumns}
          rowKey={(c) => c.key}
          rowAction={(c) => ({ label: `View sponsorships for ${c.label}`, onSelect: () => openCompany(c) })}
          empty={
            canWrite ? (
              <EmptyState title="No sponsorships found" body="Create a sponsorship, or adjust the filters above." />
            ) : (
              "No sponsorships match these filters."
            )
          }
        />
      )}

      {selectedCompany && <CompanyDetailPanel selectedCompany={selectedCompany} company={company} />}
    </div>
  );
}
