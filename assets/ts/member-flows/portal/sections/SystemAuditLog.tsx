import { useState } from "preact/hooks";
import { Badge } from "../../../components/Badge";
import { ApiDataTable } from "../../../components/ApiDataTable";
import { formatDateTime } from "../../../shared/ui";
import { DetailsSummary } from "../../../components/DetailsSummary";
import { EntityLink } from "../../../components/EntityLink";
import { auditLogListResponseSchema } from "../../../../shared/schemas/audit-log";
import { Button } from "../../../ui/Button";
import { TextInput } from "../../../ui/TextControl";
import { portalEntityHref } from "../entity-links";
import "../../../ui/Content.css";

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
    // The filters share the toolbar's one row, so — like every FilterSelect
    // beside them across the portal — each keeps its name in `aria-label`
    // rather than growing a stacked visible label of its own.
    <TextInput name={name} type="search" aria-label={label} placeholder={placeholder} class="portal-audit-filter" />
  );
}

export function SystemAuditLog() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  return (
    <ApiDataTable
      caption="System audit log"
      urlState="audit"
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
          class="pk-cluster"
          aria-label="Audit log filters"
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
          <AuditFilterInput name="entityType" label="Entity type" placeholder="Entity type" />
          <AuditFilterInput name="actorType" label="Actor type" placeholder="Actor type" />
          <AuditFilterInput name="action" label="Action" placeholder="Action" />
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          <Button
            type="reset"
            variant="link"
            size="sm"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              resetPage();
            }}
          >
            Clear
          </Button>
        </form>
      )}
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
        },
        {
          header: "Action",
          cell: (entry) => <code class="pk-small">{entry.action}</code>,
          width: "fit",
          sort: { asc: "action", desc: "-action" },
        },
        {
          header: "Entity",
          cell: (entry) => <Badge status={entry.entity_type} label={entry.entity_type} />,
          width: "fit",
          sort: { asc: "entity_type", desc: "-entity_type" },
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
          cell: (entry) => <DetailsSummary value={entry.details} />,
          width: "primary",
        },
      ]}
      empty="No entries match the current filters."
      rowKey={(entry) => entry.id}
    />
  );
}
