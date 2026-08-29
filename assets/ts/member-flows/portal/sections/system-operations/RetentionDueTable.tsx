import { type MutableRef } from "preact/hooks";
import { retentionDueListResponseSchema } from "../../../../../shared/schemas/retention";
import type { PendingWorkRow } from "../../../../../shared/schemas/pending-work";
import type { Column } from "../../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { getJson } from "../../../../shared/api-client";
import type { CollectionLoader } from "../../../../hooks/useServerCollection";
import { fmt } from "../../ui";

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
          <span class="mono text-muted small">{row.context}</span>
        </>
      ),
      sort: { asc: "title", desc: "-title" },
    },
    { header: "Registrations", cell: (row) => row.subtitle ?? "—", className: "small" },
    { header: "Policy", cell: (row) => row.detail ?? "—", className: "small text-muted" },
    {
      header: "Ended",
      cell: (row) => (row.dueAt ? fmt(row.dueAt) : "—"),
      className: "mono small text-nowrap",
      sort: { asc: "dueAt", desc: "-dueAt", defaultDirection: "asc" },
    },
  ];

  return (
    <div class="mt-4">
      <div class="border rounded p-3">
        <p class="small text-muted mb-2">
          Events whose configured retention window has elapsed and whose identifying registration data has not yet been
          redacted.
        </p>
        <ApiDataTable
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
          className="align-middle"
        />
      </div>
    </div>
  );
}
