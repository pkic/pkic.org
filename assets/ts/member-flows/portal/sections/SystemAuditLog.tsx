import { useState } from "preact/hooks";
import { Badge } from "../../../components/Badge";
import { ApiDataTable } from "../../../components/ApiDataTable";
import { DetailsSummary } from "../../../components/DetailsSummary";
import { auditLogListResponseSchema } from "../../../../shared/schemas/audit-log";

interface AuditFilters {
  entityType: string;
  actorType: string;
  action: string;
}

const EMPTY_FILTERS: AuditFilters = { entityType: "", actorType: "", action: "" };

function AuditFilterInput({
  name,
  label,
  placeholder,
}: {
  name: keyof AuditFilters;
  label: string;
  placeholder: string;
}) {
  return (
    <div>
      <label class="form-label small mb-1" for={`system-audit-${name}`}>
        {label}
      </label>
      <input
        id={`system-audit-${name}`}
        name={name}
        type="search"
        class="form-control form-control-sm"
        placeholder={placeholder}
      />
    </div>
  );
}

export function SystemAuditLog() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  return (
    <ApiDataTable
      endpoint="/api/v1/audit-log"
      responseSchema={auditLogListResponseSchema}
      resolve={(data) => data.entries}
      resolvePage={(data) => data.page}
      paginate
      searchPlaceholder="action, entity, details…"
      params={{
        ...(filters.entityType && { entityType: filters.entityType }),
        ...(filters.actorType && { actorType: filters.actorType }),
        ...(filters.action && { action: filters.action }),
      }}
      toolbar={({ resetPage }) => (
        <form
          class="d-flex gap-2 align-items-end flex-wrap"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setFilters({
              entityType: String(data.get("entityType") ?? "").trim(),
              actorType: String(data.get("actorType") ?? "").trim(),
              action: String(data.get("action") ?? "").trim(),
            });
            resetPage();
          }}
        >
          <AuditFilterInput name="entityType" label="Entity type" placeholder="e.g. event" />
          <AuditFilterInput name="actorType" label="Actor type" placeholder="e.g. user" />
          <AuditFilterInput name="action" label="Action" placeholder="e.g. event_updated" />
          <button type="submit" class="btn btn-sm btn-outline-secondary">
            Apply filters
          </button>
          <button
            type="reset"
            class="btn btn-sm btn-link"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              resetPage();
            }}
          >
            Clear
          </button>
        </form>
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
          cell: (entry) => <DetailsSummary value={entry.details} />,
        },
      ]}
      empty="No entries match the current filters."
      className="align-middle"
      rowKey={(entry) => entry.id}
    />
  );
}
