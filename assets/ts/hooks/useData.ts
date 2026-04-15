import { useState, useEffect, useCallback } from "preact/hooks";

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
export function useData<T>(fetcher: () => Promise<T>, deps: unknown[] = []): DataState<T> & { reload: () => void } {
  const [state, setState] = useState<DataState<T>>({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcher();
      setState({ data, loading: false, error: null });
    } catch (e) {
      setState({ data: null, loading: false, error: (e as Error).message });
    }
  }, deps);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}
