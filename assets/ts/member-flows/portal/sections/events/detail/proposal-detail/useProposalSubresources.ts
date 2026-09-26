import { useProposalReviewComments } from "../../../../../../components/proposals/useProposalReviewComments";
import { toast } from "../../../../ui";
import type { ProposalReview } from "../../../../../../../shared/schemas/proposal-reviews";
import type { ProposalAccess } from "../../types";
import { proposalResourcePath } from "./proposal-api";

/** Portal adapter for shared review and comment resources. */
export function useProposalSubresources(
  proposalId: string,
  reloadProposal: () => void,
  access: ProposalAccess | null | undefined,
) {
  const proposalBase = proposalResourcePath(proposalId);
  const canReviewPrivateResources = access?.canReview === true;
  const reviewComments = useProposalReviewComments(proposalBase, reloadProposal, canReviewPrivateResources);
  function reviewSaved(review: ProposalReview): void {
    reviewComments.reviewSaved(review);
  }

  async function addComment(comment: string): Promise<boolean> {
    try {
      await reviewComments.addComment(comment);
      return true;
    } catch (error) {
      toast((error as Error).message, "error");
      return false;
    }
  }

  async function loadMoreComments(): Promise<void> {
    try {
      await reviewComments.loadMoreComments();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  }

  async function loadMoreReviews(): Promise<void> {
    try {
      await reviewComments.loadMoreReviews();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  }

  return {
    reviews: reviewComments.reviews,
    reviewPage: reviewComments.reviewPage,
    reviewSummary: reviewComments.reviewSummary,
    myReview: reviewComments.myReview,
    loadingMoreReviews: reviewComments.loadingMoreReviews,
    comments: reviewComments.comments,
    commentPage: reviewComments.commentPage,
    loadingMoreComments: reviewComments.loadingMoreComments,
    loading: reviewComments.loading,
    savingComment: false,
    reload: reviewComments.reload,
    reviewSaved,
    addComment,
    loadMoreComments,
    loadMoreReviews,
  };
}
