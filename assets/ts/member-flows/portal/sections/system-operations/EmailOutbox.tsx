import { useRef, useState } from "preact/hooks";
import type { Column } from "../../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { getJson, postJson } from "../../../../shared/api-client";
import type { CollectionLoader } from "../../../../hooks/useServerCollection";
import { fmt, toast } from "../../ui";
import {
  emailOutboxProcessResponseSchema,
  emailOutboxResetFailedResponseSchema,
  emailOutboxResponseSchema,
  type EmailOutboxRow,
} from "../../../../../shared/schemas/email-outbox";

const loadPortalCollection: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });

const rowColumns: Column<EmailOutboxRow>[] = [
  {
    header: "Recipient",
    cell: (row) => (
      <>
        <div class="fw-semibold">{row.recipientName || row.recipientEmail}</div>
        <div class="mono small text-muted">{row.recipientEmail}</div>
        {row.eventName && <div class="small text-muted mt-1">{row.eventName}</div>}
      </>
    ),
    sort: { asc: "recipient", desc: "-recipient" },
  },
  {
    header: "Message",
    cell: (row) => (
      <>
        <div class="fw-semibold">{row.subject || "PKI Consortium Update"}</div>
        <div class="d-flex flex-wrap gap-1 mt-1">
          <span class="small text-muted">
            {row.templateKey}
            {row.templateVersion !== null ? ` v${row.templateVersion}` : ""}
          </span>
          <Badge status={row.messageType} />
        </div>
      </>
    ),
    sort: { asc: "template", desc: "-template" },
  },
  {
    header: "Queue",
    cell: (row) => (
      <>
        <div class="d-flex flex-wrap gap-1 align-items-center">
          <Badge status={row.status} />
          <span class="small text-muted">Attempts {row.attempts}</span>
        </div>
        <div class="small text-muted mt-2">Updated {fmt(row.updatedAt)}</div>
      </>
    ),
    sort: { asc: "status", desc: "-status" },
  },
  {
    header: "Timing",
    cell: (row) => (
      <>
        <div class="small text-muted">Queued</div>
        <div class="mono small">{fmt(row.createdAt)}</div>
        <div class="small text-muted mt-1">Due</div>
        <div class="mono small">{fmt(row.sendAfter)}</div>
        {row.sentAt && <div class="small text-muted mt-1">Sent {fmt(row.sentAt)}</div>}
      </>
    ),
    className: "small",
    sort: { asc: "sendAfter", desc: "-sendAfter" },
  },
  {
    header: "Details",
    cell: (row) => (
      <>
        <div class="mono small">{row.id}</div>
        {row.providerMessageId && <div class="mono small text-muted mt-1">{row.providerMessageId}</div>}
        {row.lastError ? (
          <details class="mt-2">
            <summary class="small text-danger">Failure details</summary>
            <div class="small text-danger mt-2">{row.lastError}</div>
          </details>
        ) : (
          <div class="small text-muted mt-2">No delivery error recorded.</div>
        )}
      </>
    ),
  },
];

export function EmailOutbox({ canManage }: { canManage: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const actionsRef = useRef<ApiTableActions | null>(null);
  const columns: Column<EmailOutboxRow>[] = canManage
    ? [
        {
          header: { label: "Select", className: "text-center" },
          className: "text-center",
          cell: (row) => (
            <input
              type="checkbox"
              class="form-check-input"
              aria-label={`Select ${row.subject || row.id}`}
              checked={selected.has(row.id)}
              disabled={!selected.has(row.id) && selected.size >= 100}
              onChange={() =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(row.id)) next.delete(row.id);
                  else next.add(row.id);
                  return next;
                })
              }
            />
          ),
        },
        ...rowColumns,
      ]
    : rowColumns;

  async function process(endpoint: string, body: unknown, reset: boolean): Promise<void> {
    setBusy(true);
    try {
      if (reset) {
        const result = await postJson(endpoint, body, emailOutboxResetFailedResponseSchema);
        toast(
          `Reset ${result.reset} and processed ${result.processed} message(s).`,
          result.failed > 0 ? "error" : "success",
        );
      } else {
        const result = await postJson(endpoint, body, emailOutboxProcessResponseSchema);
        toast(
          `Processed ${result.processed} message(s); ${result.failed} failed.`,
          result.failed > 0 ? "error" : "success",
        );
      }
      setSelected(new Set());
      await actionsRef.current?.reload();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <strong>Email Outbox</strong>
          <p class="mb-0 text-muted small">Inspect queued, sent, delivered, failed, and retryable email rows.</p>
        </div>
        {!canManage && <span class="badge text-bg-light border text-dark">Read only</span>}
      </div>
      <ApiDataTable
        urlState="outbox"
        endpoint="/api/v1/email/outbox"
        responseSchema={emailOutboxResponseSchema}
        resolve={(data) => data.outbox}
        resolvePage={(data) => data.page}
        columns={columns}
        paginate
        initialPageSize={25}
        initialSort="-createdAt"
        searchPlaceholder="Search recipient, subject, template, event, or error…"
        actionsRef={actionsRef}
        toolbar={
          canManage
            ? () => (
                <div class="d-flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-primary"
                    disabled={busy}
                    onClick={() => void process("/api/v1/email/outbox/process", { limit: 20 }, false)}
                  >
                    Process next 20 due
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-primary"
                    disabled={busy || selected.size === 0}
                    onClick={() => void process("/api/v1/email/outbox/process", { ids: [...selected] }, false)}
                  >
                    Process selected ({selected.size})
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-danger"
                    disabled={busy || selected.size === 0}
                    onClick={() => void process("/api/v1/email/outbox/reset-failed", { ids: [...selected] }, true)}
                  >
                    Reset failed selected
                  </button>
                </div>
              )
            : undefined
        }
        load={loadPortalCollection}
        empty="No outbox rows match the current filters."
        className="align-middle"
        rowKey={(row) => row.id}
      />
    </div>
  );
}
