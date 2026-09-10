import { useContractForm } from "../../../../hooks/useContractForm";
import { useRef, useState } from "preact/hooks";
import {
  groupMailingListCreateSchema,
  mailingListResponseSchema,
  mailingListsListResponseSchema,
  type MailingList,
} from "../../../../../shared/schemas/mailing-lists";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { RowActions } from "../../../../ui/RowActions";
import { postValidated } from "../../../../shared/api-client";
import { MailingListForm } from "../../../../components/mailing-lists/MailingListForm";
import {
  emptyMailingListDraft,
  mailingListDraftToPayload,
  type MailingListDraft,
} from "../../../../components/mailing-lists/model";
import { GroupMailingListRecord } from "./GroupMailingListRecord";
import { mailingListLifecycleActions } from "./mailing-list-lifecycle";
import { usePortalHashLocation } from "../../hash-location";

/** Reserved mailing-list segment that routes to the create page instead of a record. */
const NEW_MAILING_LIST_SEGMENT = "new";

/**
 * Group-scoped list configuration. Ownership is supplied by the route, never
 * by the form — and so are the create page and each list's record, which are
 * places with their own addresses rather than panels that unfold above or
 * between the table's rows.
 */
export function GroupMailingListManager({
  groupId,
  listSegment,
  listTab,
}: {
  groupId: string;
  listSegment?: string;
  /** The URL segment below a list id: the record's active tab. */
  listTab?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const listsPath = `/groups/${encodeURIComponent(groupId)}/mailing-lists`;
  const showCreate = listSegment === NEW_MAILING_LIST_SEGMENT;
  const actions = useRef<ApiTableActions | null>(null);
  const [newDraft, setNewDraft] = useState<MailingListDraft>(emptyMailingListDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const form = useContractForm(groupMailingListCreateSchema, mailingListDraftToPayload(newDraft));

  async function createList(event: Event): Promise<void> {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(new Error(checked.message));
      return;
    }
    setSaving(true);
    setError(null);
    let created = false;
    try {
      await postValidated(
        `/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists`,
        groupMailingListCreateSchema,
        checked.data,
        mailingListResponseSchema,
      );
      setNewDraft(emptyMailingListDraft());
      form.reset();
      created = true;
    } catch (cause) {
      setError(new Error(form.refuse(cause)));
    } finally {
      setSaving(false);
    }
    /*
     * Returning is the last thing, and it is outside the flag's own scope.
     * The create page's own segment is a re-render rather than a remount, so
     * leaving the flag set on the way out left its button reading "Saving…"
     * and unclickable for the rest of the session. The list fetches on its
     * own when it comes back; there is no table here to reload.
     */
    if (created) navigate(listsPath);
  }

  function rowActions(list: MailingList) {
    return mailingListLifecycleActions({
      groupId,
      list,
      onChanged: async () => {
        setError(null);
        await actions.current?.reload();
      },
      onDeleted: async () => {
        setError(null);
        await actions.current?.reload();
      },
      onError: setError,
    });
  }

  if (showCreate) {
    return (
      /*
       * A form has a measure. Left to the page's full width the fields were
       * drawn across a 1500px panel, so a three-word label and the end of its
       * input were half a screen apart — part of what #50 called messy. Held
       * to a reading measure, the section grid puts two fields on a line and
       * fills it. Start-aligned, so the form sits under the page's own
       * heading rather than centred away from it.
       */
      <div class="pk pk-stack pk-container pk-container--narrow pk-container--start">
        {/* The page's way back: creating has its own address, so leaving it
            is navigation rather than the disappearance of a layer. */}

        {error && <ErrorAlert error={error} />}
        <Panel aria-label="New group mailing list">
          <form noValidate {...form.handlers} onSubmit={(event) => void createList(event)}>
            <PanelHeader title="New group mailing list" headingLevel={2} breadcrumb />
            <PanelBody class="pk-stack">
              <MailingListForm
                draft={newDraft}
                fields={form.of}
                onChange={(patch) => setNewDraft((current) => ({ ...current, ...patch }))}
                idPrefix="group-mailing-list-create"
              />
              <div class="pk-cluster">
                <Button type="submit" size="sm" variant="primary" disabled={saving}>
                  {saving ? "Saving…" : "Create mailing list"}
                </Button>
                <Button size="sm" onClick={() => navigate(listsPath)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </PanelBody>
          </form>
        </Panel>
      </div>
    );
  }

  if (listSegment) {
    // A list is a record with facets — its subscribers, its settings, who it
    // is shared with — so it gets its own page rather than an expansion
    // between the table's rows.
    return (
      <GroupMailingListRecord
        groupId={groupId}
        listId={listSegment}
        initialTab={listTab}
        onLeave={() => navigate(listsPath)}
      />
    );
  }

  return (
    // The list is its own panel; the workspace tab already names the section,
    // so no second heading restates it above the table.
    <div class="pk pk-stack">
      {error && <ErrorAlert error={error} />}
      <ApiDataTable
        caption="Managed mailing lists"
        actionsRef={actions}
        endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/management`}
        responseSchema={mailingListsListResponseSchema}
        resolve={(response) => response.mailingLists}
        resolvePage={(response) => response.page}
        paginate
        createAction={{
          label: "Add mailing list",
          onSelect: () => navigate(`${listsPath}/${NEW_MAILING_LIST_SEGMENT}`),
        }}
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
            width: "fit",
            sort: { asc: "purpose", desc: "-purpose" },
          },
          {
            // Which list is the group's primary discussion list. The list
            // contract already accepts `primaryDiscussion`; the column shows
            // the value and its menu narrows by it, so the primary list can
            // be found without scanning every row — and without a select
            // above the table filtering by something no column said.
            header: "Role",
            cell: (list) =>
              list.primaryDiscussion ? (
                "Primary discussion"
              ) : (
                <>
                  <span class="pk-muted" aria-hidden="true">
                    —
                  </span>
                  <span class="pk-sr-only">Other list</span>
                </>
              ),
            width: "fit",
            filter: {
              param: "primaryDiscussion",
              options: [
                { value: "", label: "All lists" },
                { value: "true", label: "Primary discussion list" },
                { value: "false", label: "Other lists" },
              ],
            },
          },
          {
            header: "Status",
            // The word carries the state, not the tone: an archived list has
            // to read as archived to someone who cannot separate the hues.
            cell: (list) => <Badge tone={list.active ? "ok" : "neutral"}>{list.active ? "Active" : "Archived"}</Badge>,
            width: "fit",
          },
          {
            header: "",
            cell: (list) => <RowActions subject={list.label} actions={rowActions(list)} />,
          },
        ]}
        rowKey={(list) => list.id}
        // Activating a row opens the list's own page, the same rule as every
        // other record in the portal.
        rowAction={(list) => ({
          label: `Open ${list.label}`,
          onSelect: () => navigate(`${listsPath}/${encodeURIComponent(list.id)}`),
        })}
        empty={
          <EmptyState title="No mailing lists yet" body="Create a mailing list to start managing this group's lists." />
        }
      />
    </div>
  );
}
