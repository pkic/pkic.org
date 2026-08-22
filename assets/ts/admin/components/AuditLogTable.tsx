import type { ComponentChildren } from "preact";
import {
  scopedAuditLogResponseSchema,
  type AuditLogEntry,
  type ScopedAuditLogResponse,
} from "../../../shared/schemas/audit-log";
import { ApiDataTable } from "./ApiDataTable";

function actorCell(entry: AuditLogEntry): ComponentChildren {
  if (entry.actor_type === "system") return <span class="text-muted">System</span>;
  if (entry.actor_display) return entry.actor_display;
  if (entry.actor_id) return <span class="text-muted small">{entry.actor_id}</span>;
  return <span class="text-muted">{entry.actor_type}</span>;
}

export function AuditLogTable({
  endpoint,
  actionCell,
  detailsCell,
}: {
  endpoint: string;
  actionCell: (entry: AuditLogEntry) => ComponentChildren;
  detailsCell: (entry: AuditLogEntry) => ComponentChildren;
}) {
  return (
    <ApiDataTable<AuditLogEntry, ScopedAuditLogResponse>
      endpoint={endpoint}
      responseSchema={scopedAuditLogResponseSchema}
      resolve={(response) => response.auditLog}
      resolvePage={(response) => response.page}
      paginate
      searchPlaceholder="Search audit history…"
      initialSort="-createdAt"
      columns={[
        {
          header: "When",
          cell: (entry) =>
            new Date(entry.created_at).toLocaleString("en-US", { dateStyle: "short", timeStyle: "medium" }),
          className: "text-nowrap small text-muted",
          sort: { asc: "createdAt", desc: "-createdAt", defaultDirection: "desc" },
        },
        { header: "Actor", cell: actorCell, className: "small", sort: { asc: "actor", desc: "-actor" } },
        { header: "Action", cell: actionCell, sort: { asc: "action", desc: "-action" } },
        { header: "Details", cell: detailsCell },
      ]}
      className="align-middle"
      empty="No audit log entries."
      rowKey={(entry) => entry.id}
    />
  );
}
