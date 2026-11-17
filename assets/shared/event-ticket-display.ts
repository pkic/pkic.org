/**
 * How ticket prices read everywhere: a zero amount is "Free", a price period
 * is named by the day it starts, and an amount typed by an organizer becomes
 * the currency's smallest unit.
 */
import { currencyInfo, toSmallestUnit } from "./constants/currencies";
import { formatCalendarDate, formatDateTime, formatDateTimeInZone, formatDayAndMonth } from "./format-date";
import { formatCurrencyAmount } from "./format-currency";

/** A sum of money, where zero is a figure and not a price. Whole amounts drop their empty cents. */
export function formatTicketMoney(amount: number, currency: string): string {
  return formatCurrencyAmount(amount, currency).replace(/[.,]00(?=\D*$)/, "");
}

export function formatTicketAmount(amount: number, currency: string): string {
  return amount === 0 ? "Free" : formatTicketMoney(amount, currency);
}

/** The amount as an organizer types it: major units, without a currency sign. */
export function ticketAmountInput(amount: number, currency: string): string {
  return String(currencyInfo(currency).zeroDecimal ? amount : amount / 100);
}

/** The smallest-unit amount an organizer's entry stands for, or null when it is not an amount. */
export function parseTicketAmount(value: string, currency: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(trimmed)) return null;
  return toSmallestUnit(Number(trimmed.replace(",", ".")), currency);
}

/** The day before a calendar date, for "until Mar 19" beside a change that starts Mar 20. */
export function dayBefore(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export interface TicketPeriodLabel {
  label: string;
  until: string | null;
}

/** Names a price period by its start and says when it ends, given the periods in date order. */
export function ticketPeriodLabels(periods: ReadonlyArray<{ startsOn: string | null }>): TicketPeriodLabel[] {
  return periods.map((period, index) => {
    const next = periods[index + 1]?.startsOn;
    return {
      label: period.startsOn === null ? "Opening price" : `From ${formatDayAndMonth(period.startsOn)}`,
      until: next ? `until ${formatCalendarDate(dayBefore(next))}` : null,
    };
  });
}

/**
 * The event's refund policy as a registrant reads it, for a ticket that costs
 * money. The deadline is given on the event's clock when its zone is known,
 * otherwise on the reader's own.
 */
export function ticketRefundNote(
  policy: { refundableUntil: string | null; refundFee: number; currency: string },
  timeZone?: string,
  now = Date.now(),
): string {
  if (!policy.refundableUntil) return "Tickets for this event are not refunded.";
  if (Date.parse(policy.refundableUntil) < now) return "The refund period for this event has ended.";
  const until = timeZone
    ? formatDateTimeInZone(policy.refundableUntil, timeZone)
    : formatDateTime(policy.refundableUntil);
  return policy.refundFee > 0
    ? `Until ${until} you get your money back if you cancel, and the difference if you move to days that cost less. An administration fee of ${formatTicketMoney(policy.refundFee, policy.currency)} is kept from each refund.`
    : `Until ${until} you get your money back if you cancel, and the difference if you move to days that cost less.`;
}
