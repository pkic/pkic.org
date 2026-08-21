import { useCallback, useEffect, useState } from "preact/hooks";
import {
  proposalCommentCreateResponseSchema,
  proposalCommentsListResponseSchema,
  type ProposalInternalComment,
} from "../../../../../../shared/schemas/proposal-comments";
import type { PageInfo } from "../../../../../../shared/schemas/pagination";
import {
  proposalReviewsListResponseSchema,
  type ProposalReview,
  type ProposalReviewSummary,
} from "../../../../../../shared/schemas/proposal-reviews";
import { api } from "../../../../api";
import type { ProposalSpeaker } from "../../../../types";
import { toast } from "../../../../ui";
import type { PresentationVersion } from "./model";

const EMPTY_REVIEW_SUMMARY: ProposalReviewSummary = {
  totalReviews: 0,
  averageScore: null,
  acceptCount: 0,
  needsWorkCount: 0,
  rejectCount: 0,
  minReviewsRequired: 0,
  quorumMet: false,
};

function recoverSubresource<T>(label: string, fallback: T): (error: unknown) => T {
  return (error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[ProposalDetailPage] Failed to load ${label}: ${message}`);
    return fallback;
  };
}

export function useProposalSubresources(proposalId: string, reloadProposal: () => void) {
  const [reviews, setReviews] = useState<ProposalReview[]>([]);
  const [reviewPage, setReviewPage] = useState<PageInfo | null>(null);
  const [reviewSummary, setReviewSummary] = useState<ProposalReviewSummary>(EMPTY_REVIEW_SUMMARY);
  const [myReview, setMyReview] = useState<ProposalReview | null>(null);
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  const [speakers, setSpeakers] = useState<ProposalSpeaker[]>([]);
  const [comments, setComments] = useState<ProposalInternalComment[]>([]);
  const [commentPage, setCommentPage] = useState<PageInfo | null>(null);
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);
  const [versions, setVersions] = useState<PresentationVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingComment, setSavingComment] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [reviewData, speakerData, commentData, presentationData] = await Promise.all([
        api<unknown>(`/api/v1/admin/proposals/${proposalId}/reviews?limit=25`)
          .then((value) => proposalReviewsListResponseSchema.parse(value))
          .catch(recoverSubresource("reviews", null)),
        api<{ speakers: ProposalSpeaker[] }>(`/api/v1/admin/proposals/${proposalId}/speakers`).catch(
          recoverSubresource("speakers", { speakers: [] }),
        ),
        api<unknown>(`/api/v1/admin/proposals/${proposalId}/comments?limit=25`)
          .then((value) => proposalCommentsListResponseSchema.parse(value))
          .catch(
            recoverSubresource("comments", {
              comments: [],
              page: { limit: 25, offset: 0, total: 0, hasMore: false },
            }),
          ),
        api<{ versions: PresentationVersion[] }>(`/api/v1/admin/proposals/${proposalId}/presentation/versions`).catch(
          recoverSubresource("presentation versions", { versions: [] }),
        ),
      ]);
      setReviews(reviewData?.reviews ?? []);
      setReviewPage(reviewData?.page ?? null);
      setReviewSummary(reviewData?.summary ?? EMPTY_REVIEW_SUMMARY);
      setMyReview(reviewData?.myReview ?? null);
      setSpeakers(speakerData.speakers ?? []);
      setComments(commentData.comments ?? []);
      setCommentPage(commentData.page);
      setVersions(presentationData.versions ?? []);
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

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

  async function addComment(comment: string): Promise<boolean> {
    setSavingComment(true);
    try {
      const result = proposalCommentCreateResponseSchema.parse(
        await api<unknown>(`/api/v1/admin/proposals/${proposalId}/comments`, {
          method: "POST",
          body: JSON.stringify({ comment }),
        }),
      );
      setComments((previous) => [result.comment, ...previous]);
      setCommentPage((previous) => (previous ? { ...previous, total: previous.total + 1 } : previous));
      return true;
    } catch (error) {
      toast((error as Error).message, "error");
      return false;
    } finally {
      setSavingComment(false);
    }
  }

  async function loadMoreComments(): Promise<void> {
    if (!commentPage?.hasMore || loadingMoreComments) return;
    setLoadingMoreComments(true);
    try {
      const next = proposalCommentsListResponseSchema.parse(
        await api<unknown>(
          `/api/v1/admin/proposals/${proposalId}/comments?limit=${commentPage.limit}&offset=${comments.length}`,
        ),
      );
      setComments((previous) => [...previous, ...next.comments]);
      setCommentPage(next.page);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setLoadingMoreComments(false);
    }
  }

  async function loadMoreReviews(): Promise<void> {
    if (!reviewPage?.hasMore || loadingMoreReviews) return;
    setLoadingMoreReviews(true);
    try {
      const next = proposalReviewsListResponseSchema.parse(
        await api<unknown>(
          `/api/v1/admin/proposals/${proposalId}/reviews?limit=${reviewPage.limit}&offset=${reviews.length}`,
        ),
      );
      setReviews((previous) => [...previous, ...next.reviews]);
      setReviewPage(next.page);
      setReviewSummary(next.summary);
      setMyReview(next.myReview);
    } catch (error) {
      toast((error as Error).message, "error");
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
    speakers,
    setSpeakers,
    comments,
    commentPage,
    loadingMoreComments,
    versions,
    loading,
    savingComment,
    reload,
    reviewSaved,
    addComment,
    loadMoreComments,
    loadMoreReviews,
  };
}
