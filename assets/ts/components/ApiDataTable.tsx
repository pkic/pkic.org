import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState, type MutableRef } from "preact/hooks";
import type { z } from "zod";
import type { PageInfo } from "../../shared/schemas/pagination";
import { useOffsetPager } from "../hooks/useOffsetPager";
import {
  buildCollectionResetKey,
  useCollectionOffset,
  useServerCollection,
  type CollectionLoader,
} from "../hooks/useServerCollection";
import { getJson } from "../shared/api-client";
import { ErrorAlert } from "./ErrorAlert";
import { Pager } from "./Pager";
import { Spinner } from "./Spinner";
import { DataTable, type DataTableProps } from "./Table";

export interface ApiTableActions {
  reload: () => Promise<void>;
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
  /**
   * The list's create affordance, rendered in the same bar as search and
   * refresh so every collection offers "New …" in one predictable place.
   * The form it reveals stays behind this action — never in the default view.
   */
  createAction?: { label: string; onSelect: () => void; disabled?: boolean };
  actionsRef?: MutableRef<ApiTableActions | null>;
  onData?: (data: Response) => void;
  load?: CollectionLoader;
}

const loadCollection: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });

/** Shared schema-validated, server-filtered, sorted, and paginated table controller. */
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
  createAction,
  actionsRef,
  onData,
  load = loadCollection,
}: ApiDataTableProps<T, Response>) {
  const pager = useOffsetPager(initialPageSize);
  const resetKey = buildCollectionResetKey(endpoint, params);
  const requestOffset = useCollectionOffset(resetKey, pager.offset, pager.resetPage);
  const [sort, setSort] = useState(initialSort);
  const [search, setSearch] = useState("");
  const [pendingSearch, setPendingSearch] = useState("");

  function applySort(nextSort: string) {
    setSort(nextSort);
    pager.resetPage();
  }

  function applySearch() {
    setSearch(pendingSearch);
    pager.resetPage();
  }

  const collection = useServerCollection({
    endpoint,
    params: {
      ...params,
      ...(paginate ? { limit: String(pager.pageSize), offset: String(requestOffset) } : {}),
      ...(search ? { q: search } : {}),
      ...(sort ? { sort } : {}),
    },
    responseSchema,
    load,
  });

  const actions: ApiTableActions = { reload: collection.reload, resetPage: pager.resetPage };
  if (actionsRef) actionsRef.current = actions;

  const lastNotifiedData = useRef<Response | null>(null);
  useEffect(() => {
    if (!collection.data || collection.data === lastNotifiedData.current) return;
    lastNotifiedData.current = collection.data;
    onData?.(collection.data);
  }, [collection.data, onData]);

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
      {(searchPlaceholder || toolbar || createAction) && (
        <div class="d-flex gap-2 align-items-center mb-2 flex-wrap">
          {searchPlaceholder && (
            <input
              type="search"
              class="form-control form-control-sm w-auto"
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              value={pendingSearch}
              onInput={(event) => setPendingSearch((event.target as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applySearch();
              }}
            />
          )}
          {toolbar?.(actions)}
          {createAction && (
            <button
              type="button"
              class="btn btn-sm btn-success ms-auto"
              disabled={createAction.disabled}
              onClick={createAction.onSelect}
            >
              {createAction.label}
            </button>
          )}
          <button
            type="button"
            class={`btn btn-sm btn-outline-secondary${createAction ? "" : " ms-auto"}`}
            onClick={collection.reload}
          >
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
