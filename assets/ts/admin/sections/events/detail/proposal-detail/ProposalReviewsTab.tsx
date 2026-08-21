import { useEffect, useState } from "preact/hooks";
import { Spinner } from "../../../../../components/Spinner";
import { api } from "../../../../api";
import type { ProposalReview } from "../../../../types";
import { toast } from "../../../../ui";
import type { PageInfo } from "../../../../../../shared/schemas/pagination";
import {
  proposalReviewWriteResponseSchema,
  type ProposalRecommendation,
  type ProposalReviewSummary,
} from "../../../../../../shared/schemas/proposal-reviews";
import { ReviewCard } from "./ReviewCard";

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
  const [recommendation, setRecommendation] = useState<ProposalRecommendation>("accept");
  const [score, setScore] = useState("");
  const [reviewerComment, setReviewerComment] = useState("");
  const [applicantNote, setApplicantNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRecommendation(myReview?.recommendation ?? "accept");
    setScore(myReview?.score != null ? String(myReview.score) : "");
    setReviewerComment(myReview?.reviewer_comment ?? "");
    setApplicantNote(myReview?.applicant_note ?? "");
  }, [myReview]);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = { recommendation, score: Number.parseInt(score, 10) };
      if (reviewerComment.trim()) body.reviewerComment = reviewerComment.trim();
      if (applicantNote.trim()) body.applicantNote = applicantNote.trim();
      const result = proposalReviewWriteResponseSchema.parse(
        await api<unknown>(`/api/v1/admin/proposals/${proposalId}/reviews`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      onSaved(result.review);
      toast("Review saved", "success");
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div class="card mb-3">
        <div class="card-body py-2 px-3">
          <div class="d-flex align-items-center gap-3 flex-wrap">
            <span class="text-muted small">Review progress</span>
            <strong class="small">
              {loading ? "…" : summary.totalReviews} / {minReviewsRequired}
            </strong>
            {summary.quorumMet ? (
              <span class="badge text-bg-success">Quorum met</span>
            ) : (
              <span class="badge text-bg-warning">
                {Math.max(0, minReviewsRequired - (loading ? 0 : summary.totalReviews))} more needed
              </span>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : reviews.length === 0 ? (
        <p class="text-muted fst-italic">No reviews yet.</p>
      ) : (
        reviews.map((review) => <ReviewCard key={review.id} review={review} />)
      )}

      {page?.hasMore && (
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          disabled={loadingMore}
          onClick={() => void onLoadMore()}
        >
          {loadingMore ? "Loading…" : "Load more reviews"}
        </button>
      )}

      {canReview && !loading && reviewLocked && (
        <div class="alert alert-secondary mt-3 mb-0">Reviews are read-only after a proposal decision.</div>
      )}

      {canReview && !loading && !reviewLocked && (
        <div class="card mt-3">
          <div class="card-header">
            <h6 class="mb-0">{myReview ? "Edit My Review" : "Add Review"}</h6>
          </div>
          <div class="card-body">
            <form onSubmit={(event) => void handleSubmit(event)}>
              <div class="row g-3">
                <div class="col-md-5">
                  <label class="form-label fw-semibold">Recommendation</label>
                  <select
                    class="form-select"
                    value={recommendation}
                    required
                    onChange={(event) =>
                      setRecommendation((event.target as HTMLSelectElement).value as ProposalRecommendation)
                    }
                  >
                    <option value="accept">Accept</option>
                    <option value="needs-work">Needs Work</option>
                    <option value="reject">Reject</option>
                  </select>
                </div>
                <div class="col-md-3">
                  <label class="form-label fw-semibold">Score (1–10)</label>
                  <input
                    class="form-control"
                    type="number"
                    min="1"
                    max="10"
                    required
                    value={score}
                    onInput={(event) => setScore((event.target as HTMLInputElement).value)}
                    placeholder="1–10"
                  />
                </div>
                <div class="col-12">
                  <label class="form-label fw-semibold">
                    Internal review notes
                    <span class="text-muted fw-normal ms-2 small">Private · Markdown supported</span>
                  </label>
                  <textarea
                    class="form-control"
                    rows={3}
                    value={reviewerComment}
                    onInput={(event) => setReviewerComment((event.target as HTMLTextAreaElement).value)}
                    placeholder="Private notes for the organizing team…"
                  />
                </div>
                <div class="col-12">
                  <hr class="my-2" />
                  <label class="form-label fw-semibold">
                    Suggested note to applicant
                    <span class="text-muted fw-normal ms-2 small">Optional · private draft · Markdown supported</span>
                  </label>
                  <textarea
                    class="form-control"
                    rows={3}
                    value={applicantNote}
                    onInput={(event) => setApplicantNote((event.target as HTMLTextAreaElement).value)}
                    placeholder="Feedback or clarification request for the applicant…"
                  />
                </div>
                <div class="col-12">
                  <button type="submit" class="btn btn-primary" disabled={saving}>
                    {saving ? "Saving…" : "Submit Review"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
