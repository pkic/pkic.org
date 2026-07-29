/**
 * Admin → Mailing Lists (PRD §4.14). CRUD over the mailing_lists config
 * table the Google Groups sync engine reads at runtime — see
 * resolveAutoSyncListEmails (functions/_lib/services/mailing-lists.ts).
 * Admin role required (no Phase 2 permission — see
 * assets/shared/schemas/admin-mailing-lists.ts's header note).
 */
import { useState, useEffect, useCallback } from "preact/hooks";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { api } from "../api";
import { toast } from "../ui";
import type { MailingList } from "../types";

const LIST_TYPES = ["all_members", "consultation", "ec", "working_group", "custom"] as const;

type SortKey = "email" | "label" | "listType" | "autoSyncCategories" | "active";
type SortDir = "asc" | "desc";

function sortValue(list: MailingList, key: SortKey): string | number | null {
  switch (key) {
    case "email":
      return list.email;
    case "label":
      return list.label;
    case "listType":
      return list.listType;
    case "autoSyncCategories":
      return list.autoSyncCategories?.join(", ") ?? null;
    case "active":
      return list.active ? 1 : 0;
  }
}

// Nulls always sort last, regardless of direction.
function compareSort(a: MailingList, b: MailingList, key: SortKey, dir: SortDir): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
  return dir === "asc" ? cmp : -cmp;
}

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

function MailingListForm({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
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
  const [lists, setLists] = useState<MailingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft());
  const [newDraft, setNewDraft] = useState<Draft>(emptyDraft());
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ mailingLists: MailingList[] }>("/api/v1/admin/mailing-lists");
      setLists(data.mailingLists);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createList(e: Event) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/v1/admin/mailing-lists", { method: "POST", body: JSON.stringify(draftToPayload(newDraft)) });
      toast("Mailing list added", "success");
      setNewDraft(emptyDraft());
      setShowAdd(false);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id: string) {
    setSaving(true);
    try {
      await api(`/api/v1/admin/mailing-lists/${id}`, { method: "PATCH", body: JSON.stringify(draftToPayload(editDraft)) });
      toast("Saved", "success");
      setEditingId(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Delete mailing list "${label}"? The portal stops managing it; the Google Group itself is not deleted.`)) {
      return;
    }
    try {
      await api(`/api/v1/admin/mailing-lists/${id}`, { method: "DELETE" });
      toast("Deleted", "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const res = await api<{ processed: number; succeeded: number; failed: number; skippedUnconfigured: boolean }>(
        "/api/v1/admin/mailing-lists/sync",
        { method: "POST" },
      );
      if (res.skippedUnconfigured) {
        toast("Google Groups sync isn't configured in this environment", "error");
      } else if (res.processed === 0) {
        toast("Nothing pending to sync", "success");
      } else {
        toast(`Synced ${res.processed}: ${res.succeeded} succeeded${res.failed ? `, ${res.failed} failed` : ""}`, res.failed > 0 ? "error" : "success");
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

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
              {sortTh("Type", "listType")}
              {sortTh("Auto-sync categories", "autoSyncCategories")}
              {sortTh("Active", "active")}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(sortKey ? lists.slice().sort((a, b) => compareSort(a, b, sortKey, sortDir)) : lists).map((list) =>
              editingId === list.id ? (
                <tr key={list.id}>
                  <td colSpan={6}>
                    <MailingListForm draft={editDraft} onChange={(patch) => setEditDraft((d) => ({ ...d, ...patch }))} />
                    <div class="mt-2 d-flex gap-2">
                      <button type="button" class="btn btn-success btn-sm" disabled={saving} onClick={() => saveEdit(list.id)}>
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
                    <button type="button" class="btn btn-outline-danger btn-sm" onClick={() => remove(list.id, list.label)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
