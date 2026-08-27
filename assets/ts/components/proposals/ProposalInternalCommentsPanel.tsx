import type { PageInfo } from "../../../shared/schemas/pagination";
import type { ProposalInternalComment } from "../../../shared/schemas/proposal-comments";
import { Markdown } from "../Markdown";
import { formatDateTime } from "../../shared/ui";

/** Shared private committee discussion panel; its caller supplies the authorized command. */
export function ProposalInternalCommentsPanel({
  commentDraft,
  savingComment,
  comments,
  commentsPage,
  loadingMoreComments,
  onCommentDraftChange,
  onAddComment,
  onLoadMoreComments,
}: {
  commentDraft: string;
  savingComment: boolean;
  comments: ProposalInternalComment[];
  commentsPage: PageInfo | null;
  loadingMoreComments: boolean;
  onCommentDraftChange: (value: string) => void;
  onAddComment: (event: Event) => Promise<void>;
  onLoadMoreComments: () => Promise<void>;
}) {
  return (
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
                "Program committee";
              return (
                <div class="adm-internal-comment" key={comment.id}>
                  <div class="d-flex gap-2 align-items-center mb-1">
                    <strong class="small">{author}</strong>
                    <span class="small text-muted ms-auto">{formatDateTime(comment.created_at)}</span>
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
  );
}
