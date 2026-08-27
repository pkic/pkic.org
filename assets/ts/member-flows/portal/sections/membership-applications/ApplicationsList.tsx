import { useEffect, useRef, useState } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { getJson } from "../../../../shared/api-client";
import { fmt } from "../../ui";
import { APPLICATION_STAGES } from "../../../../../shared/schemas/member-applications";
import { membershipApplicationsListResponseSchema } from "../../../../../shared/schemas/membership-application-management";

/**
 * Consultation queue visibility (Fix 5a): shown above the table only when
 * the stage filter is set to `in_consultation`. Fetches its own lightweight
 * count (limit=1, reading page.total) rather than plumbing the main table's
 * loaded data up, since ApiDataTable's actionsRef only exposes reload/
 * resetPage, not the fetched rows/page info.
 */
function ConsultationQueueBanner() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getJson(
      "/api/v1/system/membership-applications?stage=in_consultation&limit=1&offset=0",
      membershipApplicationsListResponseSchema,
    )
      .then((data) => {
        if (!cancelled) setCount(data.page.total);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div class="alert alert-info small py-2 mb-2 d-flex justify-content-between align-items-center flex-wrap gap-2">
      <span>
        <strong>{count ?? "…"}</strong> application{count === 1 ? "" : "s"} currently queued for member consultation.
      </span>
      <span class="text-muted">Next scheduled batch: Mon &amp; Wed 07:15 UTC.</span>
    </div>
  );
}

export function ApplicationsList({ onViewApplication }: { onViewApplication: (id: string) => void }) {
  const [stageFilter, setStageFilter] = useState("");
  const tableRef = useRef<ApiTableActions | null>(null);

  return (
    <div>
      {stageFilter === "in_consultation" && <ConsultationQueueBanner />}
      <ApiDataTable
        endpoint="/api/v1/system/membership-applications"
        responseSchema={membershipApplicationsListResponseSchema}
        resolve={(data) => data.applications}
        resolvePage={(data) => data.page}
        paginate
        initialSort="-created_at"
        actionsRef={tableRef}
        searchPlaceholder="applicant email or name"
        params={stageFilter ? { stage: stageFilter } : {}}
        toolbar={({ resetPage }) => (
          <select
            class="form-select form-select-sm w-auto"
            value={stageFilter}
            onChange={(e) => {
              setStageFilter((e.target as HTMLSelectElement).value);
              resetPage();
            }}
          >
            <option value="">All stages</option>
            {APPLICATION_STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        columns={[
          {
            header: "Applicant",
            cell: (a) => (
              <>
                <strong class="adm-cell-name">{a.applicantName}</strong>
                <br />
                <span class="mono text-muted small">{a.applicantEmail}</span>
              </>
            ),
            sort: { asc: "applicant_name", desc: "-applicant_name" },
          },
          {
            header: "Organization",
            cell: (a) => a.organizationName ?? <span class="text-muted fst-italic">Individual</span>,
            sort: { asc: "organization_name", desc: "-organization_name" },
          },
          {
            header: "Category",
            cell: (a) => (
              <>
                {a.membershipCategoryLabel} <span class="mono text-muted small">({a.membershipCategory})</span>
              </>
            ),
            sort: { asc: "membership_category", desc: "-membership_category" },
          },
          {
            header: "Stage",
            cell: (a) => <Badge status={a.stage} />,
            sort: { asc: "stage", desc: "-stage" },
          },
          {
            header: "Submitted",
            cell: (a) => fmt(a.createdAt),
            className: "mono small text-nowrap",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
        ]}
        empty="No applications found"
        rowKey={(a) => a.id}
        onRowClick={(a) => onViewApplication(a.id)}
      />
    </div>
  );
}
