import { useRef } from "preact/hooks";
import { HashRedirect } from "../../HashRedirect";
import { usePortalHashLocation } from "../../hash-location";
import { FORM_PLACEMENT_CONTEXT_TYPES, FORM_PURPOSES, type FormPlacement } from "../../../../../shared/schemas/forms";
import { groupFormsListResponseSchema } from "../../../../../shared/schemas/group-forms";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { GroupFormDetail } from "./GroupFormDetail";
import { GroupFormEditor } from "./GroupFormEditor";

/** Reserved placement segment that routes to the creation page instead of a placement's detail. */
const NEW_GROUP_FORM_SEGMENT = "new";

/** Where a placement is anchored, in product language rather than schema keys. */
const FORM_CONTEXT_LABELS: Record<FormPlacement["contextType"], string> = {
  installation: "Installation-wide",
  group: "Group",
  event: "Event",
  organization: "Organization",
};

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
  const tableActions = useRef<ApiTableActions | null>(null);
  const formsPath = `/groups/${encodeURIComponent(groupId)}/forms`;

  function placementPath(placementId: string): string {
    return `${formsPath}/${encodeURIComponent(placementId)}`;
  }

  function leaveCreatePage(): void {
    navigate(formsPath);
  }

  if (creating) {
    if (!canManage) return <HashRedirect to={formsPath} />;
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
          <PanelHeader title="New group form" />
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

  if (placementSegment) {
    // A form is a record with facets — respond, statistics, responses, the
    // editors — so it gets its own page rather than an expansion between the
    // list's rows. The detail fetches itself by placement id.
    return (
      <div class="pk pk-stack">
        <div class="pk-cluster">
          <Button variant="link" size="sm" onClick={leaveCreatePage}>
            ← All forms
          </Button>
        </div>
        <GroupFormDetail
          groupId={groupId}
          placementId={placementSegment}
          initialTab={initialPlacementTab}
          onChanged={() => tableActions.current?.reload()}
        />
      </div>
    );
  }

  return (
    <div class="pk">
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
          // The list contract already accepts `purpose` and `contextType`;
          // each lives in the column that shows the value it narrows, rather
          // than being left to search syntax or to a select above the table.
          {
            header: "Purpose",
            cell: (row) => <Badge status={row.form.purpose} />,
            width: "fit",
            sort: { asc: "purpose", desc: "-purpose" },
            filter: {
              param: "purpose",
              options: [
                { value: "", label: "All purposes" },
                ...FORM_PURPOSES.map((purpose) => ({ value: purpose as string, label: purpose.replace(/_/g, " ") })),
              ],
            },
          },
          {
            // Where the placement is anchored, in product language rather
            // than the schema's `contextType` keys.
            header: "Context",
            cell: (row) => FORM_CONTEXT_LABELS[row.placement.contextType],
            width: "fit",
            filter: {
              param: "contextType",
              options: [
                { value: "", label: "All contexts" },
                ...FORM_PLACEMENT_CONTEXT_TYPES.map((contextType) => ({
                  value: contextType as string,
                  label: FORM_CONTEXT_LABELS[contextType],
                })),
              ],
            },
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
            width: "fit",
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
        // A form is a URL-addressed record; the row is a link to it, so
        // it can be opened in a new tab and the address bar follows.
        rowAction={(row) => ({
          label: `Open ${row.form.title}`,
          href: `#${placementPath(row.placement.id)}`,
        })}
      />
    </div>
  );
}
