import { useState, useEffect } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../../../components/Badge";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Tabs } from "../../../../components/Tabs";
import { api, apiCommand } from "../../../api";
import { fmt, toast } from "../../../ui";
import { useData } from "../../../../hooks/useData";
import { FormAnswerTable } from "./FormResponses";
import { AuditLogSection } from "./proposal-detail/AuditLogSection";
import { PresentationVersionsTab } from "./proposal-detail/PresentationVersionsTab";
import { ProposalSidebar } from "./proposal-detail/ProposalSidebar";
import { ProposalReviewsTab } from "./proposal-detail/ProposalReviewsTab";
import { buildReplacementProposerOptions, SpeakerCard } from "./proposal-detail/SpeakerCard";
import { isProposalDecidableStatus } from "../../../../../shared/schemas/proposal-status";
import { useProposalSubresources } from "./proposal-detail/useProposalSubresources";
import type { DetailTab, ProposalResponse } from "./proposal-detail/model";
import { adminProposalDetailResponseSchema } from "../../../../../shared/schemas/admin-event-proposals";
import { adminProposalOpenManageResponseSchema } from "../../../../../shared/schemas/route-contracts-admin-proposals";
import { ProposalDecisionPanel } from "./proposal-detail/ProposalDecisionPanel";

// ─── Main page ────────────────────────────────────────────────────────────────

export function ProposalDetailPage({ slug, proposalId }: { slug: string; proposalId: string }) {
  const [, navigate] = useHashLocation();
  const [activeTab, setActiveTab] = useState<DetailTab>("submission");

  const { data, loading, error, reload } = useData<ProposalResponse>(
    async () => api(`/api/v1/admin/proposals/${proposalId}`, adminProposalDetailResponseSchema),
    [proposalId],
  );

  const subresources = useProposalSubresources(proposalId, reload);
  const {
    reviews,
    reviewPage,
    reviewSummary,
    myReview,
    loadingMoreReviews,
    speakers,
    setSpeakers,
    comments,
    commentPage,
    loadingMoreComments,
    versions,
    versionPage,
    loadingMoreVersions,
    loading: loadingSub,
    savingComment,
    reload: loadSubData,
    reviewSaved: handleReviewSaved,
    addComment,
    loadMoreComments: handleLoadMoreComments,
    loadMoreReviews: handleLoadMoreReviews,
    loadMoreVersions: handleLoadMoreVersions,
  } = subresources;

  // Abstract editing
  const [editingAbstract, setEditingAbstract] = useState(false);
  const [abstractDraft, setAbstractDraft] = useState("");
  const [savingAbstract, setSavingAbstract] = useState(false);

  // Internal comments
  const [commentDraft, setCommentDraft] = useState("");
  // Sync the editable abstract when proposal data (re)loads.
  useEffect(() => {
    if (data?.proposal) {
      setAbstractDraft(data.proposal.abstract);
    }
  }, [data]);

  useEffect(() => {
    if (
      activeTab === "decision" &&
      data?.proposal &&
      !data.proposal.decision_status &&
      !isProposalDecidableStatus(data.proposal.status)
    ) {
      setActiveTab("submission");
    }
  }, [activeTab, data?.proposal]);

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
  const proposalDecidable = isProposalDecidableStatus(proposal.status);
  const reviewCount = reviewSummary.totalReviews;
  const quorumMet = reviewSummary.quorumMet;
  const recommendationCounts = {
    accept: reviewSummary.acceptCount,
    "needs-work": reviewSummary.needsWorkCount,
    reject: reviewSummary.rejectCount,
  };

  const tabItems = [
    { key: "submission", label: "Submission" },
    { key: "speakers", label: `Speakers (${loadingSub ? "…" : speakers.length})` },
    { key: "reviews", label: `Reviews (${loadingSub ? "…" : reviewCount})` },
    ...(canManagePresentation
      ? [
          {
            key: "presentation",
            label: `Presentation${loadingSub ? "" : versions.length > 0 ? ` (${versions.length})` : ""}`,
          },
        ]
      : []),
    { key: "audit-log", label: "Audit Log" },
    ...(access.canFinalize && (proposalDecidable || proposal.decision_status)
      ? [{ key: "decision", label: "Decision" }]
      : []),
  ];

  async function handleFlag(action: "spam" | "duplicate" | "delete") {
    const label = action === "delete" ? "soft-delete" : `mark as ${action}`;
    if (!confirm(`Are you sure you want to ${label} this proposal? This action is not easily reversible.`)) return;
    try {
      await apiCommand(`/api/v1/admin/proposals/${proposalId}/flag`, {
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
      const { manageUrl } = await api(
        `/api/v1/admin/proposals/${proposalId}/open-manage`,
        adminProposalOpenManageResponseSchema,
        {
          method: "POST",
          body: "{}",
        },
      );
      window.open(manageUrl, "_blank", "noopener");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function handleSaveAbstract(e: Event) {
    e.preventDefault();
    setSavingAbstract(true);
    try {
      await apiCommand(`/api/v1/admin/proposals/${proposalId}`, {
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

  async function handleComment(e: Event) {
    e.preventDefault();
    const comment = commentDraft.trim();
    if (!comment) return;
    if (await addComment(comment)) {
      setCommentDraft("");
      toast("Comment added", "success");
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
              {loadingSub ? "…" : reviewCount} / {minReviewsRequired} required
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
                    isCurrentProposer={s.userId === proposal.proposer_user_id}
                    replacementSpeakers={buildReplacementProposerOptions(speakers, s.userId)}
                    requiresPresentation={
                      sessionTypes.find((t) => t.label.toLowerCase() === proposal.proposal_type.toLowerCase())
                        ?.requiresPresentation ?? false
                    }
                    onSaved={(userId, patch) =>
                      setSpeakers((prev) => prev.map((sp) => (sp.userId === userId ? { ...sp, ...patch } : sp)))
                    }
                    onRemoved={() => {
                      void loadSubData();
                      void reload();
                    }}
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
              hasMore={versionPage?.hasMore ?? false}
              loadingMore={loadingMoreVersions}
              onLoadMore={() => void handleLoadMoreVersions()}
              onReload={() => void loadSubData()}
            />
          )}

          {/* ── Reviews tab ── */}
          {activeTab === "reviews" && (
            <ProposalReviewsTab
              proposalId={proposalId}
              loading={loadingSub}
              reviews={reviews}
              page={reviewPage}
              summary={reviewSummary}
              minReviewsRequired={minReviewsRequired}
              canReview={access.canReview}
              reviewLocked={!proposalDecidable}
              myReview={myReview}
              loadingMore={loadingMoreReviews}
              onLoadMore={handleLoadMoreReviews}
              onSaved={handleReviewSaved}
            />
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
          {activeTab === "decision" && access.canFinalize && (proposalDecidable || proposal.decision_status) && (
            <ProposalDecisionPanel
              proposalId={proposalId}
              proposal={proposal}
              reviewCount={reviewCount}
              minReviewsRequired={minReviewsRequired}
              loading={loadingSub}
              onSaved={() => void reload()}
            />
          )}
        </div>

        <ProposalSidebar
          proposal={proposal}
          proposalId={proposalId}
          access={access}
          proposalRequiresPresentation={proposalRequiresPresentation}
          loading={loadingSub}
          reviewCount={reviewCount}
          minReviewsRequired={minReviewsRequired}
          quorumMet={quorumMet}
          averageScore={reviewSummary.averageScore}
          recommendationCounts={recommendationCounts}
          commentDraft={commentDraft}
          savingComment={savingComment}
          comments={comments}
          commentsPage={commentPage}
          loadingMoreComments={loadingMoreComments}
          onCommentDraftChange={setCommentDraft}
          onAddComment={handleComment}
          onLoadMoreComments={handleLoadMoreComments}
          onOpenManage={handleOpenManage}
          onFlag={handleFlag}
        />
      </div>
    </div>
  );
}
