import type { ProposalReview } from "../../../shared/schemas/proposal-reviews";
import { Markdown } from "../Markdown";
import { Badge } from "../Badge";
import { Badge as ToneBadge } from "../../ui/Badge";
import { Panel, PanelBody } from "../../ui/Panel";
import { formatDateTime } from "../../shared/ui";

// `pk-code-block` lives in Content.css, which ships in a lazy chunk rather than
// the entry stylesheet: a module that writes the class name has to import the
// sheet that defines it, or the block renders unframed.
import "../../ui/Content.css";

/** Displays one review consistently wherever a program committee works. */
export function ProposalReviewCard({ review }: { review: ProposalReview }) {
  const reviewer =
    [review.reviewer_first_name, review.reviewer_last_name].filter(Boolean).join(" ") ||
    review.reviewer_email ||
    review.reviewer_user_id;

  return (
    // A program committee reads a column of these. An unnamed <section> is not
    // exposed as a region at all, so each card names whose review it is and
    // becomes something a screen reader can jump between.
    <Panel class="pk" aria-label={`Review by ${reviewer}`}>
      <PanelBody class="pk-stack pk-stack--snug">
        <div class="pk-cluster">
          <Badge status={review.recommendation} />
          {review.score != null && (
            <ToneBadge tone="neutral" dot={false}>
              Score {review.score}/10
            </ToneBadge>
          )}
          <span class="pk-small">{reviewer}</span>
          <span class="pk-small pk-nowrap pk-push">{formatDateTime(review.updated_at)}</span>
        </div>
        {review.reviewer_comment && (
          <div class="pk-stack pk-stack--tight">
            <p class="pk-small pk-strong">Internal review notes</p>
            <Markdown markdown={review.reviewer_comment} className="pk-small" />
          </div>
        )}
        {review.applicant_note && (
          <div class="pk-stack pk-stack--tight">
            <p class="pk-small pk-strong">Suggested note to applicant</p>
            {/* The note is a draft quoted back to the reader, so it sits in the
                system's framed block. The legacy amber tint it replaces carried
                nothing the heading above it does not already say in words. */}
            <div class="pk-code-block">
              <Markdown markdown={review.applicant_note} className="pk-small" />
            </div>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
