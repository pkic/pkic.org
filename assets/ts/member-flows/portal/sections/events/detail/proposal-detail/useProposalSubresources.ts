import { useCallback, useEffect, useState } from "preact/hooks";
import { useProposalReviewComments } from "../../../../../../components/proposals/useProposalReviewComments";
import { getJson } from "../../../../../../shared/api-client";
import { toast } from "../../../../ui";
import { presentationVersionsResponseSchema } from "../../../../../../../shared/schemas/presentation-versions";
import type { ProposalReview } from "../../../../../../../shared/schemas/proposal-reviews";
import type { PresentationVersion } from "./model";
import type { ProposalAccess } from "../../types";
import { proposalResourcePath } from "./proposal-api";

function recoverSubresource<T>(label: string, fallback: T): (error: unknown) => T {
  return (error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[ProposalDetailPage] Failed to load ${label}: ${message}`);
    return fallback;
  };
}

/** Portal adapter for shared review, comment, speaker, and presentation resources. */
export function useProposalSubresources(
  proposalId: string,
  reloadProposal: () => void,
  access: ProposalAccess | null | undefined,
) {
  const proposalBase = proposalResourcePath(proposalId);
  const canReadPrivateResources = access?.canRead === true;
  const canReviewPrivateResources = access?.canReview === true;
  const reviewComments = useProposalReviewComments(proposalBase, reloadProposal, canReviewPrivateResources);
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
    if (!canReadPrivateResources) {
      setVersions([]);
      setVersionPage(null);
      setLoadingAdditional(false);
      return;
    }
    setLoadingAdditional(true);
    try {
      const presentationData = await getJson(
        `${proposalResourcePath(proposalId, "presentations")}?limit=25`,
        presentationVersionsResponseSchema,
      ).catch(
        recoverSubresource("presentation versions", {
          versions: [],
          page: { limit: 25, offset: 0, total: 0, hasMore: false },
        }),
      );
      setVersions(presentationData.versions);
      setVersionPage(presentationData.page);
    } finally {
      setLoadingAdditional(false);
    }
  }, [canReadPrivateResources, proposalId]);

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
      const next = await getJson(
        `${proposalResourcePath(proposalId, "presentations")}?limit=${versionPage.limit}&offset=${versions.length}`,
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
