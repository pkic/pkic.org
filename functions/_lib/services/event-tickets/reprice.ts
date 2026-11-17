/**
 * What a change of days does to the ticket a registration holds. A ticket is
 * priced for the days and ways of attending it was issued for, and admission
 * only asks whether it is free or paid. So when those days change, the ticket
 * is priced again in the same write: otherwise a person could register for
 * what costs nothing and then move to what costs money.
 */
import { formatCurrencyAmount } from "../../../../assets/shared/format-currency";
import { ticketReminderSchedule } from "../../../../assets/shared/event-tickets";
import { prepareStateGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { priceTicket, readTicketPerson, type TicketCodeRow } from "./assignment";
import { prepareRefundDifference } from "./refund-policy";
import { OPEN_REFUND_SQL } from "./refunds";
import { readEventTicketSnapshot } from "./snapshot";

interface HeldRow {
  id: string;
  status: string;
  amount: number;
  paid_amount: number;
  refunded_amount: number;
  kept_fee: number;
  refund_fee: number;
  refund_unsettled: number;
  refund_deadline: string | null;
  currency: string;
  ticket_type_id: string;
  code_id: string | null;
  timezone: string;
  email: string;
  identity_id: string | null;
}

const OPEN_STATUSES = ["free", "pending_payment"];

export async function prepareRepriceTicketForDays(
  db: DatabaseLike,
  input: {
    eventId: string;
    registrationId: string;
    userId: string;
    dayAttendance: ReadonlyArray<{ dayDate: string; attendanceType: string }>;
    /** The registration is being restored in this write, so its canceled ticket is held again. */
    restoring: boolean;
    /** An organizer makes the change; they may give days a paid ticket did not pay for. */
    byOrganizer: boolean;
    now: string;
  },
): Promise<StatementLike[]> {
  const held = await first<HeldRow>(
    db,
    `SELECT ticket.id, ticket.status, ticket.amount, ticket.paid_amount, ticket.refunded_amount, ticket.kept_fee,
            ticket.refund_fee, ticket.currency,
            ticket.ticket_type_id,
            ticket.code_id, event.timezone, user.email, registration.registration_identity_id AS identity_id,
            (ticket.refund_reconcile_at IS NOT NULL
             OR EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                        WHERE refund.ticket_id = ticket.id AND ${OPEN_REFUND_SQL})) AS refund_unsettled,
            ticket.refund_until AS refund_deadline
     FROM registration_tickets ticket
     JOIN registrations registration ON registration.id = ticket.registration_id
     JOIN events event ON event.id = ticket.event_id
     JOIN users user ON user.id = registration.user_id
     WHERE ticket.registration_id = ? AND ticket.event_id = ?`,
    [input.registrationId, input.eventId],
  );
  // A registration without a ticket was made before the event had any; nothing was priced for it.
  if (!held) return [];
  const open =
    OPEN_STATUSES.includes(held.status) || (input.restoring && ["canceled", "refunded"].includes(held.status));
  // A refunded or canceled ticket admits nobody, whatever the days.
  if (!open && held.status !== "paid") return [];
  const snapshot = await readEventTicketSnapshot(db, { id: input.eventId, timezone: held.timezone });
  const type = snapshot.types.find((candidate) => candidate.id === held.ticket_type_id);
  if (!type || !snapshot.settings) return [];
  const code = held.code_id
    ? await first<TicketCodeRow>(
        db,
        `SELECT id, ticket_type_id, label, amount, percent_off, max_uses, used_count, revoked_at
         FROM event_ticket_codes WHERE id = ?`,
        [held.code_id],
      )
    : null;
  const person = await readTicketPerson(db, {
    userId: input.userId,
    accountEmail: held.email,
    identityId: held.identity_id,
  });
  const total = priceTicket(snapshot, { type, code }, person, input.dayAttendance).total;
  if (held.status === "paid") {
    // What is left of the payment that still stands for something: fees kept from earlier refunds do not.
    const net = held.paid_amount - held.refunded_amount - held.kept_fee;
    // What the ticket stands for: its price now, or more if more of the payment is left.
    const covered = Math.max(held.amount, net);
    // While money is on its way back, what the ticket stands for is not settled.
    if (held.refund_unsettled)
      throw new AppError(
        409,
        "TICKET_REFUND_PENDING",
        "A refund for this ticket is still being processed. Try again in a few minutes.",
      );
    if (total > covered) {
      // An organizer may give days the ticket did not pay for; the person may not take them.
      if (input.byOrganizer) return [];
      throw new AppError(
        409,
        "TICKET_CHANGE_COSTS_MORE",
        `These days cost ${formatCurrencyAmount(total, held.currency)} and your ticket covers ${formatCurrencyAmount(covered, held.currency)}. Ask the organizers to change your registration.`,
      );
    }
    // Days that cost less return the difference, less the fee, while the refund period the ticket was paid under runs.
    // After the period, or when the fee is all there is, nothing goes back.
    const fee = held.refund_fee;
    const within = held.refund_deadline !== null && held.refund_deadline >= input.now;
    const refund = within ? net - total - fee : 0;
    if (total === held.amount && refund <= 0) return [];
    return [
      // The ticket is changed only as it was priced here; otherwise nothing of the change is written.
      prepareStateGuard(db, {
        sql: `SELECT 1 FROM registration_tickets ticket
              WHERE ticket.id = ? AND ticket.status = 'paid' AND ticket.amount = ?
                AND ticket.paid_amount - ticket.refunded_amount - ticket.kept_fee = ?
                AND ticket.refund_reconcile_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                                WHERE refund.ticket_id = ticket.id AND ${OPEN_REFUND_SQL})`,
        bindings: [held.id, held.amount, net],
      }),
      // The ticket costs what its days cost now. It stays paid: nothing more is owed for it.
      db
        .prepare(
          "UPDATE registration_tickets SET amount = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'paid'",
        )
        .bind(total, input.now, held.id),
      ...(refund > 0
        ? prepareRefundDifference(db, {
            ticketId: held.id,
            net: held.paid_amount - held.refunded_amount,
            refund,
            fee,
            now: input.now,
          })
        : []),
    ];
  }
  const status = total > 0 ? "pending_payment" : "free";
  const restored = held.amount > 0 ? "pending_payment" : "free";
  if (total === held.amount && status === (input.restoring ? restored : held.status)) return [];
  const settings = snapshot.settings;
  const reminders = ticketReminderSchedule(
    { intervalDays: settings.reminder_interval_days, periodDays: settings.reminder_period_days },
    input.now,
    status === "pending_payment",
  );
  const statements: StatementLike[] = [
    // A payment that settled meanwhile keeps the ticket as paid for; then none of this change is written.
    prepareStateGuard(db, {
      sql: "SELECT 1 FROM registration_tickets WHERE id = ? AND status IN ('free', 'pending_payment')",
      bindings: [held.id],
    }),
  ];
  // A ticket that no longer costs anything has no payment to wait for: its held confirmation goes out.
  if (status === "free")
    statements.push(
      db
        .prepare(
          `UPDATE email_outbox SET send_after = ?, updated_at = ?
           WHERE id = (SELECT held_email_id FROM registration_tickets WHERE id = ?) AND status = 'queued'`,
        )
        .bind(input.now, input.now, held.id),
    );
  statements.push(
    // The person is asked for the new amount on the next run of the payment reminders, not days later.
    db
      .prepare(
        `UPDATE registration_tickets SET amount = ?, currency = ?, status = ?, reminders_sent = 0,
           next_reminder_at = ?, reminders_end_at = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND status IN ('free', 'pending_payment')`,
      )
      .bind(
        total,
        settings.currency,
        status,
        reminders.remindersEndAt ? input.now : null,
        reminders.remindersEndAt,
        input.now,
        held.id,
      ),
  );
  return statements;
}
