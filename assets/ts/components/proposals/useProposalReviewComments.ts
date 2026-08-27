import { useCallback, useEffect, useState } from "preact/hooks";
import type { PageInfo } from "../../../shared/schemas/pagination";
import {
  proposalCommentCreateResponseSchema,
  proposalCommentsListResponseSchema,
  type ProposalInternalComment,
} from "../../../shared/schemas/proposal-comments";
import {
  proposalReviewsListResponseSchema,
  type ProposalReview,
  type ProposalReviewSummary,
} from "../../../shared/schemas/proposal-reviews";
import { getJson, postJson } from "../../shared/api-client";

const EMPTY_REVIEW_SUMMARY: ProposalReviewSummary = {
  totalReviews: 0,
  averageScore: null,
  acceptCount: 0,
  needsWorkCount: 0,
  rejectCount: 0,
  minReviewsRequired: 0,
  quorumMet: false,
};

/** Reuses the same server-paginated review and private-comment data flow in every program surface. */
export function useProposalReviewComments(
  proposalApiBase: string,
  reloadProposal: () => void | Promise<void>,
  enabled = true,
) {
  const [reviews, setReviews] = useState<ProposalReview[]>([]);
  const [reviewPage, setReviewPage] = useState<PageInfo | null>(null);
  const [reviewSummary, setReviewSummary] = useState<ProposalReviewSummary>(EMPTY_REVIEW_SUMMARY);
  const [myReview, setMyReview] = useState<ProposalReview | null>(null);
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  const [comments, setComments] = useState<ProposalInternalComment[]>([]);
  const [commentPage, setCommentPage] = useState<PageInfo | null>(null);
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!enabled) {
      setReviews([]);
      setReviewPage(null);
      setReviewSummary(EMPTY_REVIEW_SUMMARY);
      setMyReview(null);
      setComments([]);
      setCommentPage(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [reviewData, commentData] = await Promise.all([
        getJson(`${proposalApiBase}/reviews?limit=25`, proposalReviewsListResponseSchema),
        getJson(`${proposalApiBase}/comments?limit=25`, proposalCommentsListResponseSchema),
      ]);
      setReviews(reviewData.reviews);
      setReviewPage(reviewData.page);
      setReviewSummary(reviewData.summary);
      setMyReview(reviewData.myReview);
      setComments(commentData.comments);
      setCommentPage(commentData.page);
    } finally {
      setLoading(false);
    }
  }, [enabled, proposalApiBase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function reviewSaved(review: ProposalReview): void {
    setMyReview(review);
    setReviews((previous) => {
      const index = previous.findIndex((item) => item.reviewer_user_id === review.reviewer_user_id);
      return index >= 0
        ? previous.map((item, itemIndex) => (itemIndex === index ? review : item))
        : [...previous, review];
    });
    void Promise.all([reloadProposal(), reload()]);
  }

  async function addComment(comment: string): Promise<void> {
    if (!enabled) return;
    const result = await postJson(`${proposalApiBase}/comments`, { comment }, proposalCommentCreateResponseSchema);
    setComments((previous) => [result.comment, ...previous]);
    setCommentPage((previous) => (previous ? { ...previous, total: previous.total + 1 } : previous));
  }

  async function loadMoreComments(): Promise<void> {
    if (!enabled || !commentPage?.hasMore || loadingMoreComments) return;
    setLoadingMoreComments(true);
    try {
      const next = await getJson(
        `${proposalApiBase}/comments?limit=${commentPage.limit}&offset=${comments.length}`,
        proposalCommentsListResponseSchema,
      );
      setComments((previous) => [...previous, ...next.comments]);
      setCommentPage(next.page);
    } finally {
      setLoadingMoreComments(false);
    }
  }

  async function loadMoreReviews(): Promise<void> {
    if (!enabled || !reviewPage?.hasMore || loadingMoreReviews) return;
    setLoadingMoreReviews(true);
    try {
      const next = await getJson(
        `${proposalApiBase}/reviews?limit=${reviewPage.limit}&offset=${reviews.length}`,
        proposalReviewsListResponseSchema,
      );
      setReviews((previous) => [...previous, ...next.reviews]);
      setReviewPage(next.page);
      setReviewSummary(next.summary);
      setMyReview(next.myReview);
    } finally {
      setLoadingMoreReviews(false);
    }
  }

  return {
    reviews,
    reviewPage,
    reviewSummary,
    myReview,
    loadingMoreReviews,
    comments,
    commentPage,
    loadingMoreComments,
    loading,
    reload,
    reviewSaved,
    addComment,
    loadMoreComments,
    loadMoreReviews,
  };
}
