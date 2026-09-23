/**
 * The shared, D1-backed proposal catalogue for every event-scoped program
 * surface — the group event's Proposals tab and the standalone event's.
 *
 * One list panel, the way every other collection in the portal is drawn.
 * Status and recommendation narrow from their own columns' menus, and the
 * archive — the deleted proposals — is one more value of the Status column
 * rather than a third select above the table; the head keeps only search,
 * the create action and refresh. Three selects stacked beside the search box,
 * each remembered in session storage, was the toolbar-of-filters the shared
 * table exists to prevent. The list's state now rides in the URL instead, so
 * a narrowed page can be refreshed and shared.
 */
import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { Badge } from "../Badge";
import { ApiDataTable, type ApiTableActions } from "../ApiDataTable";
import { CollectionTotals } from "../CollectionTotals";
import {
  eventProposalsResponseSchema,
  type EventProposalSummary,
  type ProposalAccess,
  type ProposalStats,
} from "../../../shared/schemas/event-proposals";
import {
  PROPOSAL_ADMIN_STATUS_FILTER_LABELS,
  PROPOSAL_ADMIN_STATUS_FILTERS,
} from "../../../shared/schemas/proposal-status";
import { PROPOSAL_RECOMMENDATIONS } from "../../../shared/schemas/proposal-reviews";
import { formatDateTime } from "../../shared/ui";
// `pk-mono` on the score column ships in Content.css, a lazy chunk rather than
// the entry stylesheet, so the module that writes the class name imports it.
import "../../ui/Content.css";

const RECOMMENDATION_LABELS: Record<string, string> = {
  accept: "Accept",
  "needs-work": "Needs work",
  reject: "Reject",
};

function formatAverageScore(score: number | null): string {
  if (score == null) return "—";
  return score.toFixed(1).replace(/\.0$/, "");
}

function recommendationLabel(value: string): string {
  return RECOMMENDATION_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

function recommendationSummary(proposal: EventProposalSummary) {
  const entries = [
    ["accept", proposal.recommendation_accept_count],
    ["needs-work", proposal.recommendation_needs_work_count],
    ["reject", proposal.recommendation_reject_count],
  ] as const;
  const visible = entries.filter(([, count]) => count > 0);
  if (visible.length === 0) {
    return (
      <>
        <span class="pk-muted" aria-hidden="true">
          —
        </span>
        <span class="pk-sr-only">No recommendations</span>
      </>
    );
  }
  return (
    <div class="pk-cluster">
      {visible.map(([status, count]) => (
        <Badge key={status} status={status} label={`${recommendationLabel(status)} ${String(count)}`} />
      ))}
    </div>
  );
}

function proposerName(proposal: EventProposalSummary): string {
  return (
    [proposal.proposer_first_name, proposal.proposer_last_name].filter(Boolean).join(" ") || proposal.proposer_email
  );
}

export function EventProposalsTable({
  endpoint,
  urlState,
  rowHref,
  toolbarPrefix,
  empty = "No proposals found",
}: {
  endpoint: string;
  /** Namespace for the list's URL-addressed search, sort, page and filters. */
  urlState?: string;
  /** Where a row goes: the proposal's own page. */
  rowHref: (proposal: EventProposalSummary) => string;
  toolbarPrefix?: (
    actions: ApiTableActions,
    access: ProposalAccess | null,
    selectedProposalIds: ReadonlySet<string>,
  ) => ComponentChildren;
  empty?: string;
}) {
  const [stats, setStats] = useState<ProposalStats | null>(null);
  const [access, setAccess] = useState<ProposalAccess | null>(null);
  const [selectedProposalIds, setSelectedProposalIds] = useState<ReadonlySet<string>>(new Set());
  const tableRef = useRef<ApiTableActions | null>(null);
  const visibleProposalTitles = useRef(new Map<string, string>());

  return (
    <div class="pk pk-stack pk-stack--snug">
      {stats && <ProposalStatsSummary stats={stats} />}
      <ApiDataTable
        caption="Event proposals"
        urlState={urlState}
        endpoint={endpoint}
        responseSchema={eventProposalsResponseSchema}
        resolve={(response) => response.proposals}
        resolvePage={(response) => response.page}
        onData={(response) => {
          setStats(response.stats);
          setAccess(response.access);
          visibleProposalTitles.current = new Map(response.proposals.map((proposal) => [proposal.id, proposal.title]));
          setSelectedProposalIds((current) => {
            if (current.size === 0) return current;
            const visible = new Set([...current].filter((id) => visibleProposalTitles.current.has(id)));
            return visible.size === current.size ? current : visible;
          });
        }}
        paginate
        initialSort="-submittedAt"
        // The list opens on what is still in play; the archive and every
        // other status are one choice away in the Status column's menu.
        initialFilters={{ status: "active" }}
        searchPlaceholder="title, proposer or review"
        actionsRef={tableRef}
        toolbar={
          toolbarPrefix
            ? (actions) =>
                toolbarPrefix({ reload: actions.reload, resetPage: actions.resetPage }, access, selectedProposalIds)
            : undefined
        }
        selection={{
          selected: selectedProposalIds,
          onChange: setSelectedProposalIds,
          rowLabel: (id) => visibleProposalTitles.current.get(id) ?? `proposal ${id}`,
        }}
        columns={[
          {
            header: "Title",
            cell: (proposal) => <span class="pk-strong">{proposal.title}</span>,
            width: "primary",
            sort: { asc: "title", desc: "-title", defaultDirection: "asc" },
          },
          {
            header: "Proposer",
            cell: (proposal) => {
              const proposer = proposerName(proposal);
              return (
                <div class="pk-stack pk-stack--tight">
                  <span>{proposer}</span>
                  {proposer !== proposal.proposer_email && (
                    <span class="pk-muted pk-small">{proposal.proposer_email}</span>
                  )}
                </div>
              );
            },
            sort: { asc: "proposer", desc: "-proposer", defaultDirection: "asc" },
          },
          {
            header: "Type",
            cell: (proposal) => proposal.proposal_type,
            width: "fit",
            sort: { asc: "type", desc: "-type", defaultDirection: "asc" },
          },
          {
            header: "Status",
            cell: (proposal) => <Badge status={proposal.status} />,
            width: "fit",
            sort: { asc: "status", desc: "-status", defaultDirection: "asc" },
            filter: {
              param: "status",
              options: [
                { value: "", label: "All statuses" },
                ...PROPOSAL_ADMIN_STATUS_FILTERS.map((status) => ({
                  value: status as string,
                  label: PROPOSAL_ADMIN_STATUS_FILTER_LABELS[status],
                })),
              ],
            },
          },
          {
            header: "Decision",
            cell: (proposal) =>
              proposal.decision_status ? (
                <Badge status={proposal.decision_status} />
              ) : (
                <>
                  <span class="pk-muted" aria-hidden="true">
                    —
                  </span>
                  <span class="pk-sr-only">No decision</span>
                </>
              ),
            width: "fit",
            sort: { asc: "decision", desc: "-decision", defaultDirection: "asc" },
          },
          {
            header: "Score",
            cell: (proposal) => formatAverageScore(proposal.average_review_score),
            className: "pk-mono pk-end",
            width: "fit",
            sort: { asc: "score", desc: "-score" },
          },
          {
            header: "Recommendations",
            cell: recommendationSummary,
            sort: { asc: "recommendations", desc: "-recommendations" },
            filter: {
              param: "recommendation",
              options: [
                { value: "", label: "All recommendations" },
                ...PROPOSAL_RECOMMENDATIONS.map((recommendation) => ({
                  value: recommendation as string,
                  label: recommendationLabel(recommendation),
                })),
              ],
            },
          },
          {
            header: "Reviews",
            cell: (proposal) => proposal.review_count,
            className: "pk-end",
            width: "fit",
            sort: { asc: "reviews", desc: "-reviews" },
          },
          {
            header: "Submitted",
            cell: (proposal) => formatDateTime(proposal.submitted_at),
            width: "fit",
            sort: { asc: "submittedAt", desc: "-submittedAt" },
          },
        ]}
        empty={empty}
        rowKey={(proposal) => proposal.id}
        // The row is a link to the proposal's own page, so it can be opened
        // in a new tab and the address bar follows.
        rowAction={(proposal) => ({ label: `Open ${proposal.title}`, href: rowHref(proposal) })}
      />
    </div>
  );
}

function ProposalStatsSummary({ stats }: { stats: ProposalStats }) {
  return (
    <CollectionTotals
      label="Proposal statistics"
      // Each state's figure wears the tone its status badge wears in the
      // rows; the plain counts stay plain.
      items={[
        { label: "total", value: stats.total },
        { label: "submitted", value: stats.byStatus.submitted ?? 0, tone: "info" },
        { label: "under review", value: stats.byStatus.under_review ?? 0, tone: "accent" },
        { label: "accepted", value: stats.byStatus.accepted ?? 0, tone: "ok" },
        { label: "needs work", value: stats.byStatus["needs-work"] ?? 0, tone: "warn" },
        { label: "reviewed", value: stats.reviewedCount },
        { label: "no reviews", value: stats.unreviewedCount, tone: stats.unreviewedCount > 0 ? "warn" : "neutral" },
      ]}
    />
  );
}
