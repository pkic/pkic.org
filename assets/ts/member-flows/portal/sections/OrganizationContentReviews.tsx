import { useCallback, useEffect, useState } from "preact/hooks";
import {
  CONTENT_REVIEW_STATUSES,
  organizationContentReviewDecisionResponseSchema,
  organizationContentReviewDetailResponseSchema,
  organizationContentReviewRejectSchema,
  organizationContentReviewsListResponseSchema,
  type OrganizationContentReviewDetail,
} from "../../../../shared/schemas/organization-content-reviews";
import { ApiDataTable } from "../../../components/ApiDataTable";
import { Badge } from "../../../components/Badge";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { DataTable } from "../../../components/Table";
import { TextDiff } from "../../../components/TextDiff";
import { useContractForm } from "../../../hooks/useContractForm";
import { getJson, postJson } from "../../../shared/api-client";
import { ORGANIZATION_CONTENT_FIELD_LABELS } from "../../../shared/organization-content";
import { Button, ButtonLink } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { PageHeader } from "../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { fmt, toast } from "../ui";
import { MarkdownEditor } from "../../../components/markdown-editor/MarkdownInput";

const API_BASE = "/api/v1/organizations/content-reviews";
type ReviewStatus = (typeof CONTENT_REVIEW_STATUSES)[number];

/**
 * The queue opens on what needs a decision. The server lists every status
 * when none is asked for, so the page's fixed scope is "pending" and the
 * Status column's filter overrides it: its open state carries no value and so
 * falls back to this default, and each other status replaces it. There is
 * deliberately no "all statuses" state — a moderation queue is not an archive.
 */
const DEFAULT_QUEUE_STATUS: ReviewStatus = "pending";

/**
 * A field value as text to compare. `links` arrives as an array and is read
 * one per line, so a changed link is marked on its own line.
 */
function formatDiffValue(value: unknown): string {
  return Array.isArray(value) ? value.join("\n") : String(value ?? "");
}

function statusLabel(value: ReviewStatus): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ReviewDetail({ reviewId, onDecided }: { reviewId: string; onDecided: () => Promise<void> }) {
  const [detail, setDetail] = useState<OrganizationContentReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewerNote, setReviewerNote] = useState("");
  const [busy, setBusy] = useState(false);
  // One basis for validation: the rejection contract the route parses decides
  // what the note shows and what Reject may send. Approval carries no body.
  const form = useContractForm(organizationContentReviewRejectSchema, { reviewerNote });

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
    let body: unknown = {};
    if (action === "reject") {
      // The refusal lands on the control that caused it, so a screen reader
      // hears which field is blocking rather than only a toast that has gone
      // by the time focus returns to the form.
      const checked = form.submit();
      if (!checked.data) {
        setError(checked.message);
        return;
      }
      body = checked.data;
    }

    setBusy(true);
    setError(null);
    try {
      await postJson(
        `${API_BASE}/${encodeURIComponent(reviewId)}/${action}`,
        body,
        organizationContentReviewDecisionResponseSchema,
      );
      toast(action === "approve" ? "Approved and applied" : "Rejected", "success");
      await onDecided();
    } catch (caught) {
      // A server refusal names its field the same way the contract does.
      const message = form.refuse(caught);
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
      {/* The body is the note's ancestor, so it reports to the one contract. */}
      <PanelBody class="pk-stack pk-stack--snug" {...form.handlers}>
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
            // One column shows the change in place — removed words struck,
            // inserted ones marked — instead of two fixed columns of prose
            // to compare by eye (#97). The first column is fit-width, so
            // this one claims the slack explicitly.
            {
              header: "Change",
              cell: (entry) => (
                <TextDiff
                  before={formatDiffValue(entry.current)}
                  after={formatDiffValue(entry.proposed)}
                  label={`Change to ${ORGANIZATION_CONTENT_FIELD_LABELS[entry.field] ?? entry.field}`}
                />
              ),
              width: "primary",
            },
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
              {...form.of("reviewerNote")}
            >
              {(control) => (
                <MarkdownEditor
                  variant="compact"
                  {...control}
                  name="reviewerNote"
                  label="Reviewer note"
                  initialValue={reviewerNote}
                  onChange={setReviewerNote}
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
function RoutedContentReview({ reviewId }: { reviewId: string }) {
  return (
    <div class="pk pk-stack">
      <PageHeader
        title="Content review"
        actions={
          <ButtonLink size="sm" variant="ghost" href="#/settings/organization-content-reviews">
            Back to content reviews
          </ButtonLink>
        }
      />
      <ReviewDetail
        reviewId={reviewId}
        onDecided={async () => {
          window.location.hash = "#/settings/organization-content-reviews";
        }}
      />
    </div>
  );
}

export function OrganizationContentReviews({ reviewId }: { reviewId?: string }) {
  if (reviewId) return <RoutedContentReview reviewId={reviewId} />;

  return (
    <div class="pk pk-stack">
      {/* A page under Settings heads itself. It used to be a tab on the
          Settings hub, which meant the strip named it and the page did not. */}
      <PageHeader title="Content reviews" />
      <ApiDataTable
        caption="Organization content reviews"
        endpoint={API_BASE}
        responseSchema={organizationContentReviewsListResponseSchema}
        resolve={(data) => data.reviews}
        resolvePage={(data) => data.page}
        paginate
        searchPlaceholder="organization, submitter, or note…"
        initialSort="-submittedAt"
        params={{ status: DEFAULT_QUEUE_STATUS }}
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
            filter: {
              param: "status",
              options: CONTENT_REVIEW_STATUSES.map((value) => ({
                value: value === DEFAULT_QUEUE_STATUS ? "" : value,
                label: statusLabel(value),
              })),
            },
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
          href: `#/settings/organization-content-reviews/${encodeURIComponent(review.id)}`,
        })}
        empty="No organization content submissions match the current filters."
        rowKey={(review) => review.id}
      />
    </div>
  );
}
