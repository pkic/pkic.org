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

import { DataTable as SystemDataTable, type DataTableColumn, type SortDirection } from "../ui/DataTable";
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
}

/**
 * The presentational vocabulary a column's `className` was allowed to use.
 * Anything outside this is dropped rather than passed through, because a
 * class the design system does not define renders unstyled once the surface
 * stops loading Bootstrap.
 */
const CELL_UTILITY: Record<string, string> = {
  mono: "pk-mono",
  small: "pk-small",
  "text-muted": "pk-muted",
  "text-nowrap": "pk-nowrap",
  "pk-mono": "pk-mono",
  "pk-small": "pk-small",
  "pk-muted": "pk-muted",
  "pk-nowrap": "pk-nowrap",
};

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
}: DataTableProps<T>) {
  // Row identity is by index when the caller has no key, so `rowKey` here is
  // an index lookup rather than a value the design system interprets.
  const indexOf = new Map<T, number>();
  data.forEach((row, index) => indexOf.set(row, index));
  const keyFor = (row: T) => {
    const index = indexOf.get(row) ?? 0;
    return String(rowKey ? rowKey(row, index) : index);
  };

  const systemColumns: DataTableColumn<T>[] = columns.map((column, index) => ({
    id: `column-${String(index)}`,
    header: headLabel(column.header),
    cell: (row) => column.cell(row, indexOf.get(row) ?? 0),
    sortable: Boolean(column.sort),
    align: alignOf(headClass(column.header), column.className ?? ""),
    cellClass: utilitiesOf(column.className),
  }));

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

  return (
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
    />
  );
}
