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
import { Badge as ToneBadge } from "../../../../ui/Badge";
import { BulkBar } from "../../../../ui/BulkBar";
import { Button } from "../../../../ui/Button";
import { Menu } from "../../../../ui/Menu";
import { PageHeader } from "../../../../ui/PageHeader";
import { PersonCell } from "../../../../ui/PersonCell";
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
// `pk-table__clamp` is defined in the table's own stylesheet, which rides a
// lazy chunk: a surface that writes the class name pulls the sheet in itself.
import "../../../../ui/Table.css";

/** The largest selection the process/reset endpoints accept in one request. */
const MAX_SELECTION = 100;

const STATUS_OPTIONS = emailOutboxStatusSchema.options;
const MESSAGE_TYPE_OPTIONS = emailMessageTypeSchema.options;

const loadPortalCollection: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });

/**
 * One fact per column. The list used to stack four facts into each of five
 * cells — name over address over event, subject over template over type —
 * so a row was a paragraph and the subject, the one line a reader scans for,
 * was cramped into a fifth of the width (#124). Every column here can be
 * sorted or filtered on its own, and the two that are only ever wanted while
 * chasing a failure start hidden.
 */
const rowColumns: Column<EmailOutboxRow>[] = [
  {
    header: "Recipient",
    cell: (row) => (
      <PersonCell
        name={row.recipientName || row.recipientEmail}
        // The address is the second line only when the first line is a name;
        // a row without a name already leads with the address.
        email={row.recipientName ? row.recipientEmail : undefined}
        size="sm"
      />
    ),
    sort: { asc: "recipient", desc: "-recipient" },
  },
  {
    header: "Subject",
    cell: (row) => (
      <>
        <span class="pk-strong pk-table__clamp" title={row.subject || "Email delivery details"}>
          {row.subject || "Email delivery details"}
        </span>
        <div
          class="pk-small pk-muted pk-table__clamp"
          title={[row.templateKey, row.eventName].filter(Boolean).join(" · ")}
        >
          {row.templateKey}
          {row.templateVersion !== null ? ` v${row.templateVersion}` : ""}
          {row.eventName ? ` · ${row.eventName}` : ""}
        </div>
      </>
    ),
    width: "primary",
    sort: { asc: "template", desc: "-template" },
  },
  {
    header: "Type",
    cell: (row) => <Badge status={row.messageType} />,
    width: "fit",
    filter: {
      param: "messageType",
      options: [
        { value: "", label: "All types" },
        ...MESSAGE_TYPE_OPTIONS.map((type) => ({ value: type as string, label: statusLabel(type) })),
      ],
    },
  },
  {
    header: "Status",
    cell: (row) => <Badge status={row.status} />,
    width: "fit",
    sort: { asc: "status", desc: "-status" },
    filter: {
      param: "status",
      options: [
        { value: "", label: "All statuses" },
        ...STATUS_OPTIONS.map((status) => ({ value: status as string, label: statusLabel(status) })),
      ],
    },
  },
  {
    // Wanted while chasing a failure, not while reading the queue: hidden
    // until asked for. Every fit column here is a timestamp or a badge that
    // cannot wrap, and at eight of them the subject was squeezed to its
    // narrowest before the reader had touched anything.
    header: "Attempts",
    cell: (row) => row.attempts,
    className: "pk-center",
    width: "fit",
    hideable: true,
    defaultHidden: true,
  },
  {
    header: "Queued",
    cell: (row) => fmt(row.createdAt),
    className: "pk-small pk-nowrap",
    width: "fit",
    sort: { asc: "createdAt", desc: "-createdAt", defaultDirection: "desc" },
  },
  {
    header: "Due",
    cell: (row) => fmt(row.sendAfter),
    className: "pk-small pk-nowrap",
    width: "fit",
    sort: { asc: "sendAfter", desc: "-sendAfter" },
  },
  {
    header: "Sent",
    cell: (row) => (row.sentAt ? fmt(row.sentAt) : "—"),
    className: "pk-small pk-nowrap",
    width: "fit",
    hideable: true,
    defaultHidden: true,
  },
  {
    // The identifiers are for support work against the provider's logs, not
    // for reading the queue, so the column starts hidden and comes back from
    // the columns menu when it is wanted.
    header: "References",
    cell: (row) => (
      <>
        <div class="pk-mono pk-small">{row.id}</div>
        {row.providerMessageId && <div class="pk-mono pk-small pk-muted">{row.providerMessageId}</div>}
      </>
    ),
    width: "fit",
    hideable: true,
    defaultHidden: true,
  },
];

export function EmailOutbox({ canManage }: { canManage: boolean }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
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
    // Its own page under Settings now. It was a tab inside "Operations", a
    // bucket that held the outbox, the due queue and the job registry at
    // once and named none of them (#40).
    <div class="pk pk-stack pk-stack--snug">
      <PageHeader
        title="Email outbox"
        actions={
          /* A command on the page as a whole — the next due batch, whatever
             is selected — is the page's, and lives in its menu rather than
             standing open in the table's toolbar (#124). */
          canManage ? (
            <Menu
              label="Email outbox actions"
              align="end"
              items={[
                {
                  id: "process-due",
                  label: "Process next 20 due",
                  disabled: busy,
                  onSelect: () => void process("/api/v1/email/outbox/process", { limit: 20 }, false),
                },
              ]}
            />
          ) : undefined
        }
      />
      {!canManage && (
        <div class="pk-cluster pk-cluster--end">
          <ToneBadge tone="neutral">Read only</ToneBadge>
        </div>
      )}
      <ApiDataTable
        caption="Email outbox messages"
        bulkBar={
          /* The strip appears only while rows are selected; the bounded
             commands that take the selected ids live here — in the panel's
             own slot between the head and the rows — not in the toolbar. */
          canManage ? (
            <BulkBar
              count={selected.size}
              total={lastData.current?.page.total ?? selected.size}
              onClear={() => setSelected(new Set())}
            >
              {overCap && (
                <span class="pk-small">Selection exceeds the {MAX_SELECTION}-message limit per request.</span>
              )}
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
          ) : undefined
        }
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
        selection={canManage ? { selected, onChange: setSelected, rowLabel } : undefined}
        load={loadPortalCollection}
        empty="No outbox rows match the current filters."
        rowKey={(row) => row.id}
        rowAction={(row) => ({
          label: `Open ${row.subject || "email delivery details"}`,
          href: `#/settings/email-outbox/${encodeURIComponent(row.id)}`,
        })}
      />
    </div>
  );
}
