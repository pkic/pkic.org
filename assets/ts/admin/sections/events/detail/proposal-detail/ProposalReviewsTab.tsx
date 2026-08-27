import { ProposalReviewsPanel } from "../../../../../components/proposals/ProposalReviewsPanel";
import { api } from "../../../../api";
import type { ProposalReview } from "../../../../types";
import { toast } from "../../../../ui";
import type { PageInfo } from "../../../../../../shared/schemas/pagination";
import {
  proposalReviewWriteResponseSchema,
  type ProposalReviewSummary,
} from "../../../../../../shared/schemas/proposal-reviews";

interface ProposalReviewsTabProps {
  proposalId: string;
  loading: boolean;
  reviews: ProposalReview[];
  page: PageInfo | null;
  summary: ProposalReviewSummary;
  minReviewsRequired: number;
  canReview: boolean;
  reviewLocked: boolean;
  myReview: ProposalReview | null;
  loadingMore: boolean;
  onLoadMore: () => Promise<void>;
  onSaved: (review: ProposalReview) => void;
}

export function ProposalReviewsTab({
  proposalId,
  loading,
  reviews,
  page,
  summary,
  minReviewsRequired,
  canReview,
  reviewLocked,
  myReview,
  loadingMore,
  onLoadMore,
  onSaved,
}: ProposalReviewsTabProps) {
  return (
    <ProposalReviewsPanel
      loading={loading}
      reviews={reviews}
      page={page}
      summary={summary}
      minReviewsRequired={minReviewsRequired}
      canReview={canReview}
      reviewLocked={reviewLocked}
      myReview={myReview}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
      onSave={async (draft) => {
        const result = await api(`/api/v1/admin/proposals/${proposalId}/reviews`, proposalReviewWriteResponseSchema, {
          method: "POST",
          body: JSON.stringify(draft),
        });
        toast("Review saved", "success");
        return result.review;
      }}
      onSaved={onSaved}
      onError={(error) => toast((error as Error).message, "error")}
    />
  );
}
