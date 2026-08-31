import { staffApplicationDocumentsListResponseSchema } from "../../../../../shared/schemas/application-documents";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { fmt } from "../../ui";

export function ApplicationDocumentsCard({ applicationId }: { applicationId: string }) {
  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">Documents</div>
      <div class="card-body">
        <ApiDataTable
          caption="Application documents"
          endpoint={`/api/v1/members/applications/${applicationId}/documents`}
          responseSchema={staffApplicationDocumentsListResponseSchema}
          resolve={(response) => response.documents}
          resolvePage={(response) => response.page}
          paginate
          initialPageSize={10}
          initialSort="-uploadedAt"
          searchPlaceholder="Search documents…"
          columns={[
            {
              header: "Filename",
              cell: (document) => document.filename,
              sort: { asc: "filename", desc: "-filename" },
            },
            {
              header: "Type",
              cell: (document) => document.mimeType,
              className: "small",
              sort: { asc: "mimeType", desc: "-mimeType" },
            },
            {
              header: "Size",
              cell: (document) => `${Math.ceil(document.fileSizeBytes / 1024)} KB`,
              className: "text-nowrap",
              sort: { asc: "fileSizeBytes", desc: "-fileSizeBytes" },
            },
            {
              header: "Uploaded by",
              cell: (document) => document.uploadedByEmail,
              className: "small",
            },
            {
              header: "Uploaded",
              cell: (document) => fmt(document.uploadedAt),
              className: "text-nowrap",
              sort: { asc: "uploadedAt", desc: "-uploadedAt", defaultDirection: "desc" },
            },
          ]}
          empty="No documents uploaded"
          rowKey={(document) => document.id}
        />
      </div>
    </div>
  );
}
