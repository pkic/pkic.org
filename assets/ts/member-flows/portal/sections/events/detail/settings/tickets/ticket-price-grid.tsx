/** Projects an event's ticket configuration onto the price table's rows and columns. */
import type { EventTicketsConfiguration } from "../../../../../../../../shared/schemas/event-tickets";
import { formatTicketAmount, ticketPeriodLabels } from "../../../../../../../../shared/event-ticket-display";
import { formatCalendarDate } from "../../../../../../../../shared/format-date";
import { AttendanceIcon } from "../../../../../../../components/AttendanceIcon";
import type {
  TicketPriceGroupView,
  TicketPricePeriodColumn,
} from "../../../../../../../components/events/tickets/TicketPriceTable";

type Configuration = Pick<
  EventTicketsConfiguration,
  "periods" | "prices" | "types" | "attendanceOptions" | "days" | "currentPeriodId" | "settings"
>;

export function sortedPeriods<Period extends { startsOn: string | null }>(periods: readonly Period[]): Period[] {
  return [...periods].sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? ""));
}

export function coversLabel(configuration: Pick<Configuration, "days">, dayDate: string | null): string {
  if (dayDate === null) return "All days";
  const day = configuration.days.find((candidate) => candidate.dayDate === dayDate);
  return day?.label?.trim() || formatCalendarDate(dayDate);
}

export function attendanceLabel(configuration: Pick<Configuration, "attendanceOptions">, value: string): string {
  return configuration.attendanceOptions.find((option) => option.value === value)?.label ?? value;
}

/** What the work-address rule means for a ticket, and a warning when no paid price follows the free one. */
function workEmailSummary(configuration: Configuration, typeId: string, periodIds: readonly string[]): string {
  const becomesPaid = configuration.prices
    .filter((price) => price.ticketTypeId === typeId && price.dayDate === null)
    .some((price) => {
      const free = periodIds.findIndex((id) => (price.amounts[id] ?? 0) === 0);
      return free !== -1 && periodIds.slice(free + 1).some((id) => (price.amounts[id] ?? 0) > 0);
    });
  return becomesPaid
    ? "Work email address required while free. A personal address pays the first paid price."
    : "Work email address required while free, but no paid price follows, so a personal address is free too.";
}

export function ticketPriceGrid(
  configuration: Configuration,
  priceText: (amount: number) => string = (amount) => formatTicketAmount(amount, configuration.settings.currency),
): { periods: TicketPricePeriodColumn[]; groups: TicketPriceGroupView[] } {
  const ordered = sortedPeriods(configuration.periods);
  const labels = ticketPeriodLabels(ordered);
  return {
    periods: ordered.map((period, index) => ({
      id: period.id,
      startsOn: period.startsOn,
      label: labels[index].label,
      until: labels[index].until,
      current: period.id === configuration.currentPeriodId,
    })),
    groups: configuration.types
      .filter((type) => type.active)
      .map((type) => ({
        id: type.id,
        ticket: type.name,
        summary: type.freeRequiresWorkEmail
          ? workEmailSummary(
              configuration,
              type.id,
              ordered.map((period) => period.id),
            )
          : undefined,
        rows: configuration.prices
          .filter((price) => price.ticketTypeId === type.id)
          .map((price) => {
            return {
              id: price.id,
              attendance: attendanceLabel(configuration, price.attendanceValue),
              icon: <AttendanceIcon type={price.attendanceValue} />,
              covers: coversLabel(configuration, price.dayDate),
              charged: price.charged,
              prices: ordered.map((period) => priceText(price.amounts[period.id] ?? 0)),
            };
          }),
      })),
  };
}
