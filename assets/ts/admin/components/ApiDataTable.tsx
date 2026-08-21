import type { ComponentChildren } from "preact";
import { useEffect, useState, type MutableRef } from "preact/hooks";
import type { z } from "zod";
import type { PageInfo } from "../../../shared/schemas/pagination";
import { DataTable, type DataTableProps } from "../../components/Table";
import { ErrorAlert } from "../../components/ErrorAlert";
import { Pager } from "../../components/Pager";
import { Spinner } from "../../components/Spinner";
import { useOffsetPager } from "../../hooks/useOffsetPager";
import { useServerCollection } from "../../hooks/useServerCollection";
import { loadAdminCollection } from "../services/server-collection";

export interface ApiTableActions {
  reload: () => void;
  resetPage: () => void;
}

export interface ApiDataTableProps<T, Response> extends Omit<DataTableProps<T>, "data" | "currentSort" | "onSort"> {
  endpoint: string;
  resolve: (data: Response) => T[];
  responseSchema: z.ZodType<Response>;
  resolvePage: (data: Response) => PageInfo;
  params?: Record<string, string>;
  paginate?: boolean;
  searchPlaceholder?: string;
  initialPageSize?: number;
  initialSort?: string;
  toolbar?: (actions: ApiTableActions) => ComponentChildren;
  actionsRef?: MutableRef<ApiTableActions | null>;
}

/** Connects the shared presentational DataTable to an admin API collection. */
export function ApiDataTable<T, Response = unknown>({
  endpoint,
  resolve,
  responseSchema,
  resolvePage,
  columns,
  params,
  paginate = false,
  searchPlaceholder,
  initialPageSize,
  empty,
  className,
  rowKey,
  rowClass,
  onRowClick,
  detailRow,
  initialSort = "",
  toolbar,
  actionsRef,
}: ApiDataTableProps<T, Response>) {
  const pager = useOffsetPager(initialPageSize);
  const serializedParams = JSON.stringify(
    Object.entries(params ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );

  useEffect(() => {
    pager.resetPage();
  }, [endpoint, serializedParams, pager.resetPage]);

  const [sort, setSort] = useState(initialSort);
  function applySort(nextSort: string) {
    setSort(nextSort);
    pager.resetPage();
  }

  const [search, setSearch] = useState("");
  const [pendingSearch, setPendingSearch] = useState("");
  function applySearch() {
    setSearch(pendingSearch);
    pager.resetPage();
  }

  const collection = useServerCollection({
    endpoint,
    params: {
      ...params,
      ...(paginate ? { limit: String(pager.pageSize), offset: String(pager.offset) } : {}),
      ...(search ? { q: search } : {}),
      ...(sort ? { sort } : {}),
    },
    responseSchema,
    load: loadAdminCollection,
  });

  const actions: ApiTableActions = { reload: collection.reload, resetPage: pager.resetPage };
  if (actionsRef) actionsRef.current = actions;

  const rows = collection.data ? resolve(collection.data) : [];
  const pageInfo = collection.data ? resolvePage(collection.data) : null;
  const pagerProps = pager.pagerProps({
    hasMore: pageInfo?.hasMore ?? false,
    rowCount: rows.length,
    total: pageInfo?.total ?? 0,
    serverOffset: pageInfo?.offset,
  });

  return (
    <div>
      {(searchPlaceholder || toolbar) && (
        <div class="d-flex gap-2 align-items-center mb-2 flex-wrap">
          {searchPlaceholder && (
            <input
              type="search"
              class="form-control form-control-sm adm-search-input"
              placeholder={searchPlaceholder}
              value={pendingSearch}
              onInput={(event) => setPendingSearch((event.target as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applySearch();
              }}
            />
          )}
          {toolbar?.(actions)}
          <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={collection.reload}>
            ↺ Refresh
          </button>
        </div>
      )}

      {collection.loading ? (
        <Spinner />
      ) : collection.error ? (
        <ErrorAlert error={collection.error} />
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
