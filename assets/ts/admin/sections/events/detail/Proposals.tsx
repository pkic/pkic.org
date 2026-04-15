import { Fragment } from "preact";
import { useState, useEffect } from "preact/hooks";
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
import { fmt, toast } from "../../../ui";
import type { ProposalSummary, ProposalReview, ProposalSpeaker, ProposalAccess } from "../../../types";
import { EventEmail } from "./EventEmail";
import { Invites } from "./Invites";

// ─── Proposal detail panel ────────────────────────────────────────────────────

function ReviewPanel({ review }: { review: ProposalReview }) {
  const recColour =
    { accept: "success", reject: "danger", "needs-work": "warning" }[review.recommendation] ?? "secondary";
  const reviewer =
    [review.reviewer_first_name, review.reviewer_last_name].filter(Boolean).join(" ") ||
    review.reviewer_email ||
    review.reviewer_user_id;
  return (
    <div class="border rounded p-2 mb-2">
      <div class="d-flex gap-2 align-items-center mb-1 flex-wrap">
        <span class={`badge text-bg-${recColour}`}>{review.recommendation}</span>
        {review.score != null && <span class="mono small">Score: {review.score}</span>}
        <span class="small text-muted">{reviewer}</span>
        <span class="small text-muted ms-auto">{fmt(review.updated_at)}</span>
      </div>
      {review.reviewer_comment && <p class="small mb-1">{review.reviewer_comment}</p>}
      {review.applicant_note && <p class="small text-muted mb-0">Note to applicant: {review.applicant_note}</p>}
    </div>
  );
}

function SpeakerPanel({ speaker }: { speaker: ProposalSpeaker }) {
  const name = [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || speaker.email;
  return (
    <div class="d-flex gap-2 align-items-center border rounded p-2 mb-1">
      <div>
        <strong class="small">{name}</strong>
        {name !== speaker.email && (
          <>
            <br />
            <span class="text-muted small">{speaker.email}</span>
          </>
        )}
      </div>
      <span class="badge text-bg-secondary ms-2">{speaker.role}</span>
      <Badge status={speaker.status} />
      {speaker.organizationName && <span class="small text-muted">({speaker.organizationName})</span>}
      <div class="ms-auto d-flex gap-1 small text-muted">
        {speaker.hasHeadshot && <span>📷</span>}
        {speaker.hasBio && <span>📝</span>}
      </div>
    </div>
  );
}

function ProposalDetail({
  proposal,
  slug,
  access,
}: {
  proposal: ProposalSummary;
  slug: string;
  access: ProposalAccess;
}) {
  const [reviews, setReviews] = useState<ProposalReview[]>([]);
  const [speakers, setSpeakers] = useState<ProposalSpeaker[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [decisionStatus, setDecisionStatus] = useState(proposal.decision_status ?? "");
  const [decisionNote, setDecisionNote] = useState(proposal.decision_note ?? "");
  const [savingDecision, setSavingDecision] = useState(false);
  const [decisionSaveStatus, setDecisionSaveStatus] = useState("");

  useEffect(() => {
    Promise.all([
      api<{ reviews: ProposalReview[] }>(`/api/v1/admin/events/${slug}/proposals/${proposal.id}/reviews`),
      api<{ speakers: ProposalSpeaker[] }>(`/api/v1/admin/events/${slug}/proposals/${proposal.id}/speakers`),
    ])
      .then(([r, s]) => {
        setReviews(r.reviews ?? []);
        setSpeakers(s.speakers ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingReviews(false));
  }, [slug, proposal.id]);

  async function handleDecision(e: Event) {
    e.preventDefault();
    setSavingDecision(true);
    setDecisionSaveStatus("Saving…");
    try {
      await api(`/api/v1/admin/events/${slug}/proposals/${proposal.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ status: decisionStatus, note: decisionNote.trim() || null }),
      });
      toast("Decision saved", "success");
      setDecisionSaveStatus("✓ Saved");
    } catch (e) {
      const msg = (e as Error).message;
      setDecisionSaveStatus(msg);
      toast(msg, "error");
    } finally {
      setSavingDecision(false);
    }
  }

  return (
    <div class="p-3 bg-light border-top">
      <div class="row g-3">
        <div class="col-md-8">
          <h6 class="small fw-semibold text-uppercase text-muted mb-2">Abstract</h6>
          <div class="small adm-pre-wrap">{proposal.abstract || "—"}</div>
        </div>
        <div class="col-md-4">
          <h6 class="small fw-semibold text-uppercase text-muted mb-2">Info</h6>
          <dl class="small mb-0">
            <dt>Type</dt>
            <dd>{proposal.proposal_type}</dd>
            <dt>Submitted</dt>
            <dd>{fmt(proposal.submitted_at)}</dd>
            <dt>Updated</dt>
            <dd>{fmt(proposal.updated_at)}</dd>
          </dl>
        </div>
      </div>

      {/* Speakers */}
      <div class="mt-3 border-top pt-3">
        <h6 class="small fw-semibold text-uppercase text-muted mb-2">Speakers ({speakers.length})</h6>
        {loadingReviews ? <Spinner /> : speakers.map((s) => <SpeakerPanel key={s.userId} speaker={s} />)}
        {!loadingReviews && speakers.length === 0 && <p class="small text-muted fst-italic">No speakers</p>}
      </div>

      {/* Reviews */}
      <div class="mt-3 border-top pt-3">
        <h6 class="small fw-semibold text-uppercase text-muted mb-2">Reviews ({reviews.length})</h6>
        {loadingReviews ? <Spinner /> : reviews.map((r) => <ReviewPanel key={r.id} review={r} />)}
        {!loadingReviews && reviews.length === 0 && <p class="small text-muted fst-italic">No reviews yet</p>}
      </div>

      {/* Decision */}
      {access.canFinalize && (
        <div class="mt-3 border-top pt-3">
          <h6 class="small fw-semibold text-uppercase text-muted mb-2">Decision</h6>
          <form onSubmit={handleDecision} class="d-flex gap-2 align-items-end flex-wrap">
            <div>
              <label class="form-label small fw-semibold">Status</label>
              <select
                class="form-select form-select-sm"
                value={decisionStatus}
                onChange={(e) => setDecisionStatus((e.target as HTMLSelectElement).value)}
              >
                <option value="">None</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="needs_work">Needs Work</option>
                <option value="waitlisted">Waitlisted</option>
              </select>
            </div>
            <div class="adm-flex-1">
              <label class="form-label small fw-semibold">Note (optional)</label>
              <input
                class="form-control form-control-sm"
                type="text"
                value={decisionNote}
                onInput={(e) => setDecisionNote((e.target as HTMLInputElement).value)}
                placeholder="Feedback for proposer…"
              />
            </div>
            <button type="submit" class="btn btn-sm btn-primary" disabled={savingDecision}>
              Save Decision
            </button>
            {decisionSaveStatus && (
              <span class={`small ${decisionSaveStatus.startsWith("✓") ? "text-success" : "text-danger"}`}>
                {decisionSaveStatus}
              </span>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Proposals list ───────────────────────────────────────────────────────────

interface ProposalsResponse {
  proposals: ProposalSummary[];
  access: ProposalAccess;
  pagination: { offset: number; limit: number; total: number; hasMore: boolean };
}

function ProposalsList({ slug }: { slug: string }) {
  const { offset, pageSize, resetPage, pagerProps } = usePageState();
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, loading, error, reload } = useData<ProposalsResponse>(() => {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (statusFilter) params.set("status", statusFilter);
    return api<ProposalsResponse>(`/api/v1/admin/events/${slug}/proposals?${params}`);
  }, [slug, statusFilter, offset, pageSize]);

  const proposals = data?.proposals ?? [];
  const access = data?.access ?? null;
  const total = data?.pagination?.total ?? 0;
  const hasMore = data?.pagination?.hasMore ?? false;

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
          <option value="needs_work">Needs Work</option>
          <option value="withdrawn">Withdrawn</option>
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
            heads={["Title", "Proposer", "Type", "Status", "Decision", "Reviews", "Submitted", ""]}
            empty="No proposals found"
          >
            {proposals.length > 0 &&
              proposals.map((p) => {
                const proposer =
                  [p.proposer_first_name, p.proposer_last_name].filter(Boolean).join(" ") || p.proposer_email;
                const isExpanded = expandedId === p.id;
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
                      <td class="mono">{p.review_count}</td>
                      <td class="mono small">{fmt(p.submitted_at)}</td>
                      <td>
                        <button
                          class="btn btn-sm btn-outline-secondary"
                          onClick={() => setExpandedId((prev) => (prev === p.id ? null : p.id))}
                        >
                          {isExpanded ? "Close ↑" : "Review →"}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} class="p-0">
                          <ProposalDetail
                            proposal={p}
                            slug={slug}
                            access={access ?? { eventPermissions: [], canReview: false, canFinalize: false }}
                          />
                        </td>
                      </tr>
                    )}
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
  const tab = subTab === "invites" || subTab === "email" ? subTab : "proposals";

  return (
    <div>
      <Tabs
        items={[
          { key: "proposals", label: "Overview" },
          { key: "invites", label: "Speaker Invites" },
          { key: "email", label: "Email" },
        ]}
        active={tab}
        onChange={(key) => navigate(`/events/${slug}/proposals/${key === "proposals" ? "" : key}`)}
      />
      {tab === "proposals" && <ProposalsList slug={slug} />}
      {tab === "invites" && <Invites slug={slug} inviteType="speaker" />}
      {tab === "email" && <EventEmail slug={slug} audience="speakers" />}
    </div>
  );
}
