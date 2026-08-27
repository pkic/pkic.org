import { useRef, useState } from "preact/hooks";
import {
  mailingListResponseSchema,
  mailingListsListResponseSchema,
  type MailingList,
} from "../../../../../shared/schemas/mailing-lists";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { deleteJson, patchJson, postJson } from "../../../../shared/api-client";
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
      await postJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists`,
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
      await patchJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/${encodeURIComponent(listId)}`,
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
    if (!window.confirm(`Archive ${list.label}?`)) return;
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
    <section class="card border-0 shadow-sm mb-3" aria-label="Mailing-list management">
      <div class="card-header bg-white d-flex justify-content-between align-items-center">
        <span class="fw-semibold">Managed mailing lists</span>
        <button type="button" class="btn btn-sm btn-primary" onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? "Cancel" : "Add mailing list"}
        </button>
      </div>
      <div class="card-body">
        {error && <ErrorAlert error={error} />}
        {showCreate && (
          <form class="card card-body bg-body-tertiary mb-3" onSubmit={(event) => void createList(event)}>
            <h6 class="card-title">New group mailing list</h6>
            <MailingListForm
              draft={newDraft}
              onChange={(patch) => setNewDraft((current) => ({ ...current, ...patch }))}
              idPrefix="group-mailing-list-create"
            />
            <div class="mt-3">
              <button type="submit" class="btn btn-sm btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Create mailing list"}
              </button>
            </div>
          </form>
        )}
        <ApiDataTable
          actionsRef={actions}
          endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/management`}
          responseSchema={mailingListsListResponseSchema}
          resolve={(response) => response.mailingLists}
          resolvePage={(response) => response.page}
          paginate
          searchPlaceholder="Search managed mailing lists…"
          initialSort="label"
          columns={[
            {
              header: "Mailing list",
              cell: (list) => (
                <>
                  <div class="fw-semibold">{list.label}</div>
                  <div class="small text-muted">{list.email}</div>
                </>
              ),
              sort: { asc: "label", desc: "-label" },
            },
            {
              header: "Purpose",
              cell: (list) => list.purpose.replaceAll("_", " "),
              sort: { asc: "purpose", desc: "-purpose" },
            },
            { header: "Status", cell: (list) => (list.active ? "Active" : "Archived") },
            {
              header: "",
              className: "text-end",
              cell: (list) => (
                <div class="d-flex justify-content-end gap-2">
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary"
                    aria-expanded={selectedListId === list.id}
                    onClick={() => selectForManagement(list)}
                  >
                    {selectedListId === list.id ? "Close" : "Manage"}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-danger"
                    disabled={!list.active}
                    onClick={() => void archiveList(list)}
                  >
                    Archive
                  </button>
                </div>
              ),
            },
          ]}
          rowKey={(list) => list.id}
          detailRow={(list) =>
            selectedListId === list.id ? (
              <div class="p-3 bg-body-tertiary">
                <h6>Manage {list.label}</h6>
                <MailingListForm
                  draft={editDraft}
                  onChange={(patch) => setEditDraft((current) => ({ ...current, ...patch }))}
                  idPrefix={`group-mailing-list-${list.id}`}
                />
                <div class="mt-3 d-flex gap-2">
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    disabled={saving}
                    onClick={() => void saveList(list.id)}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary"
                    onClick={() => setSelectedListId(null)}
                  >
                    Cancel
                  </button>
                </div>
                <ResourceSharingEditor
                  kind="mailingList"
                  groupId={groupId}
                  resourceId={list.id}
                  ownerGroupId={groupId}
                />
              </div>
            ) : null
          }
          empty="No mailing lists are managed by this group."
        />
      </div>
    </section>
  );
}
