import { type MutableRef } from "preact/hooks";
import { retentionDueListResponseSchema } from "../../../../../shared/schemas/retention";
import type { PendingWorkRow } from "../../../../../shared/schemas/pending-work";
import type { Column } from "../../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { getJson } from "../../../../shared/api-client";
import type { CollectionLoader } from "../../../../hooks/useServerCollection";
import { Panel, PanelBody } from "../../../../ui/Panel";
import { fmt } from "../../ui";
// `pk-mono` on the context line comes from Content.css, which ships in a lazy
// chunk rather than the entry stylesheet, so the module that writes the class
// name has to pull the stylesheet in itself.
import "../../../../ui/Content.css";

const loadPortalCollection: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });

/**
 * Retention's own pending list. Unlike the retired cross-domain projection,
 * this is a single indexed query in one domain, so its count is exact rather
 * than a bounded preview window.
 */
export function RetentionDueTable({ actionsRef }: { actionsRef?: MutableRef<ApiTableActions | null> }) {
  const columns: Column<PendingWorkRow>[] = [
    {
      header: "Event",
      cell: (row) => (
        <>
          <strong>{row.title}</strong>
          <br />
          <span class="pk-mono pk-small">{row.context}</span>
        </>
      ),
      sort: { asc: "title", desc: "-title" },
    },
    { header: "Registrations", cell: (row) => row.subtitle ?? "—", className: "pk-small" },
    { header: "Policy", cell: (row) => row.detail ?? "—", className: "pk-small pk-muted" },
    {
      // A date has a bounded length; the column says so instead of wearing
      // `pk-nowrap` while still claiming slack, and keeps the table's ink.
      header: "Ended",
      cell: (row) => (row.dueAt ? fmt(row.dueAt) : "—"),
      width: "fit",
      sort: { asc: "dueAt", desc: "-dueAt", defaultDirection: "asc" },
    },
  ];

  return (
    // The rule and padding the Bootstrap version drew by hand are the panel's
    // own edge, and the gap between the note and the table is the stack's.
    <Panel>
      <PanelBody class="pk-stack pk-stack--snug">
        <p class="pk-small">
          Events whose configured retention window has elapsed and whose identifying registration data has not yet been
          redacted.
        </p>
        <ApiDataTable
          caption="Events due for retention redaction"
          showCaption
          endpoint="/api/v1/retention/due"
          responseSchema={retentionDueListResponseSchema}
          resolve={(data) => data.items}
          resolvePage={(data) => data.page}
          paginate
          initialPageSize={25}
          initialSort="dueAt"
          searchPlaceholder="Search event name or slug…"
          actionsRef={actionsRef}
          load={loadPortalCollection}
          columns={columns}
          empty="Nothing is due for retention redaction."
        />
      </PanelBody>
    </Panel>
  );
}
