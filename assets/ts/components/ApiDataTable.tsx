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
  createAction?: {
    label: string;
    onSelect: () => void;
    disabled?: boolean;
    /** For a create control that toggles a disclosure (an inline form above the list), the open state. */
    expanded?: boolean;
  };
  /**
   * Namespace for URL-addressed list state: search, sort, and page mirror
   * into `<namespace>.q` etc. in the query string, so a filtered page can be
   * refreshed, shared, and restored by the back button. Use one namespace
   * per surface, on the page's primary list.
   */
  urlState?: string;
  /** Column filters in force before the reader touches anything, unless the URL says otherwise. */
  initialFilters?: Record<string, string>;
  /** Told each time a column filter changes, for a page whose framing depends on it. */
  onFiltersChange?: (filters: Record<string, string>) => void;
  /**
   * The selection strip, rendered between the head and the table — the slot
   * the design system's list panel reserves for its bulk bar. The page owns
   * the `BulkBar` itself because the commands, the cap, and the selection
   * state are the page's; the slot only fixes where the strip appears.
   */
  /**
   * A form the list's own toolbar opened — link a person, add a new one —
   * drawn inside the list panel between its head and its rows, so the
   * command and its consequence share one surface.
   */
  inset?: ComponentChildren;
  bulkBar?: ComponentChildren;
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
  selection,
  caption,
  showCaption,
  initialSort = "",
  toolbar,
  createAction,
  urlState,
  initialFilters,
  onFiltersChange,
  inset,
  bulkBar,
  actionsRef,
  onData,
  load = loadCollection,
}: ApiDataTableProps<T, Response>) {
  const url = useUrlTableState(urlState, {
    q: "",
    sort: initialSort,
    offset: 0,
    pageSize: initialPageSize ?? ADMIN_LIST_PAGE_SIZE_DEFAULT,
    filters: initialFilters ?? {},
  });
  const pager = useOffsetPager(url.initial.pageSize, url.initial.offset);
  const resetKey = buildCollectionResetKey(endpoint, params);
  const requestOffset = useCollectionOffset(resetKey, pager.offset, pager.resetPage);
  const [sort, setSort] = useState(url.initial.sort);
  const [search, setSearch] = useState(url.initial.q);
  const [pendingSearch, setPendingSearch] = useState(url.initial.q);
  // Column filters are the table's own state: a column declares what it can
  // be narrowed by, the table keeps what it is narrowed to, and the query
  // carries it. A page no longer threads a useState per filter into `params`.
  const [filters, setFilters] = useState<Record<string, string>>(url.initial.filters);
  useEffect(() => {
    url.mirror({ q: search, sort, offset: pager.offset, pageSize: pager.pageSize, filters });
    // url.mirror is stable per namespace; mirroring reacts to state only.
  }, [search, sort, pager.offset, pager.pageSize, filters]);

  function applySort(nextSort: string) {
    setSort(nextSort);
    pager.resetPage();
  }

  function applySearch() {
    setSearch(pendingSearch);
    pager.resetPage();
  }

  function applyFilter(param: string, value: string) {
    const next = { ...filters };
    if (value) next[param] = value;
    else delete next[param];
    setFilters(next);
    onFiltersChange?.(next);
    pager.resetPage();
  }

  const collection = useServerCollection({
    endpoint,
    params: {
      ...params,
      ...filters,
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
    // The whole list is ONE panel — the component library's list specimen:
    // head (search, filters, actions) → table → pager, sharing the panel's
    // edges. Before this the toolbar floated over a borderless table and the
    // count centred itself under the screen rather than under the rows.
    <section class="pk pk-panel pk-table-list" aria-label={caption}>
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
              full-size control. Primary, because the list's create affordance
              is the one thing the head offers beyond finding rows — the
              design system's list head draws it the same way. */}
          {createAction && (
            <Button
              variant="primary"
              onClick={createAction.onSelect}
              disabled={createAction.disabled}
              aria-expanded={createAction.expanded}
            >
              {createAction.label}
            </Button>
          )}
          <Button variant="secondary" onClick={() => void collection.reload()}>
            Refresh
          </Button>
        </Toolbar>
      )}

      {inset && <div class="pk-table-list__inset">{inset}</div>}

      {bulkBar}

      {collection.error ? (
        <ErrorAlert error={collection.error} />
      ) : (
        <>
          {/* While the page loads the table stays mounted and shows skeleton
              rows under its real headers — the columns keep their widths and
              the toolbar keeps focus, instead of the whole list collapsing to
              a spinner between every page and search. */}
          <DataTable
            caption={caption}
            showCaption={showCaption}
            columns={columns}
            data={collection.loading ? [] : rows}
            loading={collection.loading}
            empty={empty}
            rowKey={rowKey}
            rowAction={rowAction}
            detailRow={detailRow}
            selection={selection}
            currentSort={sort}
            onSort={applySort}
            filters={filters}
            onFilterChange={applyFilter}
          />
          {paginate && !collection.loading && <Pager {...pagerProps} />}
        </>
      )}
    </section>
  );
}
