import { useRef, useState } from "preact/hooks";
import { Spinner } from "../../../../../components/Spinner";
import { presentationUploadRequest } from "../../../../../../shared/presentation-upload";
import { api } from "../../../../api";
import { fmt, toast } from "../../../../ui";
import type { PresentationVersion, PresentationVersionReview } from "./model";

function reviewStatusLabel(status: PresentationVersionReview["status"]): string {
  return { approved: "Approved", rejected: "Rejected", needs_revision: "Needs revision" }[status] ?? status;
}

function reviewStatusBadgeClass(status: PresentationVersionReview["status"]): string {
  return { approved: "success", rejected: "danger", needs_revision: "warning" }[status] ?? "secondary";
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PresentationVersionsTab({
  proposalId,
  versions,
  loading,
  onReload,
}: {
  proposalId: string;
  versions: PresentationVersion[];
  loading: boolean;
  onReload: () => void;
}) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<PresentationVersionReview["status"]>("approved");
  const [reviewNote, setReviewNote] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  async function handleAdminUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = "";
    setUploading(true);
    try {
      await api(`/api/v1/admin/proposals/${proposalId}/presentation/versions`, {
        method: "POST",
        ...presentationUploadRequest(file),
      });
      toast("Presentation uploaded", "success");
      onReload();
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setUploading(false);
    }
  }

  async function handleReview(versionId: string) {
    setSavingReview(true);
    try {
      await api(`/api/v1/admin/proposals/${proposalId}/presentation/versions/${versionId}/review`, {
        method: "POST",
        body: JSON.stringify({ status: reviewStatus, note: reviewNote.trim() || null }),
      });
      toast("Review saved", "success");
      setReviewingId(null);
      setReviewNote("");
      onReload();
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setSavingReview(false);
    }
  }

  async function handleDelete(versionId: string) {
    if (!confirm("Delete this presentation version? This cannot be undone.")) return;
    setDeletingId(versionId);
    try {
      await api(`/api/v1/admin/proposals/${proposalId}/presentation/versions/${versionId}`, { method: "DELETE" });
      toast("Version deleted", "success");
      onReload();
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setDeletingId(null);
    }
  }

  const uploadButton = (
    <div>
      <button
        type="button"
        class="btn btn-sm btn-outline-primary"
        disabled={uploading}
        onClick={() => uploadInputRef.current?.click()}
      >
        {uploading ? "Uploading…" : "↑ Upload on behalf of speaker"}
      </button>
      <input
        ref={uploadInputRef}
        type="file"
        class="d-none"
        accept=".pdf,.pptx,.ppt,.odp,.pptm"
        disabled={uploading}
        onChange={handleAdminUpload}
      />
    </div>
  );

  if (loading) return <Spinner />;
  if (versions.length === 0) {
    return (
      <div class="d-flex flex-column gap-2">
        <p class="text-muted fst-italic mb-0">No presentation uploaded yet.</p>
        {uploadButton}
      </div>
    );
  }

  return (
    <div>
      <div class="mb-3">{uploadButton}</div>
      {versions.map((version) => (
        <div
          key={version.id}
          class={`card mb-3 ${version.isCurrent ? "border-primary" : ""}`}
          data-presentation-version-card
        >
          <div class="card-header d-flex align-items-center gap-2 flex-wrap">
            <span class="fw-semibold">Version {version.versionNumber}</span>
            {version.isCurrent && <span class="badge text-bg-primary">Current</span>}
            {version.latestReview && (
              <span
                class={`badge text-bg-${reviewStatusBadgeClass(version.latestReview.status)}`}
                data-presentation-review-status
              >
                {reviewStatusLabel(version.latestReview.status)}
              </span>
            )}
            <span class="small text-muted ms-auto">
              {fmt(version.uploadedAt)} · {formatBytes(version.fileSize)}
            </span>
          </div>
          <div class="card-body py-2 px-3">
            <div class="small text-muted mb-2">
              {version.fileName ?? "—"} · {version.mimeType ?? "—"}
            </div>
            {version.latestReview?.note && (
              <blockquote class="blockquote small mb-2">
                <p class="mb-0">{version.latestReview.note}</p>
              </blockquote>
            )}
            <div class="d-flex gap-2 flex-wrap">
              <a
                href={`/api/v1/admin/proposals/${proposalId}/presentation/versions/${version.id}/download`}
                class="btn btn-sm btn-outline-secondary"
                download
              >
                ↓ Download
              </a>
              <button
                class="btn btn-sm btn-outline-primary"
                onClick={() => {
                  setReviewingId(reviewingId === version.id ? null : version.id);
                  setReviewNote("");
                  setReviewStatus("approved");
                }}
              >
                Review
              </button>
              <button
                class="btn btn-sm btn-outline-danger"
                disabled={deletingId === version.id}
                onClick={() => void handleDelete(version.id)}
              >
                {deletingId === version.id ? "Deleting…" : "Delete"}
              </button>
            </div>

            {reviewingId === version.id && (
              <div class="mt-3 border-top pt-3">
                <div class="mb-2">
                  <select
                    class="form-select form-select-sm mb-2"
                    value={reviewStatus}
                    onChange={(event) =>
                      setReviewStatus((event.target as HTMLSelectElement).value as PresentationVersionReview["status"])
                    }
                  >
                    <option value="approved">Approved</option>
                    <option value="needs_revision">Needs revision</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <textarea
                    class="form-control form-control-sm"
                    rows={3}
                    placeholder="Optional note for the speaker…"
                    value={reviewNote}
                    onInput={(event) => setReviewNote((event.target as HTMLTextAreaElement).value)}
                  />
                </div>
                <div class="d-flex gap-2">
                  <button
                    class="btn btn-sm btn-success"
                    disabled={savingReview}
                    onClick={() => void handleReview(version.id)}
                  >
                    {savingReview ? "Saving…" : "Save review"}
                  </button>
                  <button class="btn btn-sm btn-outline-secondary" onClick={() => setReviewingId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
