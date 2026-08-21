import { useEffect } from "preact/hooks";
import type { z } from "zod";
import type { PageInfo } from "../../shared/schemas/pagination";
import { getJson } from "../shared/api-client";
import { useOffsetPager } from "./useOffsetPager";
import { useServerCollection, type CollectionLoader } from "./useServerCollection";

export interface ApiPageResponse {
  page: PageInfo;
}

/** Shared bounded-fetch state for non-table API collections. */
const loadCollection: CollectionLoader = (url, signal) => getJson<unknown>(url, { signal });

export function useApiPage<T extends ApiPageResponse>(
  endpoint: string,
  params: Record<string, string>,
  responseSchema: z.ZodType<T>,
  resolveItems: (data: T) => readonly unknown[],
  initialPageSize?: number,
) {
  const pager = useOffsetPager(initialPageSize);
  const serializedParams = JSON.stringify(Object.entries(params).sort(([left], [right]) => left.localeCompare(right)));
  const listing = useServerCollection({
    endpoint,
    params: {
      ...params,
      limit: String(pager.pageSize),
      offset: String(pager.offset),
    },
    responseSchema,
    load: loadCollection,
  });

  useEffect(() => {
    pager.resetPage();
  }, [endpoint, serializedParams, pager.resetPage]);

  return {
    ...listing,
    pagerProps: listing.data
      ? pager.pagerProps({
          hasMore: listing.data.page.hasMore,
          rowCount: resolveItems(listing.data).length,
          total: listing.data.page.total,
          serverOffset: listing.data.page.offset,
        })
      : null,
  };
}
