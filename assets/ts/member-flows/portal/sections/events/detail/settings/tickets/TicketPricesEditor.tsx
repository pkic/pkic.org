/**
 * Edit every price of the event in one grid. The whole grid is one request:
 * the periods, each ticket's rows, and the amount in every cell.
 */
import { useState } from "preact/hooks";
import { putJson } from "../../../../../../../shared/api-client";
import {
  eventTicketPricesReplaceSchema,
  eventTicketsChangeResponseSchema,
  type EventTicketsConfiguration,
} from "../../../../../../../../shared/schemas/event-tickets";
import { parseTicketAmount, ticketAmountInput } from "../../../../../../../../shared/event-ticket-display";
import { formatZoneCity } from "../../../../../../../../shared/format-date";
import { TicketPriceTable } from "../../../../../../../components/events/tickets/TicketPriceTable";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../../ui/Alert";
import { Button } from "../../../../../../../ui/Button";
import { Menu } from "../../../../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { ticketsEndpoint } from "./tickets-endpoint";
import { attendanceLabel, coversLabel, sortedPeriods, ticketPriceGrid } from "./ticket-price-grid";

interface DraftPeriod {
  id: string;
  startsOn: string | null;
}

interface DraftPrice {
  id: string;
  ticketTypeId: string;
  attendanceValue: string;
  dayDate: string | null;
  charged: "once" | "each_day";
  /** What the organizer typed, by period id. */
  amounts: Record<string, string>;
}

let draftSequence = 0;
const draftId = (prefix: string) => `${prefix}-new-${(draftSequence += 1)}`;

export function TicketPricesEditor({
  slug,
  configuration,
  onSaved,
  onCancel,
}: {
  slug: string;
  configuration: EventTicketsConfiguration;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const { currency } = configuration.settings;
  const [periods, setPeriods] = useState<DraftPeriod[]>(() =>
    configuration.periods.length ? sortedPeriods(configuration.periods) : [{ id: draftId("period"), startsOn: null }],
  );
  const [prices, setPrices] = useState<DraftPrice[]>(() =>
    configuration.prices.map((price) => ({
      ...price,
      amounts: Object.fromEntries(
        Object.entries(price.amounts).map(([period, amount]) => [period, ticketAmountInput(amount, currency)]),
      ),
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const body = {
    expectedRevision: configuration.revision,
    periods,
    prices: prices.map((price) => ({
      ...price,
      amounts: Object.fromEntries(
        periods.map((period) => [period.id, parseTicketAmount(price.amounts[period.id] ?? "", currency) ?? Number.NaN]),
      ),
    })),
  };
  const form = useContractForm(eventTicketPricesReplaceSchema, body);
  const priceIndex = (rowId: string) => prices.findIndex((price) => price.id === rowId);
  const periodIndex = (periodId: string) => periods.findIndex((period) => period.id === periodId);
  const grid = ticketPriceGrid({
    ...configuration,
    periods,
    prices: [],
    currentPeriodId: configuration.currentPeriodId,
  });
  const groups = grid.groups.map((group) => ({
    ...group,
    rows: prices
      .filter((price) => price.ticketTypeId === group.id)
      .map((price) => ({
        id: price.id,
        attendance: attendanceLabel(configuration, price.attendanceValue),
        covers: coversLabel(configuration, price.dayDate),
        charged: price.charged,
        // In the order the columns are shown, which is by date and not the order they were added in.
        prices: grid.periods.map((period) => price.amounts[period.id] ?? ""),
      })),
  }));
  /** The rows a ticket does not have yet: each way of attending, for all days and for each single day. */
  function missingRows(ticketTypeId: string) {
    const taken = new Set(
      prices
        .filter((price) => price.ticketTypeId === ticketTypeId)
        .map((price) => `${price.attendanceValue}|${price.dayDate ?? ""}`),
    );
    return configuration.attendanceOptions.flatMap((option) =>
      [null, ...configuration.days.map((day) => day.dayDate)]
        .filter((dayDate) => !taken.has(`${option.value}|${dayDate ?? ""}`))
        .map((dayDate) => ({ attendanceValue: option.value, dayDate })),
    );
  }
  async function save(submitEvent: Event) {
    submitEvent.preventDefault();
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage ?? "Enter each price as an amount, such as 195 or 195.50.");
    setSaving(true);
    setError("");
    try {
      await putJson(`${ticketsEndpoint(slug)}/prices`, checked.data, eventTicketsChangeResponseSchema);
      await onSaved();
    } catch (cause) {
      setError(form.refuse(cause));
      setSaving(false);
    }
  }
  return (
    <Panel aria-label="Edit prices">
      <form noValidate {...form.handlers} onSubmit={(submitEvent) => void save(submitEvent)}>
        <PanelHeader title="Edit prices">
          <Button type="button" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={saving}>
            Save prices
          </Button>
        </PanelHeader>
        <PanelBody class="pk-stack">
          <p class="pk-small pk-muted">
            Prices are in {currency.toUpperCase()}. Leave a price empty or enter 0 for free. Each change starts at
            midnight in {formatZoneCity(configuration.timeZone)} ({configuration.timeZone}) on its date. A price for one
            day replaces the all-days price on that day.
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
        </PanelBody>
        <PanelBody flush>
          <TicketPriceTable
            periods={grid.periods}
            groups={groups}
            editor={{
              priceName: (rowId, periodId) => `prices.${priceIndex(rowId)}.amounts.${periodId}`,
              periodName: (periodId) => `periods.${periodIndex(periodId)}.startsOn`,
              chargedName: (rowId) => `prices.${priceIndex(rowId)}.charged`,
              invalid: (name) => form.of(name).state === "invalid",
              onPrice: (rowId, periodId, value) =>
                setPrices((current) =>
                  current.map((price) =>
                    price.id === rowId ? { ...price, amounts: { ...price.amounts, [periodId]: value } } : price,
                  ),
                ),
              onCharged: (rowId, charged) =>
                setPrices((current) => current.map((price) => (price.id === rowId ? { ...price, charged } : price))),
              onPeriodDate: (periodId, startsOn) =>
                setPeriods((current) =>
                  current.map((period) => (period.id === periodId ? { ...period, startsOn } : period)),
                ),
              onAddPeriod: () => setPeriods((current) => [...current, { id: draftId("period"), startsOn: "" }]),
              onRemovePeriod: (periodId) => setPeriods((current) => current.filter((period) => period.id !== periodId)),
              onRemoveRow: (rowId) => setPrices((current) => current.filter((price) => price.id !== rowId)),
              addRow: (ticketTypeId) => {
                const missing = missingRows(ticketTypeId);
                if (!missing.length) return null;
                return (
                  <Menu
                    label="Add a price"
                    variant="plain"
                    triggerClass="pk-btn pk-btn--ghost"
                    items={missing.map((row) => ({
                      id: `${row.attendanceValue}|${row.dayDate ?? ""}`,
                      label: `${attendanceLabel(configuration, row.attendanceValue)}, ${coversLabel(configuration, row.dayDate).toLowerCase()}`,
                      onSelect: () =>
                        setPrices((current) => [
                          ...current,
                          {
                            id: draftId("price"),
                            ticketTypeId,
                            attendanceValue: row.attendanceValue,
                            dayDate: row.dayDate,
                            charged: row.dayDate === null ? "once" : "each_day",
                            amounts: {},
                          },
                        ]),
                    }))}
                  >
                    Add a price
                  </Menu>
                );
              },
            }}
          />
        </PanelBody>
      </form>
    </Panel>
  );
}
