/**
 * TicketPriceTable — every price of an event in one grid: a row for each way
 * of attending under each ticket, a column for each price period. The period
 * in force today is marked, so an organizer reads what people pay now and
 * what comes next without opening anything.
 *
 * With `editor` the cells are fields, the period starts are dates, and a row
 * says whether its price is charged once for the event or for each day.
 */
import type { ComponentChildren } from "preact";
import { Button } from "../../../ui/Button";
import { Select, TextInput } from "../../../ui/TextControl";
import "./TicketPriceTable.css";

export interface TicketPricePeriodColumn {
  id: string;
  label: string;
  until?: string | null;
  /** `YYYY-MM-DD`; null for the opening price. */
  startsOn: string | null;
  current?: boolean;
}

export interface TicketPriceRowView {
  id: string;
  attendance: string;
  icon?: ComponentChildren;
  /** "All days" or the one day the price is for. */
  covers: string;
  charged: "once" | "each_day";
  /** One entry per period: the price as shown, or as typed while editing. */
  prices: readonly string[];
}

export interface TicketPriceGroupView {
  id: string;
  ticket: string;
  summary?: string;
  rows: readonly TicketPriceRowView[];
}

export interface TicketPriceTableEditor {
  /** The contract path of a control, so the form reads and marks it. */
  priceName: (rowId: string, periodId: string) => string;
  periodName: (periodId: string) => string;
  chargedName: (rowId: string) => string;
  invalid: (name: string) => boolean;
  onPrice: (rowId: string, periodId: string, value: string) => void;
  onCharged: (rowId: string, value: "once" | "each_day") => void;
  onPeriodDate: (periodId: string, value: string) => void;
  onAddPeriod: () => void;
  onRemovePeriod: (periodId: string) => void;
  onRemoveRow: (rowId: string) => void;
  /** The control that adds a row to a ticket, when more rows can be added. */
  addRow: (groupId: string) => ComponentChildren;
}

const CHARGED = { once: "Once", each_day: "Each day" } as const;

export function TicketPriceTable({
  periods,
  groups,
  editor,
}: {
  periods: readonly TicketPricePeriodColumn[];
  groups: readonly TicketPriceGroupView[];
  editor?: TicketPriceTableEditor;
}) {
  const columns = periods.length + 2 + (editor ? 1 : 0);
  return (
    <div class="pk-table__scroll">
      <table class="pk-table pk-price-table" data-editing={editor ? "" : undefined}>
        <caption class="pk-sr-only">Ticket prices by period</caption>
        <thead>
          <tr>
            <th scope="col">Ticket and attendance</th>
            <th scope="col">Charged</th>
            {periods.map((period) => (
              <th scope="col" key={period.id} class="pk-price-table__period" data-current={period.current || undefined}>
                {period.current && <span class="pk-price-table__now">Now</span>}
                {editor && period.startsOn !== null ? (
                  <span class="pk-price-table__period-edit">
                    <TextInput
                      type="date"
                      name={editor.periodName(period.id)}
                      aria-label="Price change starts on"
                      aria-invalid={editor.invalid(editor.periodName(period.id)) || undefined}
                      value={period.startsOn}
                      onInput={(event) => editor.onPeriodDate(period.id, event.currentTarget.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remove the price change of ${period.label}`}
                      title="Remove this price change"
                      onClick={() => editor.onRemovePeriod(period.id)}
                    >
                      Remove
                    </Button>
                  </span>
                ) : (
                  <span class="pk-price-table__period-label">{period.label}</span>
                )}
                {period.until && !editor && <span class="pk-price-table__until">{period.until}</span>}
              </th>
            ))}
            {editor && (
              <th scope="col" class="pk-price-table__add">
                <Button type="button" onClick={editor.onAddPeriod}>
                  Add price change
                </Button>
              </th>
            )}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.id}>
            <tr class="pk-price-table__group">
              <th scope="rowgroup" colSpan={columns}>
                <strong>{group.ticket}</strong>
                {group.summary && <span>{group.summary}</span>}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" class="pk-price-table__attendance">
                  <span class="pk-price-table__attendance-name">
                    {row.icon}
                    {row.attendance}
                  </span>
                  <span class="pk-price-table__covers">{row.covers}</span>
                </th>
                <td>
                  {editor ? (
                    <Select
                      name={editor.chargedName(row.id)}
                      aria-label={`${group.ticket}, ${row.attendance}, ${row.covers}: charged`}
                      onChange={(event) => editor.onCharged(row.id, event.currentTarget.value as "once" | "each_day")}
                    >
                      <option value="once" selected={row.charged === "once"}>
                        Once
                      </option>
                      <option value="each_day" selected={row.charged === "each_day"}>
                        Each day
                      </option>
                    </Select>
                  ) : (
                    CHARGED[row.charged]
                  )}
                </td>
                {periods.map((period, index) => (
                  <td
                    key={period.id}
                    class="pk-price-table__price"
                    data-current={period.current || undefined}
                    data-free={row.prices[index] === "Free" || undefined}
                  >
                    {editor ? (
                      <TextInput
                        inputMode="decimal"
                        name={editor.priceName(row.id, period.id)}
                        aria-label={`${group.ticket}, ${row.attendance}, ${row.covers}, ${period.label}`}
                        aria-invalid={editor.invalid(editor.priceName(row.id, period.id)) || undefined}
                        value={row.prices[index] ?? ""}
                        onInput={(event) => editor.onPrice(row.id, period.id, event.currentTarget.value)}
                      />
                    ) : (
                      row.prices[index]
                    )}
                  </td>
                ))}
                {editor && (
                  <td class="pk-price-table__remove">
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remove the price of ${group.ticket}, ${row.attendance}, ${row.covers}`}
                      onClick={() => editor.onRemoveRow(row.id)}
                    >
                      Remove
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {group.rows.length === 0 && !editor && (
              <tr>
                <td colSpan={columns} class="pk-muted">
                  No prices yet. This ticket is free.
                </td>
              </tr>
            )}
            {editor && (
              <tr class="pk-price-table__more">
                <td colSpan={columns}>{editor.addRow(group.id)}</td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}
