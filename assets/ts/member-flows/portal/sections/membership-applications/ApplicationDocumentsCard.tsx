import { staffApplicationDocumentsListResponseSchema } from "../../../../../shared/schemas/application-documents";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { EmptyState } from "../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { fmt } from "../../ui";

/**
 * The files attached to one membership application.
 *
 * The card names itself: the detail view stacks several of these, and an
 * unnamed `<section>` is announced as nothing at all. Documents are uploaded
 * by the applicant, not from here, so the empty state explains the absence
 * rather than offering an action staff do not have.
 */
export function ApplicationDocumentsCard({ applicationId }: { applicationId: string }) {
  return (
    <div class="pk">
      <Panel aria-label="Documents">
        <PanelHeader title="Documents" />
        <PanelBody>
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
                className: "pk-small",
                sort: { asc: "mimeType", desc: "-mimeType" },
              },
              {
                header: "Size",
                cell: (document) => `${Math.ceil(document.fileSizeBytes / 1024)} KB`,
                className: "pk-nowrap",
                sort: { asc: "fileSizeBytes", desc: "-fileSizeBytes" },
              },
              {
                header: "Uploaded by",
                cell: (document) => document.uploadedByEmail,
                className: "pk-small",
              },
              {
                header: "Uploaded",
                cell: (document) => fmt(document.uploadedAt),
                className: "pk-nowrap",
                sort: { asc: "uploadedAt", desc: "-uploadedAt", defaultDirection: "desc" },
              },
            ]}
            empty={
              <EmptyState
                title="No documents uploaded"
                body="The applicant has not attached any files to this application."
              />
            }
            rowKey={(document) => document.id}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
