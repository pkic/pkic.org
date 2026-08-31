/**
 * URL-addressed list state for the hash-routed portal, carried INSIDE the
 * hash as a normal-looking URL: `#/users?users.q=…`. The fragment never
 * reaches the server (no log leakage, no CDN cache-key pollution for the
 * static-first future) and parses with an ordinary URL parser. The
 * magic-link verify flow (`#/verify?token=…`) established this shape;
 * routing sees only the path because the portal's location hook strips the
 * query segment.
 *
 * The component's own state stays the source of truth: this hook reads the
 * hash query once on mount and mirrors changes back with `replaceState`
 * (which does not fire hashchange, so the router is undisturbed). Params
 * are namespaced so several lists can coexist; wouter's navigate rebuilds
 * the hash on route changes, so state naturally drops when leaving the
 * page, while earlier history entries keep theirs — which is what makes the
 * back button restore a list exactly. An unmount cleanup still removes the
 * namespace's own keys for non-router hash changes.
 */
import { useEffect, useMemo, useRef } from "preact/hooks";

export interface UrlTableState {
  q: string;
  sort: string;
  offset: number;
  pageSize: number;
}

const KEYS = ["q", "sort", "offset", "size"] as const;

function splitHash(): { path: string; params: URLSearchParams } {
  const raw = window.location.hash.replace(/^#/, "");
  const queryIndex = raw.indexOf("?");
  if (queryIndex === -1) return { path: raw, params: new URLSearchParams() };
  return { path: raw.slice(0, queryIndex), params: new URLSearchParams(raw.slice(queryIndex + 1)) };
}

function readParams(namespace: string): Partial<UrlTableState> {
  const { params } = splitHash();
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
  const { path, params } = splitHash();
  for (const key of KEYS) params.delete(`${namespace}.${key}`);
  if (state) {
    if (state.q) params.set(`${namespace}.q`, state.q);
    if (state.sort && state.sort !== defaults.sort) params.set(`${namespace}.sort`, state.sort);
    if (state.offset > 0) params.set(`${namespace}.offset`, String(state.offset));
    if (state.pageSize !== defaults.pageSize) params.set(`${namespace}.size`, String(state.pageSize));
  }
  const query = params.toString();
  const url = new URL(window.location.href);
  url.hash = query ? `${path}?${query}` : path;
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
