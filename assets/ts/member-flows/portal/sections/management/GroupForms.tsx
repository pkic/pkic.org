import { useRef, useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import { groupFormsListResponseSchema } from "../../../../../shared/schemas/group-forms";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { GroupFormDetail } from "./GroupFormDetail";
import { GroupFormEditor } from "./GroupFormEditor";
import { ResourceCapabilities } from "./ResourceCapabilities";

export function GroupForms({
  groupId,
  canManage,
  initialPlacementId,
  initialPlacementTab,
}: {
  groupId: string;
  canManage: boolean;
  initialPlacementId?: string;
  /** The URL-addressed tab segment for `initialPlacementId`'s detail view. */
  initialPlacementTab?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(initialPlacementId ?? null);
  const tableActions = useRef<ApiTableActions | null>(null);

  function selectPlacement(placementId: string | null): void {
    setSelectedPlacementId(placementId);
    navigate(
      placementId
        ? `/groups/${encodeURIComponent(groupId)}/forms/${encodeURIComponent(placementId)}`
        : `/groups/${encodeURIComponent(groupId)}/forms`,
    );
  }

  return (
    // The outer card had no header of its own, so the panel carries the name
    // as a label rather than inventing a second heading above the workspace
    // tab that already announces this section. The body's gap replaces the
    // `mb-3` the create form used to carry.
    <div class="pk">
      <Panel aria-label="Group forms">
        <PanelBody class="pk-stack">
          {showCreate && (
            <Panel aria-label="New group form">
              <PanelHeader title="New group form" headingLevel={4} />
              <PanelBody>
                <GroupFormEditor
                  groupId={groupId}
                  detail={null}
                  onSaved={async () => {
                    setShowCreate(false);
                    await tableActions.current?.reload();
                  }}
                  onCancel={() => setShowCreate(false)}
                />
              </PanelBody>
            </Panel>
          )}
          <ApiDataTable
            caption="Group forms"
            endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/forms`}
            responseSchema={groupFormsListResponseSchema}
            resolve={(response) => response.forms}
            resolvePage={(response) => response.page}
            paginate
            actionsRef={tableActions}
            createAction={canManage ? { label: "New form", onSelect: () => setShowCreate(true) } : undefined}
            searchPlaceholder="Search forms…"
            initialSort="title"
            columns={[
              {
                header: "Form",
                cell: (row) => (
                  <div class="pk-stack pk-stack--tight">
                    <span class="pk-strong">{row.form.title}</span>
                    {row.form.description && <span class="pk-small">{row.form.description}</span>}
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
              {
                header: "",
                className: "pk-end",
                cell: (row) => (
                  // The control names the form it belongs to: a page of rows
                  // otherwise offers a column of buttons all called "Details".
                  <Button
                    size="sm"
                    aria-label={`${selectedPlacementId === row.placement.id ? "Hide" : "Details"} for ${row.form.title}`}
                    aria-expanded={selectedPlacementId === row.placement.id}
                    onClick={() => selectPlacement(selectedPlacementId === row.placement.id ? null : row.placement.id)}
                  >
                    {selectedPlacementId === row.placement.id ? "Hide" : "Details"}
                  </Button>
                ),
              },
            ]}
            empty={
              canManage ? (
                // An empty list a manager can act on hands them the action,
                // rather than naming what is absent and stopping there.
                <EmptyState
                  title="No forms yet"
                  body="Create a form to get started."
                  action={{ label: "New form", onSelect: () => setShowCreate(true) }}
                />
              ) : (
                "No forms are available through this group."
              )
            }
            rowKey={(row) => row.placement.id}
            detailRow={(row) =>
              selectedPlacementId === row.placement.id ? (
                <GroupFormDetail
                  groupId={groupId}
                  placementId={row.placement.id}
                  initialTab={initialPlacementTab}
                  onChanged={() => tableActions.current?.reload()}
                />
              ) : null
            }
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
