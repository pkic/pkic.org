import { useState, useEffect } from "preact/hooks";
import { usePortalHashLocation } from "../../../hash-location";
import { Badge } from "../../../../../components/Badge";
import { confirmAction } from "../../../../../components/ConfirmDialog";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Tabs } from "../../../../../components/Tabs";
import { getJson, patchJson, postJson } from "../../../../../shared/api-client";
import { fmt, toast } from "../../../ui";
import { useData } from "../../../../../hooks/useData";
import { FormAnswerTable } from "../../../../../components/forms/FormResponseViews";
import { AuditLogSection } from "./proposal-detail/AuditLogSection";
import { PresentationVersionsTab } from "./proposal-detail/PresentationVersionsTab";
import { ProposalSidebar } from "./proposal-detail/ProposalSidebar";
import { ProposalReviewsTab } from "./proposal-detail/ProposalReviewsTab";
import { proposalSpeakerEndpoints } from "./proposal-detail/proposal-api";
import {
  isProposalDecidableStatus,
  proposalFlagResponseSchema,
} from "../../../../../../shared/schemas/proposal-status";
import { proposalPatchResponseSchema } from "../../../../../../shared/schemas/proposal-management";
import { useProposalSubresources } from "./proposal-detail/useProposalSubresources";
import type { DetailTab, ProposalResponse } from "./proposal-detail/model";
import { eventProposalDetailResponseSchema } from "../../../../../../shared/schemas/event-proposals";
import { proposalAccessLinkResponseSchema } from "../../../../../../shared/schemas/route-contracts-proposal-management";
import { ProposalDecisionPanel } from "./proposal-detail/ProposalDecisionPanel";
import { ProposalCancellationPanel } from "./proposal-detail/ProposalCancellationPanel";
import { proposalResourcePath } from "./proposal-detail/proposal-api";
import { ProposalSpeakersPanel } from "../../../../../components/proposals/ProposalSpeakersPanel";

// ─── Main page ────────────────────────────────────────────────────────────────

export function ProposalDetailPage({
  slug,
  proposalId,
  contextLabel,
  onBack,
}: {
  slug: string;
  proposalId: string;
  contextLabel?: string | null;
  onBack?: () => void;
}) {
  const [, navigate] = usePortalHashLocation();
  const [activeTab, setActiveTab] = useState<DetailTab>("submission");

  const { data, loading, error, reload } = useData<ProposalResponse>(
    async () => getJson(proposalResourcePath(proposalId), eventProposalDetailResponseSchema),
    [proposalId],
  );

  const subresources = useProposalSubresources(proposalId, reload, data?.access);
  const {
    reviews,
    reviewPage,
    reviewSummary,
    myReview,
    loadingMoreReviews,
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

  useEffect(() => {
    if (!data?.access.canReview && (activeTab === "reviews" || activeTab === "audit-log")) {
      setActiveTab("submission");
    }
  }, [activeTab, data?.access.canReview]);

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
  const canEditAbstract = proposal.status === "accepted" ? access.canEditAcceptedAbstract : access.canFinalize;
  const reviewCount = reviewSummary.totalReviews;
  const quorumMet = reviewSummary.quorumMet;
  const recommendationCounts = {
    accept: reviewSummary.acceptCount,
    "needs-work": reviewSummary.needsWorkCount,
    reject: reviewSummary.rejectCount,
  };

  const tabItems = [
    { key: "submission", label: "Submission" },
    { key: "speakers", label: "Speakers" },
    ...(access.canReview ? [{ key: "reviews", label: `Reviews (${loadingSub ? "…" : reviewCount})` }] : []),
    ...(canManagePresentation
      ? [
          {
            key: "presentation",
            label: `Presentation${loadingSub ? "" : versions.length > 0 ? ` (${versions.length})` : ""}`,
          },
        ]
      : []),
    ...(access.canReview ? [{ key: "audit-log", label: "Audit Log" }] : []),
    ...((access.canFinalize && (proposalDecidable || proposal.decision_status)) ||
    (access.canCancelAcceptedProposal && proposal.status === "accepted") ||
    proposal.status === "canceled"
      ? [{ key: "decision", label: "Decision" }]
      : []),
  ];

  async function handleFlag(action: "spam" | "duplicate" | "delete") {
    const verb = action === "delete" ? "Delete" : action === "spam" ? "Mark as spam" : "Mark as duplicate";
    const consequence =
      action === "delete"
        ? "The proposal is soft-deleted and no longer appears in proposal listings"
        : `The proposal status changes to "${action}"`;
    if (
      !(await confirmAction({
        title: `${verb} "${proposal.title}"?`,
        consequences: [consequence, "This is not easily reversible"],
        confirmLabel: verb,
      }))
    )
      return;
    try {
      await postJson(proposalResourcePath(proposalId, "moderations"), { action }, proposalFlagResponseSchema);
      toast(`Proposal ${action === "delete" ? "deleted" : `marked as ${action}`}`, "success");
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function handleOpenManage() {
    try {
      const { manageUrl } = await postJson(
        proposalResourcePath(proposalId, "access-links"),
        {},
        proposalAccessLinkResponseSchema,
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
      await patchJson(proposalResourcePath(proposalId), { abstract: abstractDraft }, proposalPatchResponseSchema);
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
        <button
          class="btn btn-sm btn-outline-secondary"
          onClick={() => (onBack ? onBack() : navigate(`/events/${slug}/proposals`))}
        >
          ← Back
        </button>
        {contextLabel && <span class="text-muted small">{contextLabel}</span>}
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
                {canEditAbstract && !editingAbstract && (
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
          {activeTab === "speakers" &&
            (access.canRead ? (
              <ProposalSpeakersPanel
                endpoint={proposalResourcePath(proposalId)}
                proposalId={proposalId}
                access={access}
                proposal={proposal}
                sessionTypes={sessionTypes}
                onReload={reload}
                notify={toast}
                endpoints={proposalSpeakerEndpoints()}
                inviteEndpoint={proposalResourcePath(proposalId, "speakers")}
                inviteWindow={data.event}
              />
            ) : (
              <p class="text-muted fst-italic">Speaker access requires proposal read permission.</p>
            ))}

          {/* ── Presentation tab ── */}
          {activeTab === "presentation" && (
            <PresentationVersionsTab
              proposalId={proposalId}
              versions={versions}
              loading={loadingSub}
              hasMore={versionPage?.hasMore ?? false}
              loadingMore={loadingMoreVersions}
              canManage={access.canFinalize}
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
                <AuditLogSection proposalId={proposalId} enabled={access.canReview} />
              </div>
            </div>
          )}

          {/* ── Decision and accepted-session cancellation ── */}
          {activeTab === "decision" && (
            <>
              {access.canFinalize && (proposalDecidable || proposal.decision_status) && (
                <ProposalDecisionPanel
                  proposalId={proposalId}
                  proposal={proposal}
                  reviewCount={reviewCount}
                  minReviewsRequired={minReviewsRequired}
                  loading={loadingSub}
                  onSaved={() => void reload()}
                />
              )}
              <ProposalCancellationPanel
                proposalId={proposalId}
                proposal={proposal}
                canCancel={access.canCancelAcceptedProposal}
                onSaved={() => void reload()}
              />
            </>
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
