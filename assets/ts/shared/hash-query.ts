/**
 * The portal's URLs are ordinary URLs inside the hash: `#/path?key=value`.
 * These helpers read and write that query segment. Writes use replaceState,
 * which does not fire hashchange, so the router is undisturbed; wouter's
 * navigate rebuilds the hash on route changes, so query state naturally
 * drops when leaving a page while history entries keep theirs.
 */

export function splitHash(): { path: string; params: URLSearchParams } {
  const raw = window.location.hash.replace(/^#/, "");
  const queryIndex = raw.indexOf("?");
  if (queryIndex === -1) return { path: raw, params: new URLSearchParams() };
  return { path: raw.slice(0, queryIndex), params: new URLSearchParams(raw.slice(queryIndex + 1)) };
}

export function readHashQueryParam(name: string): string | null {
  return splitHash().params.get(name);
}

/** Sets (or with null, removes) one hash query parameter in place. */
export function writeHashQueryParam(name: string, value: string | null): void {
  const { path, params } = splitHash();
  if (value === null || value === "") {
    params.delete(name);
  } else {
    params.set(name, value);
  }
  const query = params.toString();
  const url = new URL(window.location.href);
  url.hash = query ? `${path}?${query}` : path;
  history.replaceState(history.state, "", url);
}
