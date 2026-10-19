import { useEffect, useRef, useState } from "preact/hooks";
import type { PageInfo } from "../../../shared/schemas/pagination";
import type { ProposalInternalComment } from "../../../shared/schemas/proposal-comments";
import { EmptyState } from "../../ui/EmptyState";
import { Markdown } from "../../ui/Markdown";
import { formatDateTime } from "../../shared/ui";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { MarkdownEditor } from "../markdown-editor/MarkdownInput";

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
  // The editor is uncontrolled: when the draft is cleared from outside —
  // a comment was added — it is remounted with the empty draft.
  const [draftGeneration, setDraftGeneration] = useState(0);
  const previousDraft = useRef(commentDraft);
  useEffect(() => {
    if (previousDraft.current !== "" && commentDraft === "") setDraftGeneration((generation) => generation + 1);
    previousDraft.current = commentDraft;
  }, [commentDraft]);
  return (
    <div class="pk">
      {/* "Reviewer comments", not "notes": the proposer's own private
          field is "Notes for the program committee", and the two are
          different things written by different people. */}
      <Panel aria-label="Reviewer comments">
        <PanelHeader title="Reviewer comments" headingLevel={4} />
        <PanelBody class="pk-stack">
          <form class="pk-stack pk-stack--snug" onSubmit={(event) => void onAddComment(event)}>
            {/* The textarea carried only a placeholder before, which is not a
                name: it disappears the moment anything is typed, and a reader
                arriving at the control heard "edit text" and nothing else.
                No help line: the panel's empty state already says who reads
                these comments. */}
            <Field label="Add a comment">
              {(control) => (
                <MarkdownEditor
                  key={draftGeneration}
                  {...control}
                  variant="compact"
                  name="comment"
                  label="Add a comment"
                  initialValue={commentDraft}
                  onChange={onCommentDraftChange}
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
                loading={savingComment}
                disabled={savingComment || !commentDraft.trim()}
              >
                {savingComment ? "Adding…" : "Add comment"}
              </Button>
            </div>
          </form>
          {comments.length === 0 ? (
            <EmptyState
              title="No reviewer comments yet"
              body="Reviewers and organizers see these comments. The proposer never does."
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
                  <Button loading={loadingMoreComments} onClick={() => void onLoadMoreComments()}>
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
