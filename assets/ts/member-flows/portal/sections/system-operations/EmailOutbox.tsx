/**
 * Email outbox — the queue as the server reports it, plus the two bounded
 * commands that act on it.
 *
 * This is the one portal list whose API takes a set of row ids (process
 * selected, reset failed), so it is the one list that earns selection
 * checkboxes and the BulkBar; a list without such an endpoint does not grow
 * decorative checkboxes.
 */
import { useRef, useState } from "preact/hooks";
import type { Column } from "../../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge, statusLabel } from "../../../../components/Badge";
import { FilterSelect } from "../../../../components/FilterSelect";
import { Badge as ToneBadge } from "../../../../ui/Badge";
import { BulkBar } from "../../../../ui/BulkBar";
import { Button } from "../../../../ui/Button";
import { getJson, postJson } from "../../../../shared/api-client";
import type { CollectionLoader } from "../../../../hooks/useServerCollection";
import { fmt, toast } from "../../ui";
import { emailMessageTypeSchema } from "../../../../../shared/schemas/api-common";
import {
  emailOutboxProcessResponseSchema,
  emailOutboxResetFailedResponseSchema,
  emailOutboxResponseSchema,
  emailOutboxStatusSchema,
  type EmailOutboxResponse,
  type EmailOutboxRow,
} from "../../../../../shared/schemas/email-outbox";
import "../../../../ui/Content.css";

/** The largest selection the process/reset endpoints accept in one request. */
const MAX_SELECTION = 100;

const STATUS_OPTIONS = emailOutboxStatusSchema.options;
const MESSAGE_TYPE_OPTIONS = emailMessageTypeSchema.options;

const loadPortalCollection: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });

const rowColumns: Column<EmailOutboxRow>[] = [
  {
    header: "Recipient",
    cell: (row) => (
      <div class="pk-stack pk-stack--tight">
        <div class="pk-strong">{row.recipientName || row.recipientEmail}</div>
        <div class="pk-mono pk-small pk-break">{row.recipientEmail}</div>
        {row.eventName && <div class="pk-small">{row.eventName}</div>}
      </div>
    ),
    sort: { asc: "recipient", desc: "-recipient" },
  },
  {
    header: "Message",
    cell: (row) => (
      <div class="pk-stack pk-stack--tight">
        <div class="pk-strong">{row.subject || "PKI Consortium Update"}</div>
        <div class="pk-cluster">
          <span class="pk-small">
            {row.templateKey}
            {row.templateVersion !== null ? ` v${row.templateVersion}` : ""}
          </span>
          <Badge status={row.messageType} />
        </div>
      </div>
    ),
    sort: { asc: "template", desc: "-template" },
  },
  {
    header: "Queue",
    cell: (row) => (
      <div class="pk-stack pk-stack--tight">
        <div class="pk-cluster">
          <Badge status={row.status} />
          <span class="pk-small">Attempts {row.attempts}</span>
        </div>
        <div class="pk-small">Updated {fmt(row.updatedAt)}</div>
      </div>
    ),
    sort: { asc: "status", desc: "-status" },
  },
  {
    header: "Timing",
    cell: (row) => (
      <div class="pk-stack pk-stack--tight">
        <div class="pk-small">Queued</div>
        <div class="pk-mono">{fmt(row.createdAt)}</div>
        <div class="pk-small">Due</div>
        <div class="pk-mono">{fmt(row.sendAfter)}</div>
        {row.sentAt && <div class="pk-small">Sent {fmt(row.sentAt)}</div>}
      </div>
    ),
    className: "pk-small",
    width: "fit",
    sort: { asc: "sendAfter", desc: "-sendAfter" },
  },
  {
    header: "Details",
    cell: (row) => (
      <div class="pk-stack pk-stack--tight">
        <div class="pk-mono pk-small pk-break">{row.id}</div>
        {row.providerMessageId && <div class="pk-mono pk-small pk-break">{row.providerMessageId}</div>}
        {row.lastError ? (
          <details>
            {/* "Failure" is in the words, so the row does not depend on a tone
                nobody can rely on to say that something went wrong. */}
            <summary class="pk-small">Failure details</summary>
            <div class="pk-small pk-break">{row.lastError}</div>
          </details>
        ) : (
          <div class="pk-small">No delivery error recorded.</div>
        )}
      </div>
    ),
  },
];

export function EmailOutbox({ canManage }: { canManage: boolean }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [messageTypeFilter, setMessageTypeFilter] = useState("");
  const actionsRef = useRef<ApiTableActions | null>(null);
  // The rows last handed to the table, so a selection checkbox can be named
  // after its message, and the BulkBar can state the page's total.
  const lastData = useRef<EmailOutboxResponse | null>(null);
  const columns: Column<EmailOutboxRow>[] = rowColumns;
  const overCap = selected.size > MAX_SELECTION;

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

  /** Names a selection checkbox after the message it selects. */
  function rowLabel(key: string): string {
    const row = lastData.current?.outbox.find((candidate) => candidate.id === key);
    return `Select ${row?.subject || key}`;
  }

  return (
    <div class="pk pk-stack pk-stack--snug">
      {!canManage && (
        <div class="pk-cluster pk-cluster--end">
          <ToneBadge tone="neutral">Read only</ToneBadge>
        </div>
      )}
      {/* The strip appears only while rows are selected; the bounded
          commands that take the selected ids live here, not in the toolbar. */}
      {canManage && (
        <BulkBar
          count={selected.size}
          total={lastData.current?.page.total ?? selected.size}
          onClear={() => setSelected(new Set())}
        >
          {overCap && <span class="pk-small">Selection exceeds the {MAX_SELECTION}-message limit per request.</span>}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || overCap}
            onClick={() => void process("/api/v1/email/outbox/process", { ids: [...selected] }, false)}
          >
            Process selected
          </Button>
          <Button
            size="sm"
            variant="danger-quiet"
            disabled={busy || overCap}
            onClick={() => void process("/api/v1/email/outbox/reset-failed", { ids: [...selected] }, true)}
          >
            Reset failed selected
          </Button>
        </BulkBar>
      )}
      <ApiDataTable
        caption="Email outbox messages"
        urlState="outbox"
        endpoint="/api/v1/email/outbox"
        responseSchema={emailOutboxResponseSchema}
        resolve={(data) => data.outbox}
        resolvePage={(data) => data.page}
        onData={(data) => {
          lastData.current = data;
        }}
        columns={columns}
        paginate
        initialPageSize={25}
        initialSort="-createdAt"
        searchPlaceholder="Search recipient, subject, template, event, or error…"
        actionsRef={actionsRef}
        params={{
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(messageTypeFilter ? { messageType: messageTypeFilter } : {}),
        }}
        toolbar={({ resetPage }) => (
          <>
            {/* Both filters already exist on the list contract; the toolbar
                exposes them instead of leaving status a concept the reader
                must express through search syntax. */}
            <FilterSelect
              ariaLabel="Filter messages by status"
              value={statusFilter}
              options={[
                { value: "", label: "All statuses" },
                ...STATUS_OPTIONS.map((status) => ({ value: status as string, label: statusLabel(status) })),
              ]}
              onChange={(value) => {
                setStatusFilter(value);
                resetPage();
              }}
            />
            <FilterSelect
              ariaLabel="Filter messages by type"
              value={messageTypeFilter}
              options={[
                { value: "", label: "All types" },
                ...MESSAGE_TYPE_OPTIONS.map((type) => ({ value: type as string, label: statusLabel(type) })),
              ]}
              onChange={(value) => {
                setMessageTypeFilter(value);
                resetPage();
              }}
            />
            {canManage && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void process("/api/v1/email/outbox/process", { limit: 20 }, false)}
              >
                Process next 20 due
              </Button>
            )}
          </>
        )}
        selection={canManage ? { selected, onChange: setSelected, rowLabel } : undefined}
        load={loadPortalCollection}
        empty="No outbox rows match the current filters."
        rowKey={(row) => row.id}
      />
    </div>
  );
}
