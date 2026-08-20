import { useState } from "preact/hooks";
import { Badge } from "../../components/Badge";
import { ApiDataTable } from "../../components/Table";
import { auditLogListResponseSchema, type AuditLogEntry } from "../../../shared/schemas/admin-audit-log";

const ENTITY_TYPES = [
  "registration",
  "event",
  "user",
  "form",
  "invite",
  "event_permission",
  "proposal",
  "headshot",
  "auth",
];
const ACTOR_TYPES = ["admin", "system", "user"];

export function AuditLog() {
  const [entityType, setEntityType] = useState("");
  const [actorType, setActorType] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  return (
    <ApiDataTable<AuditLogEntry>
      endpoint="/api/v1/admin/audit-log"
      resolve={(data) => auditLogListResponseSchema.parse(data).entries}
      resolvePage={(data) => auditLogListResponseSchema.parse(data).page}
      paginate
      searchPlaceholder="action, entity, details…"
      params={{
        ...(entityType && { entityType }),
        ...(actorType && { actorType }),
        ...(actionFilter && { action: actionFilter }),
      }}
      deps={[entityType, actorType, actionFilter]}
      toolbar={({ resetPage }) => (
        <>
          <div>
            <label class="form-label small mb-1">Entity type</label>
            <select
              class="form-select form-select-sm"
              value={entityType}
              onChange={(e) => {
                setEntityType((e.target as HTMLSelectElement).value);
                resetPage();
              }}
            >
              <option value="">All</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label class="form-label small mb-1">Actor type</label>
            <select
              class="form-select form-select-sm"
              value={actorType}
              onChange={(e) => {
                setActorType((e.target as HTMLSelectElement).value);
                resetPage();
              }}
            >
              <option value="">All</option>
              {ACTOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label class="form-label small mb-1">Action</label>
            <input
              type="search"
              class="form-control form-control-sm adm-auditlog-input"
              placeholder="e.g. force_status"
              value={actionFilter}
              onInput={(e) => setActionFilter((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") resetPage();
              }}
            />
          </div>
        </>
      )}
      columns={[
        {
          header: "When",
          cell: (entry) =>
            new Date(entry.created_at).toLocaleString("en-US", { dateStyle: "short", timeStyle: "medium" }),
          className: "text-nowrap small text-muted",
          sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
        },
        {
          header: "Actor",
          cell: (entry) => (
            <>
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
            </>
          ),
          className: "small",
          sort: { asc: "actor", desc: "-actor" },
        },
        {
          header: "Action",
          cell: (entry) => <code class="small">{entry.action}</code>,
          sort: { asc: "action", desc: "-action" },
        },
        {
          header: "Entity",
          cell: (entry) => <Badge status={entry.entity_type} label={entry.entity_type} />,
          className: "small text-muted",
          sort: { asc: "entity_type", desc: "-entity_type" },
        },
        { header: "Entity ID", cell: (entry) => entry.entity_id ?? "—", className: "mono small text-muted" },
        {
          header: "Details",
          cell: (entry) =>
            entry.details ? (
              <pre class="mb-0 small text-body-secondary adm-auditlog-details">
                {JSON.stringify(entry.details, null, 2)}
              </pre>
            ) : null,
        },
      ]}
      empty="No entries match the current filters."
      className="align-middle"
      rowKey={(entry) => entry.id}
    />
  );
}
