/** URL-owned inner state follows bookmarks and browser history; unmount never edits a URL. */
import { useCallback } from "preact/hooks";
import { useSyncExternalStore } from "preact/compat";
import { hashQuerySnapshot, splitHash, subscribeHashQuery, writeHashQueryParam } from "../ui/url-query";

export function useHashQueryParam<Id extends string>(
  name: string,
  defaultValue: Id,
  choices: readonly Id[],
): [Id, (next: Id) => void];
export function useHashQueryParam(name: string, defaultValue: string): [string, (next: string) => void];
export function useHashQueryParam(
  name: string,
  defaultValue: string,
  choices?: readonly string[],
): [string, (next: string) => void] {
  const hash = useSyncExternalStore(subscribeHashQuery, hashQuerySnapshot);
  const { path, params } = splitHash(hash);
  const update = useCallback(
    (next: string) => {
      if (choices && !choices.includes(next)) return;
      writeHashQueryParam(name, next === defaultValue ? null : next, path);
    },
    [name, defaultValue, path, choices],
  );
  const raw = params.get(name);
  return [raw !== null && (!choices || choices.includes(raw)) ? raw : defaultValue, update];
}
