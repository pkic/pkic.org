import type { ComponentChildren } from "preact";
import { scopedAuditLogResponseSchema, type AuditLogEntry } from "../../shared/schemas/audit-log";
import type { CollectionLoader } from "../hooks/useServerCollection";
import { ApiDataTable } from "./ApiDataTable";
import { formatDateTime } from "../shared/ui";
import { EntityLink } from "./EntityLink";
import { actingIdentityLabel } from "../shared/acting-identity-catalog";

/** The actor's name and, when known, the identity they acted as: "Paul van Brouwershaven · PKI Consortium". */
export function auditActorName(
  entry: Pick<AuditLogEntry, "actor_display" | "actor_identity_id" | "actor_organization_name">,
): string | null {
  if (!entry.actor_display) return null;
  if (!entry.actor_identity_id) return entry.actor_display;
  return `${entry.actor_display} · ${actingIdentityLabel({ organizationName: entry.actor_organization_name, jobTitle: null })}`;
}

/** One rendering of an audit entry's actor for every audit list. */
export function AuditActor({ entry, href }: { entry: AuditLogEntry; href: string | null }): ComponentChildren {
  if (entry.actor_type === "system") return <span class="pk-muted">System</span>;
  const name = auditActorName(entry);
  if (name) return <EntityLink href={href}>{name}</EntityLink>;
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
          width: "fit",
          cell: (entry) => formatDateTime(entry.created_at, { seconds: true }),
          className: "pk-nowrap pk-small pk-muted",
          sort: { asc: "createdAt", desc: "-createdAt", defaultDirection: "desc" },
        },
        {
          header: "Actor",
          cell: (entry) => (
            <AuditActor
              entry={entry}
              href={entry.actor_id && entityHref ? entityHref(entry.actor_type, entry.actor_id) : null}
            />
          ),
          className: "pk-small",
          sort: { asc: "actor", desc: "-actor" },
        },
        { header: "Action", cell: actionCell, width: "fit", sort: { asc: "action", desc: "-action" } },
        { header: "Details", cell: detailsCell, width: "primary" },
      ]}
      empty="No audit log entries."
      rowKey={(entry) => entry.id}
    />
  );
}
