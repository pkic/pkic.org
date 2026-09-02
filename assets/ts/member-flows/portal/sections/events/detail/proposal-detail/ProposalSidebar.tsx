import { useState } from "preact/hooks";
import { Badge } from "../../../../../../components/Badge";
import { ProposalInternalCommentsPanel } from "../../../../../../components/proposals/ProposalInternalCommentsPanel";
import { postJson } from "../../../../../../shared/api-client";
import { proposalSpeakerRemindersResponseSchema } from "../../../../../../../shared/schemas/proposal-speakers";
import type { ProposalAccess, ProposalReview } from "../../types";
import { fmt, toast } from "../../../../ui";
import type { PageInfo } from "../../../../../../../shared/schemas/pagination";
import { Alert } from "../../../../../../ui/Alert";
import { Badge as ToneBadge } from "../../../../../../ui/Badge";
import { Button, ButtonLink } from "../../../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import type { ProposalDetailRecord, ProposalInternalComment } from "./model";
import { proposalResourcePath } from "./proposal-api";
// `pk-datalist` is written here as a class name rather than reached through a
// component, so this module has to pull its stylesheet into its own chunk.
// The `pk-btn` classes on the mailto anchor ride the Button import above.
import "../../../../../../ui/Content.css";

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
  // A failed reminder is stated in place rather than only in a toast, so the
  // operator can still read why it failed after the toast has gone.
  const [reminderError, setReminderError] = useState<string | null>(null);

  async function remindAll(kind: "profile" | "presentation") {
    setReminderError(null);
    try {
      const response = await postJson(
        proposalResourcePath(proposalId, "speakers/reminders"),
        { kind },
        proposalSpeakerRemindersResponseSchema,
      );
      toast(
        `${kind === "profile" ? "Profile" : "Presentation"} reminder sent to ${response.queued} speaker(s)`,
        "success",
      );
    } catch (caught) {
      setReminderError((caught as Error).message);
    }
  }

  return (
    // The parent lays these out with `pk-grid --roomy`, so the cell is already
    // the right width. The `col-lg-4` that used to be here then took a third of
    // THAT, which is a third of a third above 992px.
    <div class="pk pk-stack pk-stack--snug">
      {access.canFinalize && (
        <Panel>
          <PanelHeader title="Operator actions" />
          {/* Three groups of actions, separated by the stack's own gap rather
              than by the rules that used to sit between them: a horizontal
              rule with a margin utility on it is spacing twice. */}
          <PanelBody class="pk-stack pk-stack--snug">
            <div class="pk-stack pk-stack--tight">
              <Button variant="primary" block onClick={() => void onOpenManage()}>
                Open proposer manage page
              </Button>
              <ButtonLink block href={`mailto:${proposal.proposer_email}`}>
                Email proposer
              </ButtonLink>
              <Button block onClick={() => void navigator.clipboard.writeText(proposal.proposer_email)}>
                Copy proposer email
              </Button>
            </div>

            <div class="pk-stack pk-stack--tight">
              <Button size="sm" block onClick={() => void remindAll("profile")}>
                Remind all speakers to complete their profile
              </Button>
              {proposal.decision_status === "accepted" && proposalRequiresPresentation && (
                <Button size="sm" block onClick={() => void remindAll("presentation")}>
                  Remind all speakers to upload their presentation
                </Button>
              )}
              {reminderError && <Alert tone="danger">{reminderError}</Alert>}
            </div>

            {!proposal.decision_status && (
              <div class="pk-stack pk-stack--tight">
                {/* The moderation verdicts read as words on the button, so a
                    reader who cannot separate the tones still knows which of
                    them has already been applied. */}
                <Button size="sm" block disabled={proposal.status === "spam"} onClick={() => void onFlag("spam")}>
                  {proposal.status === "spam" ? "Marked as spam" : "Mark as spam"}
                </Button>
                <Button
                  size="sm"
                  block
                  disabled={proposal.status === "duplicate"}
                  onClick={() => void onFlag("duplicate")}
                >
                  {proposal.status === "duplicate" ? "Marked as duplicate" : "Mark as duplicate"}
                </Button>
                <Button size="sm" block variant="danger-quiet" onClick={() => void onFlag("delete")}>
                  Delete proposal
                </Button>
              </div>
            )}
          </PanelBody>
        </Panel>
      )}

      <Panel>
        <PanelHeader title="Status" />
        <PanelBody>
          <dl class="pk-datalist pk-small">
            <dt>Workflow status</dt>
            <dd>
              <Badge status={proposal.status} />
            </dd>
            <dt>Decision</dt>
            <dd>
              {proposal.decision_status ? (
                <Badge status={proposal.decision_status} />
              ) : (
                <span class="pk-muted">Pending</span>
              )}
            </dd>
            <dt>Reviews</dt>
            <dd>
              <div class="pk-stack pk-stack--tight">
                <span>
                  {loading ? "…" : reviewCount} / {minReviewsRequired} required
                </span>
                {/* The verdict was a colour class and a sentence; the sentence
                    is what carried it, so only the sentence remains — now in a
                    badge whose tone repeats it rather than replaces it. */}
                <span>
                  <ToneBadge tone={quorumMet ? "ok" : "warn"}>{quorumMet ? "Quorum met" : "Quorum not met"}</ToneBadge>
                </span>
                {!loading && reviewCount > 0 && (
                  <span class="pk-muted">
                    Avg score {averageScore == null || Number.isNaN(averageScore) ? "—" : averageScore.toFixed(1)}
                  </span>
                )}
                {!loading && reviewCount > 0 && (
                  <div class="pk-cluster">
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
              </div>
            </dd>
            <dt>Last updated</dt>
            <dd class="pk-nowrap">{fmt(proposal.updated_at)}</dd>
          </dl>
        </PanelBody>
      </Panel>

      {access.canReview && (
        <ProposalInternalCommentsPanel
          commentDraft={commentDraft}
          savingComment={savingComment}
          comments={comments}
          commentsPage={commentsPage}
          loadingMoreComments={loadingMoreComments}
          onCommentDraftChange={onCommentDraftChange}
          onAddComment={onAddComment}
          onLoadMoreComments={onLoadMoreComments}
        />
      )}
    </div>
  );
}
