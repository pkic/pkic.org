import type { PageInfo } from "../../../shared/schemas/pagination";
import type { ProposalInternalComment } from "../../../shared/schemas/proposal-comments";
import { EmptyState } from "../EmptyState";
import { Markdown } from "../Markdown";
import { formatDateTime } from "../../shared/ui";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { Textarea } from "../../ui/TextControl";

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
    <div class="pk">
      <Panel aria-label="Internal comments">
        <PanelHeader title="Internal Comments" headingLevel={4} />
        <PanelBody class="pk-stack">
          <form class="pk-stack pk-stack--snug" onSubmit={(event) => void onAddComment(event)}>
            {/* The textarea carried only a placeholder before, which is not a
                name: it disappears the moment anything is typed, and a reader
                arriving at the control heard "edit text" and nothing else. */}
            <Field label="Add a comment" help="Private to the program committee · Markdown supported">
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  value={commentDraft}
                  onInput={(event) => onCommentDraftChange((event.target as HTMLTextAreaElement).value)}
                  placeholder="Add a private committee comment…"
                />
              )}
            </Field>
            <div class="pk-cluster pk-cluster--end">
              {/* `loading` alone keeps a submit button clickable, and a click on
                  a submit button posts the form whether or not its handler is
                  bound — so the in-flight write is held off by `disabled` as
                  well, which is what the Bootstrap version did. */}
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={savingComment}
                disabled={savingComment || !commentDraft.trim()}
              >
                {savingComment ? "Adding…" : "Add Comment"}
              </Button>
            </div>
          </form>
          {comments.length === 0 ? (
            <EmptyState
              title="No internal comments yet"
              body="Notes recorded here stay private to the program committee."
            />
          ) : (
            <div class="pk-stack pk-stack--snug">
              {comments.map((comment) => {
                const author =
                  [comment.author_first_name, comment.author_last_name].filter(Boolean).join(" ") ||
                  comment.author_email ||
                  "Program committee";
                return (
                  <Panel key={comment.id}>
                    <PanelBody class="pk-stack pk-stack--tight">
                      <div class="pk-cluster">
                        <strong class="pk-small">{author}</strong>
                        <span class="pk-small pk-nowrap pk-push">{formatDateTime(comment.created_at)}</span>
                      </div>
                      <Markdown markdown={comment.comment} className="pk-small" />
                    </PanelBody>
                  </Panel>
                );
              })}
              {commentsPage?.hasMore && (
                <div class="pk-cluster">
                  <Button size="sm" loading={loadingMoreComments} onClick={() => void onLoadMoreComments()}>
                    {loadingMoreComments ? "Loading…" : "Load more comments"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
