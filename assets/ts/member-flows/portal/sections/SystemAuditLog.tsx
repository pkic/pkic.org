import { Badge } from "../../../components/Badge";
import { ApiDataTable } from "../../../components/ApiDataTable";
import { formatDateTime } from "../../../shared/ui";
import { DetailsSummary } from "../../../components/DetailsSummary";
import { EntityLink } from "../../../components/EntityLink";
import { USER_BACKED_AUDIT_ACTOR_TYPES, auditLogListResponseSchema } from "../../../../shared/schemas/audit-log";
import { PageHeader } from "../../../ui/PageHeader";
import { portalEntityHref } from "../entity-links";
import "../../../ui/Content.css";
import { useColumnFilterOptions } from "../../../hooks/useColumnFilterOptions";

/**
 * Who can act: the user-backed kinds the contract names, and the system
 * itself. A closed vocabulary, so the column offers it as choices; the entity
 * type and action choices come from bounded, paged audit-log queries.
 */
const ACTOR_TYPE_OPTIONS = [
  { value: "", label: "All actors" },
  ...USER_BACKED_AUDIT_ACTOR_TYPES.map((actorType) => ({ value: actorType, label: actorLabel(actorType) })),
  { value: "system", label: "System" },
];

function actorLabel(actorType: string): string {
  return actorType.charAt(0).toUpperCase() + actorType.slice(1);
}

export function SystemAuditLog() {
  const actionFilter = useColumnFilterOptions("/api/v1/audit-log/filters", "action", "All actions");
  const entityFilter = useColumnFilterOptions("/api/v1/audit-log/filters", "entityType", "All entity types");
  return (
    // Its own page under Settings, so it heads itself; the tab strip that
    // used to name it has gone with the hub it belonged to.
    <div class="pk pk-stack">
      <PageHeader title="Audit log" />
      <ApiDataTable
        caption="System audit log"
        urlState="audit"
        endpoint="/api/v1/audit-log"
        responseSchema={auditLogListResponseSchema}
        resolve={(data) => data.entries}
        resolvePage={(data) => data.page}
        paginate
        searchPlaceholder="action, entity, details…"
        columns={[
          {
            // A timestamp has a bounded length; the column says so instead of
            // wearing `pk-nowrap` while still claiming a share of a wide
            // screen, and keeps the table's own ink and size.
            header: "When",
            cell: (entry) => formatDateTime(entry.created_at, { seconds: true }),
            width: "fit",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
          {
            header: "Actor",
            cell: (entry) => (
              <>
                {entry.actor_type === "system" ? (
                  <span class="pk-muted">System</span>
                ) : (
                  <EntityLink href={entry.actor_id ? portalEntityHref(entry.actor_type, entry.actor_id) : null}>
                    {entry.actor_display ? (
                      entry.actor_display
                    ) : entry.actor_id ? (
                      <span class="pk-small pk-mono">{entry.actor_id}</span>
                    ) : (
                      <span class="pk-muted">{entry.actor_type}</span>
                    )}
                  </EntityLink>
                )}
                <div class="pk-small">{entry.actor_type}</div>
              </>
            ),
            className: "pk-small",
            sort: { asc: "actor", desc: "-actor" },
            // The filters are the columns' own, as on every other list: the
            // page used to grow three loose inputs and an Apply/Clear pair in
            // the toolbar, a second filter vocabulary beside the one the
            // table already has.
            filter: { param: "actorType", options: ACTOR_TYPE_OPTIONS },
          },
          {
            header: "Action",
            cell: (entry) => <code class="pk-small">{entry.action}</code>,
            width: "fit",
            sort: { asc: "action", desc: "-action" },
            filter: actionFilter,
          },
          {
            header: "Entity",
            cell: (entry) => <Badge status={entry.entity_type} label={entry.entity_type} />,
            width: "fit",
            sort: { asc: "entity_type", desc: "-entity_type" },
            filter: entityFilter,
          },
          {
            header: "Entity ID",
            cell: (entry) =>
              entry.entity_id ? (
                <EntityLink href={portalEntityHref(entry.entity_type, entry.entity_id)}>
                  {/* The first block identifies the record to someone comparing
                    rows; the whole identifier stays a hover and a click away.
                    Rendered in full, a UUID column swallowed the width the
                    details column needed and wrapped down four lines. */}
                  <span title={entry.entity_id}>{entry.entity_id.slice(0, 8)}…</span>
                </EntityLink>
              ) : (
                "—"
              ),
            className: "pk-mono pk-small pk-muted",
            width: "fit",
          },
          {
            // The one prose column: the first labelled column is a fit-width
            // timestamp here, so the slack is claimed explicitly rather than
            // left to the default, which hands it to the first column.
            header: "Details",
            cell: (entry) => <DetailsSummary value={entry.details} layout="inline" />,
            width: "primary",
          },
        ]}
        empty="No entries match the current filters."
        rowKey={(entry) => entry.id}
      />
    </div>
  );
}
