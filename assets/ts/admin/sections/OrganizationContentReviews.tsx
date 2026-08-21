/**
 * Organizations → Content Review. Moderation queue
 * for member-submitted organization profile changes: a list of pending
 * submissions, a side-by-side diff view, and approve/reject actions with a
 * reviewer note field.
 */
import { useState, useEffect, useCallback } from "preact/hooks";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { api } from "../api";
import { toast, fmt } from "../ui";
import type { OrganizationContentReviewDetail, OrganizationContentReviewSummary } from "../types";
import { CONTENT_REVIEW_STATUSES as STATUS_TABS } from "../../../shared/schemas/admin-organizations";

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    slogan: "Slogan",
    description: "Description",
    contentMarkdown: "Long-form content",
    website: "Website",
    blogUrl: "Blog URL",
    blogFeedUrl: "Blog feed URL",
    pressUrl: "Press URL",
    pressFeedUrl: "Press feed URL",
    careersUrl: "Careers URL",
    links: "Links",
  };
  return labels[field] ?? field;
}

/** `links` diff values are string[] (one URL per line via pre-wrap); every other field is already a plain string. */
function formatDiffValue(value: unknown): string {
  return Array.isArray(value) ? value.join("\n") : String(value ?? "");
}

function ReviewDetail({ reviewId, onDecided }: { reviewId: string; onDecided: () => void }) {
  const [detail, setDetail] = useState<OrganizationContentReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewerNote, setReviewerNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ review: OrganizationContentReviewDetail }>(
        `/api/v1/admin/organizations/content-reviews/${reviewId}`,
      );
      setDetail(data.review);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve() {
    setBusy(true);
    try {
      await api(`/api/v1/admin/organizations/content-reviews/${reviewId}/approve`, { method: "POST" });
      toast("Approved and applied", "success");
      onDecided();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!reviewerNote.trim()) {
      toast("A reviewer note is required to reject", "error");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/v1/admin/organizations/content-reviews/${reviewId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reviewerNote: reviewerNote.trim() }),
      });
      toast("Rejected", "success");
      onDecided();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!detail) return null;

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-body">
        <h6 class="mb-1">{detail.organizationName}</h6>
        <p class="text-muted small mb-3">
          Submitted by {detail.submitterName} ({detail.submitterEmail}) on {fmt(detail.submittedAt)}
        </p>

        {detail.hasLogoChange && <p class="mb-2">Includes a proposed logo change.</p>}

        {detail.diff.length === 0 ? (
          <p class="text-muted small">No field changes (logo only).</p>
        ) : (
          <div class="table-responsive">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Current</th>
                  <th>Proposed</th>
                </tr>
              </thead>
              <tbody>
                {detail.diff.map((d) => (
                  <tr key={d.field}>
                    <td class="fw-semibold">{fieldLabel(d.field)}</td>
                    <td class="text-muted adm-diff-cell">
                      {d.current == null || d.current === "" || (Array.isArray(d.current) && d.current.length === 0) ? (
                        <em>(empty)</em>
                      ) : (
                        formatDiffValue(d.current)
                      )}
                    </td>
                    <td class="adm-diff-cell">{formatDiffValue(d.proposed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {detail.status === "pending" && (
          <>
            <div class="mb-2 mt-3">
              <label class="form-label small">Reviewer note (required to reject)</label>
              <textarea
                class="form-control"
                rows={2}
                value={reviewerNote}
                onInput={(e) => setReviewerNote((e.target as HTMLTextAreaElement).value)}
              />
            </div>
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-success btn-sm" disabled={busy} onClick={approve}>
                Approve
              </button>
              <button type="button" class="btn btn-outline-danger btn-sm" disabled={busy} onClick={reject}>
                Reject
              </button>
            </div>
          </>
        )}
        {detail.status !== "pending" && (
          <p class="small mb-0">
            <span class="badge text-bg-secondary text-capitalize">{detail.status}</span>
            {detail.reviewerNote && <span class="text-muted ms-2">{detail.reviewerNote}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

export function OrganizationContentReviews() {
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]>("pending");
  const [reviews, setReviews] = useState<OrganizationContentReviewSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ reviews: OrganizationContentReviewSummary[] }>(
        `/api/v1/admin/organizations/content-reviews?status=${status}`,
      );
      setReviews(data.reviews);
      setSelectedId((current) => current ?? data.reviews[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    setSelectedId(null);
    void load();
  }, [load]);

  function handleDecided() {
    setSelectedId(null);
    void load();
  }

  return (
    <div>
      <ul class="nav nav-tabs mb-3">
        {STATUS_TABS.map((tab) => (
          <li class="nav-item" key={tab}>
            <button
              type="button"
              class={`nav-link text-capitalize${status === tab ? " active" : ""}`}
              onClick={() => setStatus(tab)}
            >
              {tab}
            </button>
          </li>
        ))}
      </ul>

      {loading && <Spinner />}
      {error && <ErrorAlert error={error} />}
      {!loading && !error && reviews.length === 0 && <p class="text-muted">No {status} submissions.</p>}

      {!loading && !error && reviews.length > 0 && (
        <div class="row g-3">
          <div class="col-md-4">
            <div class="list-group">
              {reviews.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  class={`list-group-item list-group-item-action${selectedId === r.id ? " active" : ""}`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <div class="fw-semibold">{r.organizationName}</div>
                  <div class="small text-muted">{fmt(r.submittedAt)}</div>
                </button>
              ))}
            </div>
          </div>
          <div class="col-md-8">{selectedId && <ReviewDetail reviewId={selectedId} onDecided={handleDecided} />}</div>
        </div>
      )}
    </div>
  );
}
