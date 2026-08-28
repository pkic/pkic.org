import { useState, type MutableRef } from "preact/hooks";
import { dueWorkListResponseSchema } from "../../../../../shared/schemas/operations";
import type { DueWorkRow, DueWorkTab } from "../../../../../shared/schemas/operations";
import { Badge } from "../../../../components/Badge";
import type { Column } from "../../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { getJson } from "../../../../shared/api-client";
import type { CollectionLoader } from "../../../../hooks/useServerCollection";
import { fmt } from "../../ui";

const loadPortalCollection: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });

const BUCKET_COLORS: Record<string, string> = { outbox: "primary", reminders: "info", cleanup: "warning" };
const TABS: Array<{ key: DueWorkTab; label: string }> = [
  { key: "all", label: "All" },
  { key: "outbox", label: "Outbox" },
  { key: "reminders", label: "Reminders" },
  { key: "cleanup", label: "Cleanup" },
];

export function DueWorkTable({
  reminderLimit,
  outboxLimit,
  includeRetention,
  actionsRef,
}: {
  reminderLimit: number;
  outboxLimit: number;
  includeRetention: boolean;
  actionsRef?: MutableRef<ApiTableActions | null>;
}) {
  const [tab, setTab] = useState<DueWorkTab>("all");
  const [counts, setCounts] = useState({ all: 0, outbox: 0, reminders: 0, cleanup: 0 });
  const emptyMsg =
    tab === "cleanup"
      ? includeRetention
        ? "No cleanup candidates right now."
        : "Enable cleanup to preview retention candidates."
      : tab === "reminders"
        ? "No reminder candidates due right now."
        : tab === "outbox"
          ? "No due outbox rows right now."
          : "No due work items right now.";

  const columns: Column<DueWorkRow>[] = [
    {
      header: "Type",
      cell: (row) => <span class={`badge text-bg-${BUCKET_COLORS[row.bucket] ?? "secondary"}`}>{row.typeLabel}</span>,
      sort: { asc: "typeLabel", desc: "-typeLabel" },
    },
    {
      header: "Target",
      cell: (row) => (
        <>
          <div class="fw-semibold">{row.title}</div>
          {row.subtitle && <div class="mono small text-muted">{row.subtitle}</div>}
        </>
      ),
      sort: { asc: "title", desc: "-title" },
    },
    {
      header: "Context",
      cell: (row) => (
        <>
          <div class="small">{row.context}</div>
          {row.detail && <div class="small text-muted mt-1">{row.detail}</div>}
        </>
      ),
    },
    {
      header: "Due",
      cell: (row) => fmt(row.dueAt),
      className: "small",
      sort: { asc: "dueAt", desc: "-dueAt", defaultDirection: "asc" },
    },
    {
      header: "Status",
      cell: (row) =>
        row.bucket === "outbox" ? (
          <Badge status={row.statusKey} />
        ) : (
          <span class="badge text-bg-light border text-dark">{row.statusLabel}</span>
        ),
    },
  ];

  return (
    <div class="mt-4">
      <div class="border rounded p-3">
        <p class="small text-muted mb-2">
          Counts and search results describe the bounded preview batch, not every historical queue row.
        </p>
        <ApiDataTable
          endpoint="/api/v1/operations/due-work"
          responseSchema={dueWorkListResponseSchema}
          resolve={(data) => data.items}
          resolvePage={(data) => data.page}
          onData={(data) => setCounts(data.counts)}
          params={{
            bucket: tab,
            reminderLimit: String(reminderLimit),
            outboxLimit: String(outboxLimit),
            includeRetention: String(includeRetention),
          }}
          paginate
          initialPageSize={25}
          initialSort="dueAt"
          searchPlaceholder="Search this preview batch…"
          actionsRef={actionsRef}
          load={loadPortalCollection}
          toolbar={({ resetPage }) => (
            <div class="d-flex flex-wrap gap-2">
              {TABS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  class={`btn btn-sm ${key === tab ? "btn-primary" : "btn-outline-secondary"}`}
                  onClick={() => {
                    setTab(key);
                    resetPage();
                  }}
                >
                  {label}{" "}
                  <span class={`badge ${key === tab ? "text-bg-light text-dark" : "text-bg-secondary"}`}>
                    {counts[key]}
                  </span>
                </button>
              ))}
            </div>
          )}
          columns={columns}
          empty={emptyMsg}
          className="align-middle"
        />
      </div>
    </div>
  );
}
