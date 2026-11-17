/**
 * The emails that ask for a ticket's payment: the request sent with the
 * registration, whose confirmation is held until the payment arrives, and
 * the reminders that follow at the event's interval.
 */
import { formatCurrencyAmount } from "../../../../assets/shared/format-currency";
import { isStateGuardFailure, prepareStateGuard } from "../../db/authorization-guard";
import { all, first } from "../../db/queries";
import { DIRECT_EMAIL_TEMPLATE_KEY, directEmailBodyPayload } from "../../email/direct-body";
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
    const price = formatCurrencyAmount(ticket.amount, ticket.currency);
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
          subject: `Reminder: pay for your ${ticket.event_name} ticket`,
          lead: `Your ${ticket.ticket_name} ticket for ${ticket.event_name} is still waiting for payment of ${price}.`,
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

/** The email that asks for payment: sent with the registration, and again as a reminder. */
export function prepareTicketPaymentEmail(
  db: DatabaseLike,
  appBaseUrl: string,
  ticket: Pick<PayableTicketRow, "event_id" | "event_slug" | "event_name" | "ticket_name" | "email">,
  message: { subject: string; lead: string; idempotencyKey: string; userId?: string | null },
): StatementLike {
  const url = ticketPageUrl(appBaseUrl, ticket.event_slug);
  return prepareQueueEmailStatement(db, {
    eventId: ticket.event_id,
    baseUrl: appBaseUrl,
    templateKey: DIRECT_EMAIL_TEMPLATE_KEY,
    recipientEmail: ticket.email,
    recipientUserId: message.userId ?? undefined,
    messageType: "transactional",
    subject: message.subject,
    outboxId: uuid(),
    idempotencyKey: message.idempotencyKey,
    data: directEmailBodyPayload(
      `${message.lead}\n\n[Pay for your ticket](${url})\n\nYour registration is confirmed once the payment arrives. To cancel instead, open your registration in the portal.`,
    ),
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
      subject: `Pay for your ${ticket.event_name} ticket`,
      lead: `Thank you for registering for ${ticket.event_name}. Your ${ticket.ticket_name} ticket costs ${formatCurrencyAmount(ticket.amount, ticket.currency)}.`,
      idempotencyKey: `ticket-payment:${ticket.id}:confirmed`,
      userId: input.userId,
    }),
  ];
}
