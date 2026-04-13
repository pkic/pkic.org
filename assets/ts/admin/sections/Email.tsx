import { useState, useEffect, useCallback } from "preact/hooks";
import { Badge } from "../../components/Badge";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { Pager, ADMIN_LIST_PAGE_SIZE_DEFAULT } from "../../components/Pager";
import { Table } from "../../components/Table";
import { api } from "../api";
import { fmt, toast } from "../ui";
import type { AdminEmailOutboxRow, AdminEmailOutboxResponse } from "../types";
import type { StatsResponse } from "../types";

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

interface OutboxFilters {
  status: string;
  messageType: string;
  q: string;
  offset: number;
  pageSize: number;
}

const STATUS_DESC_ORDER = ["failed", "retrying", "queued", "sending", "sent", "transactional", "promotional"];

function sortedBadgeEntries(items: Record<string, number>): Array<[string, number]> {
  return Object.entries(items).sort(([a], [b]) => {
    const ai = STATUS_DESC_ORDER.indexOf(a) === -1 ? STATUS_DESC_ORDER.length : STATUS_DESC_ORDER.indexOf(a);
    const bi = STATUS_DESC_ORDER.indexOf(b) === -1 ? STATUS_DESC_ORDER.length : STATUS_DESC_ORDER.indexOf(b);
    return ai - bi || a.localeCompare(b);
  });
}

function isOutboxDueNow(row: AdminEmailOutboxRow): boolean {
  if (row.status !== "queued" && row.status !== "retrying") return false;
  return new Date(row.sendAfter).getTime() <= Date.now();
}

// ────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────

function SummaryBadges({ items }: { items: Record<string, number> }) {
  const entries = sortedBadgeEntries(items);
  if (!entries.length) {
    return <span class="text-muted small">No matching rows</span>;
  }
  return (
    <span class="d-flex flex-wrap gap-2 align-items-center">
      {entries.map(([key, value]) => (
        <span key={key} class="d-inline-flex align-items-center gap-1">
          <Badge status={key} />
          <span class="small text-muted">{value}</span>
        </span>
      ))}
    </span>
  );
}

function OutboxRow({
  row,
  selected,
  onToggle,
}: {
  row: AdminEmailOutboxRow;
  selected: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const showFailureDetails = Boolean(row.lastError) && row.status !== "sent";
  const eventPart = [row.eventName, row.eventSlug ? `/${row.eventSlug}` : null].filter(Boolean).join(" | ");

  return (
    <tr>
      <td>
        <input
          class="form-check-input"
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggle(row.id, (e.target as HTMLInputElement).checked)}
        />
      </td>
      <td>
        <div class="fw-semibold">{row.recipientName || row.recipientEmail}</div>
        <div class="mono small text-muted">{row.recipientEmail}</div>
        {eventPart && <div class="small text-muted mt-1">{eventPart}</div>}
      </td>
      <td>
        <div class="fw-semibold">{row.subject || "PKI Consortium Update"}</div>
        <div class="d-flex flex-wrap gap-1 mt-1">
          <span class="small text-muted">{row.templateKey}{row.templateVersion !== null ? ` v${row.templateVersion}` : ""}</span>
          <Badge status={row.messageType} />
          {row.usesDirectBody && <span class="badge text-bg-light border text-dark">Direct body</span>}
          {row.hasCustomText && <span class="badge text-bg-light border text-dark">Custom text</span>}
          {row.bccRecipientCount > 0 && <span class="badge text-bg-light border text-dark">BCC {row.bccRecipientCount}</span>}
          {row.hasCalendarInvite && <span class="badge text-bg-light border text-dark">Calendar</span>}
          {row.hasBadgeAttachment && <span class="badge text-bg-light border text-dark">Badge</span>}
        </div>
      </td>
      <td>
        <div class="d-flex flex-wrap gap-1 align-items-center">
          <Badge status={row.status} />
          <span class="small text-muted">Attempts {row.attempts}</span>
          <span class="small text-muted">{row.provider}</span>
        </div>
        <div class="small text-muted mt-2">Updated {fmt(row.updatedAt)}</div>
      </td>
      <td>
        <div><span class="small text-muted">Queued</span><div class="mono small">{fmt(row.createdAt)}</div></div>
        <div><span class="small text-muted">Due</span><div class="mono small">{fmt(row.sendAfter)}</div></div>
        <div><span class="small text-muted">Sent</span><div class="mono small">{fmt(row.sentAt)}</div></div>
      </td>
      <td>
        <div class="small text-muted">Outbox</div>
        <div class="mono small">{row.id}</div>
        {row.providerMessageId && (
          <>
            <div class="small text-muted mt-2">Provider Message</div>
            <div class="mono small">{row.providerMessageId}</div>
          </>
        )}
        {showFailureDetails ? (
          <details class="mt-2">
            <summary class="small text-danger">Failure details</summary>
            <div class="small text-danger mt-2">{row.lastError}</div>
          </details>
        ) : (
          <div class="small text-muted mt-2">No delivery error recorded.</div>
        )}
      </td>
    </tr>
  );
}

// ────────────────────────────────────────────────────────
// Main section
// ────────────────────────────────────────────────────────

export function Email() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [outboxStats, setOutboxStats] = useState<Record<string, number>>({});
  const [outboxData, setOutboxData] = useState<AdminEmailOutboxResponse | null>(null);

  const [filters, setFilters] = useState<OutboxFilters>({
    status: "",
    messageType: "",
    q: "",
    offset: 0,
    pageSize: ADMIN_LIST_PAGE_SIZE_DEFAULT,
  });

  // Pending filter values (controlled inputs before Apply is clicked)
  const [pendingStatus, setPendingStatus] = useState("");
  const [pendingType, setPendingType] = useState("");
  const [pendingQ, setPendingQ] = useState("");

  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [retryLimit, setRetryLimit] = useState(20);
  const [processAllStatus, setProcessAllStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        limit: String(filters.pageSize),
        offset: String(filters.offset),
      });
      if (filters.status) qs.set("status", filters.status);
      if (filters.messageType) qs.set("messageType", filters.messageType);
      if (filters.q) qs.set("q", filters.q);

      const [s, data] = await Promise.all([
        api<StatsResponse>("/api/v1/admin/stats"),
        api<AdminEmailOutboxResponse>(`/api/v1/admin/email/outbox?${qs.toString()}`),
      ]);
      setOutboxStats(s.email.outboxByStatus);
      setOutboxData(data);
      setSelectedIds(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  function applyFilters() {
    setFilters((f) => ({ ...f, status: pendingStatus, messageType: pendingType, q: pendingQ, offset: 0 }));
  }

  function clearFilters() {
    setPendingStatus("");
    setPendingType("");
    setPendingQ("");
    setFilters({ status: "", messageType: "", q: "", offset: 0, pageSize: ADMIN_LIST_PAGE_SIZE_DEFAULT });
  }

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    if (!outboxData) return;
    setSelectedIds(checked ? new Set(outboxData.outbox.map((r) => r.id)) : new Set());
  }

  const visibleSelected = outboxData?.outbox.filter((r) => selectedIds.has(r.id)) ?? [];
  const processableSelected = visibleSelected.filter(isOutboxDueNow);
  const failedSelected = visibleSelected.filter((r) => r.status === "failed");
  const selectAllState =
    outboxData && outboxData.outbox.length > 0 && visibleSelected.length === outboxData.outbox.length ? "all"
    : visibleSelected.length > 0 ? "some"
    : "none";

  async function doRetry(ids?: string[]) {
    try {
      const body = ids?.length ? { limit: ids.length, ids } : { limit: retryLimit };
      const r = await api<{ processed?: number; failed?: number; skipped?: number }>("/api/v1/internal/email/retry", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const extra = ids?.length ? `, skipped ${r.skipped ?? 0}` : "";
      toast(`Processed ${r.processed ?? 0}, failed ${r.failed ?? 0}${extra}`, "success");
      void load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function doProcessAllDue() {
    const BATCH = 500;
    let totalProcessed = 0;
    let totalFailed = 0;
    setProcessAllStatus("Processing…");
    try {
      while (true) {
        setProcessAllStatus(`${totalProcessed} sent so far…`);
        const r = await api<{ processed?: number; failed?: number }>("/api/v1/internal/email/retry", {
          method: "POST",
          body: JSON.stringify({ limit: BATCH }),
        });
        totalProcessed += r.processed ?? 0;
        totalFailed += r.failed ?? 0;
        if ((r.processed ?? 0) < BATCH) break;
      }
      toast(`Done: ${totalProcessed} sent, ${totalFailed} failed`, "success");
      void load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setProcessAllStatus("");
    }
  }

  async function doResetFailed(ids?: string[]) {
    try {
      const r = await api<{ reset?: number; processed?: number }>("/api/v1/internal/email/reset-failed", {
        method: "POST",
        body: JSON.stringify(ids?.length ? { ids } : {}),
      });
      toast(`Reset ${r.reset ?? 0} failed, sent ${r.processed ?? 0}`, "success");
      void load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  function handleSearchKey(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); applyFilters(); }
  }

  if (loading && !outboxData) return <Spinner />;
  if (error && !outboxData) return <ErrorAlert error={error} />;

  const ob = outboxData!;
  const currentPage = Math.floor(ob.page.offset / Math.max(1, ob.page.limit)) + 1;

  return (
    <div>
      {/* Stat cards */}
      <div class="stat-grid mb-4">
        {Object.entries(outboxStats).map(([k, v]) => (
          <div key={k} class={`stat-card${v > 0 && k === "failed" ? " danger" : ""}`}>
            <div class="val">{v}</div>
            <div class="lbl">{k}</div>
          </div>
        ))}
      </div>

      <div class="action-card mb-4">
        {/* Header */}
        <div class="d-flex flex-wrap justify-content-between gap-2 align-items-start mb-3">
          <div>
            <strong>Email Outbox</strong>
            <p class="mb-0 text-muted small">Inspect queued, retrying, sent, and failed email rows with recipient, subject, and delivery context.</p>
          </div>
          <div class="d-flex gap-2 flex-wrap">
            <button class="btn btn-sm btn-outline-secondary" onClick={() => void load()}>Refresh</button>
            <button class="btn btn-sm btn-outline-secondary" onClick={clearFilters}>Clear filters</button>
          </div>
        </div>

        {/* Filters */}
        <div class="row g-2 align-items-end mb-3">
          <div class="col-md-3">
            <label class="form-label small fw-semibold mb-1">Status</label>
            <select class="form-select form-select-sm" value={pendingStatus} onChange={(e) => { setPendingStatus((e.target as HTMLSelectElement).value); }}>
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="retrying">Retrying</option>
              <option value="sending">Sending</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div class="col-md-3">
            <label class="form-label small fw-semibold mb-1">Message type</label>
            <select class="form-select form-select-sm" value={pendingType} onChange={(e) => { setPendingType((e.target as HTMLSelectElement).value); }}>
              <option value="">All message types</option>
              <option value="transactional">Transactional</option>
              <option value="promotional">Promotional</option>
            </select>
          </div>
          <div class="col-md-4">
            <label class="form-label small fw-semibold mb-1">Search</label>
            <input
              type="search"
              class="form-control form-control-sm"
              value={pendingQ}
              placeholder="Recipient, subject, template, event, or error"
              onInput={(e) => setPendingQ((e.target as HTMLInputElement).value)}
              onKeyDown={handleSearchKey}
            />
          </div>
          <div class="col-md-2 d-grid">
            <button class="btn btn-sm btn-primary" onClick={applyFilters}>Apply</button>
          </div>
        </div>

        {/* Summary panels */}
        <div class="row g-3 mb-3">
          <div class="col-md-6">
            <div class="border rounded p-3 h-100">
              <div class="small text-muted mb-2">Status mix in current view</div>
              <SummaryBadges items={ob.summary.byStatus} />
            </div>
          </div>
          <div class="col-md-6">
            <div class="border rounded p-3 h-100">
              <div class="small text-muted mb-2">Message types, top templates, and due queue</div>
              <div class="mb-2"><SummaryBadges items={ob.summary.byMessageType} /></div>
              <div class="d-flex flex-wrap gap-2">
                {ob.summary.topTemplates.length > 0
                  ? ob.summary.topTemplates.map((item) => (
                      <span key={item.template_key} class="badge text-bg-light border text-dark">
                        {item.template_key}: {item.count}
                      </span>
                    ))
                  : <span class="text-muted small">No template usage in this view</span>
                }
              </div>
              <div class="small text-muted mt-2"><SummaryBadges items={ob.summary.dueByStatus} /></div>
            </div>
          </div>
        </div>

        {/* Queue actions */}
        <div class="border rounded p-3 mb-3 bg-light-subtle">
          <div class="d-flex flex-wrap justify-content-between gap-2 align-items-start">
            <div>
              <div class="small text-muted mb-1">Queue actions</div>
              <div class="small">
                Due now: {ob.summary.dueNow}.{" "}
                {visibleSelected.length > 0
                  ? `${visibleSelected.length} selected. ${processableSelected.length} can be processed, ${failedSelected.length} can be reset.`
                  : "Select visible rows to process due queued/retrying emails or reset failed ones."
                }
              </div>
            </div>
            <div class="d-flex flex-wrap gap-2 align-items-end">
              <div>
                <label class="form-label small fw-semibold mb-1">Batch limit</label>
                <input
                  type="number"
                  class="form-control form-control-sm"
                  value={retryLimit}
                  min={1}
                  max={500}
                  onInput={(e) => setRetryLimit(Number((e.target as HTMLInputElement).value) || 20)}
                  style="width:90px"
                />
              </div>
              <div class="form-check mt-4">
                <input
                  class="form-check-input"
                  type="checkbox"
                  id="email-select-visible"
                  checked={selectAllState === "all"}
                  ref={(el) => { if (el) (el as HTMLInputElement).indeterminate = selectAllState === "some"; }}
                  onChange={(e) => toggleSelectAll((e.target as HTMLInputElement).checked)}
                />
                <label class="form-check-label small" for="email-select-visible">Select visible</label>
              </div>
              <button class="btn btn-sm btn-success" onClick={() => void doRetry()}>Process due queue</button>
              <button class="btn btn-sm btn-primary" onClick={() => void doProcessAllDue()} disabled={Boolean(processAllStatus)}>
                {processAllStatus || "Process all due"}
              </button>
              <button
                class="btn btn-sm btn-outline-success"
                disabled={processableSelected.length === 0}
                onClick={() => void doRetry(processableSelected.map((r) => r.id))}
              >
                Process selected
              </button>
              <button
                class="btn btn-sm btn-outline-danger"
                disabled={failedSelected.length === 0}
                onClick={() => void doResetFailed(failedSelected.map((r) => r.id))}
              >
                Reset selected failed
              </button>
              <button class="btn btn-sm btn-danger" onClick={() => void doResetFailed()}>Reset all failed</button>
            </div>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorAlert error={error} />
        ) : (
          <>
            <Table heads={["", "Recipient", "Message", "Queue", "Timing", "Details"]} empty="No outbox rows match the current filters" className="align-middle">
              {ob.outbox.length > 0 && ob.outbox.map((row) => (
                    <OutboxRow
                      key={row.id}
                      row={row}
                      selected={selectedIds.has(row.id)}
                      onToggle={toggleRow}
                    />
                  ))}
            </Table>
            <Pager
              page={currentPage}
              hasMore={ob.page.hasMore}
              pageSize={ob.page.limit}
              offset={ob.page.offset}
              rowCount={ob.outbox.length}
              total={ob.page.total}
              onPrev={() => setFilters((f) => ({ ...f, offset: Math.max(0, f.offset - f.pageSize) }))}
              onNext={() => setFilters((f) => ({ ...f, offset: f.offset + f.pageSize }))}
              onJump={(page) => setFilters((f) => ({ ...f, offset: (page - 1) * f.pageSize }))}
              onPageSizeChange={(size) => setFilters((f) => ({ ...f, pageSize: size, offset: 0 }))}
            />
          </>
        )}
      </div>
    </div>
  );
}
