/**
 * Layout for the organizer's ticket sales: what was sold and collected, what
 * the payment provider kept, and each ticket with its payment. Static until
 * approved; the numbers are examples.
 */
import { asyncPaymentWindow } from "../../../shared/constants/async-payment-window";
import { formatTicketMoney } from "../../../shared/event-ticket-display";
import { CollectionToolbar } from "../../components/CollectionToolbar";
import { DataTable, type Column } from "../../components/Table";
import { Badge } from "../Badge";
import { Menu } from "../Menu";
import { PersonCell } from "../PersonCell";
import { StatCard } from "../StatCard";

interface SaleRow {
  id: string;
  name: string;
  organization: string;
  ticket: string;
  amount: number;
  net: number | null;
  status: "paid" | "processing" | "to_pay" | "payment_under_review" | "refunded";
  method: string | null;
  date: string;
}

const ROWS: SaleRow[] = [
  {
    id: "1",
    name: "Alex Example",
    organization: "Example Corp",
    ticket: "Vendor",
    amount: 39500,
    net: 38325,
    status: "paid",
    method: "card",
    date: "Nov 19, 2026",
  },
  {
    id: "2",
    name: "Sam Sample",
    organization: "Sample University",
    ticket: "Attendee",
    amount: 19500,
    net: 19380,
    status: "paid",
    method: "ideal",
    date: "Nov 18, 2026",
  },
  {
    id: "3",
    name: "Robin Placeholder",
    organization: "Placeholder Ltd",
    ticket: "Vendor",
    amount: 39500,
    net: null,
    status: "processing",
    method: "sepa_debit",
    date: "Nov 18, 2026",
  },
  {
    id: "4",
    name: "Kim Specimen",
    organization: "Specimen Inc",
    ticket: "Attendee",
    amount: 19500,
    net: null,
    status: "to_pay",
    method: null,
    date: "Nov 17, 2026",
  },
  {
    id: "5",
    name: "Taylor Example",
    organization: "Example Labs",
    ticket: "Attendee",
    amount: 19500,
    net: null,
    status: "payment_under_review",
    method: "card",
    date: "Nov 14, 2026",
  },
  {
    id: "6",
    name: "Jo Fixture",
    organization: "Fixture GmbH",
    ticket: "Vendor",
    amount: 39500,
    net: 0,
    status: "refunded",
    method: "card",
    date: "Nov 12, 2026",
  },
];

const STATUS = {
  paid: null,
  processing: { label: "Payment processing", tone: "info" },
  to_pay: { label: "Awaiting payment", tone: "warn" },
  payment_under_review: { label: "Payment under review", tone: "danger" },
  refunded: { label: "Refunded", tone: "danger" },
} as const;

const money = (amount: number) => formatTicketMoney(amount, "usd");

export function TicketSalesPreview() {
  const columns: Column<SaleRow>[] = [
    { header: "Person", cell: (row) => <PersonCell name={row.name} organization={row.organization} size="sm" /> },
    { header: "Ticket", cell: (row) => row.ticket, width: "fit" },
    {
      header: { label: "Amount", className: "pk-end" },
      className: "pk-end",
      width: "fit",
      cell: (row) => (
        <>
          <span class="pk-strong">{money(row.amount)}</span>
          {row.net !== null && row.status === "paid" && <div class="pk-small">Net: {money(row.net)}</div>}
        </>
      ),
    },
    {
      header: "Payment",
      width: "fit",
      cell: (row) => {
        const status = STATUS[row.status];
        return status ? <Badge tone={status.tone}>{status.label}</Badge> : "Paid";
      },
    },
    { header: "Method", width: "fit", cell: (row) => (row.method ? asyncPaymentWindow(row.method).label : "—") },
    { header: "Date", width: "fit", cell: (row) => row.date },
    {
      header: { label: "Actions", className: "pk-sr-only" },
      width: "fit",
      cell: (row) => (
        <Menu
          label={`Actions for ${row.name}`}
          align="end"
          items={[
            { id: "open", label: "Open registration", onSelect: () => {} },
            ...(row.status === "paid" ? [{ id: "refund", label: "Refund ticket", onSelect: () => {} }] : []),
            { id: "sync", label: "Update from payment provider", onSelect: () => {} },
          ]}
        />
      ),
    },
  ];
  return (
    <div class="pk-stack">
      <div class="pk-stat-row">
        <StatCard label="Tickets sold" value="42" note="6 free" />
        <StatCard label="Collected" value={money(1247500)} note="38 paid" />
        <StatCard label="Provider fees" value={money(38120)} />
        <StatCard label="Net" value={money(1209380)} />
        <StatCard label="Refunded" value={money(39500)} note="1 ticket" />
        <StatCard label="Awaiting payment" value="3" note={`${money(98500)} open, 1 processing`} tone="warn" />
        <StatCard label="Payment under review" value="1" note={`${money(19500)} under review`} tone="danger" />
      </div>
      <CollectionToolbar
        label="Ticket sales"
        search={{
          value: "",
          onInput: () => {},
          onSubmit: () => {},
          placeholder: "Name or organization",
          label: "Search tickets",
        }}
      >
        <Menu
          label="Actions for all tickets"
          align="end"
          items={[{ id: "update", label: "Update from payment provider", onSelect: () => {} }]}
        />
      </CollectionToolbar>
      <DataTable caption="Ticket sales" columns={columns} data={ROWS} rowKey={(row) => row.id} />
    </div>
  );
}
