import { useRef, useState, useEffect } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../../../components/Badge";
import { ApiDataTable, type ApiTableActions } from "../../../../components/Table";
import { Tabs } from "../../../../components/Tabs";
import { fmt } from "../../../ui";
import type { ProposalSummary, ProposalAccess } from "../../../types";
import { EventEmail } from "./EventEmail";
import { EventFormResponses } from "./Forms";
import { Invites } from "./Invites";

// ─── Proposals list ───────────────────────────────────────────────────────────

interface ProposalsResponse {
  proposals: ProposalSummary[];
  access: ProposalAccess;
  stats?: ProposalStats;
  page?: { offset: number; limit: number; total: number; hasMore: boolean };
  pagination?: { offset: number; limit: number; total: number; hasMore: boolean };
}

type RecommendationFilter = "" | "accept" | "needs-work" | "reject";

interface ProposalStats {
  byStatus: Record<string, number>;
  byRecommendation: Record<string, number>;
  reviewedCount: number;
  unreviewedCount: number;
  total: number;
}

function formatAverageScore(score: number | null): string {
  if (score == null) return "—";
  return score.toFixed(1).replace(/\.0$/, "");
}

function recommendationSummary(p: ProposalSummary) {
  const entries = [
    ["accept", "Accept", Number(p.recommendation_accept_count ?? 0)],
    ["needs-work", "Needs work", Number(p.recommendation_needs_work_count ?? 0)],
    ["reject", "Reject", Number(p.recommendation_reject_count ?? 0)],
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

const FILTER_STORAGE_KEY = (slug: string) => `adm_proposal_filters_${slug}`;

const VALID_STATUSES = new Set([
  "",
  "active",
  "submitted",
  "resubmitted",
  "under_review",
  "accepted",
  "rejected",
  "needs-work",
  "withdrawn",
  "spam",
  "duplicate",
]);
const VALID_RECOMMENDATIONS = new Set<RecommendationFilter>(["", "accept", "needs-work", "reject"]);

function loadSavedFilters(slug: string): { status: string; recommendation: RecommendationFilter } {
  try {
    const raw = sessionStorage.getItem(FILTER_STORAGE_KEY(slug));
    if (!raw) return { status: "active", recommendation: "" };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return { status: "", recommendation: "" };
    const { status, recommendation } = parsed as Record<string, unknown>;
    return {
      status: typeof status === "string" && VALID_STATUSES.has(status) ? status : "",
      recommendation:
        typeof recommendation === "string" && VALID_RECOMMENDATIONS.has(recommendation as RecommendationFilter)
          ? (recommendation as RecommendationFilter)
          : "",
    };
  } catch {
    return { status: "", recommendation: "" };
  }
}

function ProposalsList({ slug }: { slug: string }) {
  const saved = loadSavedFilters(slug);
  const [statusFilter, setStatusFilter] = useState(saved.status || "active");
  const [recommendationFilter, setRecommendationFilter] = useState<RecommendationFilter>(saved.recommendation);
  const [stats, setStats] = useState<ProposalStats | null>(null);
  const [, navigate] = useHashLocation();
  const tableRef = useRef<ApiTableActions | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        FILTER_STORAGE_KEY(slug),
        JSON.stringify({ status: statusFilter, recommendation: recommendationFilter }),
      );
    } catch {
      // sessionStorage unavailable
    }
  }, [slug, statusFilter, recommendationFilter]);

  const submitted = stats?.byStatus?.submitted ?? 0;
  const underReview = stats?.byStatus?.under_review ?? 0;
  const accepted = stats?.byStatus?.accepted ?? 0;
  const rejected = stats?.byStatus?.rejected ?? 0;
  const needsWork = stats?.byStatus?.["needs-work"] ?? stats?.byStatus?.needs_work ?? 0;
  const withdrawn = stats?.byStatus?.withdrawn ?? 0;
  const acceptRecommended = stats?.byRecommendation?.accept ?? 0;
  const needsWorkRecommended = stats?.byRecommendation?.["needs-work"] ?? 0;
  const rejectRecommended = stats?.byRecommendation?.reject ?? 0;

  return (
    <div>
      {stats && (
        <div class="adm-mini-stats mb-3">
          <span class="adm-mini-stat">
            <strong>{stats.total}</strong> total
          </span>
          {submitted > 0 && (
            <span class="adm-mini-stat">
              <strong>{submitted}</strong> submitted
            </span>
          )}
          {underReview > 0 && (
            <span class="adm-mini-stat">
              <strong>{underReview}</strong> under review
            </span>
          )}
          {accepted > 0 && (
            <span class="adm-mini-stat">
              <strong class="text-success">{accepted}</strong> accepted
            </span>
          )}
          {needsWork > 0 && (
            <span class="adm-mini-stat">
              <strong class="text-warning">{needsWork}</strong> needs work
            </span>
          )}
          {rejected > 0 && (
            <span class="adm-mini-stat">
              <strong class="text-danger">{rejected}</strong> rejected
            </span>
          )}
          {withdrawn > 0 && (
            <span class="adm-mini-stat">
              <strong>{withdrawn}</strong> withdrawn
            </span>
          )}
          <span class="adm-mini-stat-sep" />
          <span class="adm-mini-stat">
            <strong>{stats.reviewedCount}</strong> reviewed
          </span>
          {stats.unreviewedCount > 0 && (
            <span class="adm-mini-stat">
              <strong class="text-warning">{stats.unreviewedCount}</strong> no reviews
            </span>
          )}
          <span class="adm-mini-stat">
            <strong class="text-success">{acceptRecommended}</strong> accept recs
          </span>
          <span class="adm-mini-stat">
            <strong class="text-warning">{needsWorkRecommended}</strong> needs work recs
          </span>
          <span class="adm-mini-stat">
            <strong class="text-danger">{rejectRecommended}</strong> reject recs
          </span>
        </div>
      )}

      <ApiDataTable<ProposalSummary>
        endpoint={`/api/v1/admin/events/${slug}/proposals`}
        resolve={(d) => {
          const resp = d as ProposalsResponse;
          if (resp.stats) setStats(resp.stats);
          return resp.proposals;
        }}
        resolvePage={(d) => ((d as ProposalsResponse).pagination ?? (d as ProposalsResponse).page)!}
        paginate
        initialSort="submitted_desc"
        searchPlaceholder="Search proposals / reviews…"
        params={{
          ...(statusFilter && { status: statusFilter }),
          ...(recommendationFilter && { recommendation: recommendationFilter }),
        }}
        actionsRef={tableRef}
        deps={[slug, statusFilter, recommendationFilter]}
        toolbar={({ resetPage }) => (
          <>
            <select
              class="form-select form-select-sm adm-filter-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter((e.target as HTMLSelectElement).value);
                resetPage();
              }}
            >
              <option value="">All statuses</option>
              <option value="active">Active (excludes withdrawn/rejected/spam)</option>
              <option value="submitted">Submitted</option>
              <option value="resubmitted">Resubmitted</option>
              <option value="under_review">Under Review</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="needs-work">Needs Work</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="spam">Spam</option>
              <option value="duplicate">Duplicate</option>
            </select>
            <select
              class="form-select form-select-sm adm-filter-select"
              value={recommendationFilter}
              onChange={(e) => {
                setRecommendationFilter((e.target as HTMLSelectElement).value as RecommendationFilter);
                resetPage();
              }}
            >
              <option value="">All recommendations</option>
              <option value="accept">Accept</option>
              <option value="needs-work">Needs Work</option>
              <option value="reject">Reject</option>
            </select>
          </>
        )}
        columns={[
          {
            header: "Title",
            cell: (p) => <span class="small">{p.title}</span>,
            className: "adm-cell-title",
            sort: { asc: "title_asc", desc: "title_desc", defaultDirection: "asc" },
          },
          {
            header: "Proposer",
            cell: (p) => {
              const proposer =
                [p.proposer_first_name, p.proposer_last_name].filter(Boolean).join(" ") || p.proposer_email;
              return (
                <>
                  <span class="small">{proposer}</span>
                  {proposer !== p.proposer_email && (
                    <>
                      <br />
                      <span class="text-muted small adm-cell-sub-email">{p.proposer_email}</span>
                    </>
                  )}
                </>
              );
            },
            sort: { asc: "proposer_asc", desc: "proposer_desc", defaultDirection: "asc" },
          },
          {
            header: { label: "Type", className: "text-center" },
            cell: (p) => p.proposal_type,
            className: "small text-center",
            sort: { asc: "type_asc", desc: "type_desc", defaultDirection: "asc" },
          },
          {
            header: { label: "Status", className: "text-center" },
            cell: (p) => <Badge status={p.status} />,
            className: "text-center",
            sort: { asc: "status_asc", desc: "status_desc", defaultDirection: "asc" },
          },
          {
            header: { label: "Decision", className: "text-center" },
            cell: (p) =>
              p.decision_status ? <Badge status={p.decision_status} /> : <span class="text-muted small">—</span>,
            className: "text-center",
            sort: { asc: "decision_asc", desc: "decision_desc", defaultDirection: "asc" },
          },
          {
            header: { label: "Avg Score", className: "text-end" },
            cell: (p) => formatAverageScore(p.average_review_score),
            className: "mono text-end",
            sort: { asc: "score_asc", desc: "score_desc" },
          },
          {
            header: { label: "Recommendations", className: "text-center" },
            cell: (p) => recommendationSummary(p),
            className: "text-center",
            sort: { asc: "recommendations_asc", desc: "recommendations_desc" },
          },
          {
            header: { label: "Reviews", className: "text-end" },
            cell: (p) => p.review_count,
            className: "mono text-end",
            sort: { asc: "reviews_asc", desc: "reviews_desc" },
          },
          {
            header: "Submitted",
            cell: (p) => fmt(p.submitted_at),
            className: "mono small",
            sort: { asc: "submitted_asc", desc: "submitted_desc" },
          },
          {
            header: "",
            cell: (p) => (
              <div class="d-flex gap-1 align-items-center">
                <span class="btn btn-sm btn-outline-secondary">Review →</span>
                <a
                  class="btn btn-sm btn-outline-secondary"
                  href={`#/events/${slug}/proposal/${p.id}`}
                  target="_blank"
                  rel="noopener"
                  title="Open in new tab"
                  onClick={(e) => e.stopPropagation()}
                >
                  ↗
                </a>
              </div>
            ),
          },
        ]}
        empty="No proposals found"
        rowKey={(p) => p.id}
        onRowClick={(p) => navigate(`/events/${slug}/proposal/${p.id}`)}
      />
    </div>
  );
}

// ─── Proposals compositor ─────────────────────────────────────────────────────

export function Proposals({ slug, subTab }: { slug: string; subTab?: string }) {
  const [, navigate] = useHashLocation();
  const tab = subTab === "invites" || subTab === "email" || subTab === "responses" ? subTab : "proposals";

  return (
    <div>
      <Tabs
        items={[
          { key: "proposals", label: "Overview" },
          { key: "responses", label: "Responses" },
          { key: "invites", label: "Speaker Invites" },
          { key: "email", label: "Email" },
        ]}
        active={tab}
        onChange={(key) => navigate(`/events/${slug}/proposals/${key === "proposals" ? "" : key}`)}
      />
      {tab === "proposals" && <ProposalsList slug={slug} />}
      {tab === "responses" && <EventFormResponses slug={slug} purpose="proposal_submission" />}
      {tab === "invites" && <Invites slug={slug} inviteType="speaker" />}
      {tab === "email" && <EventEmail slug={slug} audience="speakers" />}
    </div>
  );
}
