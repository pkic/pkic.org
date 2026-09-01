import type { ComponentChildren } from "preact";
import { scopedAuditLogResponseSchema, type AuditLogEntry } from "../../shared/schemas/audit-log";
import type { CollectionLoader } from "../hooks/useServerCollection";
import { ApiDataTable } from "./ApiDataTable";
import { EntityLink } from "./EntityLink";

function actorCell(
  entry: AuditLogEntry,
  entityHref?: (entityType: string, entityId: string) => string | null,
): ComponentChildren {
  if (entry.actor_type === "system") return <span class="pk-muted">System</span>;
  const href = entry.actor_id && entityHref ? entityHref(entry.actor_type, entry.actor_id) : null;
  if (entry.actor_display) return <EntityLink href={href}>{entry.actor_display}</EntityLink>;
  if (entry.actor_id)
    return (
      <EntityLink href={href}>
        <span class="pk-muted pk-small">{entry.actor_id}</span>
      </EntityLink>
    );
  return <span class="pk-muted">{entry.actor_type}</span>;
}

export interface AuditLogTableProps {
  endpoint: string;
  actionCell: (entry: AuditLogEntry) => ComponentChildren;
  detailsCell: (entry: AuditLogEntry) => ComponentChildren;
  load?: CollectionLoader;
  /** Resolves an audit entry's actor to a route the viewer can reach; omit to keep actor names as plain text. */
  entityHref?: (entityType: string, entityId: string) => string | null;
  /**
   * Names this table for assistive technology. A surface that shows history
   * beside other tables should say whose history it is — "Registration
   * history", "Proposal history" — so the page does not offer several tables
   * all called the same thing.
   */
  caption?: string;
}

export function AuditLogTable({
  endpoint,
  actionCell,
  detailsCell,
  load,
  entityHref,
  caption = "Audit history",
}: AuditLogTableProps) {
  return (
    <ApiDataTable
      load={load}
      endpoint={endpoint}
      caption={caption}
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
          className: "pk-nowrap pk-small pk-muted",
          sort: { asc: "createdAt", desc: "-createdAt", defaultDirection: "desc" },
        },
        {
          header: "Actor",
          cell: (entry) => actorCell(entry, entityHref),
          className: "pk-small",
          sort: { asc: "actor", desc: "-actor" },
        },
        { header: "Action", cell: actionCell, sort: { asc: "action", desc: "-action" } },
        { header: "Details", cell: detailsCell },
      ]}
      empty="No audit log entries."
      rowKey={(entry) => entry.id}
    />
  );
}
