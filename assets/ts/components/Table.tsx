/**
 * The portal's column API, rendered by the design system's table.
 *
 * This is a translation layer, not a second table. The portal describes a
 * column as `{ header, cell, className, sort: { asc, desc } }`, where the sort
 * keys are the opaque strings the D1 query understands; the design system
 * describes one as `{ id, header, cell, sortable, align }` and reports sort as
 * a column plus a direction. Neither shape is wrong: the server's vocabulary
 * belongs to the server, and a reusable table cannot know it. This maps one
 * onto the other in one place instead of at fifty call sites.
 *
 * What the version it replaces got wrong, and what moves with this change:
 *
 *   - `onRowClick` put a click handler on the `<tr>`. A table row is not
 *     focusable and takes no Enter key, so fourteen portal lists could be
 *     used with a mouse and not with a keyboard. Row activation is now a real
 *     control, stretched over the row by the design system.
 *   - Tables had no caption, so a screen reader listing the tables on a page
 *     got a list of unnamed tables. `caption` is required here.
 *   - `className` on a column carried Bootstrap (`text-end`, `mono`,
 *     `text-nowrap`). That vocabulary is closed and small, so it is
 *     translated rather than passed through.
 */

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

import {
  DataTable as SystemDataTable,
  type DataTableColumn,
  type DataTableColumnWidth,
  type DataTableSelection,
  type SortDirection,
} from "../ui/DataTable";
import { Menu, type MenuItem } from "../ui/Menu";
import type { FilterOption } from "./FilterSelect";
import { AppliedFilterChips, ColumnTextFilterRow, type AppliedFilterChip } from "./table-filter-strip";
import "../ui/Content.css";

export type HeadCell = string | { label: string; className?: string };

export interface ColumnSort {
  /** The `sort` query value that orders this column ascending. */
  asc: string;
  desc: string;
  defaultDirection?: SortDirection;
}

export interface Column<T> {
  header: HeadCell;
  cell: (row: T, index: number) => ComponentChildren;
  className?: string;
  sort?: ColumnSort;
  /**
   * How wide the column may be — see `DataTableColumnWidth`.
   *
   * This is where a column states its width, rather than a page reaching for
   * `pk-nowrap` on the cells. Thirty-one columns across the portal did the
   * latter, which kept a date on one line but still let the column take a
   * proportional share of a wide screen's leftover width.
   */
  width?: DataTableColumnWidth;
  /**
   * What the column can be narrowed by: the query parameter the server
   * filters on and the values it accepts. The first option is the open state
   * — "All stages" — and carries the empty value. The table owns which value
   * is in force; the column only declares the vocabulary. This is where a
   * list's filters live now, rather than as a row of selects in the toolbar:
   * a table with ten filterable columns keeps a clean head, and the reader
   * finds a column's filter where the column is.
   */
  filter?: ColumnFilter;
  /**
   * Whether the reader may take the column out of the table. The subject
   * column and the row's actions cannot be hidden — a list without its subject
   * is not a list — so those default to false; everything else to true.
   */
  hideable?: boolean;
}

export interface ColumnFilter {
  param: string;
  /**
   * The closed vocabulary the column accepts, offered in its menu. The first
   * option is the open state — "All stages" — and carries the empty value.
   */
  options?: readonly FilterOption[];
  /**
   * The open-vocabulary alternative, declared instead of `options` when the
   * value set is a name or an organization rather than a short known list.
   * The menu then offers "Filter this column…", which opens a typed control
   * above the rows; the server does the matching, as it does for `options`.
   */
  text?: ColumnTextFilter;
}

export interface ColumnTextFilter {
  placeholder?: string;
  /** Said under the control, e.g. where the match runs. */
  hint?: string;
  /** Values the server offers for this column, as type-ahead suggestions. */
  suggestions?: readonly string[];
}

/**
 * The label an unnamed column is given for assistive technology.
 *
 * Every column in the portal that omits its header is the row's actions, and
 * all nineteen of them rendered a `<th>` with nothing in it: a screen reader
 * announced "Revoke administrator role" under a column with no name, and the
 * design system's own example — which names the column and hides the label —
 * was the only table doing it correctly. So the convention is stated here once
 * rather than repeated at every list.
 */
const ACTIONS_COLUMN_LABEL = "Actions";

/**
 * The presentational vocabulary a column's `className` was allowed to use.
 * Anything outside this is dropped rather than passed through, because a
 * class the design system does not define renders unstyled once the surface
 * stops loading Bootstrap.
 *
 * `nowrap` is deliberately absent: it is a width decision, and it is now
 * translated into `width: "fit"` so the column hugs its content instead of
 * merely refusing to break it. See `widthOf`.
 */
const CELL_UTILITY: Record<string, string> = {
  mono: "pk-mono",
  small: "pk-small",
  "text-muted": "pk-muted",
  "pk-mono": "pk-mono",
  "pk-small": "pk-small",
  "pk-muted": "pk-muted",
};

const NOWRAP_CLASSES = ["text-nowrap", "pk-nowrap"];

function headLabel(head: HeadCell): string {
  return typeof head === "string" ? head : head.label;
}

function headClass(head: HeadCell): string {
  return typeof head === "string" ? "" : (head.className ?? "");
}

function alignOf(...classNames: string[]): DataTableColumn<unknown>["align"] {
  const tokens = classNames.join(" ").split(/\s+/);
  // Both vocabularies, so a migrated surface can say `pk-end` without writing
  // a Bootstrap token into a file the isolation gate holds at zero, and an
  // unmigrated one keeps working until it is converted.
  if (tokens.includes("text-end") || tokens.includes("pk-end")) return "end";
  if (tokens.includes("text-center") || tokens.includes("pk-center")) return "center";
  return undefined;
}

/**
 * A column's width: what it says, or what its cell classes implied.
 *
 * A column that asked for `nowrap` was always saying "this value has a bounded
 * length" — a date, a count, an identifier. That is the `fit` hint, so the
 * lists that already say it get the whole behaviour without each of them being
 * edited, and new columns say it on the definition instead.
 */
function widthOf<T>(column: Column<T>): DataTableColumnWidth | undefined {
  if (column.width) return column.width;
  const tokens = `${headClass(column.header)} ${column.className ?? ""}`.split(/\s+/);
  return tokens.some((token) => NOWRAP_CLASSES.includes(token)) ? "fit" : undefined;
}

function widthFor<T>(column: Column<T>, index: number, slackIndex: number): DataTableColumnWidth | undefined {
  const stated = widthOf(column);
  if (stated) return stated;
  return index === slackIndex ? "primary" : undefined;
}

function utilitiesOf(className: string | undefined): string | undefined {
  if (!className) return undefined;
  const mapped = className
    .split(/\s+/)
    .map((token) => CELL_UTILITY[token])
    .filter(Boolean);
  return mapped.length > 0 ? [...new Set(mapped)].join(" ") : undefined;
}

export interface DataTableProps<T> {
  /** Names the table. Hidden unless `showCaption`, but always announced. */
  caption: string;
  showCaption?: boolean;
  columns: Column<T>[];
  data: T[];
  empty?: ComponentChildren;
  rowKey?: (row: T, index: number) => string | number;
  detailRow?: (row: T, index: number) => ComponentChildren;
  /**
   * What activating a row does. Prefer `href`: a link can be opened in a new
   * tab, and it says where it goes.
   */
  rowAction?: (row: T, index: number) => { label: string; href?: string; onSelect?: () => void } | undefined;
  /** The current `sort` query value, as the server understands it. */
  currentSort?: string;
  onSort?: (nextSort: string) => void;
  loading?: boolean;
  /**
   * Row selection, passed through to the design system's table. Only for
   * lists whose API actually takes a set of row ids — a checkbox column in
   * front of rows nothing can act on is decoration. The keys in `selected`
   * are the same strings `rowKey` produces.
   */
  selection?: DataTableSelection;
  /** The column filters in force, by query parameter. */
  filters?: Record<string, string>;
  /** Called with the parameter and its new value ("" opens the column back up). */
  onFilterChange?: (param: string, value: string) => void;
}

export function DataTable<T>({
  caption,
  showCaption,
  columns,
  data,
  empty = "No data",
  rowKey,
  detailRow,
  rowAction,
  currentSort,
  onSort,
  loading,
  selection,
  filters = {},
  onFilterChange,
}: DataTableProps<T>) {
  // Hidden columns are the reader's choice for this visit; they are keyed by
  // header so the choice survives a re-render that rebuilds the column list.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // Which column's typed filter is open, by query parameter. One at a time:
  // the row appears above the rows it narrows, and two of them would push the
  // table further from the control acting on it.
  const [filterOpen, setFilterOpen] = useState<string | null>(null);
  // Row identity is by index when the caller has no key, so `rowKey` here is
  // an index lookup rather than a value the design system interprets.
  const indexOf = new Map<T, number>();
  data.forEach((row, index) => indexOf.set(row, index));
  const keyFor = (row: T) => {
    const index = indexOf.get(row) ?? 0;
    return String(rowKey ? rowKey(row, index) : index);
  };

  /*
   * One column takes a wide screen's slack. When no column claims `primary`,
   * the first one gets it: a list leads with its subject, and the subject is
   * where extra room does the most good. Without this, `table-layout: auto`
   * shares the slack in proportion to content and every column drifts apart.
   */
  const primaryIndex = columns.findIndex((column) => column.width === "primary");
  const slackIndex =
    primaryIndex >= 0 ? primaryIndex : columns.findIndex((column) => headLabel(column.header).trim().length > 0);

  const canHide = (column: Column<T>, index: number) =>
    column.hideable ?? (index !== slackIndex && headLabel(column.header).trim().length > 0);

  /**
   * The column's commands, in the order a reader reaches for them: the sort
   * directions, then the values it can be narrowed to, then hiding it. Each
   * choice shows whether it is the one in force, so the menu is also where the
   * reader sees the table's current shape.
   */
  function menuFor(column: Column<T>, index: number): MenuItem[] {
    const id = `column-${String(index)}`;
    const items: MenuItem[] = [];
    const columnSort = column.sort;
    if (columnSort && onSort) {
      items.push(
        {
          id: `${id}-asc`,
          label: "Sort ascending",
          checked: currentSort === columnSort.asc,
          onSelect: () => onSort(columnSort.asc),
        },
        {
          id: `${id}-desc`,
          label: "Sort descending",
          checked: currentSort === columnSort.desc,
          onSelect: () => onSort(columnSort.desc),
        },
      );
    }
    const columnFilter = column.filter;
    if (columnFilter && onFilterChange) {
      const current = filters[columnFilter.param] ?? "";
      columnFilter.options?.forEach((option, position) => {
        items.push({
          id: `${id}-filter-${option.value || "all"}`,
          label: option.label,
          checked: current === option.value,
          separatorBefore: position === 0 && items.length > 0,
          onSelect: () => onFilterChange(columnFilter.param, option.value),
        });
      });
      if (columnFilter.text) {
        // An open vocabulary cannot be listed, so the menu offers the control
        // that can take one. "Edit" rather than "Filter" once something is in
        // force, so the item says whether the column is already narrowed.
        items.push({
          id: `${id}-filter-text`,
          label: current ? "Edit filter…" : "Filter this column…",
          separatorBefore: items.length > 0,
          onSelect: () => setFilterOpen(columnFilter.param),
        });
        if (current) {
          items.push({
            id: `${id}-filter-clear`,
            label: "Clear filter",
            onSelect: () => {
              onFilterChange(columnFilter.param, "");
              setFilterOpen((open) => (open === columnFilter.param ? null : open));
            },
          });
        }
      }
    }
    if (canHide(column, index)) {
      items.push({
        id: `${id}-hide`,
        label: "Hide column",
        separatorBefore: items.length > 0,
        onSelect: () => setHidden((current) => new Set([...current, headLabel(column.header)])),
      });
    }
    return items;
  }

  function filterSummaryFor(column: Column<T>): string | undefined {
    if (!column.filter) return undefined;
    const current = filters[column.filter.param];
    if (!current) return undefined;
    // A typed value is its own summary; an enum value reads by its label, so
    // "role=observer" is stated as the word the reader chose.
    return column.filter.options?.find((option) => option.value === current)?.label ?? current;
  }

  const visible = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !hidden.has(headLabel(column.header)));

  const systemColumns: DataTableColumn<T>[] = visible.map(({ column, index }) => {
    const label = headLabel(column.header);
    // A column with no header is the row's actions: named for assistive
    // technology, unlabelled on screen, and at the end of the row. It is NOT
    // made a `fit` column — an actions cell is often a wrapping cluster of
    // controls, and hugging it to its minimum stacks them one per line.
    const isActions = label.trim().length === 0;
    return {
      id: `column-${String(index)}`,
      header: isActions ? ACTIONS_COLUMN_LABEL : label,
      headerHidden: isActions || undefined,
      cell: (row) => column.cell(row, indexOf.get(row) ?? 0),
      sortable: Boolean(column.sort),
      align: alignOf(headClass(column.header), column.className ?? "") ?? (isActions ? "end" : undefined),
      width: widthFor(column, index, slackIndex),
      cellClass: utilitiesOf(column.className),
      menu: isActions ? undefined : menuFor(column, index),
      filterSummary: filterSummaryFor(column),
    };
  });

  // Hidden columns come back from one place: a menu at the end of the head
  // that lists every column the reader may hide, checked while it is shown.
  const columnsMenu: MenuItem[] = columns.flatMap((column, index) => {
    if (!canHide(column, index)) return [];
    const label = headLabel(column.header);
    return [
      {
        id: `columns-${String(index)}`,
        label,
        checked: !hidden.has(label),
        onSelect: () =>
          setHidden((current) => {
            const next = new Set(current);
            if (next.has(label)) next.delete(label);
            else next.add(label);
            return next;
          }),
      },
    ];
  });

  // Which column the server's opaque sort string belongs to, and which way.
  let sort: { columnId: string; direction: SortDirection } | undefined;
  for (const [index, column] of columns.entries()) {
    if (!column.sort || !currentSort) continue;
    if (currentSort === column.sort.asc) sort = { columnId: `column-${String(index)}`, direction: "asc" };
    else if (currentSort === column.sort.desc) sort = { columnId: `column-${String(index)}`, direction: "desc" };
  }

  function handleSort(columnId: string, direction: SortDirection) {
    const index = Number(columnId.replace("column-", ""));
    const column = columns[index];
    if (!column?.sort || !onSort) return;
    // A column the reader has not sorted yet opens on its natural direction —
    // newest first for a date, A–Z for a name — rather than always ascending.
    const untouched = !sort || sort.columnId !== columnId;
    const next = untouched ? column.sort[column.sort.defaultDirection ?? "desc"] : column.sort[direction];
    onSort(next);
  }

  // Every narrowing in force, in one sentence above the rows. A column menu
  // states its own filter at the column; this states the whole query, so a
  // reader looking at eleven rows learns why without opening four menus.
  const chips: AppliedFilterChip[] = [];
  if (onFilterChange) {
    for (const { column } of visible) {
      const columnFilter = column.filter;
      const summary = columnFilter ? filterSummaryFor(column) : undefined;
      if (!columnFilter || summary === undefined) continue;
      const label = headLabel(column.header);
      chips.push({
        id: `filter-${columnFilter.param}`,
        label: `${label}: ${summary}`,
        clearLabel: `Clear the ${label} filter`,
        onClear: () => {
          onFilterChange(columnFilter.param, "");
          setFilterOpen((open) => (open === columnFilter.param ? null : open));
        },
      });
    }
  }
  for (const label of hidden) {
    chips.push({
      id: `hidden-${label}`,
      label: `${label} hidden`,
      clearLabel: `Show the ${label} column`,
      onClear: () =>
        setHidden((current) => {
          const next = new Set(current);
          next.delete(label);
          return next;
        }),
    });
  }

  const openColumn = filterOpen ? columns.find((column) => column.filter?.param === filterOpen) : undefined;
  const openTextFilter = openColumn?.filter?.text;

  // A fragment, deliberately: `pk-table-list` is a flex column whose regions
  // separate with rules and a zero gap, so these bands have to be siblings of
  // the table. A wrapper would collapse them into one region.
  return (
    <>
      <AppliedFilterChips chips={chips} />
      {openColumn && openTextFilter && onFilterChange && (
        <ColumnTextFilterRow
          columnLabel={headLabel(openColumn.header)}
          value={filters[filterOpen ?? ""] ?? ""}
          suggestions={openTextFilter.suggestions}
          placeholder={openTextFilter.placeholder}
          hint={openTextFilter.hint}
          onInput={(value) => {
            onFilterChange(filterOpen ?? "", value);
          }}
          onClose={() => setFilterOpen(null)}
        />
      )}
      <SystemDataTable
        caption={caption}
        showCaption={showCaption}
        columns={systemColumns}
        rows={data}
        rowKey={keyFor}
        sort={sort}
        onSort={onSort ? handleSort : undefined}
        rowAction={rowAction ? (row) => rowAction(row, indexOf.get(row) ?? 0) : undefined}
        detailRow={detailRow ? (row) => detailRow(row, indexOf.get(row) ?? 0) : undefined}
        loading={loading}
        empty={empty}
        selection={selection}
        headerEnd={
          columnsMenu.length > 0 ? (
            <Menu label="Choose columns" heading="Columns" items={columnsMenu} align="end">
              <span class="pk-table__head-glyph pk-table__head-glyph--columns" aria-hidden="true" />
            </Menu>
          ) : undefined
        }
      />
    </>
  );
}
