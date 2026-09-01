import { useEffect, useRef, useState } from "preact/hooks";
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

/** Reserved placement segment that routes to the creation page instead of a placement's detail. */
const NEW_GROUP_FORM_SEGMENT = "new";

/** Returns to the forms list from an effect, not render — see its call site below. */
function GroupFormsRedirect({ onLeave }: { onLeave: () => void }) {
  useEffect(() => onLeave(), [onLeave]);
  return null;
}

export function GroupForms({
  groupId,
  canManage,
  placementSegment,
  initialPlacementTab,
}: {
  groupId: string;
  canManage: boolean;
  /** `undefined` for the list, `"new"` for the create page, or a placement id for its detail. */
  placementSegment?: string;
  /** The URL-addressed tab segment for `placementSegment`'s detail view. */
  initialPlacementTab?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const creating = placementSegment === NEW_GROUP_FORM_SEGMENT;
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(
    creating ? null : (placementSegment ?? null),
  );
  const tableActions = useRef<ApiTableActions | null>(null);
  const formsPath = `/groups/${encodeURIComponent(groupId)}/forms`;

  function placementPath(placementId: string): string {
    return `${formsPath}/${encodeURIComponent(placementId)}`;
  }

  function selectPlacement(placementId: string | null): void {
    setSelectedPlacementId(placementId);
    navigate(placementId ? placementPath(placementId) : formsPath);
  }

  function leaveCreatePage(): void {
    navigate(formsPath);
  }

  if (creating) {
    // Navigating away belongs in an effect, not in render.
    if (!canManage) return <GroupFormsRedirect onLeave={leaveCreatePage} />;
    return (
      // Creation is a page of its own: a heading that names what is being
      // created, a way back, and no list competing for the same screen.
      <div class="pk pk-stack">
        <div class="pk-cluster">
          <Button size="sm" onClick={leaveCreatePage}>
            ← All forms
          </Button>
        </div>
        <Panel aria-label="New group form">
          <PanelHeader title="New group form" headingLevel={2} />
          <PanelBody>
            <GroupFormEditor
              groupId={groupId}
              detail={null}
              onSaved={(createdPlacementId) =>
                navigate(createdPlacementId ? placementPath(createdPlacementId) : formsPath)
              }
              onCancel={leaveCreatePage}
            />
          </PanelBody>
        </Panel>
      </div>
    );
  }

  return (
    // The outer card had no header of its own, so the panel carries the name
    // as a label rather than inventing a second heading above the workspace
    // tab that already announces this section.
    <div class="pk">
      <Panel aria-label="Group forms">
        <PanelBody class="pk-stack">
          <ApiDataTable
            caption="Group forms"
            endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/forms`}
            responseSchema={groupFormsListResponseSchema}
            resolve={(response) => response.forms}
            resolvePage={(response) => response.page}
            paginate
            actionsRef={tableActions}
            createAction={
              canManage
                ? { label: "New form", onSelect: () => navigate(`${formsPath}/${NEW_GROUP_FORM_SEGMENT}`) }
                : undefined
            }
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
                // The way out is named, not repeated: the toolbar above
                // already carries "New form", and a second button with that
                // same name is one command answering to two controls.
                <EmptyState title="No forms yet" body="Use New form above to get started." />
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
