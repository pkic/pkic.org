import { useCallback, useEffect, useState } from "preact/hooks";
import { useProposalReviewComments } from "../../../../../components/proposals/useProposalReviewComments";
import { api } from "../../../../api";
import type { ProposalSpeaker } from "../../../../types";
import { toast } from "../../../../ui";
import { adminProposalSpeakersResponseSchema } from "../../../../../../shared/schemas/admin-event-proposals";
import { presentationVersionsResponseSchema } from "../../../../../../shared/schemas/presentation-versions";
import type { ProposalReview } from "../../../../../../shared/schemas/proposal-reviews";
import type { PresentationVersion } from "./model";

function recoverSubresource<T>(label: string, fallback: T): (error: unknown) => T {
  return (error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[ProposalDetailPage] Failed to load ${label}: ${message}`);
    return fallback;
  };
}

/** Admin adapter for shared review/comment data plus admin-only speaker and presentation resources. */
export function useProposalSubresources(proposalId: string, reloadProposal: () => void) {
  const proposalBase = `/api/v1/admin/proposals/${proposalId}`;
  const reviewComments = useProposalReviewComments(proposalBase, reloadProposal);
  const [speakers, setSpeakers] = useState<ProposalSpeaker[]>([]);
  const [versions, setVersions] = useState<PresentationVersion[]>([]);
  const [versionPage, setVersionPage] = useState<{
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  } | null>(null);
  const [loadingMoreVersions, setLoadingMoreVersions] = useState(false);
  const [loadingAdditional, setLoadingAdditional] = useState(true);

  const reloadAdditional = useCallback(async () => {
    setLoadingAdditional(true);
    try {
      const [speakerData, presentationData] = await Promise.all([
        api(`${proposalBase}/speakers`, adminProposalSpeakersResponseSchema).catch(
          recoverSubresource("speakers", { speakers: [] }),
        ),
        api(`${proposalBase}/presentation/versions?limit=25`, presentationVersionsResponseSchema).catch(
          recoverSubresource("presentation versions", {
            versions: [],
            page: { limit: 25, offset: 0, total: 0, hasMore: false },
          }),
        ),
      ]);
      setSpeakers(speakerData.speakers);
      setVersions(presentationData.versions);
      setVersionPage(presentationData.page);
    } finally {
      setLoadingAdditional(false);
    }
  }, [proposalBase]);

  useEffect(() => {
    void reloadAdditional();
  }, [reloadAdditional]);

  async function reload(): Promise<void> {
    await Promise.all([reviewComments.reload(), reloadAdditional()]);
  }

  function reviewSaved(review: ProposalReview): void {
    reviewComments.reviewSaved(review);
    void reloadAdditional();
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

  async function loadMoreVersions(): Promise<void> {
    if (!versionPage?.hasMore || loadingMoreVersions) return;
    setLoadingMoreVersions(true);
    try {
      const next = await api(
        `${proposalBase}/presentation/versions?limit=${versionPage.limit}&offset=${versions.length}`,
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
    reviews: reviewComments.reviews,
    reviewPage: reviewComments.reviewPage,
    reviewSummary: reviewComments.reviewSummary,
    myReview: reviewComments.myReview,
    loadingMoreReviews: reviewComments.loadingMoreReviews,
    speakers,
    setSpeakers,
    comments: reviewComments.comments,
    commentPage: reviewComments.commentPage,
    loadingMoreComments: reviewComments.loadingMoreComments,
    versions,
    versionPage,
    loadingMoreVersions,
    loading: reviewComments.loading || loadingAdditional,
    savingComment: false,
    reload,
    reviewSaved,
    addComment,
    loadMoreComments,
    loadMoreReviews,
    loadMoreVersions,
  };
}
