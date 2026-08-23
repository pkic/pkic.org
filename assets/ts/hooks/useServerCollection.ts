import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import type { PageInfo } from "../../shared/schemas/pagination";

export type CollectionLoader = <T>(url: string, signal: AbortSignal, responseSchema: z.ZodType<T>) => Promise<T>;

export interface ServerCollectionOptions<T> {
  endpoint: string;
  params?: Record<string, string>;
  responseSchema: z.ZodType<T>;
  load: CollectionLoader;
}

interface ServerCollectionState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/** Builds a deterministic collection URL so equivalent query objects share one request identity. */
export function buildServerCollectionUrl(endpoint: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params).sort(([left], [right]) => left.localeCompare(right))) {
    if (value !== "") query.set(key, value);
  }
  const serialized = query.toString();
  return serialized ? `${endpoint}?${serialized}` : endpoint;
}

/** Stable identity for the endpoint/filter inputs that invalidate an offset page. */
export function buildCollectionResetKey(endpoint: string, params: Record<string, string> = {}): string {
  return JSON.stringify([endpoint, Object.entries(params).sort(([left], [right]) => left.localeCompare(right))]);
}

/** Resets pagination while making the first request use offset zero immediately. */
export function useCollectionResetPending(resetKey: string, resetPage: () => void): boolean {
  const previousResetKey = useRef(resetKey);
  const resetPending = previousResetKey.current !== resetKey;

  useEffect(() => {
    if (previousResetKey.current === resetKey) return;
    previousResetKey.current = resetKey;
    resetPage();
  }, [resetKey, resetPage]);

  return resetPending;
}

/** Resets pagination while making the first request use offset zero immediately. */
export function useCollectionOffset(resetKey: string, offset: number, resetPage: () => void): number {
  return useCollectionResetPending(resetKey, resetPage) ? 0 : offset;
}

export interface LatestRequest {
  signal: AbortSignal;
  isCurrent: () => boolean;
}

/** Small testable request gate shared by every collection controller instance. */
export function createLatestRequestGate() {
  let sequence = 0;
  let active: AbortController | null = null;
  return {
    start(): LatestRequest {
      active?.abort();
      active = new AbortController();
      const requestSequence = ++sequence;
      return {
        signal: active.signal,
        isCurrent: () => requestSequence === sequence && !active?.signal.aborted,
      };
    },
    cancel(): void {
      sequence += 1;
      active?.abort();
      active = null;
    },
  };
}

/**
 * One runtime-validated controller for every server-backed collection.
 * A newer request aborts and invalidates its predecessor, so an older response
 * can never overwrite newer filter, sort, or pagination state.
 */
export function useServerCollection<T>({
  endpoint,
  params = {},
  responseSchema,
  load,
}: ServerCollectionOptions<T>): ServerCollectionState<T> & { reload: () => Promise<void> } {
  const requestGate = useRef<ReturnType<typeof createLatestRequestGate> | null>(null);
  requestGate.current ??= createLatestRequestGate();
  const reloadWaiters = useRef<Array<() => void>>([]);
  const [reloadSequence, setReloadSequence] = useState(0);
  const [state, setState] = useState<ServerCollectionState<T>>({ data: null, loading: true, error: null });
  const url = buildServerCollectionUrl(endpoint, params);

  const reload = useCallback(
    () =>
      new Promise<void>((resolve) => {
        reloadWaiters.current.push(resolve);
        setReloadSequence((current) => current + 1);
      }),
    [],
  );

  const settleReloads = useCallback(() => {
    for (const resolve of reloadWaiters.current.splice(0)) resolve();
  }, []);

  useEffect(() => {
    const request = requestGate.current!.start();
    setState((current) => ({ ...current, loading: true, error: null }));

    void load(url, request.signal, responseSchema)
      .then((data) => {
        if (request.isCurrent()) {
          setState({ data, loading: false, error: null });
          settleReloads();
        }
      })
      .catch((cause: unknown) => {
        if (!request.isCurrent()) return;
        setState({ data: null, loading: false, error: cause instanceof Error ? cause : new Error("Request failed") });
        settleReloads();
      });

    return () => {
      requestGate.current?.cancel();
    };
  }, [url, responseSchema, load, reloadSequence, settleReloads]);

  useEffect(
    () => () => {
      for (const resolve of reloadWaiters.current.splice(0)) resolve();
    },
    [],
  );

  return { ...state, reload };
}

export interface AppendablePageResponse {
  page: PageInfo;
}

export interface AppendableServerCollectionOptions<T extends AppendablePageResponse> {
  endpoint: string;
  params?: Record<string, string>;
  pageSize: number;
  responseSchema: z.ZodType<T>;
  load: CollectionLoader;
  merge: (current: T, next: T) => T;
  /** Derives the next server offset when response rows are grouped or transformed. */
  nextOffset?: (data: T) => number;
}

export interface AppendableServerCollectionState<T extends AppendablePageResponse> {
  data: T | null;
  page: PageInfo | null;
  loading: boolean;
  loadingMore: boolean;
  error: Error | null;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
}

/**
 * Shared request controller for server-paginated collections with explicit
 * append/load-more behavior. A reload, filter identity change, or newer page
 * request invalidates every older request through the same latest-request gate
 * used by useServerCollection.
 */
export function useAppendableServerCollection<T extends AppendablePageResponse>({
  endpoint,
  params = {},
  pageSize,
  responseSchema,
  load,
  merge,
  nextOffset,
}: AppendableServerCollectionOptions<T>): AppendableServerCollectionState<T> {
  const requestGate = useRef<ReturnType<typeof createLatestRequestGate> | null>(null);
  requestGate.current ??= createLatestRequestGate();
  const requestSequence = useRef(0);
  const appendOwner = useRef<number | null>(null);
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    loadingMore: boolean;
    error: Error | null;
  }>({ data: null, loading: true, loadingMore: false, error: null });
  const collectionUrl = buildServerCollectionUrl(endpoint, params);
  const normalizedPageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 1;

  const requestPage = useCallback(
    (offset: number, append: boolean): Promise<void> => {
      const sequence = ++requestSequence.current;
      const request = requestGate.current!.start();
      if (append) appendOwner.current = sequence;
      else appendOwner.current = null;
      setState((current) => ({
        data: current.data,
        loading: !append,
        loadingMore: append,
        error: null,
      }));
      const separator = collectionUrl.includes("?") ? "&" : "?";
      const url = `${collectionUrl}${separator}limit=${encodeURIComponent(String(normalizedPageSize))}&offset=${encodeURIComponent(String(offset))}`;

      return new Promise<void>((resolve) => {
        void load(url, request.signal, responseSchema)
          .then((next) => {
            if (!request.isCurrent()) return;
            setState((current) => ({
              data: append && current.data ? merge(current.data, next) : next,
              loading: false,
              loadingMore: false,
              error: null,
            }));
          })
          .catch((cause: unknown) => {
            if (!request.isCurrent()) return;
            setState((current) => ({
              data: append ? current.data : null,
              loading: false,
              loadingMore: false,
              error: cause instanceof Error ? cause : new Error("Request failed"),
            }));
          })
          .finally(() => {
            if (appendOwner.current === sequence) appendOwner.current = null;
            resolve();
          });
      });
    },
    [collectionUrl, load, merge, normalizedPageSize, responseSchema],
  );

  useEffect(() => {
    requestGate.current?.cancel();
    appendOwner.current = null;
    setState({ data: null, loading: true, loadingMore: false, error: null });
    void requestPage(0, false);
    return () => {
      requestGate.current?.cancel();
      appendOwner.current = null;
    };
  }, [collectionUrl, requestPage]);

  const reload = useCallback((): Promise<void> => {
    return requestPage(0, false);
  }, [requestPage]);

  const loadMore = useCallback((): Promise<void> => {
    if (appendOwner.current !== null || !state.data?.page.hasMore) return Promise.resolve();
    const offset = nextOffset?.(state.data) ?? state.data.page.offset + state.data.page.limit;
    return requestPage(offset, true);
  }, [nextOffset, requestPage, state.data]);

  return {
    data: state.data,
    page: state.data?.page ?? null,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    reload,
    loadMore,
  };
}
