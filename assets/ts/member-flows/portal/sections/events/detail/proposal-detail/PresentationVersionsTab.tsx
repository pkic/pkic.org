import { useRef, useState } from "preact/hooks";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { ApiDataTable, type ApiTableActions } from "../../../../../../components/ApiDataTable";
import { presentationUploadRequest } from "../../../../../../../shared/presentation-upload";
import { deleteJson, postJson, requestJson } from "../../../../../../shared/api-client";
import {
  PRESENTATION_REVIEW_STATUS_LABELS,
  presentationReviewStatusSchema,
  presentationVersionResponseSchema,
  presentationVersionReviewRequestSchema,
  presentationVersionsResponseSchema,
} from "../../../../../../../shared/schemas/presentation-versions";
import { successResponseSchema } from "../../../../../../../shared/schemas/api-common";
import { fmt, toast } from "../../../../ui";
import { Badge } from "../../../../../../components/Badge";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
import { Badge as ToneBadge } from "../../../../../../ui/Badge";
import { Button, ButtonLink } from "../../../../../../ui/Button";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import type { PresentationVersion, PresentationVersionReview } from "./model";
import { proposalResourcePath } from "./proposal-api";
// `pk-datalist` is written here as a class name rather than reached through a
// component, so this module has to pull its stylesheet into its own chunk.
import "../../../../../../ui/Content.css";
import { MarkdownEditor } from "../../../../../../components/markdown-editor/MarkdownInput";

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

export function PresentationVersionsTab({ proposalId, canManage }: { proposalId: string; canManage: boolean }) {
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
  const tableRef = useRef<ApiTableActions | null>(null);
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
      await tableRef.current?.reload();
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
      await tableRef.current?.reload();
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
      tableRef.current?.resetPage();
      await tableRef.current?.reload();
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

  return (
    <div class="pk pk-stack">
      {error && <Alert tone="danger">{error}</Alert>}
      <ApiDataTable
        caption="Presentation versions"
        endpoint={proposalResourcePath(proposalId, "presentations")}
        responseSchema={presentationVersionsResponseSchema}
        resolve={(response) => response.versions}
        resolvePage={(response) => response.page}
        paginate
        initialPageSize={25}
        initialSort="-versionNumber"
        searchPlaceholder="Search presentation files…"
        toolbar={canManage ? () => uploadButton : undefined}
        actionsRef={tableRef}
        columns={[
          {
            header: "Version",
            cell: (version) => (
              <span class="pk-cluster">
                <span class="pk-strong">Version {version.versionNumber}</span>
                {version.isCurrent && <ToneBadge tone="accent">Current</ToneBadge>}
              </span>
            ),
            width: "fit",
            sort: { asc: "versionNumber", desc: "-versionNumber" },
          },
          {
            header: "File",
            cell: (version) => <span title={version.fileName ?? undefined}>{version.fileName ?? "—"}</span>,
            width: "primary",
            sort: { asc: "fileName", desc: "-fileName" },
          },
          {
            header: "Uploaded",
            cell: (version) => fmt(version.uploadedAt),
            width: "fit",
            sort: { asc: "uploadedAt", desc: "-uploadedAt" },
          },
          {
            header: "Size",
            cell: (version) => formatBytes(version.fileSize),
            width: "fit",
          },
          {
            header: "Review",
            cell: (version) =>
              version.latestReview ? (
                <span data-presentation-review-status>
                  <Badge status={version.latestReview.status} />
                </span>
              ) : (
                <span class="pk-muted">Not reviewed</span>
              ),
            width: "fit",
          },
          {
            header: "Actions",
            cell: (version) => (
              <span class="pk-cluster">
                <ButtonLink
                  href={proposalResourcePath(
                    proposalId,
                    "presentations/" + encodeURIComponent(version.id) + "/content",
                  )}
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
              </span>
            ),
            width: "fit",
          },
        ]}
        empty="No presentation uploaded yet."
        rowKey={(version) => version.id}
        detailRow={(version) => {
          const note = version.latestReview?.note;
          const editing = canManage && reviewingId === version.id;
          if (!note && !editing) return null;
          return (
            <div class="pk-stack pk-stack--snug">
              {note && (
                <p class="pk-small">
                  <span class="pk-muted">Reviewer note: </span>
                  {note}
                </p>
              )}
              {editing && (
                <form
                  noValidate
                  class="pk-stack pk-stack--snug"
                  id={reviewFormId(version.id)}
                  {...review.handlers}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleReview(version.id);
                  }}
                >
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
                        {presentationReviewStatusSchema.options.map((status) => (
                          <option key={status} value={status}>
                            {PRESENTATION_REVIEW_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field
                    label="Note for the speaker"
                    help="Optional. The speaker sees this alongside the outcome."
                    {...review.of("note")}
                  >
                    {(control) => (
                      <MarkdownEditor
                        variant="compact"
                        {...control}
                        name="note"
                        label="Note for the speaker"
                        initialValue={reviewNote}
                        disabled={savingReview}
                        onChange={setReviewNote}
                      />
                    )}
                  </Field>
                  {reviewError && <Alert tone="danger">{reviewError}</Alert>}
                  <div class="pk-cluster">
                    <Button type="submit" variant="primary" size="sm" loading={savingReview}>
                      {savingReview ? "Saving…" : "Save review"}
                    </Button>
                    <Button type="button" size="sm" onClick={() => openReview(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
