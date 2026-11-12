import { canRetainData } from "../shared/request-failure";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";

interface DataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
}

/**
 * Fetches data when the caller-supplied dependency values change.
 * Returns `{ data, loading, error, reload }`.
 * `refresh` replaces a same-resource view after a save; on failure it keeps the
 * mounted editor's draft and rejects so that editor owns the error and retry.
 * Ordinary reloads still discard data after an access refusal.
 *
 * Usage:
 *   const { data, loading, error, reload } = useData(() => api<MyType>("/api/..."), [dep]);
 */
export function useData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): DataState<T> & {
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
  updatedAt: string | null;
} {
  const [state, setState] = useState<DataState<T>>({ data: null, loading: true, error: null, refreshing: false });
  const requestGeneration = useRef(0);
  const owner = useRef<unknown>(null);
  const updatedAt = useRef<string | null>(null);
  // The caller supplies the fetcher's inputs; preserve the fetcher captured for
  // each generation even when its inline function is recreated on render.
  const fetchGeneration = useRef({ deps: [...deps], fetcher });
  if (
    deps.length !== fetchGeneration.current.deps.length ||
    deps.some((dependency, index) => !Object.is(dependency, fetchGeneration.current.deps[index]))
  ) {
    fetchGeneration.current = { deps: [...deps], fetcher };
  }
  const currentFetchGeneration = fetchGeneration.current;

  const load = useCallback(
    async (refresh = false) => {
      const generation = ++requestGeneration.current;
      setState((s) => ({ ...s, loading: s.data === null, refreshing: s.data !== null, error: null }));
      try {
        const data = await currentFetchGeneration.fetcher();
        if (generation !== requestGeneration.current) return;
        updatedAt.current = new Date().toISOString();
        setState({ data, loading: false, refreshing: false, error: null });
      } catch (e) {
        if (generation !== requestGeneration.current) return;
        if (refresh) {
          setState((s) => ({ ...s, loading: false, refreshing: false }));
          throw e;
        }
        setState((s) => ({
          data: canRetainData(e) ? s.data : null,
          loading: false,
          refreshing: false,
          error: e instanceof Error ? e.message : "Request failed",
        }));
      }
    },
    [currentFetchGeneration],
  );
  const reload = useCallback(() => load(), [load]);
  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    owner.current = load;
    updatedAt.current = null;
    setState({ data: null, loading: true, refreshing: false, error: null });
    void load();
    return () => {
      // Invalidate requests from the previous dependency generation and
      // prevent them from updating state after unmount.
      requestGeneration.current += 1;
    };
  }, [load]);

  return {
    ...(owner.current === load ? state : { data: null, loading: true, refreshing: false, error: null }),
    reload,
    refresh,
    updatedAt: owner.current === load && state.data !== null ? updatedAt.current : null,
  };
}
