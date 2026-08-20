import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import type { PageInfo } from "../../shared/schemas/pagination";
import { getJson } from "../shared/api-client";
import { usePageState } from "./usePageState";

export interface ApiPageResponse {
  page: PageInfo;
}

/** Shared bounded-fetch state for non-table API collections. */
export function useApiPage<T extends ApiPageResponse>(
  endpoint: string,
  params: Record<string, string> = {},
  responseSchema?: z.ZodType<T>,
) {
  const pageState = usePageState();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const latestRequest = useRef(0);
  const serializedParams = JSON.stringify(params);

  const reload = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams(params);
      query.set("limit", String(pageState.pageSize));
      query.set("offset", String(pageState.offset));
      const raw = await getJson<unknown>(`${endpoint}?${query.toString()}`);
      if (requestId === latestRequest.current) {
        setData(responseSchema ? responseSchema.parse(raw) : (raw as T));
      }
    } catch (cause) {
      if (requestId === latestRequest.current) setError(cause);
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [endpoint, pageState.pageSize, pageState.offset, serializedParams, responseSchema]);

  useEffect(() => {
    pageState.resetPage();
  }, [endpoint, serializedParams]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    data,
    error,
    loading,
    reload,
    pagerProps: data ? pageState.pagerProps(pageItemCount(data), data.page.total, data.page.hasMore) : null,
  };
}

function pageItemCount(data: ApiPageResponse): number {
  for (const [key, value] of Object.entries(data)) {
    if (key !== "page" && Array.isArray(value)) return value.length;
  }
  return 0;
}
