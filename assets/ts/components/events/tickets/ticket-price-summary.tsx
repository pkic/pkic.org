/**
 * How a ticket's prices are stated around the attendance grid. The ticket's
 * stub summarizes: one price, or the range when the price depends on how and
 * when the person attends. The exact price of each way of attending is a line
 * on its row in the grid, where the person chooses it.
 */
import { dayBefore, formatTicketAmount } from "../../../../shared/event-ticket-display";
import { formatCalendarDate } from "../../../../shared/format-date";
import type { EventTicketOffer } from "../../../../shared/schemas/event-tickets";
import type { AttendanceOptionPrice } from "../../attendance-pricing";

export type OfferedTicket = EventTicketOffer["tickets"][number];

interface PriceNow {
  attendanceValue: string;
  dayDate: string | null;
  charged: OfferedTicket["prices"][number]["charged"];
  amount: number;
  /** What the price becomes when the next period starts, when that differs. */
  next: number | null;
  /** A personal mailbox pays the price that follows the free one. */
  personal: boolean;
}

function pricesNow(offer: EventTicketOffer, ticket: OfferedTicket): PriceNow[] {
  const personalPrice = offer.personalEmail && ticket.personalEmailAmount !== null;
  return ticket.prices.map((price) => {
    const personal = personalPrice && price.amount === 0 && (price.nextAmount ?? 0) > 0;
    const amount = personal ? price.nextAmount! : price.amount;
    const changes = !personal && price.nextAmount !== null && price.nextAmount !== amount;
    return {
      attendanceValue: price.attendanceValue,
      dayDate: price.dayDate,
      charged: price.charged,
      amount,
      next: changes ? price.nextAmount : null,
      personal,
    };
  });
}

const distinct = (values: readonly number[]) => new Set(values).size;

/** "then $195", or "then up to $195" when not every price changes to the same amount. */
function thenPrice(prices: readonly PriceNow[], currency: string): string | undefined {
  const next = prices.flatMap((price) => (price.next === null ? [] : [price.next]));
  if (!next.length) return undefined;
  const same = next.length === prices.length && distinct(next) === 1;
  return `then ${same ? "" : "up to "}${formatTicketAmount(Math.max(...next), currency)}`;
}

/** Whether an amount differs between ways of attending, between days, or both. */
function dependsOn(prices: readonly PriceNow[]): string {
  const byWay = new Map<string, number[]>();
  for (const price of prices)
    byWay.set(price.attendanceValue, [...(byWay.get(price.attendanceValue) ?? []), price.amount]);
  const byDay = [...byWay.values()].some((amounts) => distinct(amounts) > 1);
  const ways = distinct([...byWay.values()].map((amounts) => Math.min(...amounts))) > 1;
  if (byDay && ways) return "depends on how and when you attend";
  return byDay ? "depends on the days you attend" : "depends on how you attend";
}

/** The stub of a ticket: its one price, or the range when the price depends on how the person attends. */
export function ticketStubPrice(
  offer: EventTicketOffer,
  ticket: OfferedTicket,
): { price: string; priceTo?: string; priceTerms?: string; priceNext?: string } {
  const money = (amount: number) => formatTicketAmount(amount, offer.currency);
  const prices = pricesNow(offer, ticket);
  if (!prices.length) return { price: money(0) };
  const amounts = prices.map((price) => price.amount);
  const lowest = Math.min(...amounts);
  const highest = Math.max(...amounts);
  if (lowest !== highest) return { price: money(lowest), priceTo: money(highest), priceNext: dependsOn(prices) };
  if (prices.some((price) => price.personal)) return { price: money(lowest), priceTerms: "with a personal address" };
  const next = thenPrice(prices, offer.currency);
  if (!next || !offer.nextPeriodStartsOn) return { price: money(lowest) };
  return {
    price: money(lowest),
    priceTerms: `until ${formatCalendarDate(dayBefore(offer.nextPeriodStartsOn))}`,
    priceNext: next,
  };
}

/**
 * The price of each way of attending: with the ticket the person holds, or
 * across the tickets they still choose between.
 */
export function attendanceOptionPrices(
  offer: EventTicketOffer,
  tickets: readonly OfferedTicket[],
): Record<string, AttendanceOptionPrice> {
  const money = (amount: number) => formatTicketAmount(amount, offer.currency);
  const perTicket = tickets.map((ticket) => pricesNow(offer, ticket));
  const result: Record<string, AttendanceOptionPrice> = {};
  for (const value of new Set(perTicket.flat().map((price) => price.attendanceValue))) {
    const mine = perTicket.map((prices) => prices.filter((price) => price.attendanceValue === value));
    if (mine.length === 1) {
      result[value] = heldTicketPrice(mine[0], money);
      continue;
    }
    const amounts = mine.flat().map((price) => price.amount);
    const lowest = Math.min(...amounts);
    const highest = Math.max(...amounts);
    result[value] =
      lowest === highest
        ? { amount: money(lowest) }
        : { amount: `${money(lowest)} to ${money(highest)}`, covers: "by ticket" };
  }
  return result;
}

/** One ticket's price for one way of attending: for the event or per day, and any day priced on its own. */
function heldTicketPrice(prices: readonly PriceNow[], money: (amount: number) => string): AttendanceOptionPrice {
  const everyDay = prices.find((price) => price.dayDate === null);
  const perDay = everyDay ? everyDay.charged === "each_day" : true;
  const own = prices.filter((price) => price.dayDate !== null && !(perDay && price.amount === everyDay?.amount));
  const byDay = own.length ? Object.fromEntries(own.map((price) => [price.dayDate!, money(price.amount)])) : undefined;
  const free = !byDay && (everyDay?.amount ?? 0) === 0;
  return {
    amount: everyDay ? money(everyDay.amount) : undefined,
    per: free ? undefined : perDay ? "day" : "event",
    covers: everyDay?.personal ? "with a personal address" : undefined,
    byDay,
  };
}
