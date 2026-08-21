import { Markdown } from "../../../../../components/Markdown";
import type { ProposalReview } from "../../../../types";
import { fmt } from "../../../../ui";

export function ReviewCard({ review }: { review: ProposalReview }) {
  const recommendationColor =
    { accept: "success", reject: "danger", "needs-work": "warning" }[review.recommendation] ?? "secondary";
  const reviewer =
    [review.reviewer_first_name, review.reviewer_last_name].filter(Boolean).join(" ") ||
    review.reviewer_email ||
    review.reviewer_user_id;

  return (
    <div class="card mb-2">
      <div class="card-body py-2 px-3">
        <div class="d-flex gap-2 align-items-center mb-2 flex-wrap">
          <span class={`badge text-bg-${recommendationColor}`}>{review.recommendation}</span>
          {review.score != null && <span class="badge text-bg-light border text-body">Score {review.score}/10</span>}
          <span class="small text-muted">{reviewer}</span>
          <span class="small text-muted ms-auto">{fmt(review.updated_at)}</span>
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
