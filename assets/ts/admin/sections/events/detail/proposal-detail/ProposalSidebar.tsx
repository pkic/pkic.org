import { Badge } from "../../../../../components/Badge";
import { Markdown } from "../../../../../components/Markdown";
import { api } from "../../../../api";
import { proposalReminderResponseSchema } from "../../../../../../shared/schemas/admin-event-proposals";
import type { ProposalAccess, ProposalReview } from "../../../../types";
import { fmt, toast } from "../../../../ui";
import type { PageInfo } from "../../../../../../shared/schemas/pagination";
import type { ProposalDetailRecord, ProposalInternalComment } from "./model";

export function ProposalSidebar({
  proposal,
  proposalId,
  access,
  proposalRequiresPresentation,
  loading,
  reviewCount,
  minReviewsRequired,
  quorumMet,
  averageScore,
  recommendationCounts,
  commentDraft,
  savingComment,
  comments,
  commentsPage,
  loadingMoreComments,
  onCommentDraftChange,
  onAddComment,
  onLoadMoreComments,
  onOpenManage,
  onFlag,
}: {
  proposal: ProposalDetailRecord;
  proposalId: string;
  access: ProposalAccess;
  proposalRequiresPresentation: boolean;
  loading: boolean;
  reviewCount: number;
  minReviewsRequired: number;
  quorumMet: boolean;
  averageScore: number | null;
  recommendationCounts: Record<ProposalReview["recommendation"], number>;
  commentDraft: string;
  savingComment: boolean;
  comments: ProposalInternalComment[];
  commentsPage: PageInfo | null;
  loadingMoreComments: boolean;
  onCommentDraftChange: (value: string) => void;
  onAddComment: (event: Event) => Promise<void>;
  onLoadMoreComments: () => Promise<void>;
  onOpenManage: () => Promise<void>;
  onFlag: (action: "spam" | "duplicate" | "delete") => Promise<void>;
}) {
  async function remindAll(kind: "profile" | "presentation") {
    const path = kind === "profile" ? "remind-speakers" : "remind-presentation";
    try {
      const response = await api(`/api/v1/admin/proposals/${proposalId}/${path}`, proposalReminderResponseSchema, {
        method: "POST",
      });
      toast(
        `${kind === "profile" ? "Profile" : "Presentation"} reminder sent to ${response.queued} speaker(s)`,
        "success",
      );
    } catch (caught) {
      toast((caught as Error).message, "error");
    }
  }

  return (
    <div class="col-lg-4">
      <div class="card mb-3">
        <div class="card-header">
          <h6 class="mb-0">Operator Actions</h6>
        </div>
        <div class="card-body d-grid gap-2">
          <button class="btn btn-primary" onClick={() => void onOpenManage()}>
            Open Proposer Manage Page ↗
          </button>
          <a class="btn btn-outline-secondary" href={`mailto:${proposal.proposer_email}`}>
            Email Proposer
          </a>
          <button
            class="btn btn-outline-secondary"
            onClick={() => void navigator.clipboard.writeText(proposal.proposer_email)}
          >
            Copy Proposer Email
          </button>
          {access.canFinalize && (
            <>
              <hr class="my-1" />
              <button class="btn btn-outline-secondary btn-sm" onClick={() => void remindAll("profile")}>
                ✉ Remind all: complete profile
              </button>
              {proposal.decision_status === "accepted" && proposalRequiresPresentation && (
                <button class="btn btn-outline-secondary btn-sm" onClick={() => void remindAll("presentation")}>
                  ✉ Remind all: upload presentation
                </button>
              )}
            </>
          )}
          {access.canFinalize && !proposal.decision_status && (
            <>
              <hr class="my-1" />
              <button
                class="btn btn-outline-warning btn-sm"
                onClick={() => void onFlag("spam")}
                disabled={proposal.status === "spam"}
              >
                {proposal.status === "spam" ? "Marked as Spam" : "Mark as Spam"}
              </button>
              <button
                class="btn btn-outline-warning btn-sm"
                onClick={() => void onFlag("duplicate")}
                disabled={proposal.status === "duplicate"}
              >
                {proposal.status === "duplicate" ? "Marked as Duplicate" : "Mark as Duplicate"}
              </button>
              <button class="btn btn-outline-danger btn-sm" onClick={() => void onFlag("delete")}>
                Delete Proposal
              </button>
            </>
          )}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h6 class="mb-0">Status</h6>
        </div>
        <div class="card-body">
          <dl class="small mb-0">
            <dt>Workflow status</dt>
            <dd class="mb-2">
              <Badge status={proposal.status} />
            </dd>
            <dt>Decision</dt>
            <dd class="mb-2">
              {proposal.decision_status ? (
                <Badge status={proposal.decision_status} />
              ) : (
                <span class="text-muted">Pending</span>
              )}
            </dd>
            <dt>Reviews</dt>
            <dd class="mb-2">
              {loading ? "…" : reviewCount} / {minReviewsRequired} required
              <div class={`small ${quorumMet ? "text-success" : "text-warning"}`}>
                {quorumMet ? "Quorum met" : "Quorum not met"}
              </div>
              {!loading && reviewCount > 0 && (
                <div class="small text-muted mt-1">
                  Avg score {averageScore == null || Number.isNaN(averageScore) ? "—" : averageScore.toFixed(1)}
                </div>
              )}
              {!loading && reviewCount > 0 && (
                <div class="d-flex gap-1 flex-wrap mt-1">
                  {recommendationCounts.accept > 0 && (
                    <Badge status="accept" label={`Accept ${recommendationCounts.accept}`} />
                  )}
                  {recommendationCounts["needs-work"] > 0 && (
                    <Badge status="needs-work" label={`Needs work ${recommendationCounts["needs-work"]}`} />
                  )}
                  {recommendationCounts.reject > 0 && (
                    <Badge status="reject" label={`Reject ${recommendationCounts.reject}`} />
                  )}
                </div>
              )}
            </dd>
            <dt>Last updated</dt>
            <dd class="mb-0">{fmt(proposal.updated_at)}</dd>
          </dl>
        </div>
      </div>

      {access.canReview && (
        <div class="card mt-3">
          <div class="card-header">
            <h6 class="mb-0">Internal Comments</h6>
          </div>
          <div class="card-body">
            <form onSubmit={(event) => void onAddComment(event)} class="mb-3">
              <textarea
                class="form-control"
                rows={3}
                value={commentDraft}
                onInput={(event) => onCommentDraftChange((event.target as HTMLTextAreaElement).value)}
                placeholder="Add a private committee comment…"
              />
              <div class="d-flex justify-content-between align-items-center gap-2 mt-2">
                <span class="small text-muted">Markdown supported</span>
                <button type="submit" class="btn btn-sm btn-primary" disabled={savingComment || !commentDraft.trim()}>
                  {savingComment ? "Adding…" : "Add Comment"}
                </button>
              </div>
            </form>
            {comments.length === 0 ? (
              <p class="small text-muted mb-0">No internal comments yet.</p>
            ) : (
              <div class="d-flex flex-column gap-2">
                {comments.map((comment) => {
                  const author =
                    [comment.author_first_name, comment.author_last_name].filter(Boolean).join(" ") ||
                    comment.author_email ||
                    "Admin";
                  return (
                    <div class="adm-internal-comment" key={comment.id}>
                      <div class="d-flex gap-2 align-items-center mb-1">
                        <strong class="small">{author}</strong>
                        <span class="small text-muted ms-auto">{fmt(comment.created_at)}</span>
                      </div>
                      <Markdown markdown={comment.comment} className="small mb-0" />
                    </div>
                  );
                })}
                {commentsPage?.hasMore && (
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary"
                    disabled={loadingMoreComments}
                    onClick={() => void onLoadMoreComments()}
                  >
                    {loadingMoreComments ? "Loading…" : "Load more comments"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
