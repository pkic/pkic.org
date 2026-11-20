/**
 * One read of everything that prices a registration for an event: its ticket
 * settings, tickets, price periods and prices. Loaded as a single batch and
 * shared by the offer, the quote, and the registration itself.
 */
import {
  currentTicketPricePeriod,
  nextTicketPricePeriod,
  type TicketPriceCharged,
  type TicketPricePeriodRule,
  type TicketPriceRule,
} from "../../../../assets/shared/event-tickets";
import { batchFirst, batchRows } from "../../db/pagination";
import { configuredAttendanceOptions, type EventDayRecord } from "../event-days";
import type { D1StatementResult, DatabaseLike, StatementLike } from "../../types";

export interface TicketSettingsRow {
  event_id: string;
  currency: string;
  reminder_interval_days: number;
  reminder_period_days: number;
  unpaid_hold_days: number | null;
  payment_retry_days: number;
  tickets_transferable: number;
  send_invoice: number;
  refund_days_before_event: number | null;
  refund_fee: number;
  ticket_intro: string | null;
  attendance_intro: string | null;
  revision: number;
}

export interface TicketTypeRow {
  id: string;
  event_id: string;
  ticket_key: string;
  name: string;
  description_markdown: string;
  classifier_description: string | null;
  classifier_threshold: number;
  is_default: number;
  free_requires_work_email: number;
  sort_order: number;
  active: number;
}

interface PeriodRow {
  id: string;
  starts_on: string | null;
}

interface PriceRow {
  id: string;
  ticket_type_id: string;
  attendance_value: string;
  day_date: string | null;
  charged: string;
}

interface AmountRow {
  price_id: string;
  period_id: string;
  amount: number;
}

export interface EventTicketSnapshot {
  settings: TicketSettingsRow | null;
  types: TicketTypeRow[];
  periods: TicketPricePeriodRule[];
  prices: TicketPriceRule[];
  current: TicketPricePeriodRule | null;
  next: TicketPricePeriodRule | null;
}

export function prepareEventTicketSnapshot(db: DatabaseLike, eventId: string): StatementLike[] {
  return [
    db
      .prepare(
        "SELECT event_id, currency, reminder_interval_days, reminder_period_days, unpaid_hold_days, payment_retry_days, tickets_transferable, send_invoice, refund_days_before_event, refund_fee, ticket_intro, attendance_intro, revision FROM event_ticket_settings WHERE event_id = ?",
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT id, event_id, ticket_key, name, description_markdown, classifier_description, classifier_threshold,
                is_default, free_requires_work_email, sort_order, active
         FROM event_ticket_types WHERE event_id = ? ORDER BY sort_order, created_at, id`,
      )
      .bind(eventId),
    db
      .prepare(
        "SELECT id, starts_on FROM event_ticket_price_periods WHERE event_id = ? ORDER BY IFNULL(starts_on, ''), id",
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT price.id, price.ticket_type_id, price.attendance_value, price.day_date, price.charged
         FROM event_ticket_prices price JOIN event_ticket_types type ON type.id = price.ticket_type_id
         WHERE type.event_id = ? ORDER BY type.sort_order, price.attendance_value, IFNULL(price.day_date, ''), price.id`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT amount.price_id, amount.period_id, amount.amount
         FROM event_ticket_price_amounts amount
         JOIN event_ticket_prices price ON price.id = amount.price_id
         JOIN event_ticket_types type ON type.id = price.ticket_type_id
         WHERE type.event_id = ?`,
      )
      .bind(eventId),
  ];
}

export const EVENT_TICKET_SNAPSHOT_STATEMENTS = 5;

export function decodeEventTicketSnapshot(
  results: readonly D1StatementResult[],
  timeZone: string,
  now: string | Date = new Date(),
): EventTicketSnapshot {
  const [settingsResult, typesResult, periodsResult, pricesResult, amountsResult] = results;
  const amounts = new Map<string, Record<string, number>>();
  for (const row of batchRows<AmountRow>(amountsResult)) {
    const forPrice = amounts.get(row.price_id) ?? {};
    forPrice[row.period_id] = row.amount;
    amounts.set(row.price_id, forPrice);
  }
  const periods = batchRows<PeriodRow>(periodsResult).map((row) => ({ id: row.id, startsOn: row.starts_on }));
  const current = currentTicketPricePeriod(periods, now, timeZone);
  return {
    settings: batchFirst<TicketSettingsRow>(settingsResult) ?? null,
    types: batchRows<TicketTypeRow>(typesResult),
    periods,
    prices: batchRows<PriceRow>(pricesResult).map((row) => ({
      id: row.id,
      ticketTypeId: row.ticket_type_id,
      attendanceValue: row.attendance_value,
      dayDate: row.day_date,
      charged: (row.charged === "each_day" ? "each_day" : "once") as TicketPriceCharged,
      amounts: amounts.get(row.id) ?? {},
    })),
    current,
    next: nextTicketPricePeriod(periods, current),
  };
}

export async function readEventTicketSnapshot(
  db: DatabaseLike,
  event: { id: string; timezone: string },
  now: string | Date = new Date(),
): Promise<EventTicketSnapshot> {
  return decodeEventTicketSnapshot(await db.batch(prepareEventTicketSnapshot(db, event.id)), event.timezone, now);
}

/** An event sells tickets once it has settings and at least one active ticket. */
export function eventSellsTickets(snapshot: EventTicketSnapshot): boolean {
  return Boolean(snapshot.settings) && snapshot.types.some((type) => type.active === 1);
}

export interface TicketAttendanceOption {
  value: string;
  label: string;
  icon: string | null;
}

/** The ways of attending an event's days offer, each once, in the order the days list them. */
export function eventAttendanceOptions(
  days: ReadonlyArray<Pick<EventDayRecord, "attendance_options_json" | "in_person_capacity">>,
): TicketAttendanceOption[] {
  const options = new Map<string, TicketAttendanceOption>();
  for (const day of days)
    for (const option of configuredAttendanceOptions(day))
      if (!options.has(option.value))
        options.set(option.value, { value: option.value, label: option.label, icon: option.icon ?? null });
  return [...options.values()];
}
