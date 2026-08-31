import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Badge } from "../Badge";
import { ApiDataTable, type ApiTableActions } from "../ApiDataTable";
import { FilterSelect } from "../FilterSelect";
import {
  eventProposalsResponseSchema,
  type EventProposalSummary,
  type ProposalAccess,
  type ProposalStats,
} from "../../../shared/schemas/event-proposals";
import { PROPOSAL_ADMIN_STATUS_FILTERS } from "../../../shared/schemas/proposal-status";
import { PROPOSAL_RECOMMENDATIONS, type ProposalRecommendation } from "../../../shared/schemas/proposal-reviews";
import { formatDateTime } from "../../shared/ui";

type RecommendationFilter = "" | ProposalRecommendation;

const VALID_STATUSES = new Set<string>(["", ...PROPOSAL_ADMIN_STATUS_FILTERS]);
const VALID_RECOMMENDATIONS = new Set<RecommendationFilter>(["", ...PROPOSAL_RECOMMENDATIONS]);
const PROPOSAL_FILTER_LABELS: Record<string, string> = {
  active: "Active (excludes withdrawn/rejected/spam)",
  under_review: "Under Review",
  "needs-work": "Needs Work",
};

function formatAverageScore(score: number | null): string {
  if (score == null) return "—";
  return score.toFixed(1).replace(/\.0$/, "");
}

function proposalFilterLabel(value: string): string {
  return PROPOSAL_FILTER_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

function recommendationSummary(proposal: EventProposalSummary) {
  const entries = [
    ["accept", "Accept", proposal.recommendation_accept_count],
    ["needs-work", "Needs work", proposal.recommendation_needs_work_count],
    ["reject", "Reject", proposal.recommendation_reject_count],
  ] as const;
  const visible = entries.filter(([, , count]) => count > 0);
  if (visible.length === 0) return <span class="text-muted small">—</span>;

  return (
    <div class="d-flex gap-1 flex-wrap">
      {visible.map(([status, label, count]) => (
        <Badge key={status} status={status} label={`${label} ${count}`} />
      ))}
    </div>
  );
}

function loadSavedFilters(storageKey?: string): { status: string; recommendation: RecommendationFilter } {
  if (!storageKey) return { status: "active", recommendation: "" };
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return { status: "active", recommendation: "" };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return { status: "active", recommendation: "" };
    const { status, recommendation } = parsed as Record<string, unknown>;
    return {
      status: typeof status === "string" && VALID_STATUSES.has(status) ? status : "active",
      recommendation:
        typeof recommendation === "string" && VALID_RECOMMENDATIONS.has(recommendation as RecommendationFilter)
          ? (recommendation as RecommendationFilter)
          : "",
    };
  } catch {
    return { status: "active", recommendation: "" };
  }
}

/** Shared, D1-backed proposal catalog for every event-scoped program surface. */
export function EventProposalsTable({
  endpoint,
  storageKey,
  onSelect,
  toolbarPrefix,
  empty = "No proposals found",
}: {
  endpoint: string;
  storageKey?: string;
  onSelect: (proposal: EventProposalSummary) => void;
  toolbarPrefix?: (actions: ApiTableActions, access: ProposalAccess | null) => ComponentChildren;
  empty?: string;
}) {
  const initialFilters = loadSavedFilters(storageKey);
  const [statusFilter, setStatusFilter] = useState(initialFilters.status);
  const [recommendationFilter, setRecommendationFilter] = useState<RecommendationFilter>(initialFilters.recommendation);
  const [stats, setStats] = useState<ProposalStats | null>(null);
  const [access, setAccess] = useState<ProposalAccess | null>(null);
  const tableRef = useRef<ApiTableActions | null>(null);

  useEffect(() => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ status: statusFilter, recommendation: recommendationFilter }),
      );
    } catch {
      // Session storage is optional and must never disable server-side filtering.
    }
  }, [storageKey, statusFilter, recommendationFilter]);

  return (
    <div>
      {stats && <ProposalStatsSummary stats={stats} />}
      <ApiDataTable
        caption="Event proposals"
        endpoint={endpoint}
        responseSchema={eventProposalsResponseSchema}
        resolve={(response) => response.proposals}
        resolvePage={(response) => response.page}
        onData={(response) => {
          setStats(response.stats);
          setAccess(response.access);
        }}
        paginate
        initialSort="-submittedAt"
        searchPlaceholder="Search proposals / reviews…"
        params={{
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(recommendationFilter ? { recommendation: recommendationFilter } : {}),
        }}
        actionsRef={tableRef}
        toolbar={({ resetPage }) => (
          <>
            {toolbarPrefix?.({ reload: () => tableRef.current?.reload() ?? Promise.resolve(), resetPage }, access)}
            <FilterSelect
              ariaLabel="Proposal status"
              value={statusFilter}
              options={[
                { value: "", label: "All statuses" },
                ...PROPOSAL_ADMIN_STATUS_FILTERS.map((status) => ({
                  value: status,
                  label: proposalFilterLabel(status),
                })),
              ]}
              onChange={(value) => {
                setStatusFilter(value);
                resetPage();
              }}
            />
            <FilterSelect
              ariaLabel="Review recommendation"
              value={recommendationFilter}
              options={[
                { value: "", label: "All recommendations" },
                ...PROPOSAL_RECOMMENDATIONS.map((recommendation) => ({
                  value: recommendation,
                  label: proposalFilterLabel(recommendation),
                })),
              ]}
              onChange={(value) => {
                setRecommendationFilter(value);
                resetPage();
              }}
            />
          </>
        )}
        columns={[
          {
            header: "Title",
            cell: (proposal) => <span class="small">{proposal.title}</span>,
            sort: { asc: "title", desc: "-title", defaultDirection: "asc" },
          },
          {
            header: "Proposer",
            cell: (proposal) => {
              const proposer =
                [proposal.proposer_first_name, proposal.proposer_last_name].filter(Boolean).join(" ") ||
                proposal.proposer_email;
              return (
                <>
                  <span class="small">{proposer}</span>
                  {proposer !== proposal.proposer_email && (
                    <div class="text-muted small">{proposal.proposer_email}</div>
                  )}
                </>
              );
            },
            sort: { asc: "proposer", desc: "-proposer", defaultDirection: "asc" },
          },
          {
            header: "Type",
            cell: (proposal) => proposal.proposal_type,
            className: "small",
            sort: { asc: "type", desc: "-type", defaultDirection: "asc" },
          },
          {
            header: "Status",
            cell: (proposal) => <Badge status={proposal.status} />,
            sort: { asc: "status", desc: "-status", defaultDirection: "asc" },
          },
          {
            header: "Decision",
            cell: (proposal) =>
              proposal.decision_status ? (
                <Badge status={proposal.decision_status} />
              ) : (
                <span class="text-muted small">—</span>
              ),
            sort: { asc: "decision", desc: "-decision", defaultDirection: "asc" },
          },
          {
            header: "Avg. score",
            cell: (proposal) => formatAverageScore(proposal.average_review_score),
            className: "mono text-end",
            sort: { asc: "score", desc: "-score" },
          },
          {
            header: "Recommendations",
            cell: recommendationSummary,
            sort: { asc: "recommendations", desc: "-recommendations" },
          },
          {
            header: "Reviews",
            cell: (proposal) => proposal.review_count,
            className: "mono text-end",
            sort: { asc: "reviews", desc: "-reviews" },
          },
          {
            header: "Submitted",
            cell: (proposal) => formatDateTime(proposal.submitted_at),
            className: "small",
            sort: { asc: "submittedAt", desc: "-submittedAt" },
          },
        ]}
        empty={empty}
        rowKey={(proposal) => proposal.id}
        rowAction={(proposal) => ({ label: `Open ${proposal.title}`, onSelect: () => onSelect(proposal) })}
      />
    </div>
  );
}

function ProposalStatsSummary({ stats }: { stats: ProposalStats }) {
  const entries = [
    ["Total", stats.total, ""],
    ["Submitted", stats.byStatus.submitted ?? 0, ""],
    ["Under review", stats.byStatus.under_review ?? 0, ""],
    ["Accepted", stats.byStatus.accepted ?? 0, "text-success"],
    ["Needs work", stats.byStatus["needs-work"] ?? 0, "text-warning"],
    ["Reviewed", stats.reviewedCount, ""],
    ["No reviews", stats.unreviewedCount, "text-warning"],
  ] as const;
  return (
    <div class="d-flex gap-3 flex-wrap mb-3 small" aria-label="Proposal statistics">
      {entries.map(([label, value, className]) => (
        <span key={label}>
          <strong class={className}>{value}</strong> {label.toLowerCase()}
        </span>
      ))}
    </div>
  );
}
