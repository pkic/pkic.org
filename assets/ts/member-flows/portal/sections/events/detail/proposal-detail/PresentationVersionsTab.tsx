import { useRef, useState } from "preact/hooks";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { Spinner } from "../../../../../../components/Spinner";
import { presentationUploadRequest } from "../../../../../../../shared/presentation-upload";
import { deleteJson, postJson, requestJson } from "../../../../../../shared/api-client";
import {
  presentationVersionResponseSchema,
  presentationVersionReviewRequestSchema,
} from "../../../../../../../shared/schemas/presentation-versions";
import { successResponseSchema } from "../../../../../../../shared/schemas/api-common";
import { fmt, toast } from "../../../../ui";
import { Badge } from "../../../../../../components/Badge";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
import { Badge as ToneBadge } from "../../../../../../ui/Badge";
import { Button, ButtonLink } from "../../../../../../ui/Button";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { Field } from "../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Select, Textarea } from "../../../../../../ui/TextControl";
import type { PresentationVersion, PresentationVersionReview } from "./model";
import { proposalResourcePath } from "./proposal-api";
// `pk-datalist` is written here as a class name rather than reached through a
// component, so this module has to pull its stylesheet into its own chunk.
import "../../../../../../ui/Content.css";

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The review form's id, derived from the version rather than from `useId`, so
 * the `aria-controls` relationship is in the markup before any JavaScript runs
 * and does not depend on a hook being called inside a loop.
 */
function reviewFormId(versionId: string): string {
  return `presentation-review-${versionId}`;
}

export function PresentationVersionsTab({
  proposalId,
  versions,
  loading,
  hasMore,
  loadingMore,
  canManage,
  onLoadMore,
  onReload,
}: {
  proposalId: string;
  versions: PresentationVersion[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  canManage: boolean;
  onLoadMore: () => void;
  onReload: () => void;
}) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<PresentationVersionReview["status"]>("approved");
  const [reviewNote, setReviewNote] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Upload and delete have no form of their own to sit beside, so their
  // failures are stated once above the list. An Alert stays on screen to be
  // read back, where a toast that has already faded cannot be.
  const [error, setError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  // One review form is open at a time, checked by the review contract the
  // route parses: it decides what each control shows and what Save may send.
  const review = useContractForm(presentationVersionReviewRequestSchema, {
    status: reviewStatus,
    note: reviewNote.trim() || null,
  });

  function openReview(versionId: string | null): void {
    setReviewingId(versionId);
    setReviewNote("");
    setReviewStatus("approved");
    setReviewError(null);
    review.reset();
  }

  async function handlePresentationUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = "";
    setUploading(true);
    setError(null);
    try {
      await requestJson(proposalResourcePath(proposalId, "presentations"), successResponseSchema, {
        method: "POST",
        ...presentationUploadRequest(file),
      });
      toast("Presentation uploaded", "success");
      onReload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleReview(versionId: string) {
    const checked = review.submit();
    if (!checked.data) {
      setReviewError(checked.message);
      return;
    }
    setSavingReview(true);
    setReviewError(null);
    try {
      await postJson(
        proposalResourcePath(proposalId, `presentations/${encodeURIComponent(versionId)}/reviews`),
        checked.data,
        presentationVersionResponseSchema,
      );
      toast("Review saved", "success");
      openReview(null);
      onReload();
    } catch (caught) {
      // A refusal that names a field lands on that control; the rest is
      // stated inside the form.
      setReviewError(review.refuse(caught));
    } finally {
      setSavingReview(false);
    }
  }

  async function handleDelete(version: PresentationVersion) {
    if (
      !(await confirmAction({
        title: `Delete presentation version ${version.versionNumber}?`,
        consequences: [
          "The uploaded file is deleted and this version no longer appears here",
          ...(version.isCurrent ? ["The next most recent version becomes the current version"] : []),
        ],
        confirmLabel: "Delete version",
      }))
    )
      return;
    setDeletingId(version.id);
    setError(null);
    try {
      await deleteJson(
        proposalResourcePath(proposalId, `presentations/${encodeURIComponent(version.id)}`),
        successResponseSchema,
      );
      toast("Version deleted", "success");
      onReload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  // The button is the control and the file input is opened through it, so
  // there is one focusable thing carrying one accessible name — rather than a
  // hidden input a utility class has taken out of the page.
  const uploadButton = (
    <div class="pk-cluster">
      <Button variant="secondary" size="sm" loading={uploading} onClick={() => uploadInputRef.current?.click()}>
        {uploading ? "Uploading…" : "Upload on behalf of speaker"}
      </Button>
      <input
        ref={uploadInputRef}
        type="file"
        hidden
        accept=".pdf,.pptx,.ppt,.odp,.pptm"
        disabled={uploading}
        onChange={handlePresentationUpload}
      />
    </div>
  );

  if (loading) return <Spinner label="Loading presentation versions…" />;

  if (versions.length === 0) {
    return (
      <div class="pk pk-stack pk-stack--snug">
        {error && <Alert tone="danger">{error}</Alert>}
        <EmptyState
          title="No presentation uploaded yet."
          body="Each file a speaker uploads appears here as its own version."
        >
          {canManage && uploadButton}
        </EmptyState>
      </div>
    );
  }

  return (
    <div class="pk pk-stack">
      {error && <Alert tone="danger">{error}</Alert>}
      {canManage && uploadButton}
      {versions.map((version) => (
        <Panel
          key={version.id}
          // The section is named, so it is a landmark: every control inside it
          // is announced with the version it belongs to, which is what keeps
          // three identical "Review" buttons on one page distinguishable.
          aria-label={`Presentation version ${version.versionNumber}`}
          data-presentation-version-card
        >
          <PanelHeader title={`Version ${version.versionNumber}`}>
            {/* "Current" is a word, not a coloured border: the accent frame
                this replaces carried the whole distinction in hue. */}
            {version.isCurrent && <ToneBadge tone="accent">Current</ToneBadge>}
            {version.latestReview && (
              <span data-presentation-review-status>
                <Badge status={version.latestReview.status} />
              </span>
            )}
          </PanelHeader>
          <PanelBody class="pk-stack pk-stack--snug">
            <dl class="pk-datalist pk-small">
              <dt>Uploaded</dt>
              <dd class="pk-nowrap">{fmt(version.uploadedAt)}</dd>
              <dt>File</dt>
              <dd class="pk-break">{version.fileName ?? "—"}</dd>
              <dt>Type</dt>
              <dd class="pk-break">{version.mimeType ?? "—"}</dd>
              <dt>Size</dt>
              <dd class="pk-nowrap">{formatBytes(version.fileSize)}</dd>
            </dl>

            {version.latestReview?.note && (
              <p class="pk-small">
                <span class="pk-muted">Reviewer note: </span>
                {version.latestReview.note}
              </p>
            )}

            <div class="pk-cluster">
              <ButtonLink
                href={proposalResourcePath(proposalId, `presentations/${encodeURIComponent(version.id)}/content`)}
                size="sm"
                download
              >
                Download
              </ButtonLink>
              {canManage && (
                <>
                  <Button
                    size="sm"
                    aria-expanded={reviewingId === version.id ? "true" : "false"}
                    aria-controls={reviewFormId(version.id)}
                    onClick={() => openReview(reviewingId === version.id ? null : version.id)}
                  >
                    Review
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-quiet"
                    loading={deletingId === version.id}
                    onClick={() => void handleDelete(version)}
                  >
                    {deletingId === version.id ? "Deleting…" : "Delete"}
                  </Button>
                </>
              )}
            </div>

            {canManage && reviewingId === version.id && (
              <div class="pk-stack pk-stack--snug" id={reviewFormId(version.id)} {...review.handlers}>
                <Field label="Review outcome" {...review.of("status")}>
                  {(control) => (
                    <Select
                      {...control}
                      name="status"
                      value={reviewStatus}
                      disabled={savingReview}
                      onChange={(event) =>
                        setReviewStatus(
                          (event.target as HTMLSelectElement).value as PresentationVersionReview["status"],
                        )
                      }
                    >
                      <option value="approved">Approved</option>
                      <option value="needs_revision">Needs revision</option>
                      <option value="rejected">Rejected</option>
                    </Select>
                  )}
                </Field>
                <Field
                  label="Note for the speaker"
                  help="Optional. The speaker sees this alongside the outcome."
                  {...review.of("note")}
                >
                  {(control) => (
                    <Textarea
                      {...control}
                      name="note"
                      rows={3}
                      value={reviewNote}
                      disabled={savingReview}
                      onInput={(event) => setReviewNote((event.target as HTMLTextAreaElement).value)}
                    />
                  )}
                </Field>
                {reviewError && <Alert tone="danger">{reviewError}</Alert>}
                <div class="pk-cluster">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={savingReview}
                    onClick={() => void handleReview(version.id)}
                  >
                    {savingReview ? "Saving…" : "Save review"}
                  </Button>
                  <Button size="sm" onClick={() => openReview(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </PanelBody>
        </Panel>
      ))}
      {hasMore && (
        <div class="pk-cluster">
          <Button size="sm" loading={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "Loading…" : "Load more versions"}
          </Button>
        </div>
      )}
    </div>
  );
}
