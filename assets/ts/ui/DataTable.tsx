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

import type { ComponentChildren } from "preact";

import "./DataTable.css";

export type SortDirection = "asc" | "desc";

export interface DataTableColumn<Row> {
  id: string;
  header: string;
  /** Omit to render nothing for this column. */
  cell: (row: Row) => ComponentChildren;
  sortable?: boolean;
  align?: "start" | "end";
  /** Renders the header for assistive technology only, e.g. an actions column. */
  headerHidden?: boolean;
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
}: DataTableProps<Row>) {
  const keys = rows.map(rowKey);
  const allSelected = Boolean(selection) && keys.length > 0 && keys.every((key) => selection?.selected.has(key));
  const someSelected = Boolean(selection) && keys.some((key) => selection?.selected.has(key));
  const isEmpty = !loading && rows.length === 0;

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
                  class={column.align === "end" ? "pk-table__cell--end" : undefined}
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
            return (
              <tr key={key} aria-selected={selection ? selected : undefined}>
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
                {columns.map((column) => (
                  <td key={column.id} class={column.align === "end" ? "pk-table__cell--end" : undefined}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
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
                {columns.map((column) => (
                  <td key={column.id}>
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
