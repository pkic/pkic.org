import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState, type MutableRef } from "preact/hooks";
import type { z } from "zod";
import type { PageInfo } from "../../shared/schemas/pagination";
import { useOffsetPager } from "../hooks/useOffsetPager";
import { useUrlTableState } from "../hooks/useUrlTableState";
import {
  buildCollectionResetKey,
  useCollectionOffset,
  useServerCollection,
  type CollectionLoader,
} from "../hooks/useServerCollection";
import { getJson } from "../shared/api-client";
import { Button } from "../ui/Button";
import { Toolbar } from "../ui/Toolbar";
import { ErrorAlert } from "./ErrorAlert";
import { ADMIN_LIST_PAGE_SIZE_DEFAULT, Pager } from "./Pager";
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
  /**
   * Namespace for URL-addressed list state: search, sort, and page mirror
   * into `<namespace>.q` etc. in the query string, so a filtered page can be
   * refreshed, shared, and restored by the back button. Use one namespace
   * per surface, on the page's primary list.
   */
  urlState?: string;
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
  rowKey,
  rowAction,
  detailRow,
  caption,
  showCaption,
  initialSort = "",
  toolbar,
  createAction,
  urlState,
  actionsRef,
  onData,
  load = loadCollection,
}: ApiDataTableProps<T, Response>) {
  const url = useUrlTableState(urlState, {
    q: "",
    sort: initialSort,
    offset: 0,
    pageSize: initialPageSize ?? ADMIN_LIST_PAGE_SIZE_DEFAULT,
  });
  const pager = useOffsetPager(url.initial.pageSize, url.initial.offset);
  const resetKey = buildCollectionResetKey(endpoint, params);
  const requestOffset = useCollectionOffset(resetKey, pager.offset, pager.resetPage);
  const [sort, setSort] = useState(url.initial.sort);
  const [search, setSearch] = useState(url.initial.q);
  const [pendingSearch, setPendingSearch] = useState(url.initial.q);
  useEffect(() => {
    url.mirror({ q: search, sort, offset: pager.offset, pageSize: pager.pageSize });
    // url.mirror is stable per namespace; mirroring reacts to state only.
  }, [search, sort, pager.offset, pager.pageSize]);

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
    // `pk-table-list` measures the whole list, not only the table: the search
    // field, the filters, the table and the pager share one edge. Without it
    // the toolbar stretched across a 2000px screen above a table that had
    // settled at its own measure, and the pager centred itself under the
    // screen rather than under the rows it pages.
    <div class="pk pk-stack pk-stack--snug pk-table-list">
      {(searchPlaceholder || toolbar || createAction) && (
        // The toolbar is named after the list it controls, so a page with
        // several collections does not present several toolbars called
        // "Toolbar".
        <Toolbar
          label={`${caption} controls`}
          search={
            searchPlaceholder
              ? {
                  value: pendingSearch,
                  placeholder: searchPlaceholder,
                  onInput: setPendingSearch,
                  label: `Search ${caption.toLowerCase()}`,
                }
              : undefined
          }
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === "Enter") applySearch();
          }}
        >
          {toolbar?.(actions)}
          {/* Default size, not `sm`: these sit on the same row as the search
              field, which is a full-size control, and a button that is eight
              pixels shorter than the input beside it reads as shrunken rather
              than as quiet. `sm` belongs inside a dense row, not next to a
              full-size control. */}
          {createAction && (
            <Button onClick={createAction.onSelect} disabled={createAction.disabled}>
              {createAction.label}
            </Button>
          )}
          <Button variant="secondary" onClick={() => void collection.reload()}>
            Refresh
          </Button>
        </Toolbar>
      )}

      {collection.loading ? (
        <Spinner />
      ) : collection.error ? (
        <ErrorAlert error={collection.error} />
      ) : (
        <>
          <DataTable
            caption={caption}
            showCaption={showCaption}
            columns={columns}
            data={rows}
            empty={empty}
            rowKey={rowKey}
            rowAction={rowAction}
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
