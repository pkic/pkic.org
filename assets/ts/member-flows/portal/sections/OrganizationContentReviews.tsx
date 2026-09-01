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
import { FilterSelect } from "../../../components/FilterSelect";
import { Spinner } from "../../../components/Spinner";
import { DataTable } from "../../../components/Table";
import { getJson, postJson } from "../../../shared/api-client";
import { ORGANIZATION_CONTENT_FIELD_LABELS } from "../../../shared/organization-content";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { Textarea } from "../../../ui/TextControl";
import { fmt, toast } from "../ui";
// `pk-answer-pre` is written here as a class name rather than reached through a
// component, so this module has to pull its stylesheet into its own chunk.
import "../../../ui/Content.css";

const API_BASE = "/api/v1/organizations/content-reviews";
type ReviewStatus = (typeof CONTENT_REVIEW_STATUSES)[number];

const REVIEWER_NOTE_REQUIRED = "A reviewer note is required to reject";

function formatDiffValue(value: unknown): string {
  return Array.isArray(value) ? value.join("\n") : String(value ?? "");
}

function isEmptyValue(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * One side of a field diff. A multi-line proposal keeps its line breaks —
 * `links` arrives as an array joined by newlines — so the value renders as
 * wrapping preformatted text rather than collapsing into one run-on line.
 */
function DiffValue({ value }: { value: unknown }) {
  if (isEmptyValue(value)) return <em class="pk-muted">(empty)</em>;
  return <p class="pk-answer-pre pk-break">{formatDiffValue(value)}</p>;
}

function statusLabel(value: ReviewStatus): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ReviewDetail({ reviewId, onDecided }: { reviewId: string; onDecided: () => Promise<void> }) {
  const [detail, setDetail] = useState<OrganizationContentReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewerNote, setReviewerNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
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
      // The refusal is attached to the control that caused it, so a screen
      // reader hears which field is blocking rather than only a toast that has
      // already gone by the time focus returns to the form.
      setNoteError("Write the reason for the rejection before rejecting this submission.");
      toast(REVIEWER_NOTE_REQUIRED, "error");
      return;
    }

    setNoteError(null);
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

  if (loading) return <Spinner label="Loading this submission…" />;
  if (!detail) return error ? <ErrorAlert error={error} /> : null;

  return (
    // The panel names itself after the organization under review, so a page
    // holding a queue and one open submission offers two distinguishable
    // regions rather than an unnamed box below a table.
    <Panel aria-label={detail.organizationName}>
      <PanelHeader title={detail.organizationName} />
      <PanelBody class="pk-stack pk-stack--snug">
        <p class="pk-muted pk-small">
          Submitted by {detail.submitterName} ({detail.submitterEmail}) on {fmt(detail.submittedAt)}
        </p>
        {error && <ErrorAlert error={error} />}
        {detail.hasLogoChange && <p>Includes a proposed logo change.</p>}

        <DataTable
          caption={`Proposed changes for ${detail.organizationName}`}
          columns={[
            {
              header: "Field",
              cell: (entry) => ORGANIZATION_CONTENT_FIELD_LABELS[entry.field] ?? entry.field,
              width: "fit",
            },
            { header: "Current", cell: (entry) => <DiffValue value={entry.current} />, className: "pk-muted" },
            // The first labelled column is fit-width here, so the prose
            // column claims the slack explicitly.
            { header: "Proposed", cell: (entry) => <DiffValue value={entry.proposed} />, width: "primary" },
          ]}
          data={detail.diff}
          rowKey={(entry) => entry.field}
          empty="No field changes (logo only)."
        />

        {detail.status === "pending" ? (
          <>
            <Field
              label="Reviewer note"
              help="Required to reject. Sent to the organization with the decision."
              state={noteError ? "invalid" : undefined}
              message={noteError ?? undefined}
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxlength={2000}
                  value={reviewerNote}
                  onInput={(event) => setReviewerNote((event.target as HTMLTextAreaElement).value)}
                />
              )}
            </Field>
            <div class="pk-cluster">
              <Button variant="primary" size="sm" loading={busy} onClick={() => void decide("approve")}>
                Approve
              </Button>
              <Button variant="danger-quiet" size="sm" loading={busy} onClick={() => void decide("reject")}>
                Reject
              </Button>
            </div>
          </>
        ) : (
          <div class="pk-cluster">
            <Badge status={detail.status} />
            {detail.reviewerNote && <span class="pk-muted pk-small">{detail.reviewerNote}</span>}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

export function OrganizationContentReviews() {
  const [status, setStatus] = useState<ReviewStatus>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tableActions = useRef<ApiTableActions | null>(null);

  return (
    <div class="pk pk-stack">
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
          <FilterSelect
            ariaLabel="Filter by review status"
            value={status}
            options={CONTENT_REVIEW_STATUSES.map((value) => ({ value, label: statusLabel(value) }))}
            onChange={(next) => {
              setStatus(next);
              setSelectedId(null);
              resetPage();
            }}
          />
        )}
        columns={[
          {
            header: "Organization",
            cell: (review) => review.organizationName,
            sort: { asc: "organizationName", desc: "-organizationName" },
          },
          {
            header: "Submitted by",
            cell: (review) => (
              <>
                <div>{review.submitterName}</div>
                <div class="pk-small pk-muted">{review.submitterEmail}</div>
              </>
            ),
            sort: { asc: "submitterName", desc: "-submitterName" },
          },
          {
            header: "Status",
            cell: (review) => <Badge status={review.status} />,
            width: "fit",
            sort: { asc: "status", desc: "-status" },
          },
          {
            // A date has a bounded length; the column says so instead of
            // wearing `pk-nowrap` while still claiming slack, and keeps the
            // table's own ink and size.
            header: "Submitted",
            cell: (review) => fmt(review.submittedAt),
            width: "fit",
            sort: { asc: "submittedAt", desc: "-submittedAt", defaultDirection: "desc" },
          },
        ]}
        // Opening a submission is the row's action, so the whole row is the
        // target and it is a real control with a name that says what it opens.
        // The version this replaces put the handler on a link-styled button
        // inside one cell, which left the rest of the row inert.
        rowAction={(review) => ({
          label: `Open the content review for ${review.organizationName}`,
          onSelect: () => setSelectedId(review.id),
        })}
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
