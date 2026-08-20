import { useState, useEffect, useCallback } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../../../components/Badge";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Markdown } from "../../../../components/Markdown";
import { Tabs } from "../../../../components/Tabs";
import { api } from "../../../api";
import { authEmail } from "../../../state";
import { fmt, toast } from "../../../ui";
import { useData } from "../../../../hooks/useData";
import type { ProposalReview, ProposalSpeaker } from "../../../types";
import { FormAnswerTable } from "./FormResponses";
import { AuditLogSection } from "./proposal-detail/AuditLogSection";
import { PresentationVersionsTab } from "./proposal-detail/PresentationVersionsTab";
import { ProposalSidebar } from "./proposal-detail/ProposalSidebar";
import { ReviewCard } from "./proposal-detail/ReviewCard";
import { SpeakerCard } from "./proposal-detail/SpeakerCard";
import type {
  DecisionPreviewResponse,
  DetailTab,
  PresentationVersion,
  ProposalInternalComment,
  ProposalResponse,
} from "./proposal-detail/model";
import { isNeedsWorkDecision } from "./proposal-detail/model";

// ─── Main page ────────────────────────────────────────────────────────────────

export function ProposalDetailPage({ slug, proposalId }: { slug: string; proposalId: string }) {
  const [, navigate] = useHashLocation();
  const [activeTab, setActiveTab] = useState<DetailTab>("submission");

  const { data, loading, error, reload } = useData<ProposalResponse>(
    () => api<ProposalResponse>(`/api/v1/admin/proposals/${proposalId}`),
    [proposalId],
  );

  const [reviews, setReviews] = useState<ProposalReview[]>([]);
  const [speakers, setSpeakers] = useState<ProposalSpeaker[]>([]);
  const [comments, setComments] = useState<ProposalInternalComment[]>([]);
  const [versions, setVersions] = useState<PresentationVersion[]>([]);
  const [loadingSub, setLoadingSub] = useState(true);

  // Abstract editing
  const [editingAbstract, setEditingAbstract] = useState(false);
  const [abstractDraft, setAbstractDraft] = useState("");
  const [savingAbstract, setSavingAbstract] = useState(false);

  // Review form
  const [reviewRec, setReviewRec] = useState<"accept" | "reject" | "needs-work">("accept");
  const [reviewScore, setReviewScore] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewApplicantNote, setReviewApplicantNote] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  // Internal comments
  const [commentDraft, setCommentDraft] = useState("");
  const [savingComment, setSavingComment] = useState(false);

  // Sync review form from the admin's own review whenever reviews load
  useEffect(() => {
    const mine = reviews.find((r) => r.reviewer_email === authEmail.value);
    if (mine) {
      setReviewRec(mine.recommendation as typeof reviewRec);
      setReviewScore(mine.score != null ? String(mine.score) : "");
      setReviewComment(mine.reviewer_comment ?? "");
      setReviewApplicantNote(mine.applicant_note ?? "");
    }
  }, [reviews]);

  // Decision form
  const [decisionStatus, setDecisionStatus] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [savingDecision, setSavingDecision] = useState(false);
  const [previewingDecision, setPreviewingDecision] = useState(false);
  const [decisionPreview, setDecisionPreview] = useState<DecisionPreviewResponse | null>(null);
  const [decisionPreviewConfirmed, setDecisionPreviewConfirmed] = useState(false);
  const [decisionPreviewTab, setDecisionPreviewTab] = useState<"html" | "text">("html");
  const [selectedDecisionPreviewId, setSelectedDecisionPreviewId] = useState("");

  const loadSubData = useCallback(async () => {
    setLoadingSub(true);
    try {
      const [r, s, c, v] = await Promise.all([
        api<{ reviews: ProposalReview[] }>(`/api/v1/admin/proposals/${proposalId}/reviews`).catch(() => ({
          reviews: [],
        })),
        api<{ speakers: ProposalSpeaker[] }>(`/api/v1/admin/proposals/${proposalId}/speakers`).catch(() => ({
          speakers: [],
        })),
        api<{ comments: ProposalInternalComment[] }>(`/api/v1/admin/proposals/${proposalId}/comments`).catch(() => ({
          comments: [],
        })),
        api<{ versions: PresentationVersion[] }>(`/api/v1/admin/proposals/${proposalId}/presentation/versions`).catch(
          () => ({ versions: [] }),
        ),
      ]);
      setReviews(r.reviews ?? []);
      setSpeakers(s.speakers ?? []);
      setComments(c.comments ?? []);
      setVersions(v.versions ?? []);
    } catch {
      // non-fatal
    } finally {
      setLoadingSub(false);
    }
  }, [proposalId]);

  useEffect(() => {
    void loadSubData();
  }, [loadSubData]);

  // Sync decision/abstract form state when proposal data (re)loads
  useEffect(() => {
    if (data?.proposal) {
      setDecisionStatus(
        isNeedsWorkDecision(data.proposal.decision_status ?? "") ? "needs-work" : (data.proposal.decision_status ?? ""),
      );
      setDecisionNote(data.proposal.decision_note ?? "");
      setAbstractDraft(data.proposal.abstract);
    }
  }, [data]);

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;

  const { proposal, access, form, minReviewsRequired, sessionTypes } = data;
  const proposer =
    [proposal.proposer_first_name, proposal.proposer_last_name].filter(Boolean).join(" ") || proposal.proposer_email;
  const proposalRequiresPresentation =
    sessionTypes.find((t) => t.label.toLowerCase() === proposal.proposal_type.toLowerCase())?.requiresPresentation ??
    false;
  const canManagePresentation = proposal.status === "accepted" || proposalRequiresPresentation || versions.length > 0;
  const quorumMet = reviews.length >= minReviewsRequired;
  const needsWorkRequiresNote = isNeedsWorkDecision(decisionStatus) && !decisionNote.trim();
  const selectedDecisionPreview =
    decisionPreview?.messages.find((message) => message.id === selectedDecisionPreviewId) ??
    decisionPreview?.messages[0] ??
    null;
  const scoredReviews = reviews.filter((review) => review.score != null);
  const averageScore =
    scoredReviews.length > 0
      ? scoredReviews.reduce((sum, review) => sum + (review.score ?? 0), 0) / scoredReviews.length
      : null;
  const recommendationCounts = reviews.reduce(
    (counts, review) => {
      if (review.recommendation in counts) {
        counts[review.recommendation] += 1;
      }
      return counts;
    },
    { accept: 0, "needs-work": 0, reject: 0 } as Record<ProposalReview["recommendation"], number>,
  );

  useEffect(() => {
    setDecisionPreview(null);
    setDecisionPreviewConfirmed(false);
    setSelectedDecisionPreviewId("");
    setDecisionPreviewTab("html");
  }, [decisionStatus, decisionNote]);

  useEffect(() => {
    if (!decisionPreview?.messages.length) return;
    setSelectedDecisionPreviewId((current) =>
      current && decisionPreview.messages.some((message) => message.id === current)
        ? current
        : decisionPreview.messages[0].id,
    );
  }, [decisionPreview]);

  const tabItems = [
    { key: "submission", label: "Submission" },
    { key: "speakers", label: `Speakers (${loadingSub ? "…" : speakers.length})` },
    { key: "reviews", label: `Reviews (${loadingSub ? "…" : reviews.length})` },
    ...(canManagePresentation
      ? [
          {
            key: "presentation",
            label: `Presentation${loadingSub ? "" : versions.length > 0 ? ` (${versions.length})` : ""}`,
          },
        ]
      : []),
    { key: "audit-log", label: "Audit Log" },
    ...(access.canFinalize ? [{ key: "decision", label: "Decision" }] : []),
  ];

  async function handleFlag(action: "spam" | "duplicate" | "delete") {
    const label = action === "delete" ? "soft-delete" : `mark as ${action}`;
    if (!confirm(`Are you sure you want to ${label} this proposal? This action is not easily reversible.`)) return;
    try {
      await api(`/api/v1/admin/proposals/${proposalId}/flag`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      toast(`Proposal ${action === "delete" ? "deleted" : `marked as ${action}`}`, "success");
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function handleOpenManage() {
    try {
      const { manageUrl } = await api<{ manageUrl: string }>(`/api/v1/admin/proposals/${proposalId}/open-manage`, {
        method: "POST",
        body: "{}",
      });
      window.open(manageUrl, "_blank", "noopener");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function handleSaveAbstract(e: Event) {
    e.preventDefault();
    setSavingAbstract(true);
    try {
      await api(`/api/v1/admin/proposals/${proposalId}`, {
        method: "PATCH",
        body: JSON.stringify({ abstract: abstractDraft }),
      });
      setEditingAbstract(false);
      toast("Abstract updated", "success");
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSavingAbstract(false);
    }
  }

  async function handleReview(e: Event) {
    e.preventDefault();
    setSavingReview(true);
    try {
      const score = parseInt(reviewScore, 10);
      const body: Record<string, unknown> = { recommendation: reviewRec, score };
      if (reviewComment.trim()) body.reviewerComment = reviewComment.trim();
      if (reviewApplicantNote.trim()) body.applicantNote = reviewApplicantNote.trim();
      const result = await api<{ review: ProposalReview }>(`/api/v1/admin/proposals/${proposalId}/reviews`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setReviews((prev) => {
        const idx = prev.findIndex((r) => r.reviewer_user_id === result.review.reviewer_user_id);
        return idx >= 0 ? prev.map((r, i) => (i === idx ? result.review : r)) : [...prev, result.review];
      });
      toast("Review saved", "success");
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSavingReview(false);
    }
  }

  async function handleComment(e: Event) {
    e.preventDefault();
    const comment = commentDraft.trim();
    if (!comment) return;
    setSavingComment(true);
    try {
      const result = await api<{ comment: ProposalInternalComment }>(`/api/v1/admin/proposals/${proposalId}/comments`, {
        method: "POST",
        body: JSON.stringify({ comment }),
      });
      if (result.comment) {
        setComments((prev) => [result.comment, ...prev]);
      }
      setCommentDraft("");
      toast("Comment added", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSavingComment(false);
    }
  }

  async function handleDecision(e: Event) {
    e.preventDefault();
    if (!decisionStatus) return;
    if (!decisionPreview || !decisionPreviewConfirmed) {
      toast("Preview and confirm the outgoing email first", "error");
      return;
    }
    setSavingDecision(true);
    try {
      await api(`/api/v1/admin/proposals/${proposalId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ finalStatus: decisionStatus, decisionNote: decisionNote.trim() || undefined }),
      });
      toast("Decision saved", "success");
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSavingDecision(false);
    }
  }

  async function handlePreviewDecision() {
    if (!decisionStatus) return;
    setPreviewingDecision(true);
    try {
      const preview = await api<DecisionPreviewResponse>(`/api/v1/admin/proposals/${proposalId}/finalize-preview`, {
        method: "POST",
        body: JSON.stringify({ finalStatus: decisionStatus, decisionNote: decisionNote.trim() || undefined }),
      });
      setDecisionPreview(preview);
      setDecisionPreviewConfirmed(false);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setPreviewingDecision(false);
    }
  }

  function decisionEmailLabel(templateKey: string): string {
    switch (templateKey) {
      case "proposal_decision":
        return "Decision Email";
      case "speaker_profile_request":
        return "Profile Request";
      case "presentation_upload_request":
        return "Presentation Upload";
      default:
        return templateKey.replace(/_/g, " ");
    }
  }

  return (
    <div>
      {/* ── Header ── */}
      <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <button class="btn btn-sm btn-outline-secondary" onClick={() => navigate(`/events/${slug}/proposals`)}>
          ← Back
        </button>
        <h5 class="mb-0 me-1">{proposal.title}</h5>
        <Badge status={proposal.status} />
        {proposal.decision_status && <Badge status={proposal.decision_status} />}
        <span class="text-muted small ms-1">{proposer}</span>
        <span class="text-muted small">·</span>
        <span class="mono small text-muted">{fmt(proposal.submitted_at)}</span>
        <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void reload()}>
          ↺ Refresh
        </button>
      </div>

      {/* ── Stat cards ── */}
      <div class="row g-2 mb-3">
        <div class="col-sm-6 col-md-3">
          <div class="card card-body p-3 h-100">
            <div class="small text-muted mb-1">Proposer</div>
            <div class="fw-semibold">{proposer}</div>
            <div class="small text-muted">{proposal.proposer_email}</div>
          </div>
        </div>
        <div class="col-sm-6 col-md-3">
          <div class="card card-body p-3 h-100">
            <div class="small text-muted mb-1">Type</div>
            <div class="text-capitalize">{proposal.proposal_type.replace(/_/g, " ")}</div>
            <div class="small text-muted">Submitted {fmt(proposal.submitted_at)}</div>
          </div>
        </div>
        <div class="col-sm-6 col-md-3">
          <div class="card card-body p-3 h-100">
            <div class="small text-muted mb-1">Reviews</div>
            <div>
              {loadingSub ? "…" : reviews.length} / {minReviewsRequired} required
            </div>
            <div class={`small ${quorumMet ? "text-success" : "text-warning"}`}>
              {quorumMet ? "Quorum met ✓" : "Quorum not met"}
            </div>
          </div>
        </div>
        <div class="col-sm-6 col-md-3">
          <div class="card card-body p-3 h-100">
            <div class="small text-muted mb-1">Decision</div>
            <div class="text-capitalize">
              {proposal.decision_status ? proposal.decision_status.replace(/[_-]/g, " ") : "Pending"}
            </div>
            <div class="small text-muted">
              {proposal.decision_decided_at ? `Recorded ${fmt(proposal.decision_decided_at)}` : "No final decision yet"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div class="row g-3">
        {/* Main content */}
        <div class="col-lg-8">
          <Tabs
            items={tabItems}
            active={activeTab}
            onChange={(key) => setActiveTab(key as DetailTab)}
            className="mb-3"
          />

          {/* ── Submission tab ── */}
          {activeTab === "submission" && (
            <div class="card">
              <div class="card-header d-flex align-items-center gap-2">
                <h6 class="mb-0">Abstract</h6>
                {access.canFinalize && !editingAbstract && (
                  <button
                    class="btn btn-sm btn-outline-secondary ms-auto"
                    onClick={() => {
                      setAbstractDraft(proposal.abstract);
                      setEditingAbstract(true);
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>
              <div class="card-body">
                {editingAbstract ? (
                  <form onSubmit={(e) => void handleSaveAbstract(e)}>
                    <textarea
                      class="form-control mb-3"
                      rows={8}
                      value={abstractDraft}
                      onInput={(e) => setAbstractDraft((e.target as HTMLTextAreaElement).value)}
                    />
                    <div class="d-flex gap-2">
                      <button type="submit" class="btn btn-primary" disabled={savingAbstract}>
                        {savingAbstract ? "Saving…" : "Save"}
                      </button>
                      <button type="button" class="btn btn-outline-secondary" onClick={() => setEditingAbstract(false)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div class="adm-pre-wrap">{proposal.abstract || "—"}</div>
                )}
              </div>

              {proposal.details && Object.keys(proposal.details).length > 0 && (
                <>
                  <div class="card-header border-top">
                    <h6 class="mb-0 small">
                      Submission Answers
                      {form?.title && <span class="text-muted fw-normal ms-2">— {form.title}</span>}
                    </h6>
                  </div>
                  <div class="card-body p-0">
                    <FormAnswerTable answers={proposal.details} fields={form?.fields} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Speakers tab ── */}
          {activeTab === "speakers" && (
            <div>
              {loadingSub ? (
                <Spinner />
              ) : speakers.length === 0 ? (
                <p class="text-muted fst-italic">No speakers assigned yet.</p>
              ) : (
                speakers.map((s) => (
                  <SpeakerCard
                    key={s.userId}
                    speaker={s}
                    proposalId={proposalId}
                    canEdit={access.canReview}
                    canFinalize={access.canFinalize}
                    decisionStatus={proposal.decision_status}
                    requiresPresentation={
                      sessionTypes.find((t) => t.label.toLowerCase() === proposal.proposal_type.toLowerCase())
                        ?.requiresPresentation ?? false
                    }
                    onSaved={(userId, patch) =>
                      setSpeakers((prev) => prev.map((sp) => (sp.userId === userId ? { ...sp, ...patch } : sp)))
                    }
                  />
                ))
              )}
            </div>
          )}

          {/* ── Presentation tab ── */}
          {activeTab === "presentation" && (
            <PresentationVersionsTab
              proposalId={proposalId}
              versions={versions}
              loading={loadingSub}
              onReload={() => void loadSubData()}
            />
          )}

          {/* ── Reviews tab ── */}
          {activeTab === "reviews" && (
            <div>
              <div class="card mb-3">
                <div class="card-body py-2 px-3">
                  <div class="d-flex align-items-center gap-3 flex-wrap">
                    <span class="text-muted small">Review progress</span>
                    <strong class="small">
                      {loadingSub ? "…" : reviews.length} / {minReviewsRequired}
                    </strong>
                    {quorumMet ? (
                      <span class="badge text-bg-success">Quorum met</span>
                    ) : (
                      <span class="badge text-bg-warning">
                        {minReviewsRequired - (loadingSub ? 0 : reviews.length)} more needed
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {loadingSub ? (
                <Spinner />
              ) : reviews.length === 0 ? (
                <p class="text-muted fst-italic">No reviews yet.</p>
              ) : (
                reviews.map((r) => <ReviewCard key={r.id} review={r} />)
              )}

              {access.canReview && !loadingSub && (
                <div class="card mt-3">
                  <div class="card-header">
                    <h6 class="mb-0">
                      {reviews.some((r) => r.reviewer_email === authEmail.value) ? "Edit My Review" : "Add Review"}
                    </h6>
                  </div>
                  <div class="card-body">
                    <form onSubmit={(e) => void handleReview(e)}>
                      <div class="row g-3">
                        <div class="col-md-5">
                          <label class="form-label fw-semibold">Recommendation</label>
                          <select
                            class="form-select"
                            value={reviewRec}
                            required
                            onChange={(e) => setReviewRec((e.target as HTMLSelectElement).value as typeof reviewRec)}
                          >
                            <option value="accept">Accept</option>
                            <option value="needs-work">Needs Work</option>
                            <option value="reject">Reject</option>
                          </select>
                        </div>
                        <div class="col-md-3">
                          <label class="form-label fw-semibold">Score (1–10)</label>
                          <input
                            class="form-control"
                            type="number"
                            min="1"
                            max="10"
                            required
                            value={reviewScore}
                            onInput={(e) => setReviewScore((e.target as HTMLInputElement).value)}
                            placeholder="1–10"
                          />
                        </div>
                        <div class="col-12">
                          <label class="form-label fw-semibold">
                            Internal review notes
                            <span class="text-muted fw-normal ms-2 small">Private · Markdown supported</span>
                          </label>
                          <textarea
                            class="form-control"
                            rows={3}
                            value={reviewComment}
                            onInput={(e) => setReviewComment((e.target as HTMLTextAreaElement).value)}
                            placeholder="Private notes for the organizing team…"
                          />
                        </div>
                        <div class="col-12">
                          <hr class="my-2" />
                          <label class="form-label fw-semibold">
                            Suggested note to applicant
                            <span class="text-muted fw-normal ms-2 small">
                              Optional · private draft · Markdown supported
                            </span>
                          </label>
                          <textarea
                            class="form-control"
                            rows={3}
                            value={reviewApplicantNote}
                            onInput={(e) => setReviewApplicantNote((e.target as HTMLTextAreaElement).value)}
                            placeholder="Feedback or clarification request for the applicant…"
                          />
                        </div>
                        <div class="col-12">
                          <button type="submit" class="btn btn-primary" disabled={savingReview}>
                            {savingReview ? "Saving…" : "Submit Review"}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Audit log tab ── */}
          {activeTab === "audit-log" && (
            <div class="card">
              <div class="card-header">
                <h6 class="mb-0">Audit Log</h6>
              </div>
              <div class="card-body p-0">
                <AuditLogSection proposalId={proposalId} />
              </div>
            </div>
          )}

          {/* ── Decision tab (finalizers only) ── */}
          {activeTab === "decision" && access.canFinalize && (
            <div class="card">
              <div class="card-header">
                <h6 class="mb-0">Final Decision</h6>
              </div>
              <div class="card-body">
                {proposal.decision_status ? (
                  <div class="alert alert-info mb-0">
                    <div class="d-flex gap-2 align-items-center mb-1">
                      <strong>Decision recorded:</strong>
                      <Badge status={proposal.decision_status} />
                    </div>
                    {proposal.decision_note && (
                      <Markdown markdown={proposal.decision_note} className="small mt-2 mb-0" />
                    )}
                    {proposal.decision_decided_at && (
                      <div class="small text-muted mt-2">Recorded {fmt(proposal.decision_decided_at)}</div>
                    )}
                  </div>
                ) : (
                  <>
                    {!quorumMet && !loadingSub && (
                      <div class="alert alert-warning">
                        <strong>Quorum not met.</strong> {reviews.length} of {minReviewsRequired} required review
                        {minReviewsRequired !== 1 ? "s" : ""} completed. Add more reviews before finalizing.
                      </div>
                    )}
                    <form onSubmit={(e) => void handleDecision(e)}>
                      <div class="row g-3">
                        <div class="col-md-4">
                          <label class="form-label fw-semibold">Decision</label>
                          <select
                            class="form-select"
                            value={decisionStatus}
                            onChange={(e) => setDecisionStatus((e.target as HTMLSelectElement).value)}
                          >
                            <option value="">— select —</option>
                            <option value="accepted">Accepted</option>
                            <option value="needs-work">Needs Work</option>
                            <option value="rejected">Rejected</option>
                          </select>
                        </div>
                        <div class="col-12">
                          <label class="form-label fw-semibold">
                            Note to applicant
                            {isNeedsWorkDecision(decisionStatus) && <span class="text-danger ms-1">* required</span>}
                            <span class="text-muted fw-normal ms-2 small">
                              Sent in decision email · Markdown supported
                            </span>
                          </label>
                          <textarea
                            class={`form-control${needsWorkRequiresNote ? " is-invalid" : ""}`}
                            rows={4}
                            value={decisionNote}
                            onInput={(e) => setDecisionNote((e.target as HTMLTextAreaElement).value)}
                            placeholder={
                              isNeedsWorkDecision(decisionStatus)
                                ? "Describe what changes or clarifications are needed…"
                                : "Optional feedback for the proposer…"
                            }
                          />
                          {needsWorkRequiresNote && (
                            <div class="invalid-feedback">A note is required when requesting work.</div>
                          )}
                        </div>
                        <div class="col-12">
                          <div class="d-flex gap-2 align-items-center flex-wrap">
                            <button
                              type="button"
                              class="btn btn-outline-primary"
                              onClick={() => void handlePreviewDecision()}
                              disabled={previewingDecision || !decisionStatus || needsWorkRequiresNote}
                            >
                              {previewingDecision ? "Previewing…" : "Preview Emails"}
                            </button>
                            {decisionPreview && (
                              <span class="small text-muted">
                                {decisionPreview.emailCount} email{decisionPreview.emailCount === 1 ? "" : "s"} to{" "}
                                {decisionPreview.recipientCount} recipient
                                {decisionPreview.recipientCount === 1 ? "" : "s"}
                                {(decisionPreview.layoutMissing ||
                                  (decisionPreview.missingTemplateKeys?.length ?? 0) > 0) && (
                                  <span class="text-warning ms-2">⚠ Configuration issues — see preview</span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                        {decisionPreview && selectedDecisionPreview && (
                          <div class="col-12">
                            <div class="card border">
                              <div class="card-header bg-light small fw-semibold">Email Preview</div>
                              <div class="card-body">
                                {decisionPreview.layoutMissing && (
                                  <div class="alert alert-warning small py-2 mb-3">
                                    <strong>Email layout template not configured.</strong> Emails will render without
                                    your branded layout. Configure the <code>email_layout</code> template to fix this.
                                  </div>
                                )}
                                {(decisionPreview.missingTemplateKeys?.length ?? 0) > 0 && (
                                  <div class="alert alert-warning small py-2 mb-3">
                                    <strong>
                                      Missing email template
                                      {(decisionPreview.missingTemplateKeys?.length ?? 0) > 1 ? "s" : ""}:
                                    </strong>{" "}
                                    <code>{decisionPreview.missingTemplateKeys?.join(", ")}</code>. These notifications
                                    will not be sent until the templates are configured.
                                  </div>
                                )}
                                <div class="row g-3">
                                  <div class="col-lg-4">
                                    <div class="small text-muted mb-2">Outgoing emails</div>
                                    <div class="list-group">
                                      {decisionPreview.messages.map((message) => (
                                        <button
                                          key={message.id}
                                          type="button"
                                          class={`list-group-item list-group-item-action${message.id === selectedDecisionPreview.id ? " active" : ""}`}
                                          onClick={() => setSelectedDecisionPreviewId(message.id)}
                                        >
                                          <div class="fw-semibold small">{decisionEmailLabel(message.templateKey)}</div>
                                          <div class="small">{message.recipientLabel}</div>
                                          <div class="small text-break">{message.recipientEmail}</div>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <div class="col-lg-8">
                                    <div class="small text-muted">To</div>
                                    <div class="fw-semibold mb-2">
                                      {selectedDecisionPreview.recipientLabel} &lt;
                                      {selectedDecisionPreview.recipientEmail}&gt;
                                    </div>
                                    <div class="small text-muted">Subject</div>
                                    <div class="fw-semibold mb-2">{selectedDecisionPreview.subject}</div>
                                    <Tabs
                                      items={[
                                        { key: "html", label: "HTML" },
                                        { key: "text", label: "Text" },
                                      ]}
                                      active={decisionPreviewTab}
                                      onChange={(key) => setDecisionPreviewTab(key as "html" | "text")}
                                      className="mb-2"
                                    />
                                    {decisionPreviewTab === "html" &&
                                      (selectedDecisionPreview.templateMissing ? (
                                        <div class="alert alert-warning small mb-0">
                                          Email template <code>{selectedDecisionPreview.templateKey}</code> is not
                                          configured. This notification will not be sent until the template is
                                          activated.
                                        </div>
                                      ) : (
                                        <iframe
                                          srcdoc={selectedDecisionPreview.html}
                                          sandbox=""
                                          class="adm-email-preview-frame"
                                        />
                                      ))}
                                    {decisionPreviewTab === "text" && (
                                      <pre class="json-out adm-email-preview-text">{selectedDecisionPreview.text}</pre>
                                    )}
                                    <div class="form-check mt-2">
                                      <input
                                        class="form-check-input"
                                        type="checkbox"
                                        id="proposal-decision-preview-confirm"
                                        checked={decisionPreviewConfirmed}
                                        onChange={(e) =>
                                          setDecisionPreviewConfirmed((e.target as HTMLInputElement).checked)
                                        }
                                      />
                                      <label class="form-check-label small" for="proposal-decision-preview-confirm">
                                        I reviewed the outgoing email preview and confirm this decision send.
                                      </label>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        <div class="col-12">
                          <button
                            type="submit"
                            class="btn btn-primary"
                            disabled={
                              savingDecision ||
                              !decisionStatus ||
                              !quorumMet ||
                              needsWorkRequiresNote ||
                              !decisionPreview ||
                              !decisionPreviewConfirmed
                            }
                            title={!quorumMet ? `Requires ${minReviewsRequired} reviews` : undefined}
                          >
                            {savingDecision ? "Saving…" : "Record Decision"}
                          </button>
                        </div>
                      </div>
                    </form>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <ProposalSidebar
          proposal={proposal}
          proposalId={proposalId}
          access={access}
          proposalRequiresPresentation={proposalRequiresPresentation}
          loading={loadingSub}
          reviews={reviews}
          minReviewsRequired={minReviewsRequired}
          quorumMet={quorumMet}
          averageScore={averageScore}
          recommendationCounts={recommendationCounts}
          commentDraft={commentDraft}
          savingComment={savingComment}
          comments={comments}
          onCommentDraftChange={setCommentDraft}
          onAddComment={handleComment}
          onOpenManage={handleOpenManage}
          onFlag={handleFlag}
        />
      </div>
    </div>
  );
}
