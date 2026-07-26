import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

/**
 * Shared document-upload widget for membership applications (PRD §1.2).
 * Used by both the join-form success panel and the application status page,
 * since applicants may return later to add supporting documents.
 */

interface DocumentEntry {
  id: string;
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: string;
}

interface DocumentUploaderOptions {
  applicationId: string;
  token: string;
  apiBase?: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function documentsUrl(apiBase: string, applicationId: string, token: string): string {
  return `${apiBase}/members/applications/${encodeURIComponent(applicationId)}/documents?token=${encodeURIComponent(token)}`;
}

function DocumentUploader({ applicationId, token, apiBase }: Required<DocumentUploaderOptions>) {
  const [documents, setDocuments] = useState<DocumentEntry[]>([]);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);

  const url = documentsUrl(apiBase, applicationId, token);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as { documents: DocumentEntry[] };
        if (!cancelled) setDocuments(data.documents);
      } catch {
        // Best-effort — leave the list empty if it can't be loaded.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const handleUpload = useCallback(
    async (event: Event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;

      setUploading(true);
      setStatus(null);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(url, { method: "POST", body: formData });
        const data = (await res.json()) as { document?: DocumentEntry; error?: { message?: string } };
        if (!res.ok || !data.document) {
          throw new Error(data.error?.message ?? `Upload failed (HTTP ${res.status})`);
        }
        const uploaded = data.document;
        setDocuments((prev) => [...prev, uploaded]);
        setStatus({ message: `Uploaded ${uploaded.filename}.`, isError: false });
      } catch (error) {
        setStatus({ message: error instanceof Error ? error.message : "Upload failed.", isError: true });
      } finally {
        setUploading(false);
        input.value = "";
      }
    },
    [url],
  );

  return (
    <div class="member-doc-uploader">
      <label class="form-label" for="member-doc-file">
        Upload a supporting document (optional)
      </label>
      <div class="form-text mb-2">
        PDF, Word, or image files up to 20MB — e.g. corporate registration or credentials.
      </div>
      <input
        id="member-doc-file"
        type="file"
        class="form-control"
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
        disabled={uploading}
        onChange={handleUpload}
      />
      {status && (
        <div class={`form-text mt-2 ${status.isError ? "text-danger" : "text-success"}`}>{status.message}</div>
      )}
      {documents.length > 0 && (
        <ul class="list-unstyled mt-3 mb-0">
          {documents.map((doc) => (
            <li key={doc.id} class="small">
              📄 {doc.filename} <span class="text-muted">({formatFileSize(doc.fileSizeBytes)})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Renders the document uploader into `container`. Safe to call once per container. */
export function renderDocumentUploader(container: HTMLElement, options: DocumentUploaderOptions): void {
  render(
    <DocumentUploader
      applicationId={options.applicationId}
      token={options.token}
      apiBase={options.apiBase ?? "/api/v1"}
    />,
    container,
  );
}
