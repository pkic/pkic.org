import { useRef, useState } from "preact/hooks";
import {
  groupMailingListCreateSchema,
  groupMailingListUpdateSchema,
  mailingListResponseSchema,
  mailingListsListResponseSchema,
  type MailingList,
} from "../../../../../shared/schemas/mailing-lists";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { RowActions } from "../../../../ui/RowActions";
import { deleteJson, patchValidated, postValidated } from "../../../../shared/api-client";
import { MailingListForm } from "../../../../components/mailing-lists/MailingListForm";
import {
  emptyMailingListDraft,
  mailingListDraftToPayload,
  mailingListToDraft,
  type MailingListDraft,
} from "../../../../components/mailing-lists/model";
import { ResourceSharingEditor } from "./ResourceSharingEditor";

/** Group-scoped list configuration. Ownership is supplied by the route, never by the form. */
export function GroupMailingListManager({ groupId }: { groupId: string }) {
  const actions = useRef<ApiTableActions | null>(null);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newDraft, setNewDraft] = useState<MailingListDraft>(emptyMailingListDraft());
  const [editDraft, setEditDraft] = useState<MailingListDraft>(emptyMailingListDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function createList(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await postValidated(
        `/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists`,
        groupMailingListCreateSchema,
        mailingListDraftToPayload(newDraft),
        mailingListResponseSchema,
      );
      setNewDraft(emptyMailingListDraft());
      setShowCreate(false);
      await actions.current?.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not create the mailing list"));
    } finally {
      setSaving(false);
    }
  }

  async function saveList(listId: string): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await patchValidated(
        `/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/${encodeURIComponent(listId)}`,
        groupMailingListUpdateSchema,
        mailingListDraftToPayload(editDraft),
        mailingListResponseSchema,
      );
      setSelectedListId(null);
      await actions.current?.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not update the mailing list"));
    } finally {
      setSaving(false);
    }
  }

  async function archiveList(list: MailingList): Promise<void> {
    if (
      !(await confirmAction({
        title: `Archive ${list.label}?`,
        body: "Archiving stops the list from accepting new mail.",
        consequences: [
          "Members can no longer send to or receive from this list",
          "The list's configuration and history are kept, so it can be referenced later",
        ],
        confirmLabel: "Archive mailing list",
      }))
    )
      return;
    setError(null);
    try {
      await deleteJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/${encodeURIComponent(list.id)}`,
        successResponseSchema,
      );
      if (selectedListId === list.id) setSelectedListId(null);
      await actions.current?.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not archive the mailing list"));
    }
  }

  function selectForManagement(list: MailingList): void {
    setSelectedListId((current) => (current === list.id ? null : list.id));
    setEditDraft(mailingListToDraft(list));
  }

  return (
    <Panel class="pk" aria-label="Mailing-list management">
      <PanelHeader title="Managed mailing lists" />
      <PanelBody class="pk-stack">
        {error && <ErrorAlert error={error} />}
        {showCreate && (
          <Panel>
            <form onSubmit={(event) => void createList(event)}>
              <PanelHeader title="New group mailing list" headingLevel={4}>
                <Button size="sm" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
              </PanelHeader>
              <PanelBody class="pk-stack">
                <MailingListForm
                  draft={newDraft}
                  onChange={(patch) => setNewDraft((current) => ({ ...current, ...patch }))}
                  idPrefix="group-mailing-list-create"
                />
                <div class="pk-cluster">
                  <Button type="submit" size="sm" variant="primary" disabled={saving}>
                    {saving ? "Saving…" : "Create mailing list"}
                  </Button>
                </div>
              </PanelBody>
            </form>
          </Panel>
        )}
        <ApiDataTable
          caption="Managed mailing lists"
          actionsRef={actions}
          endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/management`}
          responseSchema={mailingListsListResponseSchema}
          resolve={(response) => response.mailingLists}
          resolvePage={(response) => response.page}
          paginate
          createAction={{ label: "Add mailing list", onSelect: () => setShowCreate(true) }}
          searchPlaceholder="Search managed mailing lists…"
          initialSort="label"
          columns={[
            {
              header: "Mailing list",
              cell: (list) => (
                <div class="pk-stack pk-stack--tight">
                  <span class="pk-strong">{list.label}</span>
                  <span class="pk-small">{list.email}</span>
                </div>
              ),
              sort: { asc: "label", desc: "-label" },
            },
            {
              header: "Purpose",
              cell: (list) => list.purpose.replaceAll("_", " "),
              sort: { asc: "purpose", desc: "-purpose" },
            },
            {
              header: "Status",
              // The word carries the state, not the tone: an archived list has
              // to read as archived to someone who cannot separate the hues.
              cell: (list) => (
                <Badge tone={list.active ? "ok" : "neutral"}>{list.active ? "Active" : "Archived"}</Badge>
              ),
            },
            {
              header: "",
              className: "pk-end",
              cell: (list) => (
                <div class="pk-cluster pk-cluster--end">
                  <Button
                    size="sm"
                    aria-expanded={selectedListId === list.id}
                    onClick={() => selectForManagement(list)}
                  >
                    {selectedListId === list.id ? "Close" : "Manage"}
                  </Button>
                  <RowActions
                    subject={list.label}
                    actions={[
                      {
                        id: "archive",
                        label: "Archive",
                        onSelect: () => void archiveList(list),
                        disabled: !list.active,
                      },
                    ]}
                  />
                </div>
              ),
            },
          ]}
          rowKey={(list) => list.id}
          detailRow={(list) =>
            selectedListId === list.id ? (
              // The expanded cell has no padding of its own — DataTable zeroes
              // it so the row's owner decides — so the panel body supplies it
              // on the space scale rather than a one-off padding utility.
              <PanelBody class="pk-stack">
                <h4>Manage {list.label}</h4>
                <MailingListForm
                  draft={editDraft}
                  onChange={(patch) => setEditDraft((current) => ({ ...current, ...patch }))}
                  idPrefix={`group-mailing-list-${list.id}`}
                />
                <div class="pk-cluster">
                  <Button size="sm" variant="primary" disabled={saving} onClick={() => void saveList(list.id)}>
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                  <Button size="sm" onClick={() => setSelectedListId(null)}>
                    Cancel
                  </Button>
                </div>
                <ResourceSharingEditor
                  kind="mailingList"
                  groupId={groupId}
                  resourceId={list.id}
                  ownerGroupId={groupId}
                />
              </PanelBody>
            ) : null
          }
          empty={
            <EmptyState
              title="No mailing lists yet"
              body="Create a mailing list to start managing this group's lists."
            />
          }
        />
      </PanelBody>
    </Panel>
  );
}
