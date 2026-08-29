import type { ProposalReview } from "../../types";
import { ProposalReviewCard } from "../../../../../../components/proposals/ProposalReviewCard";

export function ReviewCard({ review }: { review: ProposalReview }) {
  return <ProposalReviewCard review={review} />;
}
