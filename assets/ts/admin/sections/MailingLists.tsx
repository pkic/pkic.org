/**
 * Admin → Mailing Lists. CRUD over the mailing_lists config
 * table the Google Groups sync engine reads at runtime — see
 * resolveAutoSyncListEmails (functions/_lib/services/mailing-lists.ts).
 * This legacy view consumes the same canonical contracts as the group portal.
 */
import { useState } from "preact/hooks";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { Pager } from "../../components/Pager";
import { useApiPage } from "../../hooks/useApiPage";
import { runGoogleGroupsSync } from "../services/google-groups-sync";
import { api, apiCommand } from "../api";
import { toast } from "../ui";
import {
  mailingListsListResponseSchema,
  mailingListResponseSchema,
  type MailingListsListResponse,
} from "../../../shared/schemas/mailing-lists";
import { MailingListForm } from "../../components/mailing-lists/MailingListForm";
import {
  emptyMailingListDraft,
  mailingListDraftToPayload,
  mailingListDraftToUpdatePayload,
  mailingListToDraft,
  type MailingListDraft,
} from "../../components/mailing-lists/model";

type SortKey = "email" | "label" | "purpose" | "active";
type SortDir = "asc" | "desc";

export function MailingLists() {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MailingListDraft>(emptyMailingListDraft());
  const [newDraft, setNewDraft] = useState<MailingListDraft>(emptyMailingListDraft());
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const listing = useApiPage<MailingListsListResponse>(
    "/api/v1/admin/mailing-lists",
    sortKey ? { sort: `${sortDir === "desc" ? "-" : ""}${sortKey}` } : {},
    mailingListsListResponseSchema,
    (data) => data.mailingLists,
  );
  const lists = listing.data?.mailingLists ?? [];

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortTh(label: string, key: SortKey) {
    const active = sortKey === key;
    return (
      <th>
        <button
          type="button"
          class={`tbl-sort-btn${active ? " is-active" : ""}`}
          onClick={() => toggleSort(key)}
          aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        >
          <span>{label}</span>
          <span aria-hidden="true" class="tbl-sort-indicator">
            {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </th>
    );
  }

  async function createList(e: Event) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/v1/admin/mailing-lists", mailingListResponseSchema, {
        method: "POST",
        body: JSON.stringify(mailingListDraftToPayload(newDraft, "admin")),
      });
      toast("Mailing list added", "success");
      setNewDraft(emptyMailingListDraft());
      setShowAdd(false);
      await listing.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id: string) {
    setSaving(true);
    try {
      await api(`/api/v1/admin/mailing-lists/${id}`, mailingListResponseSchema, {
        method: "PATCH",
        body: JSON.stringify(mailingListDraftToUpdatePayload(editDraft)),
      });
      toast("Saved", "success");
      setEditingId(null);
      await listing.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Archive mailing list "${label}"? The portal will stop managing it.`)) {
      return;
    }
    try {
      await apiCommand(`/api/v1/admin/mailing-lists/${id}`, { method: "DELETE" });
      toast("Archived", "success");
      await listing.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      await runGoogleGroupsSync();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSyncing(false);
    }
  }

  if (listing.loading && !listing.data) return <Spinner />;
  if (listing.error) {
    return <ErrorAlert error={listing.error instanceof Error ? listing.error : "Could not load mailing lists."} />;
  }

  return (
    <div>
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-outline-success btn-sm" disabled={syncing} onClick={handleSyncNow}>
            {syncing ? "Syncing…" : "↺ Sync now"}
          </button>
        </div>
        <button type="button" class="btn btn-primary btn-sm" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? "Cancel" : "Add mailing list"}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={createList} class="card border-0 shadow-sm mb-3">
          <div class="card-body">
            <MailingListForm
              draft={newDraft}
              onChange={(patch) => setNewDraft((d) => ({ ...d, ...patch }))}
              idPrefix="admin-mailing-list-create"
            />
            <button type="submit" class="btn btn-success btn-sm mt-2" disabled={saving}>
              Save
            </button>
          </div>
        </form>
      )}

      <div class="table-responsive">
        <table class="table table-sm align-middle">
          <thead class="table-dark">
            <tr>
              {sortTh("Email", "email")}
              {sortTh("Label", "label")}
              {sortTh("Purpose", "purpose")}
              <th>Auto-sync categories</th>
              {sortTh("Active", "active")}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lists.map((list) =>
              editingId === list.id ? (
                <tr key={list.id}>
                  <td colSpan={6}>
                    <MailingListForm
                      draft={editDraft}
                      onChange={(patch) => setEditDraft((d) => ({ ...d, ...patch }))}
                      showGroupOwnership={false}
                      ownershipLabel="Immutable owner group"
                      idPrefix={`admin-mailing-list-${list.id}`}
                    />
                    <div class="mt-2 d-flex gap-2">
                      <button
                        type="button"
                        class="btn btn-success btn-sm"
                        disabled={saving}
                        onClick={() => saveEdit(list.id)}
                      >
                        Save
                      </button>
                      <button type="button" class="btn btn-outline-secondary btn-sm" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={list.id}>
                  <td>{list.email}</td>
                  <td>{list.label}</td>
                  <td>
                    <span class="badge text-bg-light text-capitalize">{list.purpose.replace("_", " ")}</span>
                  </td>
                  <td class="small text-muted">{list.autoSyncCategories?.join(", ") ?? "all"}</td>
                  <td>
                    {list.active ? (
                      <span class="badge text-bg-success">Active</span>
                    ) : (
                      <span class="badge text-bg-secondary">Inactive</span>
                    )}
                  </td>
                  <td class="text-end">
                    <button
                      type="button"
                      class="btn btn-outline-secondary btn-sm me-1"
                      onClick={() => {
                        setEditingId(list.id);
                        setEditDraft(mailingListToDraft(list));
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-danger btn-sm"
                      onClick={() => remove(list.id, list.label)}
                    >
                      Archive
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {listing.pagerProps && <Pager {...listing.pagerProps} />}
    </div>
  );
}
