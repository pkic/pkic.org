import { Fragment, type ComponentChildren } from "preact";
import { useState, useEffect, useCallback, type MutableRef } from "preact/hooks";
import { Pager, ADMIN_LIST_PAGE_SIZE_DEFAULT } from "./Pager";
import { Spinner } from "./Spinner";
import { ErrorAlert } from "./ErrorAlert";
import { api } from "../admin/api";

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

interface DataTableProps<T> {
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

// ─── API-connected DataTable ──────────────────────────────────────────────────

interface PageInfo {
  total: number;
  hasMore: boolean;
}

export interface ApiTableActions {
  reload: () => void;
  resetPage: () => void;
}

export interface ApiDataTableProps<T> {
  /** API endpoint path (without query string) */
  endpoint: string;
  /** Extract the row array from the API response */
  resolve: (data: unknown) => T[];
  /** Extract pagination info; omit for non-paginated tables */
  resolvePage?: (data: unknown) => PageInfo;
  /** Column definitions */
  columns: Column<T>[];
  /** Extra query params merged into every request */
  params?: Record<string, string>;
  /** Enable server-side pagination */
  paginate?: boolean;
  /** Enable a search input */
  searchPlaceholder?: string;
  /** Empty-state message */
  empty?: string;
  /** Table class */
  className?: string;
  /** Row key extractor */
  rowKey?: (row: T, index: number) => string | number;
  /** Row class extractor */
  rowClass?: (row: T, index: number) => string | undefined;
  /** Row click handler */
  onRowClick?: (row: T) => void;
  /** Optional full-width detail row rendered after each data row */
  detailRow?: (row: T, index: number) => ComponentChildren;
  /** Initial server-side sort value. Sortable columns send their configured value as `sort`. */
  initialSort?: string;
  /** Toolbar rendered between search and refresh (e.g., filter selects, action buttons) */
  toolbar?: (actions: ApiTableActions) => ComponentChildren;
  /** Ref to expose reload/resetPage to parent for cell-level actions */
  actionsRef?: MutableRef<ApiTableActions | null>;
  /** Extra dependencies that should trigger a re-fetch */
  deps?: unknown[];
}

export function ApiDataTable<T>({
  endpoint,
  resolve,
  resolvePage,
  columns,
  params,
  paginate = false,
  searchPlaceholder,
  empty,
  className,
  rowKey,
  rowClass,
  onRowClick,
  detailRow,
  initialSort = "",
  toolbar,
  actionsRef,
  deps = [],
}: ApiDataTableProps<T>) {
  // ── pagination state ────────────────────────────────────────────────────
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(ADMIN_LIST_PAGE_SIZE_DEFAULT);
  const page = pageSize > 0 ? Math.floor(offset / pageSize) + 1 : 1;
  function resetPage() {
    setOffset(0);
  }

  // ── sorting state ───────────────────────────────────────────────────────
  const [sort, setSort] = useState(initialSort);
  function applySort(nextSort: string) {
    setSort(nextSort);
    setOffset(0);
  }

  // ── search state ────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [pendingSearch, setPendingSearch] = useState("");
  function applySearch() {
    setSearch(pendingSearch);
    setOffset(0);
  }

  // ── data fetching ───────────────────────────────────────────────────────
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams(params);
      if (paginate) {
        qs.set("limit", String(pageSize));
        qs.set("offset", String(offset));
      }
      if (search) qs.set("q", search);
      if (sort) qs.set("sort", sort);
      const qstr = qs.toString();
      const url = qstr ? `${endpoint}?${qstr}` : endpoint;
      const result = await api(url);
      setData(result);
      setLoading(false);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }, [endpoint, search, sort, pageSize, offset, JSON.stringify(params), ...deps]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── expose actions to parent ────────────────────────────────────────────
  const actions: ApiTableActions = { reload: load, resetPage };
  if (actionsRef) actionsRef.current = actions;

  // ── derived state ───────────────────────────────────────────────────────
  const rows = data ? resolve(data) : [];
  const pageInfo = data && resolvePage ? resolvePage(data) : null;
  const total = pageInfo?.total ?? 0;
  const hasMore = pageInfo?.hasMore ?? false;

  const pagerProps = {
    page,
    hasMore,
    pageSize,
    offset,
    rowCount: rows.length,
    total,
    onPrev: () => setOffset((o) => Math.max(0, o - pageSize)),
    onNext: () => setOffset((o) => o + pageSize),
    onJump: (p: number) => setOffset((p - 1) * pageSize),
    onPageSizeChange: (s: number) => {
      setPageSize(s);
      setOffset(0);
    },
  };

  // ── render ──────────────────────────────────────────────────────────────
  const showToolbar = searchPlaceholder || toolbar;

  return (
    <div>
      {showToolbar && (
        <div class="d-flex gap-2 align-items-center mb-2 flex-wrap">
          {searchPlaceholder && (
            <input
              type="search"
              class="form-control form-control-sm adm-search-input"
              placeholder={searchPlaceholder}
              value={pendingSearch}
              onInput={(e) => setPendingSearch((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySearch();
              }}
            />
          )}
          {toolbar?.(actions)}
          <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void load()}>
            ↺ Refresh
          </button>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorAlert error={error} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={rows}
            empty={empty}
            className={className}
            rowKey={rowKey}
            rowClass={rowClass}
            onRowClick={onRowClick}
            detailRow={detailRow}
            currentSort={sort}
            onSort={applySort}
          />
          {paginate && <Pager {...pagerProps} />}
        </>
      )}
    </div>
  );
}
