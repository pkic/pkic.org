/**
 * The shared, D1-backed proposal catalog for every event-scoped program
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
import { Badge, statusTone } from "../Badge";
import { ApiDataTable, type ApiTableActions } from "../ApiDataTable";
import { CollectionTotals } from "../CollectionTotals";
import {
  eventProposalsResponseSchema,
  proposalPresentationFilterSchema,
  type EventProposalSummary,
  type ProposalAccess,
  type ProposalStats,
} from "../../../shared/schemas/event-proposals";
import {
  PROPOSAL_ADMIN_STATUS_FILTER_LABELS,
  PROPOSAL_ADMIN_STATUS_FILTERS,
} from "../../../shared/schemas/proposal-status";
import { PROPOSAL_RECOMMENDATIONS } from "../../../shared/schemas/proposal-reviews";
import { proposalSessionTypeLabel, type ProposalSessionType } from "../../../shared/proposal-session-types";
import { formatDate } from "../../shared/ui";

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
  /*
   * Words, not glyphs. A check here meant "recommends accepting" while the
   * same check in Status meant "accepted"; the words keep a recommendation
   * from reading as the decision, and the tone still tells them apart.
   */
  return (
    <div class="pk-cluster">
      {visible.map(([status, count]) => (
        <Badge key={status} status={status} label={`${recommendationLabel(status)} ${String(count)}`} />
      ))}
    </div>
  );
}

function proposerName(proposal: EventProposalSummary): string {
  return [proposal.proposer_first_name, proposal.proposer_last_name].filter(Boolean).join(" ") || "Unnamed proposer";
}

export function EventProposalsTable({
  endpoint,
  urlState,
  rowHref,
  toolbarPrefix,
  initialFilters = { status: "active" },
  empty = "No proposals found",
}: {
  endpoint: string;
  /** Namespace for the list's URL-addressed search, sort, page and filters. */
  urlState: string;
  /** Where a row goes: the proposal's own page. */
  rowHref: (proposal: EventProposalSummary) => string;
  toolbarPrefix?: (
    actions: ApiTableActions,
    access: ProposalAccess | null,
    selectedProposalIds: ReadonlySet<string>,
  ) => ComponentChildren;
  empty?: string;
  initialFilters?: Record<string, string>;
}) {
  const [sessionTypes, setSessionTypes] = useState<ProposalSessionType[] | undefined>();
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
          setSessionTypes(response.sessionTypes);
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
        initialFilters={initialFilters}
        searchPlaceholder="title, speaker or review"
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
          rowLabel: (id) => visibleProposalTitles.current.get(id) ?? "proposal",
        }}
        columns={[
          {
            header: "Title",
            // Two lines before the cut: titles that open with the same words
            // were indistinguishable at one.
            cell: (proposal) => (
              <span class="pk-strong pk-table__wrap" title={proposal.title}>
                {proposal.title}
              </span>
            ),
            width: "primary",
            sort: { asc: "title", desc: "-title", defaultDirection: "asc" },
          },
          {
            header: "Proposer",
            // A name may take a second line, so the column gives its width to the title.
            cell: (proposal) => (
              <span class="pk-table__wrap">
                {proposerName(proposal)}
                {proposal.co_speaker_names.length > 0 && (
                  <span class="pk-muted pk-small"> with {proposal.co_speaker_names.join(", ")}</span>
                )}
              </span>
            ),
            sort: { asc: "proposer", desc: "-proposer", defaultDirection: "asc" },
          },
          {
            header: "Type",
            cell: (proposal) => proposalSessionTypeLabel(proposal.proposal_type, sessionTypes),
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
            header: "Score",
            // The table's tabular figures line the scores up digit under
            // digit; a monospace face only made them look like code.
            cell: (proposal) => formatAverageScore(proposal.average_review_score),
            className: "pk-end",
            width: "fit",
            sort: { asc: "score", desc: "-score" },
          },
          {
            header: "Recommendations",
            cell: recommendationSummary,
            // Up to three worded badges. They stack when the row is tight
            // rather than taking the width the title needs.
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
            defaultHidden: true,
            cell: (proposal) => proposal.review_count,
            className: "pk-end",
            width: "fit",
            sort: { asc: "reviews", desc: "-reviews" },
          },
          {
            header: "Presentation",
            cell: (proposal) =>
              proposal.has_presentation ? (
                <span aria-label="Presentation uploaded">✓</span>
              ) : (
                <span class="pk-muted" aria-label="No presentation uploaded">
                  —
                </span>
              ),
            width: "fit",
            defaultHidden: true,
            filter: {
              param: "presentation",
              options: [
                { value: "", label: "Any presentation status" },
                ...proposalPresentationFilterSchema.options.map((value) => ({
                  value,
                  label: value.charAt(0).toUpperCase() + value.slice(1),
                })),
              ],
            },
          },
          {
            header: "Submitted",
            // The day is what a list compares; the record keeps the minute.
            cell: (proposal) => formatDate(proposal.submitted_at),
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
        { label: "submitted", value: stats.byStatus.submitted ?? 0, tone: statusTone("submitted") },
        { label: "under review", value: stats.byStatus.under_review ?? 0, tone: "accent" },
        { label: "accepted", value: stats.byStatus.accepted ?? 0, tone: "ok" },
        { label: "needs work", value: stats.byStatus["needs-work"] ?? 0, tone: "warn" },
        // "Reviewed" is the total less this figure, so only the gap is shown.
        { label: "no reviews", value: stats.unreviewedCount, tone: "warn" },
      ]}
    />
  );
}
