import { useSyncExternalStore } from "preact/compat";
import { splitHash, subscribeUrlQuery, urlQuerySnapshot, writeUrlQuery } from "../ui/url-query";

/** Named workspace views are routes; filters and display preferences remain in their query. */
export function useRouteView<Id extends string>(
  basePath: string,
  views: readonly Id[],
  defaultView: Id,
): [Id, (next: Id) => void] {
  const snapshot = useSyncExternalStore(subscribeUrlQuery, urlQuerySnapshot);
  const url = snapshot ? new URL(snapshot) : undefined;
  const source = url?.hash.startsWith("#/") ? "hash" : "search";
  const current =
    source === "hash"
      ? splitHash(url?.hash)
      : { path: url?.pathname ?? basePath, params: url?.searchParams ?? new URLSearchParams() };
  const base = basePath.replace(/\/$/u, "");
  const path = current.path.replace(/\/$/u, "");
  const selected = views.find((view) => path === `${base}/${encodeURIComponent(view)}`);
  const owned = path === base || selected !== undefined;
  const update = (next: Id) => {
    if (!owned || !views.includes(next)) return;
    writeUrlQuery({
      source,
      ownerPath: current.path,
      destinationPath: next === defaultView ? base : `${base}/${encodeURIComponent(next)}`,
      params: current.params,
      mode: "push",
    });
  };
  return [selected ?? defaultView, update];
}
