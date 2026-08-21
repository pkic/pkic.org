import { Fragment, type ComponentChildren } from "preact";

// ─── Shared types ─────────────────────────────────────────────────────────────

type HeadCell = string | { label: string; className?: string };
type SortDirection = "asc" | "desc";

export interface ColumnSort {
  asc: string;
  desc: string;
  defaultDirection?: SortDirection;
}

function renderHead(
  h: HeadCell,
  i: number,
  sort?: ColumnSort,
  currentSort?: string,
  onSort?: (nextSort: string) => void,
) {
  const cell = typeof h === "string" ? { label: h } : h;
  const isAsc = sort ? currentSort === sort.asc : false;
  const isDesc = sort ? currentSort === sort.desc : false;
  const active = isAsc || isDesc;
  const nextSort = sort ? (isDesc ? sort.asc : isAsc ? sort.desc : sort[sort.defaultDirection ?? "desc"]) : "";

  return (
    <th key={i} class={cell.className}>
      {sort && onSort ? (
        <button
          type="button"
          class={`tbl-sort-btn${active ? " is-active" : ""}`}
          onClick={() => onSort(nextSort)}
          aria-sort={isAsc ? "ascending" : isDesc ? "descending" : "none"}
        >
          <span>{cell.label}</span>
          <span aria-hidden="true" class="tbl-sort-indicator">
            {isAsc ? "▲" : isDesc ? "▼" : "↕"}
          </span>
        </button>
      ) : (
        cell.label
      )}
    </th>
  );
}

// ─── Children-based Table (for complex row rendering) ─────────────────────────

interface TableProps {
  heads: HeadCell[];
  empty?: string;
  className?: string;
  children?: ComponentChildren;
}

export function Table({ heads, empty = "No data", className, children }: TableProps) {
  const hasRows = children !== undefined && children !== null && children !== false;
  return (
    <div class="tbl-wrap">
      <table class={`table table-sm table-hover mb-0${className ? ` ${className}` : ""}`}>
        <thead class="table-dark">
          <tr>{heads.map((head, i) => renderHead(head, i))}</tr>
        </thead>
        <tbody>
          {hasRows ? (
            children
          ) : (
            <tr>
              <td colspan={heads.length} class="text-center text-muted fst-italic py-3">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Column-based DataTable ───────────────────────────────────────────────────

export interface Column<T> {
  header: HeadCell;
  cell: (row: T, index: number) => ComponentChildren;
  className?: string;
  sort?: ColumnSort;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  empty?: string;
  className?: string;
  rowKey?: (row: T, index: number) => string | number;
  rowClass?: (row: T, index: number) => string | undefined;
  onRowClick?: (row: T) => void;
  detailRow?: (row: T, index: number) => ComponentChildren;
  currentSort?: string;
  onSort?: (nextSort: string) => void;
}

export function DataTable<T>({
  columns,
  data,
  empty = "No data",
  className,
  rowKey,
  rowClass,
  onRowClick,
  detailRow,
  currentSort,
  onSort,
}: DataTableProps<T>) {
  return (
    <div class="tbl-wrap">
      <table class={`table table-sm table-hover mb-0${className ? ` ${className}` : ""}`}>
        <thead class="table-dark">
          <tr>{columns.map((col, i) => renderHead(col.header, i, col.sort, currentSort, onSort))}</tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colspan={columns.length} class="text-center text-muted fst-italic py-3">
                {empty}
              </td>
            </tr>
          ) : (
            data.map((row, i) => {
              const key = rowKey ? rowKey(row, i) : i;
              const detail = detailRow?.(row, i);
              return (
                <Fragment key={key}>
                  <tr
                    class={
                      [rowClass?.(row, i), onRowClick ? "tbl-row-link" : ""].filter(Boolean).join(" ") || undefined
                    }
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((col, ci) => (
                      <td key={ci} class={col.className}>
                        {col.cell(row, i)}
                      </td>
                    ))}
                  </tr>
                  {detail && (
                    <tr>
                      <td colspan={columns.length} class="p-0">
                        {detail}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
