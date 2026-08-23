import type { z } from "zod";
import type { PageInfo } from "../../shared/schemas/pagination";
import { getJson } from "../shared/api-client";
import { useOffsetPager } from "./useOffsetPager";
import {
  buildCollectionResetKey,
  type CollectionLoader,
  useCollectionOffset,
  useServerCollection,
} from "./useServerCollection";

export interface ApiPageResponse {
  page: PageInfo;
}

const loadApiPage: CollectionLoader = (url, signal, responseSchema) => getJson(url, responseSchema, { signal });

/** Shared bounded-fetch state for non-table API collections. */
export function useApiPage<T extends ApiPageResponse>(
  endpoint: string,
  params: Record<string, string>,
  responseSchema: z.ZodType<T>,
  resolveItems: (data: T) => readonly unknown[],
  initialPageSize?: number,
) {
  const pager = useOffsetPager(initialPageSize);
  const resetKey = buildCollectionResetKey(endpoint, params);
  const requestOffset = useCollectionOffset(resetKey, pager.offset, pager.resetPage);
  const listing = useServerCollection({
    endpoint,
    params: {
      ...params,
      limit: String(pager.pageSize),
      offset: String(requestOffset),
    },
    responseSchema,
    load: loadApiPage,
  });

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
