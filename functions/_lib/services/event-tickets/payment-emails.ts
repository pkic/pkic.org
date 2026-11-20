/**
 * The emails that ask for a ticket's payment: the request sent with the
 * registration, whose confirmation is held until the payment arrives, and
 * the reminders that follow at the event's interval.
 */
import { ticketRefundNote } from "../../../../assets/shared/event-ticket-display";
import { formatCurrencyAmount } from "../../../../assets/shared/format-currency";
import { formatDateTimeInZone } from "../../../../assets/shared/format-date";
import { isStateGuardFailure, prepareStateGuard } from "../../db/authorization-guard";
import { all, first } from "../../db/queries";
import { prepareQueueEmailStatement } from "../../email/outbox";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { HELD_UNTIL_PAID, payableTicketSql, ticketPageUrl, type PayableTicketRow } from "./payment";

const DAY_MS = 86_400_000;

interface ReminderRow extends PayableTicketRow {
  reminders_sent: number;
  reminders_end_at: string | null;
  reminder_interval_days: number;
}

/** Reminds people with an unpaid ticket, at the event's interval, until its reminder period ends. Nothing is canceled. */
export async function sendTicketPaymentReminders(
  db: DatabaseLike,
  appBaseUrl: string,
  limit = 50,
): Promise<{ reminded: number }> {
  const now = nowIso();
  const due = await all<ReminderRow>(
    db,
    `${payableTicketSql(", ticket.reminders_sent, ticket.reminders_end_at, settings.reminder_interval_days")}
     WHERE ticket.status = 'pending_payment' AND ticket.next_reminder_at IS NOT NULL AND ticket.next_reminder_at <= ?
       AND registration.status NOT IN ('cancelled', 'pending_email_confirmation')
     ORDER BY ticket.next_reminder_at, ticket.id LIMIT ?`,
    [now, limit],
  );
  let reminded = 0;
  for (const ticket of due) {
    const next = new Date(Date.parse(now) + ticket.reminder_interval_days * DAY_MS).toISOString();
    const nextReminder = ticket.reminders_end_at && next <= ticket.reminders_end_at ? next : null;
    try {
      await db.batch([
        // The reminder goes out only if the ticket is still unpaid and nobody else sent this one.
        prepareStateGuard(db, {
          sql: "SELECT 1 FROM registration_tickets WHERE id = ? AND status = 'pending_payment' AND reminders_sent = ?",
          bindings: [ticket.id, ticket.reminders_sent],
        }),
        db
          .prepare(
            `UPDATE registration_tickets SET reminders_sent = reminders_sent + 1, next_reminder_at = ?, updated_at = ?
             WHERE id = ? AND status = 'pending_payment' AND reminders_sent = ?`,
          )
          .bind(nextReminder, now, ticket.id, ticket.reminders_sent),
        prepareTicketPaymentEmail(db, appBaseUrl, ticket, {
          templateKey: "ticket_payment_reminder",
          idempotencyKey: `ticket-reminder:${ticket.id}:${ticket.reminders_sent + 1}`,
        }),
      ]);
      reminded += 1;
    } catch (error) {
      if (!isStateGuardFailure(error)) throw error;
    }
  }
  return { reminded };
}

/** The stored templates that ask for a ticket's payment. Organizers edit their wording in the portal. */
export type TicketPaymentTemplate =
  | "ticket_payment_request"
  | "ticket_payment_reminder"
  | "ticket_changed_payment_request";

/** What a payment email says about the ticket: which one, what it costs, and the refund terms a payment falls under. */
export type TicketPaymentEmailTicket = Pick<
  PayableTicketRow,
  | "event_id"
  | "event_slug"
  | "event_name"
  | "ticket_name"
  | "email"
  | "amount"
  | "currency"
  | "timezone"
  | "refund_deadline"
  | "refund_fee"
> & { pay_by?: string | null };

/** The email that asks for payment: sent with the registration, again as a reminder, and after a ticket was moved. */
export function prepareTicketPaymentEmail(
  db: DatabaseLike,
  appBaseUrl: string,
  ticket: TicketPaymentEmailTicket,
  /** `outboxId` lets a caller send the email right after its write instead of on the outbox's next run. */
  message: { templateKey: TicketPaymentTemplate; idempotencyKey: string; userId?: string | null; outboxId?: string },
): StatementLike {
  return prepareQueueEmailStatement(db, {
    eventId: ticket.event_id,
    baseUrl: appBaseUrl,
    templateKey: message.templateKey,
    recipientEmail: ticket.email,
    recipientUserId: message.userId ?? undefined,
    messageType: "transactional",
    outboxId: message.outboxId ?? uuid(),
    idempotencyKey: message.idempotencyKey,
    data: {
      eventName: ticket.event_name,
      ticketName: ticket.ticket_name,
      ticketPrice: formatCurrencyAmount(ticket.amount, ticket.currency),
      paymentUrl: ticketPageUrl(appBaseUrl, ticket.event_slug),
      // The day the unpaid place is released, on the event's clock; empty for an event that keeps it.
      payBy: ticket.pay_by ? formatDateTimeInZone(ticket.pay_by, ticket.timezone) : "",
      refundPolicy: ticketRefundNote(
        {
          refundableUntil: ticket.refund_deadline,
          refundFee: ticket.refund_deadline ? ticket.refund_fee : 0,
          currency: ticket.currency,
        },
        ticket.timezone,
      ),
    },
  }).statement;
}

/**
 * Holds a registration's confirmation email until its ticket is paid and asks
 * for the payment instead. Returns nothing when the ticket has nothing to pay.
 * The statements run after the one that queues the confirmation, in its batch.
 */
export async function prepareHoldConfirmationForPayment(
  db: DatabaseLike,
  appBaseUrl: string,
  input: { registrationId: string; outboxId: string; userId?: string | null },
): Promise<StatementLike[]> {
  const ticket = await first<PayableTicketRow>(
    db,
    `${payableTicketSql()} WHERE ticket.registration_id = ? AND ticket.status = 'pending_payment'`,
    [input.registrationId],
  );
  if (!ticket) return [];
  const now = nowIso();
  return [
    db
      .prepare(
        `UPDATE email_outbox SET send_after = ?, updated_at = ? WHERE id = ? AND status = 'queued'
           AND EXISTS (SELECT 1 FROM registration_tickets WHERE id = ? AND status = 'pending_payment')`,
      )
      .bind(HELD_UNTIL_PAID, now, input.outboxId, ticket.id),
    db
      .prepare("UPDATE registration_tickets SET held_email_id = ? WHERE id = ? AND status = 'pending_payment'")
      .bind(input.outboxId, ticket.id),
    prepareTicketPaymentEmail(db, appBaseUrl, ticket, {
      templateKey: "ticket_payment_request",
      idempotencyKey: `ticket-payment:${ticket.id}:confirmed`,
      userId: input.userId,
    }),
  ];
}
