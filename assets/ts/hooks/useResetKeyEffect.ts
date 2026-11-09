import { useLayoutEffect, useRef } from "preact/hooks";

/** Skip mounting; reset on a changed key before paint and report the pending reset during rendering. */
export function useResetKeyEffect<Key>(key: Key, onReset: () => void): boolean {
  const previousKey = useRef(key);
  const pending = !Object.is(previousKey.current, key);
  useLayoutEffect(() => {
    if (Object.is(previousKey.current, key)) return;
    previousKey.current = key;
    onReset();
  }, [key, onReset]);
  return pending;
}
