import { fmt } from "../../ui";
import type { AdminApplicationDetail } from "../../types";

export function ApplicationDocumentsCard({ detail }: { detail: AdminApplicationDetail }) {
  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">Documents</div>
      <div class="card-body">
        {detail.documents.length === 0 ? (
          <p class="text-muted small mb-0">No documents uploaded.</p>
        ) : (
          <ul class="list-unstyled mb-0 small">
            {detail.documents.map((d) => (
              <li key={d.id}>
                {d.filename}{" "}
                <span class="text-muted">
                  ({Math.round(d.fileSizeBytes / 1024)} KB, {fmt(d.uploadedAt)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
