/**
 * How ticket prices read everywhere: a zero amount is "Free", a price period
 * is named by the day it starts, and an amount typed by an organizer becomes
 * the currency's smallest unit.
 */
import { currencyInfo, toSmallestUnit } from "./constants/currencies";
import { formatCalendarDate, formatDayAndMonth } from "./format-date";
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
