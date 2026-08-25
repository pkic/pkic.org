import { groupFormsListResponseSchema } from "../../../../../shared/schemas/group-forms";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { ResourceCapabilities } from "./ResourceCapabilities";

export function GroupForms({ groupId }: { groupId: string }) {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Forms</div>
      <div class="card-body">
        <ApiDataTable
          endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/forms`}
          responseSchema={groupFormsListResponseSchema}
          resolve={(response) => response.forms}
          resolvePage={(response) => response.page}
          paginate
          searchPlaceholder="Search forms…"
          initialSort="title"
          columns={[
            {
              header: "Form",
              cell: (row) => (
                <div>
                  <div class="fw-semibold">{row.form.title}</div>
                  {row.form.description && <div class="small text-muted">{row.form.description}</div>}
                </div>
              ),
              sort: { asc: "title", desc: "-title" },
            },
            {
              header: "Purpose",
              cell: (row) => <Badge status={row.form.purpose} />,
              sort: { asc: "purpose", desc: "-purpose" },
            },
            {
              header: "Audience",
              cell: (row) => row.placement.audience,
              sort: { asc: "audience", desc: "-audience" },
            },
            {
              header: "Status",
              cell: (row) => (
                <Badge
                  status={row.acceptingResponses ? "active" : row.form.status}
                  label={row.acceptingResponses ? "Accepting responses" : undefined}
                />
              ),
            },
            { header: "Access", cell: (row) => <ResourceCapabilities capabilities={row.capabilities} /> },
          ]}
          empty="No forms are available through this group."
          rowKey={(row) => row.placement.id}
        />
      </div>
    </div>
  );
}
