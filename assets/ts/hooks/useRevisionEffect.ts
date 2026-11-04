import { useEffect, useRef } from "preact/hooks";

/** Reset a record-scoped draft when its identity or revision changes. */
export function useRevisionEffect(reset: () => void, revision: string): void {
  const latestReset = useRef(reset);
  latestReset.current = reset;
  useEffect(() => {
    latestReset.current();
  }, [revision]);
}
