/** Namespaced table state follows the URL and preserves bookmarks when its view unmounts. */
import { useCallback, useMemo, useRef } from "preact/hooks";
import { useSyncExternalStore } from "preact/compat";
import { hashQuerySnapshot, splitHash, subscribeHashQuery, writeHashQuery } from "../ui/url-query";

export interface UrlTableState {
  q: string;
  sort: string;
  offset: number;
  pageSize: number;
  /** Column filters in force, by the query parameter each one narrows. */
  filters: Record<string, string>;
}

const KEYS = ["q", "sort", "offset", "size"] as const;

function readParams(namespace: string, hash: string, defaultFilters: Record<string, string>): Partial<UrlTableState> {
  const { params } = splitHash(hash);
  const raw = (key: string) => params.get(`${namespace}.${key}`);
  const numeric = (value: string | null) => {
    const parsed = Number(value);
    return value !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  };
  // A filter travels as `<namespace>.f.<param>`, so a link to a narrowed list
  // reopens narrowed the same way, and a page can carry filters for two lists.
  const filters: Record<string, string> = { ...defaultFilters };
  let explicitFilters = false;
  const prefix = `${namespace}.f.`;
  for (const [key, value] of params) {
    if (!key.startsWith(prefix)) continue;
    explicitFilters = true;
    if (value) filters[key.slice(prefix.length)] = value;
    else delete filters[key.slice(prefix.length)];
  }
  return {
    ...(raw("q") !== null ? { q: raw("q")! } : {}),
    ...(raw("sort") !== null ? { sort: raw("sort")! } : {}),
    ...(numeric(raw("offset")) !== undefined ? { offset: numeric(raw("offset")) } : {}),
    ...(numeric(raw("size")) !== undefined && numeric(raw("size"))! > 0 ? { pageSize: numeric(raw("size")) } : {}),
    ...(explicitFilters ? { filters } : {}),
  };
}

function writeParams(
  namespace: string,
  state: UrlTableState,
  defaults: UrlTableState | undefined,
  ownerPath: string,
): void {
  const { path, params } = splitHash();
  if (path !== ownerPath) return;
  for (const key of KEYS) params.delete(`${namespace}.${key}`);
  for (const key of [...params.keys()]) {
    if (key.startsWith(`${namespace}.f.`)) params.delete(key);
  }
  if (state) {
    for (const [param, value] of Object.entries(state.filters)) {
      if (value && value !== defaults?.filters[param]) params.set(`${namespace}.f.${param}`, value);
    }
    for (const param of Object.keys(defaults?.filters ?? {})) {
      if (!state.filters[param]) params.set(`${namespace}.f.${param}`, "");
    }
    if (state.q) params.set(`${namespace}.q`, state.q);
    if (state.sort && state.sort !== defaults?.sort) params.set(`${namespace}.sort`, state.sort);
    if (state.offset > 0) params.set(`${namespace}.offset`, String(state.offset));
    if (state.pageSize !== defaults?.pageSize) params.set(`${namespace}.size`, String(state.pageSize));
  }
  writeHashQuery(path, params);
}

/** Namespace-only owners need no requests or destructive URL cleanup. */
export function useUrlTableState(namespace: string | undefined): void;
export function useUrlTableState(
  namespace: string | undefined,
  defaults: UrlTableState,
  retainOnUnmount?: boolean,
): { initial: UrlTableState; mirror: (state: UrlTableState) => void };
export function useUrlTableState(namespace: string | undefined, defaults?: UrlTableState, _retainOnUnmount = false) {
  const hash = useSyncExternalStore(subscribeHashQuery, hashQuerySnapshot);
  const { path } = splitHash(hash);
  const defaultsRef = useRef(defaults);
  const initial = useMemo(
    () =>
      defaultsRef.current
        ? namespace
          ? { ...defaultsRef.current, ...readParams(namespace, hash, defaultsRef.current.filters) }
          : defaultsRef.current
        : undefined,
    [namespace, hash],
  );
  const mirror = useCallback(
    (state: UrlTableState) => {
      if (namespace) writeParams(namespace, state, defaultsRef.current, path);
    },
    [namespace, path],
  );
  if (!initial) return;
  return { initial, mirror };
}
