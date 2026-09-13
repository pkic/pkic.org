import { canRetainData } from "../shared/request-failure";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";

interface DataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
}

/**
 * Fetches data whenever `fetcher` identity changes (wraps it in useCallback at
 * the call site). Returns `{ data, loading, error, reload }`.
 *
 * Usage:
 *   const { data, loading, error, reload } = useData(() => api<MyType>("/api/..."), [dep]);
 */
export function useData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): DataState<T> & {
  reload: () => Promise<void>;
  updatedAt: string | null;
} {
  const [state, setState] = useState<DataState<T>>({ data: null, loading: true, error: null, refreshing: false });
  const requestGeneration = useRef(0);
  const owner = useRef<unknown>(null);
  const updatedAt = useRef<string | null>(null);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setState((s) => ({ ...s, loading: s.data === null, refreshing: s.data !== null, error: null }));
    try {
      const data = await fetcher();
      if (generation !== requestGeneration.current) return;
      updatedAt.current = new Date().toISOString();
      setState({ data, loading: false, refreshing: false, error: null });
    } catch (e) {
      if (generation !== requestGeneration.current) return;
      setState((s) => ({
        data: canRetainData(e) ? s.data : null,
        loading: false,
        refreshing: false,
        error: e instanceof Error ? e.message : "Request failed",
      }));
    }
  }, deps);

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
    reload: load,
    updatedAt: owner.current === load && state.data !== null ? updatedAt.current : null,
  };
}
