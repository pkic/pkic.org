import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { z } from "zod";

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
