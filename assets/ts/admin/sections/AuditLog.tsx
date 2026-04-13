import { h } from "preact";
import { useState } from "preact/hooks";
import { Badge } from "../../components/Badge";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { Pager } from "../../components/Pager";
import { api } from "../api";
import { fmt } from "../ui";
import { useData } from "../../hooks/useData";
import { usePageState } from "../../hooks/usePageState";

export interface AuditLogEntry {
  id: string;
  actor_type: string;
  actor_id: string | null;
  actor_display: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface AuditLogResponse {
  entries: AuditLogEntry[];
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}

const ENTITY_TYPES = [
  "registration", "event", "user", "form", "invite",
  "event_permission", "proposal", "headshot", "auth",
];
const ACTOR_TYPES = ["admin", "system", "user"];

export function AuditLog() {
  const { offset, pageSize, resetPage, resetAll, pagerProps } = usePageState();
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("");
  const [actorType, setActorType] = useState("");
  const [action, setAction] = useState("");

  const { data, loading, error } = useData<AuditLogResponse>(() => {
    const qs = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (search) qs.set("q", search);
    if (entityType) qs.set("entityType", entityType);
    if (actorType) qs.set("actorType", actorType);
    if (action) qs.set("action", action);
    return api<AuditLogResponse>(`/api/v1/admin/audit-log?${qs.toString()}`);
  }, [search, entityType, actorType, action, pageSize, offset]);

  const entries = data?.entries ?? [];
  const total = data?.page.total ?? 0;
  const hasMore = data?.page.hasMore ?? false;

  function applyFilters(updates: Partial<{ search: string; entityType: string; actorType: string; action: string }>) {
    if ("search" in updates) setSearch(updates.search!);
    if ("entityType" in updates) setEntityType(updates.entityType!);
    if ("actorType" in updates) setActorType(updates.actorType!);
    if ("action" in updates) setAction(updates.action!);
    resetPage();
  }

  function resetFilters() {
    setSearch(""); setEntityType(""); setActorType(""); setAction("");
    resetAll();
  }

  return (
    <div>
      <div class="d-flex gap-2 align-items-end flex-wrap mb-3">
        <div>
          <label class="form-label small mb-1">Search</label>
          <input
            type="search"
            class="form-control form-control-sm adm-auditlog-input"
            placeholder="action, entity, details…"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyFilters({ search }); }}
          />
        </div>
        <div>
          <label class="form-label small mb-1">Entity type</label>
          <select
            class="form-select form-select-sm"
            value={entityType}
            onChange={(e) => applyFilters({ entityType: (e.target as HTMLSelectElement).value })}
          >
            <option value="">All</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label class="form-label small mb-1">Actor type</label>
          <select
            class="form-select form-select-sm"
            value={actorType}
            onChange={(e) => applyFilters({ actorType: (e.target as HTMLSelectElement).value })}
          >
            <option value="">All</option>
            {ACTOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label class="form-label small mb-1">Action</label>
          <input
            type="search"
            class="form-control form-control-sm adm-auditlog-input"
            placeholder="e.g. force_status"
            value={action}
            onInput={(e) => setAction((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyFilters({ action }); }}
          />
        </div>
        <button class="btn btn-sm btn-primary" onClick={() => applyFilters({})}>Apply</button>
        <button class="btn btn-sm btn-outline-secondary" onClick={resetFilters}>Reset</button>
      </div>

      {loading && <Spinner />}
      {!loading && <ErrorAlert error={error} />}

      {!loading && !error && (
        <>
          {entries.length === 0 ? (
            <p class="text-muted">No entries match the current filters.</p>
          ) : (
            <div class="table-responsive">
              <table class="table table-sm align-middle mb-2">
                <thead class="table-light">
                  <tr>
                    <th>When</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Entity ID</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const ts = new Date(entry.created_at).toLocaleString("en-GB", {
                      dateStyle: "short",
                      timeStyle: "medium",
                    });
                    return (
                      <tr key={entry.id}>
                        <td class="text-nowrap small text-muted">{ts}</td>
                        <td class="small">
                          {entry.actor_type === "system" ? (
                            <span class="text-muted">System</span>
                          ) : entry.actor_display ? (
                            entry.actor_display
                          ) : entry.actor_id ? (
                            <span class="text-muted small mono">{entry.actor_id}</span>
                          ) : (
                            <span class="text-muted">{entry.actor_type}</span>
                          )}
                          <div class="text-muted small">{entry.actor_type}</div>
                        </td>
                        <td>
                          <code class="small">{entry.action}</code>
                        </td>
                        <td class="small text-muted">
                          <Badge status={entry.entity_type} label={entry.entity_type} />
                        </td>
                        <td class="mono small text-muted">{entry.entity_id ?? "—"}</td>
                        <td>
                          {entry.details && (
                            <pre class="mb-0 small text-body-secondary adm-auditlog-details">
                              {JSON.stringify(entry.details, null, 2)}
                            </pre>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pager {...pagerProps(entries.length, total, hasMore)} />
        </>
      )}
    </div>
  );
}
