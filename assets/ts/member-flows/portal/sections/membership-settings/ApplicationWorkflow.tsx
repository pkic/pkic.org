import { ApiDataTable } from "../../../../components/ApiDataTable";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { MEMBERSHIP_WORKFLOWS_API } from "../../../../shared/membership-workflow-catalog";
import {
  membershipWorkflowsResponseSchema,
  membershipWorkflowVersionResponseSchema,
  membershipWorkflowVersionSchema,
  type MembershipWorkflowVersion,
} from "../../../../../shared/schemas/membership-workflows";
import { PageHeader } from "../../../../ui/PageHeader";
import { Badge, statusLabel } from "../../../../components/Badge";
import { usePortalHashLocation } from "../../hash-location";
import { WorkflowVersionEditor } from "./WorkflowVersionEditor";

const path = "/settings/application-workflow";
function VersionPage({ id, canWrite, canPublish }: { id: string; canWrite: boolean; canPublish: boolean }) {
  const [, navigate] = usePortalHashLocation();
  const state = useData(
    () => getJson(`${MEMBERSHIP_WORKFLOWS_API}/${encodeURIComponent(id)}`, membershipWorkflowVersionResponseSchema),
    [id],
  );
  const saved = (version: MembershipWorkflowVersion) => {
    if (version.id === id) void state.reload();
    else navigate(`${path}/${encodeURIComponent(version.id)}`);
  };
  if (state.loading) return <Spinner label="Loading membership workflow…" />;
  if (state.error) return <ErrorAlert error={state.error} />;
  return state.data ? (
    <WorkflowVersionEditor
      key={`${id}:${state.data.workflow.revision}`}
      initial={state.data.workflow}
      canWrite={canWrite}
      canPublish={canPublish}
      onSaved={saved}
    />
  ) : null;
}
export function ApplicationWorkflow({
  canWrite,
  canPublish = false,
  resourceId,
}: {
  canWrite: boolean;
  canPublish?: boolean;
  resourceId?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  if (resourceId === "new")
    return (
      <WorkflowVersionEditor
        canWrite={canWrite}
        canPublish={canPublish}
        onSaved={(version) => navigate(`${path}/${version.id}`)}
      />
    );
  if (resourceId) return <VersionPage id={resourceId} canWrite={canWrite} canPublish={canPublish} />;
  return (
    <div class="pk pk-stack">
      <PageHeader
        title="Application workflows"
        trail={[
          { label: "Settings", href: usePortalHashLocation.hrefs("/settings") },
          { label: "Application workflows" },
        ]}
      />
      <p>
        Categories select a published workflow. Each application keeps its version, so a later policy edit cannot change
        an ongoing review.
      </p>
      <ApiDataTable
        caption="Membership workflow versions"
        endpoint={MEMBERSHIP_WORKFLOWS_API}
        responseSchema={membershipWorkflowsResponseSchema}
        resolve={(data) => data.workflows}
        resolvePage={(data) => data.page}
        paginate
        urlState="workflows"
        initialSort="name"
        searchPlaceholder="Workflow name"
        rowKey={(version) => version.id}
        rowAction={(version) => ({
          label: "View workflow",
          href: usePortalHashLocation.hrefs(`${path}/${encodeURIComponent(version.id)}`),
        })}
        createAction={canWrite ? { label: "New workflow", onSelect: () => navigate(`${path}/new`) } : undefined}
        initialFilters={{ archived: "false" }}
        columns={[
          {
            header: "Workflow",
            cell: (version) => <strong>{version.definition.name}</strong>,
            sort: { asc: "name", desc: "-name" },
            width: "primary",
          },
          {
            header: "Version",
            cell: (version) => version.version,
            sort: { asc: "version", desc: "-version" },
            width: "fit",
          },
          {
            header: "Status",
            cell: (version) => <Badge status={version.archivedAt ? "archived" : version.status} />,
            filter: {
              param: "status",
              options: [
                { value: "", label: "All statuses" },
                ...membershipWorkflowVersionSchema.shape.status.options.map((value) => ({
                  value,
                  label: statusLabel(value),
                })),
              ],
            },
            width: "fit",
          },
          {
            header: "Required steps",
            cell: (version) => version.definition.steps.map((step) => step.label).join(" → "),
          },
          {
            header: "Availability",
            cell: (version) => (
              <Badge
                status={version.archivedAt ? "archived" : "active"}
                label={version.archivedAt ? "Archived" : "Available"}
              />
            ),
            filter: {
              param: "archived",
              options: [
                { value: "false", label: "Available workflows" },
                { value: "true", label: "Archived workflows" },
              ],
            },
            width: "fit",
          },
        ]}
      />
    </div>
  );
}
