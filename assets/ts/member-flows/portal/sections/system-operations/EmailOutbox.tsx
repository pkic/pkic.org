/**
 * Email outbox — the queue as the server reports it, plus the two bounded
 * commands that act on it.
 *
 * The row checkbox is a real label-wrapped control carrying all three parts of
 * the design system's check block; its name is visually hidden because the row
 * beside it already says which message it selects, but it is still a name
 * rather than an unlabelled box in a column of unlabelled boxes.
 */
import { useRef, useState } from "preact/hooks";
import type { Column } from "../../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { Badge as ToneBadge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { getJson, postJson } from "../../../../shared/api-client";
import type { CollectionLoader } from "../../../../hooks/useServerCollection";
import { fmt, toast } from "../../ui";
import {
  emailOutboxProcessResponseSchema,
  emailOutboxResetFailedResponseSchema,
  emailOutboxResponseSchema,
  type EmailOutboxRow,
} from "../../../../../shared/schemas/email-outbox";
import "../../../../ui/Content.css";
import "../../../../ui/Field.css";

/** The largest selection the process/reset endpoints accept in one request. */
const MAX_SELECTION = 100;

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const actionsRef = useRef<ApiTableActions | null>(null);
  const columns: Column<EmailOutboxRow>[] = canManage
    ? [
        {
          header: "Select",
          cell: (row) => (
            <label class="pk-check">
              <input
                type="checkbox"
                class="pk-check__input"
                checked={selected.has(row.id)}
                disabled={!selected.has(row.id) && selected.size >= MAX_SELECTION}
                onChange={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(row.id)) next.delete(row.id);
                    else next.add(row.id);
                    return next;
                  })
                }
              />
              <span class="pk-check__label pk-sr-only">Select {row.subject || row.id}</span>
            </label>
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
    <div class="pk pk-stack pk-stack--snug">
      <div class="pk-cluster pk-cluster--between">
        <div class="pk-stack pk-stack--tight">
          <strong>Email Outbox</strong>
          <p class="pk-small">Inspect queued, sent, delivered, failed, and retryable email rows.</p>
        </div>
        {!canManage && <ToneBadge tone="neutral">Read only</ToneBadge>}
      </div>
      <ApiDataTable
        caption="Email outbox messages"
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
                <div class="pk-cluster">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void process("/api/v1/email/outbox/process", { limit: 20 }, false)}
                  >
                    Process next 20 due
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || selected.size === 0}
                    onClick={() => void process("/api/v1/email/outbox/process", { ids: [...selected] }, false)}
                  >
                    Process selected ({selected.size})
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-quiet"
                    disabled={busy || selected.size === 0}
                    onClick={() => void process("/api/v1/email/outbox/reset-failed", { ids: [...selected] }, true)}
                  >
                    Reset failed selected
                  </Button>
                </div>
              )
            : undefined
        }
        load={loadPortalCollection}
        empty="No outbox rows match the current filters."
        rowKey={(row) => row.id}
      />
    </div>
  );
}
