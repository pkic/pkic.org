import { useRef, useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import { groupFormsListResponseSchema } from "../../../../../shared/schemas/group-forms";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
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
    <div class="card border-0 shadow-sm">
      <div class="card-body">
        {showCreate && (
          <div class="card mb-3">
            <div class="card-header fw-semibold">New group form</div>
            <div class="card-body">
              <GroupFormEditor
                groupId={groupId}
                detail={null}
                onSaved={async () => {
                  setShowCreate(false);
                  await tableActions.current?.reload();
                }}
                onCancel={() => setShowCreate(false)}
              />
            </div>
          </div>
        )}
        <ApiDataTable
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
            {
              header: "",
              className: "text-end",
              cell: (row) => (
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary"
                  aria-expanded={selectedPlacementId === row.placement.id}
                  onClick={() => selectPlacement(selectedPlacementId === row.placement.id ? null : row.placement.id)}
                >
                  {selectedPlacementId === row.placement.id ? "Hide" : "Details"}
                </button>
              ),
            },
          ]}
          empty={
            canManage ? (
              <EmptyState title="No forms yet" body="Create a form to get started." />
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
      </div>
    </div>
  );
}
