/**
 * Canonical browser URL state for public paths and portal hash routes.
 * Route-owned writes preserve unrelated parameters, notify mounted controls,
 * and use browser history for meaningful navigation.
 */

export function splitHash(hash = window.location.hash): { path: string; params: URLSearchParams } {
  const raw = hash.replace(/^#/, "");
  const queryIndex = raw.indexOf("?");
  if (queryIndex === -1) return { path: raw, params: new URLSearchParams() };
  return { path: raw.slice(0, queryIndex), params: new URLSearchParams(raw.slice(queryIndex + 1)) };
}

export function readHashQueryParam(name: string): string | null {
  return splitHash().params.get(name);
}

const QUERY_CHANGED = "pk-url-query-change";

/** Browser history and shared query writes are one reactive URL source. */
export function subscribeUrlQuery(changed: () => void): () => void {
  for (const event of ["hashchange", "popstate", QUERY_CHANGED]) window.addEventListener(event, changed);
  return () => {
    for (const event of ["hashchange", "popstate", QUERY_CHANGED]) window.removeEventListener(event, changed);
  };
}
export const urlQuerySnapshot = () => window.location.href;
export const subscribeHashQuery = subscribeUrlQuery;
export const hashQuerySnapshot = () => window.location.hash;

/** One route-owned query writer for public URLs and the portal's hash routes. */
export function writeUrlQuery({
  source,
  ownerPath,
  destinationPath = ownerPath,
  params,
  mode = "replace",
}: {
  source: "hash" | "search";
  ownerPath: string;
  destinationPath?: string;
  params: URLSearchParams;
  mode?: "push" | "replace";
}): void {
  if (
    destinationPath !== ownerPath &&
    (!destinationPath.startsWith("/") || destinationPath.startsWith("//") || /[?#\\]/u.test(destinationPath))
  )
    throw new TypeError("Use a same-origin route path without a query or fragment.");
  const url = new URL(window.location.href);
  if ((source === "hash" ? splitHash().path : url.pathname) !== ownerPath) return;
  const query = params.toString();
  if (source === "hash") url.hash = query ? `${destinationPath}?${query}` : destinationPath;
  else {
    url.pathname = destinationPath;
    url.search = query;
  }
  if (url.href === window.location.href) return;
  if (mode === "push") history.pushState(history.state, "", url);
  else history.replaceState(history.state, "", url);
  window.dispatchEvent(new Event(QUERY_CHANGED));
  if (source === "hash" && destinationPath !== ownerPath) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Write only to the route that owns the state; delayed callbacks cannot edit an incoming route. */
export function writeHashQuery(path: string, params: URLSearchParams, mode: "push" | "replace" = "replace"): void {
  writeUrlQuery({ source: "hash", ownerPath: path, params, mode });
}

/** User-selected inner views have history entries; defaults omit their key. */
export function writeHashQueryParam(name: string, value: string | null, ownerPath = splitHash().path): void {
  const { path, params } = splitHash();
  if (path !== ownerPath) return;
  if (value === null || value === "") params.delete(name);
  else params.set(name, value);
  writeHashQuery(path, params, "push");
}
