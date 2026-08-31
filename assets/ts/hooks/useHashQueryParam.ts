/**
 * URL-addressed local state for surfaces without a route segment of their
 * own (an inner tab, a panel toggle): `#/path?name=value`. Initializes from
 * the hash query on mount, mirrors changes back with replaceState, and
 * removes its key on unmount so it never leaks onto the next page.
 */
import { useEffect, useState } from "preact/hooks";
import { readHashQueryParam, writeHashQueryParam } from "../shared/hash-query";

export function useHashQueryParam(name: string, defaultValue: string): [string, (next: string) => void] {
  const [value, setValue] = useState(() => readHashQueryParam(name) ?? defaultValue);

  useEffect(() => {
    return () => writeHashQueryParam(name, null);
  }, [name]);

  const update = (next: string) => {
    setValue(next);
    writeHashQueryParam(name, next === defaultValue ? null : next);
  };
  return [value, update];
}
