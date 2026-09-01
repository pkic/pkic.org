/**
 * DataTable — rosters, audit rows, registrations, the outbox.
 *
 * Presentational only: it never sorts, filters or paginates the rows it is
 * given. Those belong in the D1 query, and a table that quietly re-sorts a
 * page of results is lying about what the server returned.
 *
 * What it does own is the part that is easy to get wrong: `aria-sort` on the
 * sorted column, a real accessible name for every selection checkbox, a
 * caption so the table is identifiable in a list of tables, and a loading
 * state that is announced rather than mimed by grey rectangles.
 */

import { Fragment, type ComponentChildren } from "preact";

// The skin is shared with the Markdown table render hook and ships in the
// entry stylesheet; importing it here states the dependency rather than
// relying on the entry having happened to load first.
import "./Table.css";
import "./DataTable.css";
import "./Content.css";

export type SortDirection = "asc" | "desc";

/**
 * How wide a column is allowed to be.
 *
 * `content` is the default and is what a table does on its own: the column is
 * as wide as its content wants, and whatever width the row has left over is
 * shared between the content columns in proportion to what each one needs.
 *
 * `fit` says the column's content has a bounded length — a date, a count, a
 * status, the row's actions. It hugs that content and never wraps, so it takes
 * no share of the leftover width and the columns holding real prose get it
 * instead. Say this on the column rather than writing `pk-nowrap` on its cells:
 * the utility stops the value breaking in two but still lets the column claim
 * space it has no use for, which is how a date ended up a third of the way
 * across a wide screen from the row it dates.
 */
/**
 * How a column relates to the width the table is given.
 *
 *   content   the default: sized by what it holds
 *   fit       hugs its content and never wraps — dates, counts, badges
 *   primary   takes all the slack on a wide screen. One per table; the
 *             translation layer gives it to the first column when no column
 *             claims it, because a list leads with its subject.
 */
export type DataTableColumnWidth = "content" | "fit" | "primary";

export interface DataTableColumn<Row> {
  id: string;
  header: string;
  /** Omit to render nothing for this column. */
  cell: (row: Row) => ComponentChildren;
  sortable?: boolean;
  /**
   * Which edge the column reads from.
   *
   * Text and dates stay at the start: they are read left to right, and a date
   * is a label rather than a magnitude. Numbers a reader compares down the
   * column — counts, amounts, sizes — take `end`, so their units line up under
   * each other. The table sets `tabular-nums`, so digits line up either way.
   */
  align?: "start" | "center" | "end";
  /** See DataTableColumnWidth. Defaults to `content`. */
  width?: DataTableColumnWidth;
  /**
   * Utilities for the cells in this column - `pk-mono` for identifiers,
   * `pk-small` and `pk-muted` to mark the column as the row's secondary
   * information. Design-system classes only; the isolation gate rejects
   * anything else in an adopted surface. How wide the column is is not one of
   * these — see `width`.
   */
  cellClass?: string;
  /**
   * Renders the header for assistive technology only.
   *
   * The one column that needs this is the row's actions: a visible "Actions"
   * label names a column the reader can already see is full of buttons, but a
   * `<th>` with nothing in it leaves a screen reader announcing each of those
   * buttons under a column with no name at all.
   */
  headerHidden?: boolean;
}

/**
 * What activating a row does.
 *
 * This exists instead of an `onRowClick` on the `<tr>`, which is how the
 * portal's fourteen list surfaces used to do it and which no keyboard could
 * reach: a table row is not focusable and takes no Enter key. The action is
 * rendered as a real link or button inside the first cell and then stretched
 * over the whole row, so the row is clickable anywhere, reachable by Tab,
 * activated by Enter, and announced with a name.
 *
 * `label` is that name. It should say where the row goes or what it opens —
 * "Open Example Corp", not "View".
 */
export interface DataTableRowAction {
  label: string;
  /** A navigation. Preferred: it is a link, so it can be opened in a new tab. */
  href?: string;
  /** A selection that stays on the page. Used when there is no URL for it. */
  onSelect?: () => void;
}

export interface DataTableSelection {
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  /** Names the row in the checkbox's accessible label. */
  rowLabel: (rowKey: string) => string;
}

export interface DataTableProps<Row> {
  /** Names the table. Always rendered, visually hidden unless `showCaption`. */
  caption: string;
  showCaption?: boolean;
  columns: ReadonlyArray<DataTableColumn<Row>>;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  sort?: { columnId: string; direction: SortDirection };
  onSort?: (columnId: string, direction: SortDirection) => void;
  selection?: DataTableSelection;
  loading?: boolean;
  loadingRows?: number;
  /** Shown instead of the body when there are no rows and nothing is loading. */
  empty?: ComponentChildren;
  /** Makes the whole row activate one thing. See DataTableRowAction. */
  rowAction?: (row: Row) => DataTableRowAction | undefined;
  /**
   * An expanded region belonging to the row above it, spanning every column.
   * Return nothing for rows that have none.
   */
  detailRow?: (row: Row) => ComponentChildren;
}

/**
 * The row's activation, as a real control. Its own text is for assistive
 * technology only - what a sighted reader sees is the row.
 */
function RowActionControl({ action }: { action: DataTableRowAction }) {
  if (action.href) {
    return (
      <a class="pk-table__row-link" href={action.href}>
        <span class="pk-table__sr">{action.label}</span>
      </a>
    );
  }
  return (
    <button type="button" class="pk-table__row-link" onClick={action.onSelect}>
      <span class="pk-table__sr">{action.label}</span>
    </button>
  );
}

/*
 * Alignment is the utilities' `pk-center`/`pk-end`, not a pair of table-only
 * classes. The table used to define its own, which meant two names for one
 * declaration and — once the Markdown render hook started drawing tables too —
 * a second copy of them in the entry stylesheet, which has no room for one.
 * The utilities layer also beats the components layer, so an aligned column
 * needs no extra specificity to hold.
 */
function alignClass(align: DataTableColumn<unknown>["align"]): string | undefined {
  if (align === "end") return "pk-end";
  if (align === "center") return "pk-center";
  return undefined;
}

/*
 * Width is the table's own class, not a utility: it is a rule about the column,
 * so it has to land on the `<th>` and on every `<td>` beneath it, and it means
 * nothing anywhere else on the page.
 */
function widthClass(width: DataTableColumn<unknown>["width"]): string | undefined {
  if (width === "fit") return "pk-table__col--fit";
  if (width === "primary") return "pk-table__col--primary";
  return undefined;
}

function classList(...names: Array<string | undefined>): string | undefined {
  const used = names.filter(Boolean);
  return used.length > 0 ? used.join(" ") : undefined;
}

function nextDirection(sort: DataTableProps<unknown>["sort"], columnId: string): SortDirection {
  if (!sort || sort.columnId !== columnId) return "asc";
  return sort.direction === "asc" ? "desc" : "asc";
}

export function DataTable<Row>({
  caption,
  showCaption = false,
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  selection,
  loading = false,
  loadingRows = 3,
  empty,
  rowAction,
  detailRow,
}: DataTableProps<Row>) {
  const keys = rows.map(rowKey);
  const allSelected = Boolean(selection) && keys.length > 0 && keys.every((key) => selection?.selected.has(key));
  const someSelected = Boolean(selection) && keys.some((key) => selection?.selected.has(key));
  const isEmpty = !loading && rows.length === 0;
  const columnCount = columns.length + (selection ? 1 : 0);

  function toggleAll() {
    if (!selection) return;
    selection.onChange(allSelected ? new Set() : new Set(keys));
  }

  function toggleRow(key: string) {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange(next);
  }

  return (
    <div class="pk-table__scroll">
      <table class="pk-table" aria-busy={loading ? "true" : undefined}>
        <caption class={showCaption ? "pk-table__caption" : "pk-table__caption pk-table__caption--hidden"}>
          {caption}
        </caption>
        <thead>
          <tr>
            {selection && (
              <th scope="col" class="pk-table__select">
                <input
                  type="checkbox"
                  class="pk-table__checkbox"
                  checked={allSelected}
                  // Some-but-not-all is a third state; without it the header
                  // box reads as "nothing selected" while rows are selected.
                  indeterminate={someSelected && !allSelected}
                  aria-label={allSelected ? "Clear selection" : "Select all rows"}
                  onChange={toggleAll}
                />
              </th>
            )}
            {columns.map((column) => {
              const sorted = sort?.columnId === column.id;
              return (
                <th
                  key={column.id}
                  scope="col"
                  class={classList(alignClass(column.align), widthClass(column.width))}
                  aria-sort={sorted ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                >
                  {column.sortable && onSort ? (
                    <button
                      type="button"
                      class="pk-table__sort"
                      onClick={() => onSort(column.id, nextDirection(sort, column.id))}
                    >
                      <span class={column.headerHidden ? "pk-table__sr" : undefined}>{column.header}</span>
                      <span class="pk-table__arrow" aria-hidden="true">
                        {sorted ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  ) : (
                    <span class={column.headerHidden ? "pk-table__sr" : undefined}>{column.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const selected = Boolean(selection?.selected.has(key));
            const action = rowAction?.(row);
            const detail = detailRow?.(row);
            return (
              <Fragment key={key}>
                <tr
                  aria-selected={selection ? selected : undefined}
                  class={action ? "pk-table__row--action" : undefined}
                >
                  {selection && (
                    <td class="pk-table__select">
                      <input
                        type="checkbox"
                        class="pk-table__checkbox"
                        checked={selected}
                        aria-label={selection.rowLabel(key)}
                        onChange={() => toggleRow(key)}
                      />
                    </td>
                  )}
                  {columns.map((column, index) => (
                    <td
                      key={column.id}
                      class={classList(alignClass(column.align), widthClass(column.width), column.cellClass)}
                    >
                      {/* The stretched control goes in the first cell so it
                          precedes the row's content in the tab order, and so a
                          cell that already holds its own buttons - the actions
                          column - is not covered by it. */}
                      {index === 0 && action && <RowActionControl action={action} />}
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
                {detail !== undefined && detail !== null && detail !== false && (
                  <tr class="pk-table__detail">
                    <td colSpan={columnCount}>{detail}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}

          {loading &&
            Array.from({ length: loadingRows }, (_unused, index) => (
              // Placeholders carry no information, so they are hidden from
              // assistive technology; `aria-busy` on the table is what says
              // something is happening.
              <tr key={`pk-loading-${String(index)}`} aria-hidden="true" class="pk-table__placeholder">
                {selection && (
                  <td class="pk-table__select">
                    <span class="pk-table__skeleton" />
                  </td>
                )}
                {/* The width hints ride the placeholders too, so the columns
                    do not jump the moment the real rows land. */}
                {columns.map((column) => (
                  <td key={column.id} class={widthClass(column.width)}>
                    <span class="pk-table__skeleton" />
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>

      {isEmpty && <div class="pk-table__empty">{empty}</div>}
    </div>
  );
}
