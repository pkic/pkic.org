import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../../../components/Badge";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { Table } from "../../../../components/Table";
import { Tabs } from "../../../../components/Tabs";
import { useData } from "../../../../hooks/useData";
import { usePageState } from "../../../../hooks/usePageState";
import { api } from "../../../api";
import { fmt } from "../../../ui";
import type { ProposalSummary, ProposalAccess } from "../../../types";
import { EventEmail } from "./EventEmail";
import { EventFormResponses } from "./Forms";
import { Invites } from "./Invites";

// ─── Proposals list ───────────────────────────────────────────────────────────

interface ProposalsResponse {
  proposals: ProposalSummary[];
  access: ProposalAccess;
  page?: { offset: number; limit: number; total: number; hasMore: boolean };
  pagination?: { offset: number; limit: number; total: number; hasMore: boolean };
}

type RecommendationFilter = "" | "accept" | "needs-work" | "reject";
type ProposalSort = "submitted_desc" | "score_desc" | "score_asc";

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

function ProposalsList({ slug }: { slug: string }) {
  const { offset, pageSize, resetPage, pagerProps } = usePageState();
  const [statusFilter, setStatusFilter] = useState("");
  const [recommendationFilter, setRecommendationFilter] = useState<RecommendationFilter>("");
  const [sort, setSort] = useState<ProposalSort>("submitted_desc");
  const [, navigate] = useHashLocation();

  const { data, loading, error, reload } = useData<ProposalsResponse>(() => {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (statusFilter) params.set("status", statusFilter);
    if (recommendationFilter) params.set("recommendation", recommendationFilter);
    if (sort !== "submitted_desc") params.set("sort", sort);
    return api<ProposalsResponse>(`/api/v1/admin/events/${slug}/proposals?${params}`);
  }, [slug, statusFilter, recommendationFilter, sort, offset, pageSize]);

  const proposals = data?.proposals ?? [];
  const page = data?.pagination ?? data?.page;
  const total = page?.total ?? 0;
  const hasMore = page?.hasMore ?? false;

  return (
    <div>
      <div class="d-flex gap-2 align-items-center mb-3 flex-wrap">
        <label class="form-label mb-0 small fw-semibold">Status</label>
        <select
          class="form-select form-select-sm adm-filter-select"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter((e.target as HTMLSelectElement).value);
            resetPage();
          }}
        >
          <option value="">All</option>
          <option value="submitted">Submitted</option>
          <option value="under_review">Under Review</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="needs-work">Needs Work</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
        <label class="form-label mb-0 small fw-semibold">Recommendation</label>
        <select
          class="form-select form-select-sm adm-filter-select"
          value={recommendationFilter}
          onChange={(e) => {
            setRecommendationFilter((e.target as HTMLSelectElement).value as RecommendationFilter);
            resetPage();
          }}
        >
          <option value="">All</option>
          <option value="accept">Accept</option>
          <option value="needs-work">Needs Work</option>
          <option value="reject">Reject</option>
        </select>
        <label class="form-label mb-0 small fw-semibold">Sort</label>
        <select
          class="form-select form-select-sm adm-filter-select"
          value={sort}
          onChange={(e) => {
            setSort((e.target as HTMLSelectElement).value as ProposalSort);
            resetPage();
          }}
        >
          <option value="submitted_desc">Submitted newest</option>
          <option value="score_desc">Score high to low</option>
          <option value="score_asc">Score low to high</option>
        </select>
        <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void reload()}>
          ↺ Refresh
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorAlert error={error} />
      ) : (
        <>
          <Table
            heads={[
              "Title",
              "Proposer",
              "Type",
              "Status",
              "Decision",
              "Avg Score",
              "Recommendations",
              "Reviews",
              "Submitted",
              "",
            ]}
            empty="No proposals found"
          >
            {proposals.length > 0 &&
              proposals.map((p) => {
                const proposer =
                  [p.proposer_first_name, p.proposer_last_name].filter(Boolean).join(" ") || p.proposer_email;
                return (
                  <Fragment key={p.id}>
                    <tr>
                      <td class="adm-cell-title">
                        <span class="small">{p.title}</span>
                      </td>
                      <td>
                        <span class="small">{proposer}</span>
                        {proposer !== p.proposer_email && (
                          <>
                            <br />
                            <span class="text-muted small adm-cell-sub-email">{p.proposer_email}</span>
                          </>
                        )}
                      </td>
                      <td class="small">{p.proposal_type}</td>
                      <td>
                        <Badge status={p.status} />
                      </td>
                      <td>
                        {p.decision_status ? (
                          <Badge status={p.decision_status} />
                        ) : (
                          <span class="text-muted small">—</span>
                        )}
                      </td>
                      <td class="mono">{formatAverageScore(p.average_review_score)}</td>
                      <td>{recommendationSummary(p)}</td>
                      <td class="mono">{p.review_count}</td>
                      <td class="mono small">{fmt(p.submitted_at)}</td>
                      <td>
                        <button
                          class="btn btn-sm btn-outline-secondary"
                          onClick={() => navigate(`/events/${slug}/proposal/${p.id}`)}
                        >
                          Review →
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
          </Table>
          <Pager {...pagerProps(proposals.length, total, hasMore)} />
        </>
      )}
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
