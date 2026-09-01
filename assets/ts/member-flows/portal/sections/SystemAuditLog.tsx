import { useState } from "preact/hooks";
import { Badge } from "../../../components/Badge";
import { ApiDataTable } from "../../../components/ApiDataTable";
import { DetailsSummary } from "../../../components/DetailsSummary";
import { EntityLink } from "../../../components/EntityLink";
import { auditLogListResponseSchema } from "../../../../shared/schemas/audit-log";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
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
    // `Field` owns the label/control `for`+`id` pair, so the filter can no
    // longer end up with a label pointing at an id that is not there.
    <Field label={label}>
      {(control) => <TextInput {...control} name={name} type="search" placeholder={placeholder} />}
    </Field>
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
          class="pk-stack pk-stack--snug"
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
          {/* A grid rather than a flex row: three filters and two buttons wrap
              into a readable shape on a phone without a breakpoint class each,
              and the buttons keep their own line instead of floating against
              the middle of a taller field. */}
          <div class="pk-grid pk-grid--tight">
            <AuditFilterInput name="entityType" label="Entity type" placeholder="e.g. event" />
            <AuditFilterInput name="actorType" label="Actor type" placeholder="e.g. user" />
            <AuditFilterInput name="action" label="Action" placeholder="e.g. event_updated" />
          </div>
          <div class="pk-cluster">
            <Button type="submit" variant="primary" size="sm">
              Apply filters
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
          </div>
        </form>
      )}
      columns={[
        {
          // A timestamp has a bounded length; the column says so instead of
          // wearing `pk-nowrap` while still claiming a share of a wide
          // screen, and keeps the table's own ink and size.
          header: "When",
          cell: (entry) =>
            new Date(entry.created_at).toLocaleString("en-US", { dateStyle: "short", timeStyle: "medium" }),
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
              <EntityLink href={portalEntityHref(entry.entity_type, entry.entity_id)}>{entry.entity_id}</EntityLink>
            ) : (
              "—"
            ),
          className: "pk-mono pk-small pk-muted",
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
