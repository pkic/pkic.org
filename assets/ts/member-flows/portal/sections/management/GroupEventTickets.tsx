/**
 * The tickets an event has issued, for its organizers: what was sold and
 * collected, what the payment provider kept, and each ticket with its payment.
 * A refund and an update from the provider are taken here, per ticket or for
 * every ticket that could change.
 */
import { useRef, useState } from "preact/hooks";
import { asyncPaymentWindow } from "../../../../../shared/constants/async-payment-window";
import { formatTicketAmount, formatTicketMoney } from "../../../../../shared/event-ticket-display";
import { TICKET_STATUS_LABELS } from "../../../../../shared/event-tickets";
import { TICKET_STANDING_COPY } from "../../../../../shared/event-ticket-standing";
import { formatNumber } from "../../../../../shared/format-number";
import {
  ISSUED_TICKET_PAYMENT_STATES,
  issuedTicketsResponseSchema,
  issuedTicketsUpdateResponseSchema,
  type IssuedTicket,
  type IssuedTicketPaymentState,
  type IssuedTicketsSummary,
} from "../../../../../shared/schemas/event-issued-tickets";
import { registrationTicketSyncResponseSchema } from "../../../../../shared/schemas/registration-tickets";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { TicketRefundDialog, ticketRefundable } from "../../../../components/events/tickets/TicketRefundDialog";
import type { Column } from "../../../../components/Table";
import { postJson } from "../../../../shared/api-client";
import { Badge } from "../../../../ui/Badge";
import { Menu } from "../../../../ui/Menu";
import { PersonCell } from "../../../../ui/PersonCell";
import { StatCard } from "../../../../ui/StatCard";
import { usePortalHashLocation } from "../../hash-location";
import { fmtDate, toast } from "../../ui";

/** How an organizer reads each payment state; only a state that needs attention carries a tone. */
const PAYMENT_LABELS: Record<IssuedTicketPaymentState, { label: string; tone?: "warn" | "info" | "danger" }> = {
  paid: { label: TICKET_STATUS_LABELS.paid },
  free: { label: TICKET_STATUS_LABELS.free },
  to_pay: { label: TICKET_STATUS_LABELS.pending_payment, tone: "warn" },
  processing: { label: TICKET_STANDING_COPY.processing.status, tone: "info" },
  payment_under_review: { label: TICKET_STATUS_LABELS.payment_under_review, tone: "danger" },
  refunded: { label: TICKET_STATUS_LABELS.refunded, tone: "danger" },
  canceled: { label: TICKET_STATUS_LABELS.canceled, tone: "danger" },
};

const EMPTY_SUMMARY: IssuedTicketsSummary = {
  currency: "usd",
  byPayment: {},
  collected: 0,
  providerFees: 0,
  refunded: 0,
  refundedCount: 0,
  underReviewAmount: 0,
  awaitingAmount: 0,
  unread: 0,
  updatable: 0,
};

/** A long list is updated in batches; this bounds one press of the button. */
const MAX_UPDATE_ROUNDS = 25;

function Totals({ summary }: { summary: IssuedTicketsSummary }) {
  const money = (amount: number) => formatTicketMoney(amount, summary.currency);
  const of = (state: IssuedTicketPaymentState) => summary.byPayment[state] ?? 0;
  const awaiting = of("to_pay") + of("processing");
  return (
    <div class="pk-stat-row">
      <StatCard
        label="Tickets sold"
        value={formatNumber(of("paid"))}
        note={of("free") ? `${formatNumber(of("free"))} free` : undefined}
      />
      <StatCard label="Collected" value={money(summary.collected)} />
      <StatCard
        label="Provider fees"
        value={money(summary.providerFees)}
        note={summary.unread ? `${formatNumber(summary.unread)} not read yet` : undefined}
      />
      <StatCard label="Net" value={money(summary.collected - summary.providerFees)} />
      <StatCard
        label="Refunded"
        value={money(summary.refunded)}
        note={summary.refundedCount ? `${formatNumber(summary.refundedCount)} tickets` : undefined}
      />
      <StatCard
        label="Awaiting payment"
        value={formatNumber(awaiting)}
        note={
          awaiting
            ? `${money(summary.awaitingAmount)} open${of("processing") ? `, ${formatNumber(of("processing"))} processing` : ""}`
            : undefined
        }
        tone={awaiting ? "warn" : undefined}
      />
      <StatCard
        label="Payment under review"
        value={formatNumber(of("payment_under_review"))}
        note={of("payment_under_review") ? `${money(summary.underReviewAmount)} under review` : undefined}
        tone={of("payment_under_review") ? "danger" : undefined}
      />
    </div>
  );
}

export function GroupEventTickets({
  eventSlug,
  registrationsPath,
  canManage,
}: {
  eventSlug: string;
  /** Where a registration's own page lives; a ticket opens the registration it belongs to. */
  registrationsPath: string;
  canManage: boolean;
}) {
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [refunding, setRefunding] = useState<IssuedTicket | null>(null);
  const [updating, setUpdating] = useState(false);
  const actionsRef = useRef<ApiTableActions | null>(null);
  const base = `/api/v1/events/${encodeURIComponent(eventSlug)}`;
  const reload = () => actionsRef.current?.reload() ?? Promise.resolve();

  async function updateAll() {
    if (updating) return;
    setUpdating(true);
    let checked = 0;
    let changed = 0;
    let failed = 0;
    try {
      let after: string | undefined;
      for (let round = 0; round < MAX_UPDATE_ROUNDS; round += 1) {
        const batch = await postJson(
          `${base}/tickets/issued/updates`,
          after ? { after } : {},
          issuedTicketsUpdateResponseSchema,
        );
        checked += batch.checked;
        changed += batch.changed;
        failed += batch.failed;
        if (!batch.next) break;
        after = batch.next;
      }
      toast(
        failed
          ? `${formatNumber(changed)} of ${formatNumber(checked)} tickets updated. ${formatNumber(failed)} could not be read; try again.`
          : `${formatNumber(changed)} of ${formatNumber(checked)} tickets updated from the payment provider.`,
        failed ? "error" : "success",
      );
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The payment provider could not be read. Try again.", "error");
    } finally {
      setUpdating(false);
      await reload();
    }
  }

  async function updateOne(row: IssuedTicket) {
    try {
      const synced = await postJson(
        `${base}/registrations/${encodeURIComponent(row.registrationId)}/ticket/sync`,
        {},
        registrationTicketSyncResponseSchema,
      );
      toast(
        synced.changed
          ? "Ticket updated from the payment provider."
          : "The ticket already matches the payment provider.",
        "success",
      );
      await reload();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The payment provider could not be read. Try again.", "error");
    }
  }

  const total = Object.values(summary.byPayment).reduce((sum, value) => sum + value, 0);
  const columns: Column<IssuedTicket>[] = [
    {
      header: "Person",
      cell: (row) => (
        <PersonCell name={row.name} organization={row.organizationName} avatarSrc={row.headshotUrl} size="sm" />
      ),
      sort: { asc: "name", desc: "-name" },
    },
    { header: "Ticket", cell: (row) => row.ticket.ticketName, width: "fit" },
    {
      header: { label: "Amount", className: "pk-end" },
      className: "pk-end",
      width: "fit",
      cell: (row) => (
        <>
          <span class="pk-strong">{formatTicketAmount(row.ticket.amount, row.ticket.currency)}</span>
          {row.ticket.netAmount !== null && (
            <div class="pk-small">Net: {formatTicketMoney(row.ticket.netAmount, row.ticket.currency)}</div>
          )}
        </>
      ),
      sort: { asc: "amount", desc: "-amount", defaultDirection: "desc" },
    },
    {
      header: "Payment",
      width: "fit",
      cell: (row) => {
        const state = PAYMENT_LABELS[row.payment];
        return state.tone ? <Badge tone={state.tone}>{state.label}</Badge> : state.label;
      },
      filter: {
        param: "payment",
        options: [
          { value: "", label: `All payments (${formatNumber(total)})` },
          ...ISSUED_TICKET_PAYMENT_STATES.map((state) => ({
            value: state as string,
            label: `${PAYMENT_LABELS[state].label} (${formatNumber(summary.byPayment[state] ?? 0)})`,
          })),
        ],
      },
    },
    {
      header: "Method",
      width: "fit",
      cell: (row) => (row.ticket.paymentMethod ? asyncPaymentWindow(row.ticket.paymentMethod).label : "—"),
    },
    {
      header: "Date",
      width: "fit",
      cell: (row) => fmtDate(row.ticket.paidAt ?? row.issuedAt),
      sort: { asc: "issued", desc: "-issued", defaultDirection: "desc" },
    },
    ...(canManage
      ? [
          {
            header: { label: "Actions", className: "pk-sr-only" },
            width: "fit",
            cell: (row) => (
              <Menu
                label={`Actions for ${row.name}`}
                align="end"
                items={[
                  ...(ticketRefundable(row.ticket)
                    ? [{ id: "refund", label: "Refund ticket", onSelect: () => setRefunding(row) }]
                    : []),
                  ...(row.ticket.amount > 0 || row.ticket.paidAmount > 0
                    ? [{ id: "update", label: "Update from payment provider", onSelect: () => void updateOne(row) }]
                    : []),
                  ...(row.ticket.receiptUrl
                    ? [{ id: "receipt", label: "Open receipt", href: row.ticket.receiptUrl }]
                    : []),
                ]}
              />
            ),
          } satisfies Column<IssuedTicket>,
        ]
      : []),
  ];

  return (
    <div class="pk-stack">
      <Totals summary={summary} />
      <ApiDataTable
        caption="Tickets"
        searchPlaceholder="Name or organization"
        urlState="tickets"
        endpoint={`${base}/tickets/issued`}
        responseSchema={issuedTicketsResponseSchema}
        resolve={(data) => data.tickets}
        resolvePage={(data) => data.page}
        onData={(data) => setSummary(data.summary)}
        paginate
        actionsRef={actionsRef}
        // A list's own actions sit in its toolbar menu, as on every other list; never a text button beside the icons.
        toolbar={() =>
          canManage && (
            <Menu
              label="Actions for all tickets"
              align="end"
              items={[
                {
                  id: "update",
                  label: updating ? "Updating from payment provider…" : "Update from payment provider",
                  disabled: updating || summary.updatable === 0,
                  onSelect: () => void updateAll(),
                },
              ]}
            />
          )
        }
        columns={columns}
        empty={({ narrowed }) => (narrowed ? "No tickets match." : "No tickets issued yet.")}
        rowKey={(row) => row.registrationId}
        rowAction={(row) => ({
          label: `Open the registration of ${row.name}`,
          href: usePortalHashLocation.hrefs(`${registrationsPath}/${encodeURIComponent(row.registrationId)}`),
        })}
      />
      {refunding && (
        <TicketRefundDialog
          slug={eventSlug}
          registrationId={refunding.registrationId}
          ticket={refunding.ticket}
          open
          onClose={() => setRefunding(null)}
          onRefunded={async () => {
            toast("Refund requested. The ticket shows as refunded once the payment provider confirms it.", "success");
            await reload();
          }}
        />
      )}
    </div>
  );
}
