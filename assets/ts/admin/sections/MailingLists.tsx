/**
 * Admin → Mailing Lists. CRUD over the mailing_lists config
 * table the Google Groups sync engine reads at runtime — see
 * resolveAutoSyncListEmails (functions/_lib/services/mailing-lists.ts).
 * Admin role required (
 * assets/shared/schemas/admin-mailing-lists.ts's header note).
 */
import { useState } from "preact/hooks";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { Pager } from "../../components/Pager";
import { useApiPage } from "../../hooks/useApiPage";
import { runGoogleGroupsSync } from "../services/google-groups-sync";
import { api } from "../api";
import { toast } from "../ui";
import type { MailingList } from "../types";
import {
  MAILING_LIST_TYPES as LIST_TYPES,
  mailingListsListResponseSchema,
  type MailingListsListResponse,
} from "../../../shared/schemas/admin-mailing-lists";

type SortKey = "email" | "label" | "list_type" | "active";
type SortDir = "asc" | "desc";

interface Draft {
  email: string;
  label: string;
  listType: (typeof LIST_TYPES)[number];
  workingGroupId: string;
  autoSyncCategories: string;
  active: boolean;
}

function emptyDraft(): Draft {
  return { email: "", label: "", listType: "custom", workingGroupId: "", autoSyncCategories: "", active: true };
}

function toDraft(list: MailingList): Draft {
  return {
    email: list.email,
    label: list.label,
    listType: list.listType,
    workingGroupId: list.workingGroupId ?? "",
    autoSyncCategories: list.autoSyncCategories?.join(", ") ?? "",
    active: list.active,
  };
}

function draftToPayload(draft: Draft) {
  return {
    email: draft.email.trim(),
    label: draft.label.trim(),
    listType: draft.listType,
    workingGroupId: draft.workingGroupId.trim() || null,
    autoSyncCategories: draft.autoSyncCategories.trim()
      ? draft.autoSyncCategories
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
      : null,
    active: draft.active,
  };
}

function MailingListForm({ draft, onChange }: { draft: Draft; onChange: (patch: Partial<Draft>) => void }) {
  return (
    <div class="row g-2">
      <div class="col-sm-4">
        <label class="form-label small">Email</label>
        <input
          class="form-control form-control-sm"
          value={draft.email}
          onInput={(e) => onChange({ email: (e.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-3">
        <label class="form-label small">Label</label>
        <input
          class="form-control form-control-sm"
          value={draft.label}
          onInput={(e) => onChange({ label: (e.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-2">
        <label class="form-label small">Type</label>
        <select
          class="form-select form-select-sm"
          value={draft.listType}
          onChange={(e) => onChange({ listType: (e.target as HTMLSelectElement).value as Draft["listType"] })}
        >
          {LIST_TYPES.map((t) => (
            <option value={t} key={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div class="col-sm-2">
        <label class="form-label small">Auto-sync categories</label>
        <input
          class="form-control form-control-sm"
          placeholder="A,B,C (blank = all)"
          value={draft.autoSyncCategories}
          onInput={(e) => onChange({ autoSyncCategories: (e.target as HTMLInputElement).value })}
        />
      </div>
      <div class="col-sm-1 d-flex align-items-end">
        <div class="form-check">
          <input
            class="form-check-input"
            type="checkbox"
            checked={draft.active}
            onChange={(e) => onChange({ active: (e.target as HTMLInputElement).checked })}
          />
          <label class="form-check-label small">Active</label>
        </div>
      </div>
    </div>
  );
}

export function MailingLists() {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft());
  const [newDraft, setNewDraft] = useState<Draft>(emptyDraft());
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
      await api("/api/v1/admin/mailing-lists", { method: "POST", body: JSON.stringify(draftToPayload(newDraft)) });
      toast("Mailing list added", "success");
      setNewDraft(emptyDraft());
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
      await api(`/api/v1/admin/mailing-lists/${id}`, {
        method: "PATCH",
        body: JSON.stringify(draftToPayload(editDraft)),
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
    if (
      !confirm(`Delete mailing list "${label}"? The portal stops managing it; the Google Group itself is not deleted.`)
    ) {
      return;
    }
    try {
      await api(`/api/v1/admin/mailing-lists/${id}`, { method: "DELETE" });
      toast("Deleted", "success");
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
            <MailingListForm draft={newDraft} onChange={(patch) => setNewDraft((d) => ({ ...d, ...patch }))} />
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
              {sortTh("Type", "list_type")}
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
                    <span class="badge text-bg-light text-capitalize">{list.listType.replace("_", " ")}</span>
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
                        setEditDraft(toDraft(list));
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-danger btn-sm"
                      onClick={() => remove(list.id, list.label)}
                    >
                      Delete
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
