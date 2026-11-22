/**
 * Event ticket policy shared by the Worker and the portal: which price period
 * is in force, what a set of day choices costs with a ticket, what a code does
 * to that price, and when a classifier's answer is certain enough to decide.
 *
 * Amounts are integers in the currency's smallest unit. A price change is a
 * calendar date in the event's IANA zone and starts at that day's midnight.
 */
import { instantToCalendarDate } from "./timezone";

export const TICKET_PRICE_CHARGED = ["once", "each_day"] as const;
export type TicketPriceCharged = (typeof TICKET_PRICE_CHARGED)[number];

export const REGISTRATION_TICKET_STATUSES = [
  "free",
  "pending_payment",
  "paid",
  "payment_under_review",
  "refunded",
  "canceled",
] as const;
export type RegistrationTicketStatus = (typeof REGISTRATION_TICKET_STATUSES)[number];

/** How a person came to hold their ticket, most specific first. */
export const TICKET_ASSIGNMENT_SOURCES = ["code", "organizer", "classifier", "chosen", "default", "disputed"] as const;
export type TicketAssignmentSource = (typeof TICKET_ASSIGNMENT_SOURCES)[number];

export const DEFAULT_CLASSIFIER_THRESHOLD = 0.75;
export const DEFAULT_PAYMENT_REMINDER_INTERVAL_DAYS = 3;
export const DEFAULT_PAYMENT_REMINDER_PERIOD_DAYS = 14;
/** How long a place is kept after its payment failed, unless the event says otherwise. */
export const DEFAULT_PAYMENT_RETRY_DAYS = 1;

const DAY_MS = 86_400_000;

/**
 * What starts when a ticket begins to wait for its payment: when it is next
 * reminded, when reminders stop, and until when its place is kept. All are
 * null for a ticket with nothing to pay; the reminders also for an event that
 * sends none, and the deadline for an event that keeps unpaid places.
 */
export function ticketReminderSchedule(
  settings: { intervalDays: number; periodDays: number; holdDays?: number | null },
  now: string,
  awaitingPayment: boolean,
): { nextReminderAt: string | null; remindersEndAt: string | null; payBy: string | null } {
  if (!awaitingPayment) return { nextReminderAt: null, remindersEndAt: null, payBy: null };
  const from = Date.parse(now);
  const after = (days: number) => new Date(from + days * DAY_MS).toISOString();
  const reminded = settings.periodDays > 0;
  return {
    nextReminderAt: reminded ? after(settings.intervalDays) : null,
    remindersEndAt: reminded ? after(settings.periodDays) : null,
    payBy: settings.holdDays ? after(settings.holdDays) : null,
  };
}

export interface TicketPricePeriodRule {
  id: string;
  /** `YYYY-MM-DD` in the event's zone; null is the opening price. */
  startsOn: string | null;
}

export interface TicketPriceRule {
  id: string;
  ticketTypeId: string;
  attendanceValue: string;
  /** `YYYY-MM-DD` when the price is for one day only; null covers every day. */
  dayDate: string | null;
  charged: TicketPriceCharged;
  /** Amount per period id. A period without an amount is free. */
  amounts: Readonly<Record<string, number>>;
}

/** The period in force at `now`: the latest change whose date has begun in the event's zone. */
export function currentTicketPricePeriod<Period extends TicketPricePeriodRule>(
  periods: readonly Period[],
  now: string | Date,
  timeZone: string,
): Period | null {
  const today = instantToCalendarDate(now, timeZone);
  let current: Period | null = null;
  for (const period of periods) {
    if (period.startsOn !== null && period.startsOn > today) continue;
    if (!current || (period.startsOn ?? "") > (current.startsOn ?? "")) current = period;
  }
  return current;
}

/** The period that follows `current`, when one is scheduled. */
export function nextTicketPricePeriod<Period extends TicketPricePeriodRule>(
  periods: readonly Period[],
  current: Period | null,
): Period | null {
  const after = current?.startsOn ?? "";
  return (
    periods
      .filter((period) => period.startsOn !== null && period.startsOn > after)
      .sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? ""))[0] ?? null
  );
}

export interface TicketQuoteLine {
  priceId: string;
  attendanceValue: string;
  /** The days the line covers, in date order. */
  dayDates: string[];
  charged: TicketPriceCharged;
  amount: number;
  /** A price for the event that a higher one already covers; its amount is 0. */
  included: boolean;
}

export interface TicketQuote {
  lines: TicketQuoteLine[];
  /** Before any code. */
  subtotal: number;
  total: number;
}

/**
 * What the chosen days cost with one ticket in one period. A price for one
 * day wins over the all-days price for that day; an all-days price charged
 * once is counted once however many days use it. A person who mixes ways of
 * attending pays one price for the event, the highest; the others are
 * included. Prices per day and for a single day are always added.
 */
export function quoteTicket(input: {
  ticketTypeId: string;
  periodId: string | null;
  prices: readonly TicketPriceRule[];
  dayAttendance: ReadonlyArray<{ dayDate: string; attendanceType: string }>;
}): TicketQuote {
  const prices = input.prices.filter((price) => price.ticketTypeId === input.ticketTypeId);
  const lines = new Map<string, TicketQuoteLine>();
  /** The prices charged once for the event, in the order the days reach them. */
  const forEvent: string[] = [];
  for (const choice of [...input.dayAttendance].sort((a, b) => a.dayDate.localeCompare(b.dayDate))) {
    const price =
      prices.find((rule) => rule.attendanceValue === choice.attendanceType && rule.dayDate === choice.dayDate) ??
      prices.find((rule) => rule.attendanceValue === choice.attendanceType && rule.dayDate === null);
    if (!price) continue;
    const unit = (input.periodId && price.amounts[input.periodId]) || 0;
    const line = lines.get(price.id);
    if (line) {
      line.dayDates.push(choice.dayDate);
      if (price.charged === "each_day") line.amount += unit;
    } else {
      lines.set(price.id, {
        priceId: price.id,
        attendanceValue: price.attendanceValue,
        dayDates: [choice.dayDate],
        charged: price.charged,
        amount: unit,
        included: false,
      });
      if (price.charged === "once" && price.dayDate === null) forEvent.push(price.id);
    }
  }
  const highest = forEvent.reduce<string | null>(
    (best, id) => (best === null || lines.get(id)!.amount > lines.get(best)!.amount ? id : best),
    null,
  );
  for (const id of forEvent) {
    if (id === highest) continue;
    const line = lines.get(id)!;
    line.amount = 0;
    line.included = true;
  }
  const subtotal = [...lines.values()].reduce((sum, line) => sum + line.amount, 0);
  return { lines: [...lines.values()], subtotal, total: subtotal };
}

export interface TicketCodeEffect {
  /** A fixed total in place of the ticket's price; 0 is free. */
  amount: number | null;
  /** A share taken off the ticket's price, from 1 to 100. */
  percentOff: number | null;
}

/** The total after a code. A fixed amount replaces the price; a percentage rounds down to a whole unit. */
export function applyTicketCode(subtotal: number, code: TicketCodeEffect): number {
  if (code.amount !== null) return Math.max(0, code.amount);
  if (code.percentOff !== null) return Math.max(0, subtotal - Math.floor((subtotal * code.percentOff) / 100));
  return subtotal;
}

export interface TicketClassifierOption {
  key: string;
  /** Who qualifies, in the organizer's words. The whole text is the criterion. */
  description: string;
  threshold: number;
}

/**
 * The identity of a set of classifier options: the ticket keys it chooses
 * between. Descriptions, thresholds and the model's instructions are tuning,
 * so changing them keeps every stored decision; another event that offers the
 * same ticket keys reuses them too.
 */
export function ticketClassifierCriteria(options: readonly TicketClassifierOption[]): string {
  return JSON.stringify(options.map((option) => option.key).sort((a, b) => a.localeCompare(b)));
}

/** The ticket a classifier's answer decides, or null when it is not certain enough for that ticket. */
export function decideClassifiedTicket(
  options: readonly TicketClassifierOption[],
  probabilities: Readonly<Record<string, number>>,
): { key: string; confidence: number } | null {
  let best: { key: string; confidence: number } | null = null;
  for (const option of options) {
    const confidence = probabilities[option.key];
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) continue;
    if (!best || confidence > best.confidence) best = { key: option.key, confidence };
  }
  if (!best) return null;
  const decided = best;
  const threshold = options.find((option) => option.key === decided.key)?.threshold ?? DEFAULT_CLASSIFIER_THRESHOLD;
  return decided.confidence >= threshold ? decided : null;
}

/** One form for an organization name wherever a decision is keyed by it. */
export function normalizeTicketOrganizationName(name: string | null | undefined): string {
  return (name ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export const TICKET_STATUS_LABELS: Record<RegistrationTicketStatus, string> = {
  free: "Free",
  pending_payment: "Awaiting payment",
  paid: "Paid",
  payment_under_review: "Payment under review",
  refunded: "Refunded",
  canceled: "Canceled",
};
