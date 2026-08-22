import { useState, useEffect, useCallback, useRef } from "preact/hooks";

interface DataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
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
} {
  const [state, setState] = useState<DataState<T>>({ data: null, loading: true, error: null });
  const requestGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcher();
      if (generation !== requestGeneration.current) return;
      setState({ data, loading: false, error: null });
    } catch (e) {
      if (generation !== requestGeneration.current) return;
      setState({ data: null, loading: false, error: (e as Error).message });
    }
  }, deps);

  useEffect(() => {
    void load();
    return () => {
      // Invalidate requests from the previous dependency generation and
      // prevent them from updating state after unmount.
      requestGeneration.current += 1;
    };
  }, [load]);

  return { ...state, reload: load };
}
