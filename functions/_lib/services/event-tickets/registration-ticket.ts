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
import { ticketPaymentProcessingSql } from "./payment";
import { refundDeadlineSql } from "./refund-policy";
import { OPEN_REFUND_SQL } from "./refunds";
import { prepareRepriceTicketForDays } from "./reprice";
import { eventSellsTickets, readEventTicketSnapshot } from "./snapshot";

export interface IssuedRegistrationTicket {
  id: string;
  ticketName: string;
  amount: number;
  currency: string;
  status: Extract<RegistrationTicketStatus, "free" | "pending_payment" | "paid">;
  statements: StatementLike[];
  /** The code this plan claims a pass of, when it claims one: its last pass may go to someone else first. */
  claimedCodeId?: string | null;
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
  refund_unsettled: number;
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
            ticket.amount, ticket.currency, type.ticket_key, type.name AS ticket_name,
            (ticket.refund_reconcile_at IS NOT NULL
             OR EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                        WHERE refund.ticket_id = ticket.id AND ${OPEN_REFUND_SQL})) AS refund_unsettled
     FROM registration_tickets ticket JOIN event_ticket_types type ON type.id = ticket.ticket_type_id
     WHERE ticket.registration_id = ? AND ticket.status <> 'canceled'`,
    [input.registrationId],
  );
  const clearSelection = db
    .prepare("DELETE FROM event_ticket_selections WHERE event_id = ? AND user_id = ?")
    .bind(input.event.id, input.userId);
  // While what its payment returned is still being read from the provider, the ticket keeps its payment:
  // replacing it now would cut the ticket loose from that payment before the answer is in.
  if (held?.refund_unsettled)
    throw new AppError(
      409,
      "TICKET_REFUND_PENDING",
      "A refund for this ticket is still being checked. Try again in a few minutes.",
    );
  // A paid ticket is settled: it is neither priced again nor replaced. It covers what was paid for, so
  // registering again for days that cost more is refused.
  if (held?.status === "paid") {
    await prepareRepriceTicketForDays(db, {
      eventId: input.event.id,
      registrationId: input.registrationId,
      userId: input.userId,
      dayAttendance: input.dayAttendance,
      restoring: false,
      byOrganizer: false,
      now: nowIso(),
    });
    return {
      id: held.id,
      ticketName: held.ticket_name,
      amount: held.amount,
      currency: held.currency,
      status: "paid",
      statements: [clearSelection],
    };
  }
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
    // A payment that settles while this plan is made keeps the ticket as paid for, and a refund that fails
    // meanwhile keeps it for the reading that follows: then none of the plan
    // is written, neither its code uses nor a confirmation held for a payment that already arrived.
    prepareStateGuard(db, {
      sql: `SELECT 1 WHERE NOT EXISTS
              (SELECT 1 FROM registration_tickets
               WHERE registration_id = ? AND (status = 'paid' OR refund_reconcile_at IS NOT NULL))`,
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
    // A pass is claimed only while one is left: when the last one went to someone else meanwhile, or the
    // code was revoked, the guard refuses the whole plan.
    statements.push(
      prepareStateGuard(db, {
        sql: "SELECT 1 FROM event_ticket_codes WHERE id = ? AND revoked_at IS NULL AND used_count < max_uses",
        bindings: [resolved.code.id],
      }),
      db
        .prepare(
          `UPDATE event_ticket_codes SET used_count = used_count + 1, updated_at = ?
           WHERE id = ? AND revoked_at IS NULL AND used_count < max_uses`,
        )
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
           paid_at = NULL, payment_intent_id = NULL, paid_amount = 0, kept_fee = 0, refunded_amount = 0,
           refund_until = NULL, refund_fee = 0, refunds_seen_at = NULL,
           refund_reconcile_at = NULL,
           revision = registration_tickets.revision + 1, updated_at = excluded.updated_at
         WHERE registration_tickets.status NOT IN ('paid') AND registration_tickets.refund_reconcile_at IS NULL`,
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
  return {
    id,
    ticketName: resolved.type.name,
    amount: priced.total,
    currency: settings.currency,
    status,
    statements,
    claimedCodeId: resolved.code && resolved.code.id !== held?.code_id ? resolved.code.id : null,
  };
}

/** Whether a registration's ticket still waits for payment, for a query that holds the registration's id. */
export const ticketPaymentDueSql = (registrationId: string) =>
  `EXISTS (SELECT 1 FROM registration_tickets due WHERE due.registration_id = ${registrationId} AND due.status = 'pending_payment')`;

/** Whether that payment was made by a method that takes days and is on its way. */
export const ticketPaymentOnItsWaySql = (registrationId: string) =>
  `EXISTS (SELECT 1 FROM registration_tickets due WHERE due.registration_id = ${registrationId}
           AND due.status = 'pending_payment' AND ${ticketPaymentProcessingSql("due.id")})`;

/** What is still owed for a registration's ticket; no row when nothing is. */
export interface TicketPaymentDue {
  amount: number;
  currency: string;
  /** The payment was made and has not arrived yet (1), so nothing more is asked. */
  processing?: number;
}

export function prepareTicketPaymentDue(db: DatabaseLike, registrationId: string): StatementLike {
  return db
    .prepare(
      `SELECT amount, currency, ${ticketPaymentProcessingSql("registration_tickets.id")} AS processing
       FROM registration_tickets WHERE registration_id = ? AND status = 'pending_payment'`,
    )
    .bind(registrationId);
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

/**
 * Whether a refused plan lost its code's last pass: asked after the plan's write was refused, to tell the
 * person that and not that something else changed.
 */
export async function isTicketCodeSpent(db: DatabaseLike, codeId: string | null | undefined): Promise<boolean> {
  if (!codeId) return false;
  return Boolean(
    await first(
      db,
      "SELECT 1 FROM event_ticket_codes WHERE id = ? AND (used_count >= max_uses OR revoked_at IS NOT NULL)",
      [codeId],
    ),
  );
}

export function ticketCodeExhaustedError(): AppError {
  return new AppError(
    409,
    "TICKET_CODE_USED_UP",
    "Every pass on this code has just been claimed. Register again without it or ask for another code.",
  );
}

export interface TicketReadRow {
  payment_processing: number;
  payment_method: string | null;
  net_amount: number | null;
  receipt_url: string | null;
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
  paid_amount: number;
  refund_pending: number;
  refund_failed: number;
  payment_reference: string | null;
  refund_deadline: string | null;
  refund_fee: number;
}

/**
 * The columns of a ticket's read model and the tables they come from, apart so a list can join and page them.
 * What arrived after the provider's costs is given only when the provider settled in the ticket's own currency.
 */
export const REGISTRATION_TICKET_COLUMNS_SQL = `ticket.id, type.ticket_key, type.name AS ticket_name, ticket.assignment_source, ticket.status,
         ticket.amount, ticket.currency, code.label AS code_label, ticket.paid_at, ticket.dispute_reason,
         ticket.dispute_resolved_at,
         ticket.refunded_amount, ticket.paid_amount,
         (ticket.status = 'pending_payment' AND ${ticketPaymentProcessingSql("ticket.id")}) AS payment_processing,
         (ticket.refund_reconcile_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                     WHERE refund.ticket_id = ticket.id AND ${OPEN_REFUND_SQL})) AS refund_pending,
         COALESCE((SELECT refund.failed_at IS NOT NULL FROM registration_ticket_refunds refund
                   WHERE refund.ticket_id = ticket.id ORDER BY refund.created_at DESC, refund.id DESC LIMIT 1), 0)
           AS refund_failed,
         (SELECT checkout.payment_intent_id FROM registration_ticket_checkouts checkout
          WHERE checkout.ticket_id = ticket.id AND checkout.payment_intent_id IS NOT NULL
          ORDER BY checkout.created_at DESC LIMIT 1) AS payment_reference,
         CASE WHEN ticket.paid_at IS NOT NULL THEN ticket.refund_until
              ELSE ${refundDeadlineSql("settings", "event")} END AS refund_deadline,
         CASE WHEN ticket.paid_at IS NOT NULL THEN ticket.refund_fee ELSE COALESCE(settings.refund_fee, 0) END
           AS refund_fee,
         ticket.payment_method, ticket.receipt_url,
         CASE WHEN ticket.settled_currency = ticket.currency THEN ticket.net_amount END AS net_amount`;

export const REGISTRATION_TICKET_FROM_SQL = `
  FROM registration_tickets ticket
  JOIN event_ticket_types type ON type.id = ticket.ticket_type_id
  JOIN events event ON event.id = ticket.event_id
  LEFT JOIN event_ticket_settings settings ON settings.event_id = ticket.event_id
  LEFT JOIN event_ticket_codes code ON code.id = ticket.code_id`;

export const REGISTRATION_TICKET_READ_SQL = `SELECT ${REGISTRATION_TICKET_COLUMNS_SQL}${REGISTRATION_TICKET_FROM_SQL}`;

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
    refundPending: row.refund_pending === 1,
    refundFailed: row.refund_failed === 1,
    paymentProcessing: row.payment_processing === 1,
    refundedAmount: row.refunded_amount,
    paidAmount: row.paid_amount,
    paymentReference: row.payment_reference,
    paymentMethod: row.payment_method,
    netAmount: row.net_amount,
    receiptUrl: row.receipt_url,
    refundableUntil: row.refund_deadline,
    refundFee: row.refund_deadline ? row.refund_fee : 0,
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

/** A canceled ticket whose code can no longer give it a pass: every pass was claimed meanwhile, or the code was revoked. */
const RESTORE_CODE_SPENT_SQL = `SELECT 1 FROM registration_tickets ticket JOIN event_ticket_codes code ON code.id = ticket.code_id
  WHERE ticket.registration_id = ? AND ticket.status = 'canceled'
    AND (code.used_count >= code.max_uses OR code.revoked_at IS NOT NULL)`;

/**
 * Refuses the restore of a registration whose ticket came from a code that has no pass left for it, or whose
 * ticket has money on its way back: until that is settled, what the ticket stands for is not known.
 */
export async function assertRegistrationTicketRestorable(db: DatabaseLike, registrationId: string): Promise<void> {
  if (
    await first(
      db,
      `SELECT 1 FROM registration_tickets ticket
       WHERE ticket.registration_id = ?
         AND (ticket.refund_reconcile_at IS NOT NULL
              OR EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                         WHERE refund.ticket_id = ticket.id AND ${OPEN_REFUND_SQL}))`,
      [registrationId],
    )
  )
    throw new AppError(
      409,
      "TICKET_REFUND_PENDING",
      "A refund for this ticket is still being processed. Try again in a few minutes.",
    );
  if (await first(db, RESTORE_CODE_SPENT_SQL, [registrationId]))
    throw new AppError(
      409,
      "TICKET_CODE_USED_UP",
      "The code this ticket was issued with has no pass left. Ask the person to register again.",
    );
}

/**
 * What restoring a canceled registration does to its ticket: it holds the same
 * ticket again at the price it had, free or still to be paid, and takes its
 * code's pass back. A ticket that was refunded when the registration was
 * canceled is to be paid again, and its payment reminders start over: the
 * email about the restored registration asks for the payment first. Without a
 * pass to take back nothing of the restore is written. A ticket that was never
 * canceled is untouched.
 */
export function prepareRestoreRegistrationTicket(
  db: DatabaseLike,
  registrationId: string,
  now: string,
): StatementLike[] {
  // The event's reminder interval and period, counted from the restore; no period means no reminders.
  const reminderAt = (days: string) =>
    `CASE WHEN amount = 0 THEN NULL ELSE (
       SELECT CASE WHEN settings.reminder_period_days > 0
                   THEN strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+' || settings.${days} || ' days') END
       FROM event_ticket_settings settings WHERE settings.event_id = registration_tickets.event_id) END`;
  return [
    // The pass may have gone to someone else since the check; then the ticket must not come back at the code's price.
    prepareStateGuard(db, {
      sql: `SELECT 1 WHERE NOT EXISTS (${RESTORE_CODE_SPENT_SQL})`,
      bindings: [registrationId],
    }),
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
           reminders_sent = 0, next_reminder_at = ${reminderAt("reminder_interval_days")},
           reminders_end_at = ${reminderAt("reminder_period_days")},
           paid_at = NULL, payment_intent_id = NULL, paid_amount = 0, kept_fee = 0, refunded_amount = 0,
           refund_until = NULL, refund_fee = 0, refunds_seen_at = NULL,
           refund_reconcile_at = NULL, revision = revision + 1, updated_at = ?
         WHERE registration_id = ? AND status IN ('canceled', 'refunded') AND refund_reconcile_at IS NULL`,
      )
      .bind(now, now, now, registrationId),
  ];
}
