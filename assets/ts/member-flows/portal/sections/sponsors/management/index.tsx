/**
 * System → Sponsorships. Sales pipeline: filterable
 * list, detail panel with stage-advance control + editable
 * tier/assigned-staff/renewal-date/notes, and the full audit trail
 * (sponsorship_events). Staff-only — members never see pipeline stage,
 * only their org's active tier (My Organization, not built here).
 *
 * Split into feature components (PR #1 review, Phase 8) — see
 * CompanyDetailPanel, SponsorshipDetail, SponsorshipLogo, and
 * CreateSponsorshipForm in this directory. This file is just the
 * companies-table + company-drill-down composition.
 *
 * 2026-07-30 testing feedback: the flat list mixed every sponsor of every
 * type/stage in one scroll, so finding "what does company X sponsor" meant
 * scanning the whole list for name matches. This drills down instead:
 * companies → that company's sponsorships → sponsorship detail. Both lists
 * are the shared table over a bounded D1 query — grouping, search, sort,
 * filters and pagination all happen in `/companies`
 * (`listSponsorshipCompanies`) and `/sponsors` respectively, never in the
 * browser.
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
import { SponsorshipDetail } from "./SponsorshipDetail";

function readSelectedCompany(): SponsorshipCompany | null {
  const key = readHashQueryParam("company");
  if (!key) return null;
  const label = readHashQueryParam("companyLabel") ?? key.replace(/^[^:]+:/, "");
  return { key, label, website: null, sponsorshipCount: 0, stages: "" };
}
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

/** Reserved sponsorship segment that routes to the create page instead of a record. */
const NEW_SPONSORSHIP_SEGMENT = "new";

/** Redirects back to the pipeline from an effect, not render — see its call site below. */
function SponsorshipsRedirect({ onNavigate }: { onNavigate: (segment?: string) => void }) {
  useEffect(() => onNavigate(), [onNavigate]);
  return null;
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
  onNavigate,
}: {
  canRead?: boolean;
  canWrite: boolean;
  detailId?: string;
  onNavigate: (segment?: string) => void;
}) {
  if (!canRead) {
    return canWrite ? <SponsorshipCreateOnly /> : null;
  }
  // Creating a sponsorship is a place with its own address, under a reserved
  // segment, rather than a panel that unfolds above the pipeline it adds to.
  if (detailId === NEW_SPONSORSHIP_SEGMENT) {
    if (!canWrite) return <SponsorshipsRedirect onNavigate={onNavigate} />;
    return (
      <div class="pk pk-stack">
        {/* The page's way back: creating has its own address, so leaving it
            is navigation rather than the disappearance of a layer. */}
        <div class="pk-cluster">
          <Button size="sm" onClick={() => onNavigate()}>
            ← All sponsorships
          </Button>
        </div>
        <CreateSponsorshipForm onCreated={() => onNavigate()} onCancel={() => onNavigate()} />
      </div>
    );
  }
  if (detailId) return <SponsorshipDetailPage detailId={detailId} canRead={canRead} canWrite={canWrite} />;

  const tableRef = useRef<ApiTableActions | null>(null);

  // The stable key and display label live in the address, so a new tab can
  // render the same bounded company sponsorship query without list-page state.
  const [selectedCompany, setSelectedCompany] = useState(readSelectedCompany);
  useEffect(() => {
    const sync = () => setSelectedCompany(readSelectedCompany());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // The list contract's two filters live in the columns they narrow: the
  // stage filter on the stages column, the type filter on the count of
  // sponsorships — which is, once narrowed, the count of that type.
  const companyColumns: Column<SponsorshipCompany>[] = [
    {
      header: "Company",
      cell: (c) => <span class="pk-strong">{c.label}</span>,
      sort: { asc: "label", desc: "-label", defaultDirection: "asc" },
    },
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
      sort: { asc: "sponsorshipCount", desc: "-sponsorshipCount", defaultDirection: "desc" },
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
      {!selectedCompany && (
        <ApiDataTable
          caption="Sponsoring companies"
          urlState="sponsorships"
          /*
           * Search and sort are the shared table's, not this list's: the
           * companies endpoint has taken `q` and both sort columns since it
           * was written, and this was the one list that never asked for them
           * (#31). Nothing here implements either — the column says it sorts
           * and the bar says what it searches, and the query does the rest.
           */
          searchPlaceholder="company, contact, event or tier"
          endpoint="/api/v1/sponsors/companies"
          responseSchema={sponsorshipCompaniesListResponseSchema}
          resolve={(data) => data.companies}
          resolvePage={(data) => data.page}
          paginate
          actionsRef={tableRef}
          createAction={
            canWrite ? { label: "Create sponsorship", onSelect: () => onNavigate(NEW_SPONSORSHIP_SEGMENT) } : undefined
          }
          columns={companyColumns}
          rowKey={(c) => c.key}
          rowAction={(c) => ({
            label: `View sponsorships for ${c.label}`,
            href: `#/sponsors?company=${encodeURIComponent(c.key)}&companyLabel=${encodeURIComponent(c.label)}`,
          })}
          empty={
            canWrite ? (
              <EmptyState title="No sponsorships found" body="Create a sponsorship, or adjust the filters above." />
            ) : (
              "No sponsorships match these filters."
            )
          }
        />
      )}

      {selectedCompany && <CompanyDetailPanel selectedCompany={selectedCompany} />}
    </div>
  );
}
