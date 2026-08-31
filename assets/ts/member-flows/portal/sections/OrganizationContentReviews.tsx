import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  CONTENT_REVIEW_STATUSES,
  organizationContentReviewDecisionResponseSchema,
  organizationContentReviewDetailResponseSchema,
  organizationContentReviewsListResponseSchema,
  type OrganizationContentReviewDetail,
} from "../../../../shared/schemas/organization-content-reviews";
import { ApiDataTable, type ApiTableActions } from "../../../components/ApiDataTable";
import { Badge } from "../../../components/Badge";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { getJson, postJson } from "../../../shared/api-client";
import { ORGANIZATION_CONTENT_FIELD_LABELS } from "../../../shared/organization-content";
import { fmt, toast } from "../ui";

const API_BASE = "/api/v1/organizations/content-reviews";
type ReviewStatus = (typeof CONTENT_REVIEW_STATUSES)[number];

function formatDiffValue(value: unknown): string {
  return Array.isArray(value) ? value.join("\n") : String(value ?? "");
}

function ReviewDetail({ reviewId, onDecided }: { reviewId: string; onDecided: () => Promise<void> }) {
  const [detail, setDetail] = useState<OrganizationContentReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewerNote, setReviewerNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getJson(
        `${API_BASE}/${encodeURIComponent(reviewId)}`,
        organizationContentReviewDetailResponseSchema,
      );
      setDetail(data.review);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(action: "approve" | "reject") {
    const note = reviewerNote.trim();
    if (action === "reject" && !note) {
      toast("A reviewer note is required to reject", "error");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await postJson(
        `${API_BASE}/${encodeURIComponent(reviewId)}/${action}`,
        action === "reject" ? { reviewerNote: note } : {},
        organizationContentReviewDecisionResponseSchema,
      );
      toast(action === "approve" ? "Approved and applied" : "Rejected", "success");
      await onDecided();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (!detail) return error ? <ErrorAlert error={error} /> : null;

  return (
    <section class="card border-0 shadow-sm mt-3" aria-labelledby="organization-content-review-title">
      <div class="card-body">
        <h5 id="organization-content-review-title" class="mb-1">
          {detail.organizationName}
        </h5>
        <p class="text-muted small mb-3">
          Submitted by {detail.submitterName} ({detail.submitterEmail}) on {fmt(detail.submittedAt)}
        </p>
        {error && <ErrorAlert error={error} />}
        {detail.hasLogoChange && <p class="mb-2">Includes a proposed logo change.</p>}

        {detail.diff.length === 0 ? (
          <p class="text-muted small">No field changes (logo only).</p>
        ) : (
          <div class="table-responsive">
            <table class="table table-sm align-middle">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Current</th>
                  <th scope="col">Proposed</th>
                </tr>
              </thead>
              <tbody>
                {detail.diff.map((entry) => (
                  <tr key={entry.field}>
                    <th scope="row">{ORGANIZATION_CONTENT_FIELD_LABELS[entry.field] ?? entry.field}</th>
                    <td class="text-muted text-break text-pre-wrap">
                      {entry.current == null ||
                      entry.current === "" ||
                      (Array.isArray(entry.current) && entry.current.length === 0) ? (
                        <em>(empty)</em>
                      ) : (
                        formatDiffValue(entry.current)
                      )}
                    </td>
                    <td class="text-break text-pre-wrap">{formatDiffValue(entry.proposed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {detail.status === "pending" ? (
          <div class="mt-3">
            <label class="form-label small" for="organization-content-review-note">
              Reviewer note (required to reject)
            </label>
            <textarea
              id="organization-content-review-note"
              class="form-control"
              rows={3}
              maxlength={2000}
              value={reviewerNote}
              onInput={(event) => setReviewerNote((event.target as HTMLTextAreaElement).value)}
            />
            <div class="d-flex gap-2 mt-2">
              <button
                type="button"
                class="btn btn-success btn-sm"
                disabled={busy}
                onClick={() => void decide("approve")}
              >
                Approve
              </button>
              <button
                type="button"
                class="btn btn-outline-danger btn-sm"
                disabled={busy}
                onClick={() => void decide("reject")}
              >
                Reject
              </button>
            </div>
          </div>
        ) : (
          <p class="small mb-0 mt-3">
            <Badge status={detail.status} />
            {detail.reviewerNote && <span class="text-muted ms-2">{detail.reviewerNote}</span>}
          </p>
        )}
      </div>
    </section>
  );
}

export function OrganizationContentReviews() {
  const [status, setStatus] = useState<ReviewStatus>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tableActions = useRef<ApiTableActions | null>(null);

  return (
    <div>
      <ApiDataTable
        caption="Organization content reviews"
        endpoint={API_BASE}
        responseSchema={organizationContentReviewsListResponseSchema}
        resolve={(data) => data.reviews}
        resolvePage={(data) => data.page}
        paginate
        searchPlaceholder="organization, submitter, or note…"
        initialSort="-submittedAt"
        params={{ status }}
        actionsRef={tableActions}
        toolbar={({ resetPage }) => (
          <div>
            <label class="visually-hidden" for="organization-content-review-status">
              Review status
            </label>
            <select
              id="organization-content-review-status"
              class="form-select form-select-sm"
              value={status}
              onChange={(event) => {
                setStatus((event.target as HTMLSelectElement).value as ReviewStatus);
                setSelectedId(null);
                resetPage();
              }}
            >
              {CONTENT_REVIEW_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </div>
        )}
        columns={[
          {
            header: "Organization",
            cell: (review) => (
              <button type="button" class="btn btn-link btn-sm p-0 text-start" onClick={() => setSelectedId(review.id)}>
                {review.organizationName}
              </button>
            ),
            sort: { asc: "organizationName", desc: "-organizationName" },
          },
          {
            header: "Submitted by",
            cell: (review) => (
              <>
                <div>{review.submitterName}</div>
                <div class="small text-muted">{review.submitterEmail}</div>
              </>
            ),
            sort: { asc: "submitterName", desc: "-submitterName" },
          },
          {
            header: "Status",
            cell: (review) => <Badge status={review.status} />,
            sort: { asc: "status", desc: "-status" },
          },
          {
            header: "Submitted",
            cell: (review) => fmt(review.submittedAt),
            className: "text-nowrap small text-muted",
            sort: { asc: "submittedAt", desc: "-submittedAt", defaultDirection: "desc" },
          },
        ]}
        empty={`No ${status} organization content submissions.`}
        rowKey={(review) => review.id}
      />

      {selectedId && (
        <ReviewDetail
          reviewId={selectedId}
          onDecided={async () => {
            setSelectedId(null);
            await tableActions.current?.reload();
          }}
        />
      )}
    </div>
  );
}
