import { useRef } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge, statusLabel } from "../../../../components/Badge";
// `pk-mono` is written here as a class name rather than reached through a
// component, so this module pulls its stylesheet into its own chunk.
import "../../../../ui/Content.css";
import { fmtDate } from "../../ui";
import { APPLICATION_SCOPE_STAGES, type ApplicationScope } from "../../../../../shared/schemas/member-applications";
import {
  membershipApplicationsListResponseSchema,
  type MembershipApplicationSummary,
} from "../../../../../shared/schemas/membership-application-management";
import { usePortalHashLocation } from "../../hash-location";

export function ApplicationsList({ scope = "active" }: { scope?: ApplicationScope }) {
  const tableRef = useRef<ApiTableActions | null>(null);

  return (
    <div class="pk pk-stack pk-stack--snug">
      <ApiDataTable
        caption={scope === "active" ? "Active applications" : "Application history"}
        urlState={scope === "active" ? "applications" : "applicationHistory"}
        params={{ scope }}
        endpoint="/api/v1/members/applications"
        responseSchema={membershipApplicationsListResponseSchema}
        resolve={(data) => data.applications}
        resolvePage={(data) => data.page}
        paginate
        initialSort="-created_at"
        actionsRef={tableRef}
        searchPlaceholder="Search applicants, organizations, or categories"
        columns={[
          {
            header: "Applicant",
            cell: (a) => (
              <>
                <strong>{a.applicantName}</strong>
                <br />
                <span class="pk-mono pk-muted pk-small">{a.applicantEmail}</span>
              </>
            ),
            sort: { asc: "applicant_name", desc: "-applicant_name" },
          },
          {
            header: "Organization",
            cell: (a) =>
              a.organizationName ?? (
                <span class="pk-muted">{a.source?.historical ? "Not recorded" : "Individual"}</span>
              ),
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
                {a.membershipCategoryLabel}{" "}
                {a.membershipCategory && <span class="pk-mono pk-muted pk-small">({a.membershipCategory})</span>}
              </>
            ),
            width: "primary",
            sort: { asc: "membership_category", desc: "-membership_category" },
          },
          {
            header: scope === "active" ? "Stage" : "Outcome",
            cell: (a) => (
              <div class="pk-stack pk-stack--snug">
                <Badge status={a.stage} />
                {a.onHoldSubtype === "manual" && <span class="pk-small">Manual hold</span>}
                {a.source && !a.source.historical && !a.source.activatedAt && (
                  <span class="pk-small">Awaiting cutover reconciliation</span>
                )}
                {a.currentRequirement && <span class="pk-small">{a.currentRequirement}</span>}
              </div>
            ),
            width: "fit",
            sort: { asc: "stage", desc: "-stage" },
            // The stage filter is the column's, beside the sort it shares a
            // head with, rather than a select above the table.
            filter: {
              param: "stage",
              options: [
                { value: "", label: "All stages" },
                ...APPLICATION_SCOPE_STAGES[scope].map((s) => ({ value: s as string, label: statusLabel(s) })),
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
          ...(scope === "history"
            ? [
                {
                  header: "Closed",
                  cell: (a: MembershipApplicationSummary) => (a.closedAt ? fmtDate(a.closedAt) : "Unknown"),
                  width: "fit" as const,
                  sort: { asc: "closed_at", desc: "-closed_at" },
                },
                {
                  header: "Source",
                  cell: (a: MembershipApplicationSummary) => (a.source ? `GitHub #${a.source.issueNumber}` : "Portal"),
                  width: "fit" as const,
                },
              ]
            : []),
        ]}
        empty={
          scope === "active" ? "No active applications match this view" : "No application history matches this view"
        }
        rowKey={(a) => a.id}
        rowAction={(a) => ({
          label: `Review the application from ${a.applicantName}`,
          href: usePortalHashLocation.hrefs(`/membership/applications/${encodeURIComponent(a.id)}`),
        })}
      />
    </div>
  );
}
