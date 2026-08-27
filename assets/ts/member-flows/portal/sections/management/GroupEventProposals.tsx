import { useState } from "preact/hooks";
import {
  eventProposalDetailResponseSchema,
  type EventProposalSummary,
} from "../../../../../shared/schemas/event-proposals";
import { proposalProgramsListResponseSchema } from "../../../../../shared/schemas/proposal-programs";
import {
  cancelAcceptedProposalResponseSchema,
  finalizeProposalResponseSchema,
  proposalPatchResponseSchema,
} from "../../../../../shared/schemas/proposal-management";
import { proposalDecisionPreviewResponseSchema } from "../../../../../shared/schemas/proposal-decisions";
import { isProposalDecidableStatus } from "../../../../../shared/schemas/proposal-status";
import { proposalReviewWriteResponseSchema } from "../../../../../shared/schemas/proposal-reviews";
import { FormAnswerTable } from "../../../../components/forms/FormResponseViews";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { AcceptedProposalCancellationPanel } from "../../../../components/proposals/AcceptedProposalCancellationPanel";
import { ProposalAuditLog } from "../../../../components/proposals/ProposalAuditLog";
import { ProposalDecisionPanel } from "../../../../components/proposals/ProposalDecisionPanel";
import { EventProposalsTable } from "../../../../components/proposals/EventProposalsTable";
import { ProposalInternalCommentsPanel } from "../../../../components/proposals/ProposalInternalCommentsPanel";
import { ProposalReviewsPanel } from "../../../../components/proposals/ProposalReviewsPanel";
import { ProposalSpeakersPanel } from "../../../../components/proposals/ProposalSpeakersPanel";
import { useProposalReviewComments } from "../../../../components/proposals/useProposalReviewComments";
import { useData } from "../../../../hooks/useData";
import { getJson, patchJson, postJson } from "../../../../shared/api-client";
import { fmt, toast } from "../../ui";

function proposalEndpoint(groupId: string, eventId: string, proposalId?: string): string {
  const eventBase = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/proposals`;
  return proposalId ? `${eventBase}/${encodeURIComponent(proposalId)}` : eventBase;
}

function portalSpeakerPath(base: string, userId: string, suffix = ""): string {
  return `${base}/speakers/${encodeURIComponent(userId)}${suffix ? `/${suffix}` : ""}`;
}

export function portalSpeakerAssetPath(base: string, userId: string, asset: "headshot" | "gravatar"): string {
  return `${base}/speakers/${encodeURIComponent(userId)}/${asset}`;
}

function GroupEventProposalDetail({
  groupId,
  eventId,
  proposalId,
  contextLabel,
  onBack,
}: {
  groupId: string;
  eventId: string;
  proposalId: string;
  contextLabel: string | null;
  onBack: () => void;
}) {
  const base = proposalEndpoint(groupId, eventId, proposalId);
  const detail = useData(() => getJson(base, eventProposalDetailResponseSchema), [base]);
  const reviewComments = useProposalReviewComments(base, detail.reload, detail.data?.access.canReview === true);
  const [commentDraft, setCommentDraft] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [editingAbstract, setEditingAbstract] = useState(false);
  const [abstractDraft, setAbstractDraft] = useState("");
  const [savingAbstract, setSavingAbstract] = useState(false);

  if (detail.loading) return <Spinner />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (!detail.data) return null;

  const { proposal, access, form, minReviewsRequired } = detail.data;
  const proposer =
    [proposal.proposer_first_name, proposal.proposer_last_name].filter(Boolean).join(" ") || proposal.proposer_email;
  const canEditAbstract = proposal.status === "accepted" ? access.canEditAcceptedAbstract : access.canFinalize;
  const reviewLocked = !isProposalDecidableStatus(proposal.status);

  async function saveAbstract(event: Event): Promise<void> {
    event.preventDefault();
    setSavingAbstract(true);
    try {
      await patchJson(base, { abstract: abstractDraft }, proposalPatchResponseSchema);
      setEditingAbstract(false);
      toast("Abstract updated", "success");
      await detail.reload();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setSavingAbstract(false);
    }
  }

  async function addComment(event: Event): Promise<void> {
    event.preventDefault();
    const comment = commentDraft.trim();
    if (!comment) return;
    setSavingComment(true);
    try {
      await reviewComments.addComment(comment);
      setCommentDraft("");
      toast("Comment added", "success");
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setSavingComment(false);
    }
  }

  return (
    <div class="d-flex flex-column gap-3">
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onBack}>
          ← All proposals
        </button>
        {contextLabel && <span class="small text-muted">{contextLabel}</span>}
        <h6 class="mb-0">{proposal.title}</h6>
        <Badge status={proposal.status} />
        {proposal.decision_status && <Badge status={proposal.decision_status} />}
        <span class="small text-muted">{proposer}</span>
        <button type="button" class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void detail.reload()}>
          ↺ Refresh
        </button>
      </div>

      <div class="row g-3">
        <div class="col-lg-8 d-flex flex-column gap-3">
          <div class="card">
            <div class="card-header d-flex align-items-center gap-2">
              <h6 class="mb-0">Abstract</h6>
              {canEditAbstract && !editingAbstract && (
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary ms-auto"
                  onClick={() => {
                    setAbstractDraft(proposal.abstract);
                    setEditingAbstract(true);
                  }}
                >
                  Edit abstract
                </button>
              )}
            </div>
            <div class="card-body">
              {editingAbstract ? (
                <form onSubmit={(event) => void saveAbstract(event)}>
                  <textarea
                    class="form-control mb-3"
                    rows={8}
                    value={abstractDraft}
                    onInput={(event) => setAbstractDraft((event.target as HTMLTextAreaElement).value)}
                  />
                  <div class="d-flex gap-2">
                    <button type="submit" class="btn btn-primary" disabled={savingAbstract}>
                      {savingAbstract ? "Saving…" : "Save abstract"}
                    </button>
                    <button type="button" class="btn btn-outline-secondary" onClick={() => setEditingAbstract(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div class="adm-pre-wrap">{proposal.abstract}</div>
              )}
            </div>
            {proposal.details && Object.keys(proposal.details).length > 0 && (
              <>
                <div class="card-header border-top">
                  <h6 class="mb-0 small">
                    Submission answers
                    {form?.title && <span class="text-muted fw-normal ms-2">— {form.title}</span>}
                  </h6>
                </div>
                <div class="card-body p-0">
                  <FormAnswerTable answers={proposal.details} fields={form?.fields} />
                </div>
              </>
            )}
          </div>

          {access.canReview && (
            <div class="card">
              <div class="card-header">
                <h6 class="mb-0">Reviews</h6>
              </div>
              <div class="card-body">
                <ProposalReviewsPanel
                  loading={reviewComments.loading}
                  reviews={reviewComments.reviews}
                  page={reviewComments.reviewPage}
                  summary={reviewComments.reviewSummary}
                  minReviewsRequired={minReviewsRequired}
                  canReview={access.canReview}
                  reviewLocked={reviewLocked}
                  myReview={reviewComments.myReview}
                  loadingMore={reviewComments.loadingMoreReviews}
                  onLoadMore={reviewComments.loadMoreReviews}
                  onSave={async (draft) => {
                    const result = await postJson(`${base}/reviews`, draft, proposalReviewWriteResponseSchema);
                    toast("Review saved", "success");
                    return result.review;
                  }}
                  onSaved={reviewComments.reviewSaved}
                  onError={(error) => toast((error as Error).message, "error")}
                />
              </div>
            </div>
          )}

          {access.canFinalize && (
            <ProposalDecisionPanel
              proposal={proposal}
              reviewCount={proposal.review_count}
              minReviewsRequired={minReviewsRequired}
              onPreview={(input) => postJson(`${base}/finalize-preview`, input, proposalDecisionPreviewResponseSchema)}
              onFinalize={async (input) => {
                await postJson(`${base}/finalize`, input, finalizeProposalResponseSchema);
              }}
              onFinalized={() => void detail.reload()}
              formatDate={fmt}
              notify={toast}
            />
          )}

          {access.canReview && (
            <ProposalSpeakersPanel
              endpoint={base}
              proposalId={proposal.id}
              access={access}
              proposal={proposal}
              sessionTypes={detail.data.sessionTypes}
              onReload={detail.reload}
              notify={toast}
              endpoints={{
                speakerPath: (_speakerProposalId, userId, suffix) => portalSpeakerPath(base, userId, suffix),
                assetPath: (speakerProposalId, userId, asset) =>
                  portalSpeakerAssetPath(proposalEndpoint(groupId, eventId, speakerProposalId), userId, asset),
              }}
            />
          )}

          <AcceptedProposalCancellationPanel
            proposal={proposal}
            canCancel={access.canCancelAcceptedProposal}
            onCancel={async (comment) => {
              const result = await postJson(`${base}/cancel`, { comment }, cancelAcceptedProposalResponseSchema);
              return { notifiedSpeakerCount: result.notifiedSpeakerCount };
            }}
            onCanceled={(notifiedSpeakerCount) => {
              toast(
                `Accepted proposal canceled; ${notifiedSpeakerCount} speaker notification${notifiedSpeakerCount === 1 ? "" : "s"} queued`,
                "success",
              );
              void detail.reload();
            }}
            onError={(error) => toast((error as Error).message, "error")}
          />

          {access.canReview && (
            <div class="card">
              <div class="card-header">
                <h6 class="mb-0">Audit log</h6>
              </div>
              <div class="card-body p-0">
                <ProposalAuditLog endpoint={`${base}/audit-log`} />
              </div>
            </div>
          )}
        </div>

        <aside class="col-lg-4">
          <div class="card">
            <div class="card-header">
              <h6 class="mb-0">Proposal</h6>
            </div>
            <div class="card-body">
              <dl class="mb-0 small">
                <dt>Proposer</dt>
                <dd>{proposer}</dd>
                <dt>Email</dt>
                <dd>{proposal.proposer_email}</dd>
                <dt>Type</dt>
                <dd>{proposal.proposal_type.replaceAll("_", " ")}</dd>
                <dt>Submitted</dt>
                <dd class="mb-0">{fmt(proposal.submitted_at)}</dd>
              </dl>
            </div>
          </div>
          {access.canReview && (
            <ProposalInternalCommentsPanel
              commentDraft={commentDraft}
              savingComment={savingComment}
              comments={reviewComments.comments}
              commentsPage={reviewComments.commentPage}
              loadingMoreComments={reviewComments.loadingMoreComments}
              onCommentDraftChange={setCommentDraft}
              onAddComment={addComment}
              onLoadMoreComments={reviewComments.loadMoreComments}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

/** Program committee surface for a proposal program owned by the selected group event. */
export function GroupEventProposals({ groupId, eventId }: { groupId: string; eventId: string }) {
  const [selected, setSelected] = useState<EventProposalSummary | null>(null);
  const endpoint = proposalEndpoint(groupId, eventId);
  const programCatalog = useData(
    () =>
      getJson(
        `/api/v1/me/proposal-programs?groupId=${encodeURIComponent(groupId)}&eventId=${encodeURIComponent(eventId)}`,
        proposalProgramsListResponseSchema,
      ),
    [eventId, groupId],
  );
  const program = programCatalog.data?.programs[0];

  if (selected) {
    return (
      <GroupEventProposalDetail
        groupId={groupId}
        eventId={eventId}
        proposalId={selected.id}
        contextLabel={program ? `${program.group.name} / ${program.event.name}` : null}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <section aria-label="Event proposals" class="border-top pt-3 mt-3">
      {program && (
        <nav class="small text-muted mb-1" aria-label="Proposal program context">
          <span>{program.group.name}</span>
          <span aria-hidden="true"> / </span>
          <span>{program.event.name}</span>
        </nav>
      )}
      <h6>Proposal program</h6>
      <EventProposalsTable
        endpoint={endpoint}
        storageKey={`portal_proposal_filters_${groupId}_${eventId}`}
        onSelect={setSelected}
        empty="No proposals are available through this event."
      />
    </section>
  );
}
