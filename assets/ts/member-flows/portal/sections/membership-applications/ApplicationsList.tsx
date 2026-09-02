import { useEffect, useRef, useState } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge, statusLabel } from "../../../../components/Badge";
import { Alert } from "../../../../ui/Alert";
import { getJson } from "../../../../shared/api-client";
// `pk-mono` is written here as a class name rather than reached through a
// component, so this module pulls its stylesheet into its own chunk.
import "../../../../ui/Content.css";
import { fmtDate } from "../../ui";
import { APPLICATION_STAGES } from "../../../../../shared/schemas/member-applications";
import { membershipApplicationsListResponseSchema } from "../../../../../shared/schemas/membership-application-management";

/**
 * Consultation queue visibility: how many applications are waiting on the
 * scheduled member-consultation batch, stated above the list whenever there
 * are any. It fetches its own lightweight count (limit=1, reading page.total)
 * rather than plumbing the main table's loaded data up, since ApiDataTable's
 * actionsRef only exposes reload/resetPage, not the fetched rows/page info.
 *
 * It used to appear only while the stage filter was set to `in_consultation`.
 * The filter now lives in the Stage column and is the table's own state, so
 * the banner answers to the queue itself instead: a non-empty queue is worth
 * a sentence whichever stage the reader is looking at.
 */
function ConsultationQueueBanner() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getJson(
      "/api/v1/members/applications?stage=in_consultation&limit=1&offset=0",
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

  if (!count) return null;
  return (
    <Alert tone="info">
      <div class="pk-cluster pk-cluster--between">
        <span>
          <strong>{count}</strong> application{count === 1 ? "" : "s"} currently queued for member consultation.
        </span>
        <span class="pk-muted pk-small">Next scheduled batch: Mon &amp; Wed 07:15 UTC.</span>
      </div>
    </Alert>
  );
}

export function ApplicationsList({ onViewApplication }: { onViewApplication: (id: string) => void }) {
  const tableRef = useRef<ApiTableActions | null>(null);

  return (
    <div class="pk pk-stack pk-stack--snug">
      <ConsultationQueueBanner />
      <ApiDataTable
        caption="Membership applications"
        urlState="applications"
        endpoint="/api/v1/members/applications"
        responseSchema={membershipApplicationsListResponseSchema}
        resolve={(data) => data.applications}
        resolvePage={(data) => data.page}
        paginate
        initialSort="-created_at"
        actionsRef={tableRef}
        searchPlaceholder="applicant email or name"
        columns={[
          {
            header: "Applicant",
            cell: (a) => (
              <>
                <strong class="adm-cell-name">{a.applicantName}</strong>
                <br />
                <span class="pk-mono pk-muted pk-small">{a.applicantEmail}</span>
              </>
            ),
            sort: { asc: "applicant_name", desc: "-applicant_name" },
          },
          {
            header: "Organization",
            cell: (a) => a.organizationName ?? <span class="pk-muted">Individual</span>,
            sort: { asc: "organization_name", desc: "-organization_name" },
          },
          {
            // The slack column: the category labels are the longest prose in
            // the row ("Certification Authorities and Trust Service
            // Providers"), so the wide screen's leftover width belongs here.
            // Left to the default it went to the applicant, and the labels
            // wrapped down four-line ribbons beside a half-empty name column.
            header: "Category",
            cell: (a) => (
              <>
                {a.membershipCategoryLabel} <span class="pk-mono pk-muted pk-small">({a.membershipCategory})</span>
              </>
            ),
            width: "primary",
            sort: { asc: "membership_category", desc: "-membership_category" },
          },
          {
            header: "Stage",
            cell: (a) => <Badge status={a.stage} />,
            width: "fit",
            sort: { asc: "stage", desc: "-stage" },
            // The stage filter is the column's, beside the sort it shares a
            // head with, rather than a select above the table.
            filter: {
              param: "stage",
              options: [
                { value: "", label: "All stages" },
                ...APPLICATION_STAGES.map((s) => ({ value: s as string, label: statusLabel(s) })),
              ],
            },
          },
          {
            // A date has a bounded length; the column says so instead of
            // wearing `pk-nowrap` while still claiming a share of a wide
            // screen, and keeps the table's own ink and size.
            header: "Submitted",
            cell: (a) => fmtDate(a.createdAt),
            width: "fit",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
        ]}
        empty="No membership applications have been submitted yet"
        rowKey={(a) => a.id}
        rowAction={(a) => ({
          label: `Review the application from ${a.applicantName}`,
          onSelect: () => onViewApplication(a.id),
        })}
      />
    </div>
  );
}
