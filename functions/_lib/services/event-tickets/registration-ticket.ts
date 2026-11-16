/**
 * The ticket a registration holds: issued in the registration's own batch,
 * with the price fixed at that moment and a code's use counted with it.
 */
import type { RegistrationTicket } from "../../../../assets/shared/schemas/event-tickets";
import {
  ticketReminderSchedule,
  type RegistrationTicketStatus,
  type TicketAssignmentSource,
} from "../../../../assets/shared/event-tickets";
import { prepareStateGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, Env, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { priceTicket, readTicketPerson, resolveTicket } from "./assignment";
import { eventSellsTickets, readEventTicketSnapshot } from "./snapshot";

export interface IssuedRegistrationTicket {
  id: string;
  ticketName: string;
  amount: number;
  currency: string;
  status: Extract<RegistrationTicketStatus, "free" | "pending_payment" | "paid">;
  statements: StatementLike[];
}

interface SelectionRow {
  ticket_key: string | null;
  code_id: string | null;
  dispute_reason: string | null;
}

/** The ticket a registration already holds when it is planned again. */
interface HeldTicketRow extends SelectionRow {
  id: string;
  status: string;
  assignment_source: string;
  ticket_name: string;
  amount: number;
  currency: string;
}

/**
 * Plans the ticket for a registration that is about to be saved. Returns null
 * when the event sells no tickets, so registration is unchanged for it.
 */
export async function planRegistrationTicket(
  db: DatabaseLike,
  env: Pick<Env, "AI" | "TICKET_CLASSIFIER_MODEL">,
  input: {
    event: { id: string; timezone: string };
    registrationId: string;
    userId: string;
    email: string;
    identityId: string | null;
    organizationName?: string | null;
    dayAttendance: ReadonlyArray<{ dayDate: string; attendanceType: string }>;
    /** Records where the confirmation email is held until a paid ticket settles. */
    heldEmailId?: string | null;
  },
): Promise<IssuedRegistrationTicket | null> {
  const snapshot = await readEventTicketSnapshot(db, input.event);
  if (!eventSellsTickets(snapshot) || !input.dayAttendance.length) return null;
  const selection = await first<SelectionRow>(
    db,
    `SELECT type.ticket_key, selection.code_id, selection.dispute_reason
     FROM event_ticket_selections selection
     LEFT JOIN event_ticket_types type ON type.id = selection.ticket_type_id
     WHERE selection.event_id = ? AND selection.user_id = ?`,
    [input.event.id, input.userId],
  );
  // A registration that is submitted again without going through the ticket step keeps the code, the
  // choice and the reason of the ticket it holds. A canceled ticket gave its code back and holds nothing.
  const held = await first<HeldTicketRow>(
    db,
    `SELECT ticket.id, ticket.status, ticket.assignment_source, ticket.code_id, ticket.dispute_reason,
            ticket.amount, ticket.currency, type.ticket_key, type.name AS ticket_name
     FROM registration_tickets ticket JOIN event_ticket_types type ON type.id = ticket.ticket_type_id
     WHERE ticket.registration_id = ? AND ticket.status <> 'canceled'`,
    [input.registrationId],
  );
  const clearSelection = db
    .prepare("DELETE FROM event_ticket_selections WHERE event_id = ? AND user_id = ?")
    .bind(input.event.id, input.userId);
  // A paid ticket is settled: it is neither priced again nor replaced.
  if (held?.status === "paid")
    return {
      id: held.id,
      ticketName: held.ticket_name,
      amount: held.amount,
      currency: held.currency,
      status: "paid",
      statements: [clearSelection],
    };
  const kept: SelectionRow | null =
    selection ??
    (held
      ? {
          code_id: held.code_id,
          ticket_key: ["chosen", "disputed"].includes(held.assignment_source) ? held.ticket_key : null,
          dispute_reason: held.dispute_reason,
        }
      : null);
  // The ticket is priced for the identity the registration is made as, as the quote was.
  const identityPerson = await readTicketPerson(db, {
    userId: input.userId,
    accountEmail: input.email,
    identityId: input.identityId,
  });
  const person = { ...identityPerson, organizationName: input.organizationName ?? identityPerson.organizationName };
  const resolved = await resolveTicket(db, env, input.event, snapshot, person, {
    ticketKey: kept?.code_id ? null : kept?.ticket_key,
    codeId: kept?.code_id,
    disputeReason: kept?.dispute_reason,
    // A code this registration already holds is not claimed a second time, so its limit does not refuse it.
    heldCodeId: held?.code_id,
  });
  const priced = priceTicket(snapshot, resolved, person, input.dayAttendance);
  const settings = snapshot.settings!;
  const now = nowIso();
  const id = uuid();
  const status = priced.total > 0 ? "pending_payment" : "free";
  const { nextReminderAt: nextReminder, remindersEndAt: remindersEnd } = ticketReminderSchedule(
    { intervalDays: settings.reminder_interval_days, periodDays: settings.reminder_period_days },
    now,
    status === "pending_payment",
  );
  const statements: StatementLike[] = [
    // A payment that settles while this plan is made keeps the ticket as paid for: then none of the plan
    // is written, neither its code uses nor a confirmation held for a payment that already arrived.
    prepareStateGuard(db, {
      sql: `SELECT 1 WHERE NOT EXISTS
              (SELECT 1 FROM registration_tickets WHERE registration_id = ? AND status = 'paid')`,
      bindings: [input.registrationId],
    }),
  ];
  // A code the registration held and no longer uses gives its pass back.
  if (held?.code_id && held.code_id !== resolved.code?.id)
    statements.push(
      db
        .prepare(
          "UPDATE event_ticket_codes SET used_count = used_count - 1, updated_at = ? WHERE id = ? AND used_count > 0",
        )
        .bind(now, held.code_id),
    );
  if (resolved.code && resolved.code.id !== held?.code_id) {
    // The CHECK on `used_count <= max_uses` aborts the batch when the last pass went to someone else meanwhile.
    statements.push(
      prepareStateGuard(db, {
        sql: "SELECT 1 FROM event_ticket_codes WHERE id = ? AND revoked_at IS NULL",
        bindings: [resolved.code.id],
      }),
      db
        .prepare("UPDATE event_ticket_codes SET used_count = used_count + 1, updated_at = ? WHERE id = ?")
        .bind(now, resolved.code.id),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO registration_tickets
           (id, registration_id, event_id, ticket_type_id, assignment_source, code_id, amount, currency, status,
            dispute_reason, held_email_id, next_reminder_at, reminders_end_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(registration_id) DO UPDATE SET
           ticket_type_id = excluded.ticket_type_id, assignment_source = excluded.assignment_source,
           code_id = excluded.code_id, amount = excluded.amount, currency = excluded.currency,
           status = excluded.status, dispute_reason = excluded.dispute_reason, dispute_resolved_at = NULL,
           held_email_id = excluded.held_email_id, reminders_sent = 0,
           next_reminder_at = excluded.next_reminder_at, reminders_end_at = excluded.reminders_end_at,
           paid_at = NULL, revision = registration_tickets.revision + 1, updated_at = excluded.updated_at
         WHERE registration_tickets.status NOT IN ('paid')`,
      )
      .bind(
        id,
        input.registrationId,
        input.event.id,
        resolved.type.id,
        resolved.source,
        resolved.code?.id ?? null,
        priced.total,
        settings.currency,
        status,
        resolved.disputeReason,
        status === "pending_payment" ? (input.heldEmailId ?? null) : null,
        nextReminder,
        remindersEnd,
        now,
        now,
      ),
    clearSelection,
  );
  return { id, ticketName: resolved.type.name, amount: priced.total, currency: settings.currency, status, statements };
}

/**
 * What cancelling a registration does to its ticket: one that is free or
 * unpaid is canceled, gives its code's pass back and drops the confirmation
 * held for payment. A paid ticket stays paid until an organizer refunds it.
 */
export function prepareCancelRegistrationTicket(
  db: DatabaseLike,
  registrationId: string,
  now: string,
): StatementLike[] {
  const open = "registration_id = ? AND status IN ('free', 'pending_payment')";
  return [
    db
      .prepare(
        `UPDATE event_ticket_codes SET used_count = used_count - 1, updated_at = ?
         WHERE used_count > 0 AND id = (SELECT code_id FROM registration_tickets WHERE ${open})`,
      )
      .bind(now, registrationId),
    db
      .prepare(
        `UPDATE email_outbox SET status = 'cancelled', updated_at = ?
         WHERE status = 'queued' AND id = (SELECT held_email_id FROM registration_tickets WHERE ${open})`,
      )
      .bind(now, registrationId),
    db
      .prepare(
        `UPDATE registration_tickets SET status = 'canceled', next_reminder_at = NULL, held_email_id = NULL,
           revision = revision + 1, updated_at = ?
         WHERE ${open}`,
      )
      .bind(now, registrationId),
  ];
}

export function isTicketCodeExhausted(error: unknown): boolean {
  return (
    error instanceof Error &&
    /CHECK constraint failed/i.test(error.message) &&
    /used_count|event_ticket_codes/i.test(error.message)
  );
}

export function ticketCodeExhaustedError(): AppError {
  return new AppError(
    409,
    "TICKET_CODE_USED_UP",
    "Every pass on this code has just been claimed. Register again without it or ask for another code.",
  );
}

interface TicketReadRow {
  id: string;
  ticket_key: string;
  ticket_name: string;
  assignment_source: string;
  status: string;
  amount: number;
  currency: string;
  code_label: string | null;
  paid_at: string | null;
  dispute_reason: string | null;
  dispute_resolved_at: string | null;
  refunded_amount: number;
  refund_pending: number;
  payment_reference: string | null;
}

export const REGISTRATION_TICKET_READ_SQL = `
  SELECT ticket.id, type.ticket_key, type.name AS ticket_name, ticket.assignment_source, ticket.status,
         ticket.amount, ticket.currency, code.label AS code_label, ticket.paid_at, ticket.dispute_reason,
         ticket.dispute_resolved_at,
         COALESCE((SELECT SUM(refund.amount) FROM registration_ticket_refunds refund
                   WHERE refund.ticket_id = ticket.id AND refund.completed_at IS NOT NULL
                     AND refund.provider_refund_id IS NOT NULL), 0) AS refunded_amount,
         EXISTS (SELECT 1 FROM registration_ticket_refunds refund WHERE refund.ticket_id = ticket.id) AS refund_pending,
         (SELECT checkout.payment_intent_id FROM registration_ticket_checkouts checkout
          WHERE checkout.ticket_id = ticket.id AND checkout.payment_intent_id IS NOT NULL
          ORDER BY checkout.created_at DESC LIMIT 1) AS payment_reference
  FROM registration_tickets ticket
  JOIN event_ticket_types type ON type.id = ticket.ticket_type_id
  LEFT JOIN event_ticket_codes code ON code.id = ticket.code_id`;

export function decodeRegistrationTicket(row: TicketReadRow | null): RegistrationTicket | null {
  if (!row) return null;
  return {
    id: row.id,
    ticketKey: row.ticket_key,
    ticketName: row.ticket_name,
    source: row.assignment_source as TicketAssignmentSource,
    status: row.status as RegistrationTicketStatus,
    amount: row.amount,
    currency: row.currency,
    codeLabel: row.code_label,
    paidAt: row.paid_at,
    disputed: Boolean(row.dispute_reason) && !row.dispute_resolved_at,
    disputeReason: row.dispute_reason && !row.dispute_resolved_at ? row.dispute_reason : null,
    refundPending: row.status === "paid" && row.refund_pending === 1,
    refundedAmount: row.refunded_amount,
    paymentReference: row.payment_reference,
  };
}

export async function readRegistrationTicket(
  db: DatabaseLike,
  input: { eventId: string; registrationId: string },
): Promise<RegistrationTicket | null> {
  return decodeRegistrationTicket(
    await first<TicketReadRow>(
      db,
      `${REGISTRATION_TICKET_READ_SQL} WHERE ticket.event_id = ? AND ticket.registration_id = ?`,
      [input.eventId, input.registrationId],
    ),
  );
}

/** Who a registration belongs to, so a route can tell its owner from an organizer. */
export async function readRegistrationOwner(
  db: DatabaseLike,
  input: { eventId: string; registrationId: string },
): Promise<string | null> {
  const row = await first<{ user_id: string }>(db, "SELECT user_id FROM registrations WHERE id = ? AND event_id = ?", [
    input.registrationId,
    input.eventId,
  ]);
  return row?.user_id ?? null;
}

/**
 * What restoring a canceled registration does to its ticket: it holds the same
 * ticket again at the price it had, free or still to be paid, and takes its
 * code's pass back while one is left. A ticket that was never canceled is untouched.
 */
export function prepareRestoreRegistrationTicket(
  db: DatabaseLike,
  registrationId: string,
  now: string,
): StatementLike[] {
  return [
    db
      .prepare(
        `UPDATE event_ticket_codes SET used_count = used_count + 1, updated_at = ?
         WHERE used_count < max_uses AND revoked_at IS NULL
           AND id = (SELECT code_id FROM registration_tickets WHERE registration_id = ? AND status = 'canceled')`,
      )
      .bind(now, registrationId),
    db
      .prepare(
        `UPDATE registration_tickets SET status = CASE WHEN amount = 0 THEN 'free' ELSE 'pending_payment' END,
           reminders_sent = 0, revision = revision + 1, updated_at = ?
         WHERE registration_id = ? AND status = 'canceled'`,
      )
      .bind(now, registrationId),
  ];
}
