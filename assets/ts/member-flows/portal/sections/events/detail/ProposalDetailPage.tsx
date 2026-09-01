import { useState, useEffect } from "preact/hooks";
import { useHashQueryParam } from "../../../../../hooks/useHashQueryParam";
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
import { Alert } from "../../../../../ui/Alert";
import { Button } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { StatCard } from "../../../../../ui/StatCard";
import { Textarea } from "../../../../../ui/TextControl";
// `pk-mono` and `pk-answer-pre` are written here as class names rather than
// reached through a component, so this module has to pull their stylesheet
// into its own chunk.
import "../../../../../ui/Content.css";

const DETAIL_TABS: DetailTab[] = ["submission", "speakers", "reviews", "presentation", "audit-log", "decision"];

/**
 * The reader-facing label for a stored vocabulary value. Bootstrap's
 * `text-capitalize` did this in CSS, which meant the words on screen and the
 * words a screen reader announced were two different strings; doing it here
 * keeps them the same one.
 */
function vocabularyLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

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
  const [rawTab, setRawTab] = useHashQueryParam("proposalTab", "submission");
  const activeTab: DetailTab = (DETAIL_TABS as string[]).includes(rawTab) ? (rawTab as DetailTab) : "submission";
  const setActiveTab = (next: DetailTab) => setRawTab(next);

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
    if (data && !data.access.canReview && (activeTab === "reviews" || activeTab === "audit-log")) {
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
    <div class="pk pk-stack">
      {/* ── Header ── */}
      <div class="pk-cluster">
        <Button size="sm" onClick={() => (onBack ? onBack() : navigate(`/events/${slug}/proposals`))}>
          ← Back
        </Button>
        {contextLabel && <span class="pk-small">{contextLabel}</span>}
        <h2>{proposal.title}</h2>
        <Badge status={proposal.status} />
        {proposal.decision_status && <Badge status={proposal.decision_status} />}
        <span class="pk-small">{proposer}</span>
        <span class="pk-small" aria-hidden="true">
          ·
        </span>
        <span class="pk-mono pk-small">{fmt(proposal.submitted_at)}</span>
        <Button size="sm" class="pk-push" onClick={() => void reload()}>
          ↺ Refresh
        </Button>
      </div>

      {/* ── Stat cards ── */}
      <Panel>
        <PanelBody>
          <div class="pk-grid pk-grid--tight">
            <StatCard label="Proposer" value={proposer} note={proposal.proposer_email} />
            <StatCard
              label="Type"
              value={vocabularyLabel(proposal.proposal_type)}
              note={`Submitted ${fmt(proposal.submitted_at)}`}
            />
            {/* The quorum verdict is a word, not a colour: StatCard's tinted
                note variants say "trending up", which is not what a met
                quorum means. */}
            <StatCard
              label="Reviews"
              value={`${loadingSub ? "…" : reviewCount} / ${minReviewsRequired} required`}
              note={quorumMet ? "Quorum met" : "Quorum not met"}
            />
            <StatCard
              label="Decision"
              value={proposal.decision_status ? vocabularyLabel(proposal.decision_status) : "Pending"}
              note={
                proposal.decision_decided_at ? `Recorded ${fmt(proposal.decision_decided_at)}` : "No final decision yet"
              }
            />
          </div>
        </PanelBody>
      </Panel>

      {/* ── Two-column layout ── */}
      <div class="pk-grid pk-grid--roomy">
        {/* Main content */}
        <div class="pk-stack">
          {/* Named for what it switches. The default "Sections" collides with
              the group workspace's own "<group> sections" strip on the same
              page — and its "Audit log" entry — leaving two tab strips a
              reader cannot tell apart. */}
          <Tabs
            items={tabItems}
            active={activeTab}
            label="Proposal sections"
            onChange={(key) => setActiveTab(key as DetailTab)}
          />

          {/* ── Submission tab ── */}
          {activeTab === "submission" && (
            <Panel>
              <PanelHeader title="Abstract">
                {canEditAbstract && !editingAbstract && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setAbstractDraft(proposal.abstract);
                      setEditingAbstract(true);
                    }}
                  >
                    Edit
                  </Button>
                )}
              </PanelHeader>
              <PanelBody>
                {editingAbstract ? (
                  <form class="pk-stack" onSubmit={(e) => void handleSaveAbstract(e)}>
                    <Field label="Abstract">
                      {(control) => (
                        <Textarea
                          {...control}
                          rows={8}
                          value={abstractDraft}
                          onInput={(e) => setAbstractDraft((e.target as HTMLTextAreaElement).value)}
                        />
                      )}
                    </Field>
                    <div class="pk-cluster">
                      <Button type="submit" variant="primary" loading={savingAbstract}>
                        {savingAbstract ? "Saving…" : "Save"}
                      </Button>
                      <Button type="button" onClick={() => setEditingAbstract(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p class="pk-answer-pre">{proposal.abstract || "—"}</p>
                )}
              </PanelBody>

              {proposal.details && Object.keys(proposal.details).length > 0 && (
                <>
                  <PanelHeader
                    headingLevel={4}
                    title={form?.title ? `Submission Answers — ${form.title}` : "Submission Answers"}
                  />
                  <PanelBody>
                    <FormAnswerTable answers={proposal.details} fields={form?.fields} />
                  </PanelBody>
                </>
              )}
            </Panel>
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
              <Alert tone="info">Speaker access requires proposal read permission.</Alert>
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
            <Panel>
              <PanelHeader title="Audit Log" />
              <PanelBody>
                <AuditLogSection proposalId={proposalId} enabled={access.canReview} />
              </PanelBody>
            </Panel>
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
