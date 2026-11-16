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
import { readEventTicketSnapshot } from "./snapshot";

interface HeldRow {
  id: string;
  status: string;
  amount: number;
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
    `SELECT ticket.id, ticket.status, ticket.amount, ticket.currency, ticket.ticket_type_id, ticket.code_id,
            event.timezone, user.email, registration.registration_identity_id AS identity_id
     FROM registration_tickets ticket
     JOIN registrations registration ON registration.id = ticket.registration_id
     JOIN events event ON event.id = ticket.event_id
     JOIN users user ON user.id = registration.user_id
     WHERE ticket.registration_id = ? AND ticket.event_id = ?`,
    [input.registrationId, input.eventId],
  );
  // A registration without a ticket was made before the event had any; nothing was priced for it.
  if (!held) return [];
  const open = OPEN_STATUSES.includes(held.status) || (input.restoring && held.status === "canceled");
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
    // What was paid covers these days, or an organizer decides: the ticket stands as it is.
    if (total <= held.amount || input.byOrganizer) return [];
    throw new AppError(
      409,
      "TICKET_CHANGE_COSTS_MORE",
      `These days cost ${formatCurrencyAmount(total, held.currency)} and your ticket was paid at ${formatCurrencyAmount(held.amount, held.currency)}. Ask the organizers to change your registration.`,
    );
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
