/**
 * URL-addressed list state for the hash-routed portal. The hash carries the
 * route; a list's search, sort, and page live in NAMESPACED real query
 * parameters (`users.q=…`) so a filtered, sorted page can be refreshed and
 * shared as a link. The component's own state stays the source of truth:
 * this hook reads the URL once on mount and mirrors changes back with
 * `replaceState` (no history spam). On unmount it removes its own keys, so
 * parameters never leak onto the next page — while earlier history entries
 * keep theirs, which is what makes the back button restore a list exactly.
 */
import { useEffect, useMemo, useRef } from "preact/hooks";

export interface UrlTableState {
  q: string;
  sort: string;
  offset: number;
  pageSize: number;
}

const KEYS = ["q", "sort", "offset", "size"] as const;

function readParams(namespace: string): Partial<UrlTableState> {
  const params = new URLSearchParams(window.location.search);
  const raw = (key: string) => params.get(`${namespace}.${key}`);
  const numeric = (value: string | null) => {
    const parsed = Number(value);
    return value !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  };
  return {
    ...(raw("q") !== null ? { q: raw("q")! } : {}),
    ...(raw("sort") !== null ? { sort: raw("sort")! } : {}),
    ...(numeric(raw("offset")) !== undefined ? { offset: numeric(raw("offset")) } : {}),
    ...(numeric(raw("size")) !== undefined ? { pageSize: numeric(raw("size")) } : {}),
  };
}

function writeParams(namespace: string, state: UrlTableState | null, defaults: UrlTableState): void {
  const url = new URL(window.location.href);
  for (const key of KEYS) url.searchParams.delete(`${namespace}.${key}`);
  if (state) {
    if (state.q) url.searchParams.set(`${namespace}.q`, state.q);
    if (state.sort && state.sort !== defaults.sort) url.searchParams.set(`${namespace}.sort`, state.sort);
    if (state.offset > 0) url.searchParams.set(`${namespace}.offset`, String(state.offset));
    if (state.pageSize !== defaults.pageSize) url.searchParams.set(`${namespace}.size`, String(state.pageSize));
  }
  history.replaceState(history.state, "", url);
}

export function useUrlTableState(
  namespace: string | undefined,
  defaults: UrlTableState,
): { initial: UrlTableState; mirror: (state: UrlTableState) => void } {
  const initial = useMemo<UrlTableState>(
    () => (namespace ? { ...defaults, ...readParams(namespace) } : defaults),
    // The URL is only a mount-time input; defaults are stable per surface.
    [namespace],
  );
  const defaultsRef = useRef(defaults);

  useEffect(() => {
    if (!namespace) return;
    return () => writeParams(namespace, null, defaultsRef.current);
  }, [namespace]);

  return {
    initial,
    mirror: (state: UrlTableState) => {
      if (namespace) writeParams(namespace, state, defaultsRef.current);
    },
  };
}
