import type { ProposalReview } from "../../../shared/schemas/proposal-reviews";
import { Markdown } from "../Markdown";
import { Badge } from "../Badge";
import { formatDateTime } from "../../shared/ui";

/** Displays one review consistently wherever a program committee works. */
export function ProposalReviewCard({ review }: { review: ProposalReview }) {
  const reviewer =
    [review.reviewer_first_name, review.reviewer_last_name].filter(Boolean).join(" ") ||
    review.reviewer_email ||
    review.reviewer_user_id;

  return (
    <div class="card mb-2">
      <div class="card-body py-2 px-3">
        <div class="d-flex gap-2 align-items-center mb-2 flex-wrap">
          <Badge status={review.recommendation} />
          {review.score != null && <span class="badge text-bg-light border text-body">Score {review.score}/10</span>}
          <span class="small text-muted">{reviewer}</span>
          <span class="small text-muted ms-auto">{formatDateTime(review.updated_at)}</span>
        </div>
        {review.reviewer_comment && (
          <div class="mb-2">
            <div class="small text-muted fw-semibold mb-1">Internal review notes</div>
            <Markdown markdown={review.reviewer_comment} className="small mb-0" />
          </div>
        )}
        {review.applicant_note && (
          <div class="adm-applicant-note">
            <div class="small fw-semibold mb-1">Suggested note to applicant</div>
            <Markdown markdown={review.applicant_note} className="small mb-0" />
          </div>
        )}
      </div>
    </div>
  );
}
