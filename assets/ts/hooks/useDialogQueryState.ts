/** Dialog navigation uses the same route-owned URL source as tabs and lists. */
import { useMemo } from "preact/hooks";
import { useSyncExternalStore } from "preact/compat";
import { splitHash, subscribeUrlQuery, urlQuerySnapshot, createUrlDialogState } from "../ui/url-query";

export function useDialogQueryState(name: string): [boolean, () => void, () => Promise<void>] {
  const url = new URL(useSyncExternalStore(subscribeUrlQuery, urlQuerySnapshot));
  const hash = splitHash(url.hash);
  const source = hash.path.startsWith("/") ? "hash" : "search";
  const ownerPath = source === "hash" ? hash.path : url.pathname;
  const state = useMemo(() => createUrlDialogState(name, source, ownerPath), [name, source, ownerPath]);
  const marker = state.marker(url.href);
  return [Boolean(marker), state.show, () => state.close(marker)];
}
