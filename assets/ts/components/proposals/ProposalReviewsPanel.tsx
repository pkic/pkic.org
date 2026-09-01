import { useEffect, useState } from "preact/hooks";
import type { PageInfo } from "../../../shared/schemas/pagination";
import type {
  ProposalRecommendation,
  ProposalReview,
  ProposalReviewSummary,
} from "../../../shared/schemas/proposal-reviews";
import { EmptyState } from "../EmptyState";
import { ErrorAlert } from "../ErrorAlert";
import { Spinner } from "../Spinner";
import { Alert } from "../../ui/Alert";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { Select, Textarea, TextInput } from "../../ui/TextControl";
import { ProposalReviewCard } from "./ProposalReviewCard";

export interface ProposalReviewDraft {
  recommendation: ProposalRecommendation;
  score: number;
  reviewerComment?: string;
  applicantNote?: string;
}

/** Shared presentation and editing form for the authenticated reviewer's own review. */
export function ProposalReviewsPanel({
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
  onSave,
  onSaved,
  onError,
}: {
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
  onSave: (draft: ProposalReviewDraft) => Promise<ProposalReview>;
  onSaved: (review: ProposalReview) => void;
  onError: (error: unknown) => void;
}) {
  const [recommendation, setRecommendation] = useState<ProposalRecommendation>("accept");
  const [score, setScore] = useState("");
  const [reviewerComment, setReviewerComment] = useState("");
  const [applicantNote, setApplicantNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setRecommendation(myReview?.recommendation ?? "accept");
    setScore(myReview?.score != null ? String(myReview.score) : "");
    setReviewerComment(myReview?.reviewer_comment ?? "");
    setApplicantNote(myReview?.applicant_note ?? "");
    setSaveError(null);
  }, [myReview]);

  const outstanding = Math.max(0, minReviewsRequired - (loading ? 0 : summary.totalReviews));

  async function handleSubmit(event: Event) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await onSave({
        recommendation,
        score: Number.parseInt(score, 10),
        ...(reviewerComment.trim() ? { reviewerComment: reviewerComment.trim() } : {}),
        ...(applicantNote.trim() ? { applicantNote: applicantNote.trim() } : {}),
      });
      onSaved(saved);
    } catch (error) {
      // The message stays on the surface the reviewer is looking at as well as
      // reaching the caller's notifier: a toast that has already faded leaves
      // behind a form that silently did not save.
      setSaveError(error instanceof Error ? error.message : String(error));
      onError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="pk pk-stack">
      <Panel>
        <PanelBody class="pk-cluster">
          <span class="pk-small">Review progress</span>
          <strong class="pk-nowrap">
            {loading ? "…" : summary.totalReviews} / {minReviewsRequired}
          </strong>
          {summary.quorumMet ? (
            <Badge tone="ok">Quorum met</Badge>
          ) : (
            <Badge tone="warn">
              {outstanding} more review{outstanding === 1 ? "" : "s"} needed
            </Badge>
          )}
        </PanelBody>
      </Panel>

      {loading ? (
        <Spinner label="Loading reviews…" />
      ) : reviews.length === 0 ? (
        <EmptyState title="No reviews yet" body="No one on the program committee has recorded a review." />
      ) : (
        reviews.map((review) => <ProposalReviewCard key={review.id} review={review} />)
      )}

      {page?.hasMore && (
        <div class="pk-cluster">
          <Button size="sm" loading={loadingMore} onClick={() => void onLoadMore()}>
            {loadingMore ? "Loading…" : "Load more reviews"}
          </Button>
        </div>
      )}

      {canReview && !loading && reviewLocked && (
        <Alert tone="info">Reviews are read-only after a proposal decision.</Alert>
      )}

      {canReview && !loading && !reviewLocked && (
        <Panel>
          <PanelHeader title={myReview ? "Edit My Review" : "Add Review"} headingLevel={4} />
          <PanelBody>
            <form class="pk-stack" onSubmit={(event) => void handleSubmit(event)}>
              {/* The fieldset carries `disabled` for the whole group, which is
                  the only way to take controls rendered by a child component
                  out of play while the save is in flight. */}
              <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={saving}>
                <Field label="Recommendation" required>
                  {(control) => (
                    <Select
                      {...control}
                      value={recommendation}
                      onChange={(event) =>
                        setRecommendation((event.target as HTMLSelectElement).value as ProposalRecommendation)
                      }
                    >
                      <option value="accept">Accept</option>
                      <option value="needs-work">Needs Work</option>
                      <option value="reject">Reject</option>
                    </Select>
                  )}
                </Field>
                <Field label="Score (1–10)" required>
                  {(control) => (
                    <TextInput
                      {...control}
                      type="number"
                      min="1"
                      max="10"
                      value={score}
                      onInput={(event) => setScore((event.target as HTMLInputElement).value)}
                      placeholder="1–10"
                    />
                  )}
                </Field>
              </fieldset>

              <fieldset class="pk-fieldset pk-stack" disabled={saving}>
                <Field label="Internal review notes" help="Private · Markdown supported">
                  {(control) => (
                    <Textarea
                      {...control}
                      rows={3}
                      value={reviewerComment}
                      onInput={(event) => setReviewerComment((event.target as HTMLTextAreaElement).value)}
                      placeholder="Private notes for the organizing team…"
                    />
                  )}
                </Field>

                <Field label="Suggested note to applicant" help="Optional · private draft · Markdown supported">
                  {(control) => (
                    <Textarea
                      {...control}
                      rows={3}
                      value={applicantNote}
                      onInput={(event) => setApplicantNote((event.target as HTMLTextAreaElement).value)}
                      placeholder="Feedback or clarification request for the applicant…"
                    />
                  )}
                </Field>
              </fieldset>

              {saveError && <ErrorAlert error={saveError} />}

              <div class="pk-cluster">
                <Button type="submit" variant="primary" loading={saving}>
                  {saving ? "Saving…" : "Submit Review"}
                </Button>
              </div>
            </form>
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
