/**
 * The tickets an event has issued, as the organizer's searched, filtered,
 * sorted and paged list with its totals, and the bounded update that brings
 * a batch of them in line with the payment provider.
 */
import {
  issuedTicketsResponseSchema,
  type IssuedTicketPaymentState,
  type IssuedTicketsQuery,
  type IssuedTicketsUpdateResponse,
} from "../../../../assets/shared/schemas/event-issued-tickets";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike, Env } from "../../types";
import { REGISTRATION_ORGANIZATION_SQL } from "../registrations/selected-identity";
import { publicUserHeadshotPath } from "../user-headshot";
import { ticketPaymentProcessingSql } from "./payment";
import { TICKET_PAYMENT_UNREAD_SQL } from "./payment-details";
import { syncRegistrationTicketWithProvider } from "./provider-sync";
import {
  decodeRegistrationTicket,
  REGISTRATION_TICKET_COLUMNS_SQL,
  REGISTRATION_TICKET_FROM_SQL,
  type TicketReadRow,
} from "./registration-ticket";

/** How many tickets one update request reads at the provider; each takes a few calls. */
const UPDATE_BATCH = 8;

const PROCESSING_SQL = `(ticket.status = 'pending_payment' AND ${ticketPaymentProcessingSql("ticket.id")})`;

/** A ticket's payment state as one word: a payment on its way is told apart from one still to make. */
const PAYMENT_STATE_SQL = `CASE WHEN ${PROCESSING_SQL} THEN 'processing'
  WHEN ticket.status = 'pending_payment' THEN 'to_pay' ELSE ticket.status END`;

/** A ticket an update from the provider could change: an unread payment, or a payment page that was opened. */
const UPDATABLE_SQL = `((${TICKET_PAYMENT_UNREAD_SQL}) OR (ticket.status = 'pending_payment' AND EXISTS (
  SELECT 1 FROM registration_ticket_checkouts page
  WHERE page.ticket_id = ticket.id AND page.provider_session_id IS NOT NULL AND page.payment_intent_id IS NULL)))`;

const HOLDER_FROM_SQL = `${REGISTRATION_TICKET_FROM_SQL}
  JOIN registrations r ON r.id = ticket.registration_id
  JOIN users u ON u.id = r.user_id`;

interface IssuedRow extends TicketReadRow {
  registration_id: string;
  user_id: string;
  display_name: string;
  organization_name: string | null;
  headshot_r2_key: string | null;
  payment: IssuedTicketPaymentState;
  issued_at: string;
}

interface SummaryRow {
  payment: IssuedTicketPaymentState;
  tickets: number;
  collected: number;
  under_review_amount: number;
  provider_fees: number;
  refunded: number;
  refunded_count: number;
  awaiting_amount: number;
  unread: number;
  updatable: number;
}

export async function listIssuedTickets(db: DatabaseLike, event: { id: string }, query: IssuedTicketsQuery) {
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["u.first_name", "u.last_name", "u.email", REGISTRATION_ORGANIZATION_SQL])
    : null;
  const [page, summary, settings] = await Promise.all([
    queryPage<IssuedRow>(db, {
      source: {
        selectSql: `SELECT ${REGISTRATION_TICKET_COLUMNS_SQL},
          r.id AS registration_id, u.id AS user_id, u.headshot_r2_key,
          COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name,
          ${REGISTRATION_ORGANIZATION_SQL} AS organization_name,
          ${PAYMENT_STATE_SQL} AS payment, ticket.created_at AS issued_at`,
        fromSql: `${HOLDER_FROM_SQL} WHERE ticket.event_id = ?${query.payment ? ` AND ${PAYMENT_STATE_SQL} = ?` : ""}${
          search ? ` AND (${search.sql})` : ""
        }`,
        bindings: [event.id, ...(query.payment ? [query.payment] : []), ...(search?.bindings ?? [])],
      },
      orderBy: resolveMappedOrderBy(
        query.sort,
        {
          name: "display_name COLLATE NOCASE",
          amount: "ticket.amount",
          paid: "ticket.paid_at",
          issued: "ticket.created_at",
        },
        "ticket.created_at DESC",
        "ticket.id ASC",
      ),
      limit: query.limit,
      offset: query.offset,
    }),
    // The totals cover every ticket of the event, whatever the list is filtered to.
    all<SummaryRow>(
      db,
      `SELECT ${PAYMENT_STATE_SQL} AS payment, COUNT(*) AS tickets,
              SUM(CASE WHEN ticket.status = 'payment_under_review' THEN 0
                       ELSE ticket.paid_amount - ticket.refunded_amount END) AS collected,
              SUM(CASE WHEN ticket.status = 'payment_under_review' THEN ticket.paid_amount - ticket.refunded_amount
                       ELSE 0 END) AS under_review_amount,
              SUM(CASE WHEN ticket.settled_currency = ticket.currency
                       THEN ticket.settled_amount - ticket.net_amount ELSE 0 END) AS provider_fees,
              SUM(ticket.refunded_amount) AS refunded, SUM(ticket.refunded_amount > 0) AS refunded_count,
              SUM(CASE WHEN ticket.status = 'pending_payment' THEN ticket.amount ELSE 0 END) AS awaiting_amount,
              SUM(${TICKET_PAYMENT_UNREAD_SQL}) AS unread, SUM(${UPDATABLE_SQL}) AS updatable
       FROM registration_tickets ticket WHERE ticket.event_id = ? GROUP BY 1`,
      [event.id],
    ),
    first<{ currency: string }>(db, "SELECT currency FROM event_ticket_settings WHERE event_id = ?", [event.id]),
  ]);
  const total = (field: Exclude<keyof SummaryRow, "payment">) =>
    summary.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
  return issuedTicketsResponseSchema.parse({
    tickets: page.rows.map((row) => ({
      registrationId: row.registration_id,
      name: row.display_name,
      organizationName: row.organization_name,
      headshotUrl: publicUserHeadshotPath(row.user_id, row.headshot_r2_key),
      payment: row.payment,
      issuedAt: row.issued_at,
      ticket: decodeRegistrationTicket(row),
    })),
    page: buildPageInfo(query.limit, query.offset, page.total, page.rows.length),
    summary: {
      currency: settings?.currency ?? "usd",
      byPayment: Object.fromEntries(summary.map((row) => [row.payment, Number(row.tickets)])),
      collected: total("collected"),
      underReviewAmount: total("under_review_amount"),
      providerFees: total("provider_fees"),
      refunded: total("refunded"),
      refundedCount: total("refunded_count"),
      awaitingAmount: total("awaiting_amount"),
      unread: total("unread"),
      updatable: total("updatable"),
    },
  });
}

/**
 * Brings the next batch of the event's updatable tickets in line with the payment provider, each as an
 * organizer's single update does. A ticket the provider could not be read for is counted and left for later.
 */
export async function updateIssuedTicketsFromProvider(
  db: DatabaseLike,
  env: Pick<Env, "STRIPE_SECRET_KEY" | "STRIPE_API_BASE">,
  actor: { id: string },
  input: { eventId: string; after?: string },
  fetcher?: typeof fetch,
): Promise<IssuedTicketsUpdateResponse & { outboxIds: string[] }> {
  const batch = await all<{ id: string; registration_id: string }>(
    db,
    `SELECT ticket.id, ticket.registration_id FROM registration_tickets ticket
     WHERE ticket.event_id = ?1 AND (?2 IS NULL OR ticket.id > ?2) AND ${UPDATABLE_SQL}
     ORDER BY ticket.id LIMIT ?3`,
    [input.eventId, input.after ?? null, UPDATE_BATCH + 1],
  );
  const tickets = batch.slice(0, UPDATE_BATCH);
  const outboxIds: string[] = [];
  let changed = 0;
  let failed = 0;
  for (const ticket of tickets) {
    try {
      const synced = await syncRegistrationTicketWithProvider(
        db,
        env,
        actor,
        { eventId: input.eventId, registrationId: ticket.registration_id },
        fetcher,
      );
      if (synced.changed) changed += 1;
      outboxIds.push(...synced.outboxIds);
    } catch {
      failed += 1;
    }
  }
  return {
    success: true,
    checked: tickets.length,
    changed,
    failed,
    next: batch.length > UPDATE_BATCH ? (tickets.at(-1)?.id ?? null) : null,
    outboxIds,
  };
}
