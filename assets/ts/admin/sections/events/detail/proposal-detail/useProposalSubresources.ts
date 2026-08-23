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
import { presentationVersionsResponseSchema } from "../../../../../../shared/schemas/presentation-versions";
import { adminProposalSpeakersResponseSchema } from "../../../../../../shared/schemas/admin-event-proposals";

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
  const [versionPage, setVersionPage] = useState<PageInfo | null>(null);
  const [loadingMoreVersions, setLoadingMoreVersions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingComment, setSavingComment] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [reviewData, speakerData, commentData, presentationData] = await Promise.all([
        api(`/api/v1/admin/proposals/${proposalId}/reviews?limit=25`, proposalReviewsListResponseSchema).catch(
          recoverSubresource("reviews", null),
        ),
        api(`/api/v1/admin/proposals/${proposalId}/speakers`, adminProposalSpeakersResponseSchema).catch(
          recoverSubresource("speakers", { speakers: [] }),
        ),
        api(`/api/v1/admin/proposals/${proposalId}/comments?limit=25`, proposalCommentsListResponseSchema).catch(
          recoverSubresource("comments", {
            comments: [],
            page: { limit: 25, offset: 0, total: 0, hasMore: false },
          }),
        ),
        api(
          `/api/v1/admin/proposals/${proposalId}/presentation/versions?limit=25`,
          presentationVersionsResponseSchema,
        ).catch(
          recoverSubresource("presentation versions", {
            versions: [],
            page: { limit: 25, offset: 0, total: 0, hasMore: false },
          }),
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
      setVersionPage(presentationData.page);
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
      const result = await api(`/api/v1/admin/proposals/${proposalId}/comments`, proposalCommentCreateResponseSchema, {
        method: "POST",
        body: JSON.stringify({ comment }),
      });
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
      const next = await api(
        `/api/v1/admin/proposals/${proposalId}/comments?limit=${commentPage.limit}&offset=${comments.length}`,
        proposalCommentsListResponseSchema,
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
      const next = await api(
        `/api/v1/admin/proposals/${proposalId}/reviews?limit=${reviewPage.limit}&offset=${reviews.length}`,
        proposalReviewsListResponseSchema,
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

  async function loadMoreVersions(): Promise<void> {
    if (!versionPage?.hasMore || loadingMoreVersions) return;
    setLoadingMoreVersions(true);
    try {
      const next = await api(
        `/api/v1/admin/proposals/${proposalId}/presentation/versions?limit=${versionPage.limit}&offset=${versions.length}`,
        presentationVersionsResponseSchema,
      );
      setVersions((previous) => [...previous, ...next.versions]);
      setVersionPage(next.page);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setLoadingMoreVersions(false);
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
    versionPage,
    loadingMoreVersions,
    loading,
    savingComment,
    reload,
    reviewSaved,
    addComment,
    loadMoreComments,
    loadMoreReviews,
    loadMoreVersions,
  };
}
