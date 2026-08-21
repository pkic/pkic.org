import { useEffect, useState } from "preact/hooks";
import { adminDueWorkListResponseSchema } from "../../../../shared/schemas/admin-due-work";
import type { AdminDueWorkListResponse, AdminDueWorkTab } from "../../../../shared/schemas/admin-due-work";
import { Badge } from "../../../components/Badge";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Pager } from "../../../components/Pager";
import { Spinner } from "../../../components/Spinner";
import { DataTable } from "../../../components/Table";
import { useOffsetPager } from "../../../hooks/useOffsetPager";
import { api } from "../../api";
import { fmt } from "../../ui";

const BUCKET_COLORS: Record<string, string> = { outbox: "primary", reminders: "info", cleanup: "warning" };
const TABS: Array<{ key: AdminDueWorkTab; label: string }> = [
  { key: "all", label: "All" },
  { key: "outbox", label: "Outbox" },
  { key: "reminders", label: "Reminders" },
  { key: "cleanup", label: "Cleanup" },
];

export function DueWorkTable({
  reminderLimit,
  outboxLimit,
  includeRetention,
  refreshKey,
}: {
  reminderLimit: number;
  outboxLimit: number;
  includeRetention: boolean;
  refreshKey: number;
}) {
  const [tab, setTab] = useState<AdminDueWorkTab>("all");
  const pager = useOffsetPager(25);
  const { offset, pageSize } = pager;
  const [result, setResult] = useState<AdminDueWorkListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pager.resetPage();
  }, [tab, reminderLimit, outboxLimit, includeRetention, pager.resetPage]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({
      bucket: tab,
      reminderLimit: String(reminderLimit),
      outboxLimit: String(outboxLimit),
      includeRetention: String(includeRetention),
      limit: String(pageSize),
      offset: String(offset),
      sort: "dueAt",
    });
    void api<unknown>(`/api/v1/admin/due-work?${query}`)
      .then((raw) => adminDueWorkListResponseSchema.parse(raw))
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch((reason) => {
        if (!cancelled) setError((reason as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, offset, pageSize, reminderLimit, outboxLimit, includeRetention, refreshKey]);

  const pagedRows = result?.items ?? [];
  const counts = result?.counts ?? { all: 0, outbox: 0, reminders: 0, cleanup: 0 };
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

  function handleTabChange(key: AdminDueWorkTab) {
    setTab(key);
  }

  return (
    <div class="mt-4">
      <div class="d-flex flex-wrap gap-2 mb-3">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            class={`btn btn-sm ${key === tab ? "btn-primary" : "btn-outline-secondary"}`}
            onClick={() => handleTabChange(key)}
          >
            {label}{" "}
            <span class={`badge ${key === tab ? "text-bg-light text-dark" : "text-bg-secondary"}`}>{counts[key]}</span>
          </button>
        ))}
      </div>
      <div class="border rounded p-3">
        {error && <ErrorAlert error={error} />}
        {loading && !result ? <Spinner /> : null}
        <DataTable
          columns={[
            {
              header: "Type",
              cell: (row) => (
                <span class={`badge text-bg-${BUCKET_COLORS[row.bucket] ?? "secondary"}`}>{row.typeLabel}</span>
              ),
            },
            {
              header: "Target",
              cell: (row) => (
                <>
                  <div class="fw-semibold">{row.title}</div>
                  {row.subtitle && <div class="mono small text-muted">{row.subtitle}</div>}
                </>
              ),
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
            { header: "Due", cell: (row) => fmt(row.dueAt), className: "small" },
            {
              header: "Status",
              cell: (row) =>
                row.bucket === "outbox" ? (
                  <Badge status={row.statusKey} />
                ) : (
                  <span class="badge text-bg-light border text-dark">{row.statusLabel}</span>
                ),
            },
          ]}
          data={pagedRows}
          empty={emptyMsg}
          className="align-middle"
        />
        <Pager
          {...pager.pagerProps({
            hasMore: result?.page.hasMore ?? false,
            rowCount: pagedRows.length,
            total: result?.page.total ?? 0,
            serverOffset: result?.page.offset,
          })}
        />
      </div>
    </div>
  );
}
