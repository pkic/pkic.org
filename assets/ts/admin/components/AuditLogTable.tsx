import type { ComponentChildren } from "preact";
import { DataTable } from "../../components/Table";
import { Spinner } from "../../components/Spinner";

export interface AuditLogTableEntry {
  id?: string;
  created_at: string;
  actor_type: string;
  actor_display?: string | null;
  actor_id?: string | null;
  action: string;
  details?: Record<string, unknown> | null;
}

function actorCell(entry: AuditLogTableEntry): ComponentChildren {
  if (entry.actor_type === "system") return <span class="text-muted">System</span>;
  if (entry.actor_display) return entry.actor_display;
  if (entry.actor_id) return <span class="text-muted small">{entry.actor_id}</span>;
  return <span class="text-muted">{entry.actor_type}</span>;
}

export function AuditLogTable<Entry extends AuditLogTableEntry>({
  entries,
  loading = false,
  actionCell,
  detailsCell,
}: {
  entries?: Entry[];
  loading?: boolean;
  actionCell: (entry: Entry) => ComponentChildren;
  detailsCell: (entry: Entry) => ComponentChildren;
}) {
  if (loading) return <Spinner />;
  if (!entries?.length) return <p class="small text-body-secondary mb-0">No audit log entries.</p>;

  return (
    <DataTable
      columns={[
        {
          header: "When",
          cell: (entry) =>
            new Date(entry.created_at).toLocaleString("en-US", { dateStyle: "short", timeStyle: "medium" }),
          className: "text-nowrap small text-muted",
        },
        { header: "Actor", cell: actorCell, className: "small" },
        { header: "Action", cell: actionCell },
        { header: "Details", cell: detailsCell },
      ]}
      data={entries}
      className="align-middle"
      rowKey={(entry, index) => entry.id ?? `${entry.created_at}:${entry.action}:${index}`}
    />
  );
}
