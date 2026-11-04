import { useEffect, useRef, useState } from "preact/hooks";
import type { EligibilityManifest } from "./eligibility-manifest";

/** A task choice waits for its own preparation, never a previous room's cached readiness. */
export function useScannerAutoStart({
  ready,
  preparing,
  manifest,
  manifestReady,
  targetId,
  roomId,
  onStart,
  error = "",
}: {
  error?: string;
  ready: boolean;
  preparing: boolean;
  manifest: { current: Pick<EligibilityManifest, "occurrenceId" | "roomId"> | null };
  manifestReady: boolean;
  targetId: string | null;
  roomId: string | null;
  onStart: () => void;
}) {
  const [pending, setPending] = useState(false);
  const start = useRef(onStart);
  start.current = onStart;
  useEffect(() => {
    const current = manifest.current;
    if (
      !pending ||
      !ready ||
      preparing ||
      (!manifestReady && !error) ||
      (current ? current.occurrenceId !== targetId || (current.roomId ?? null) !== roomId : !error)
    )
      return;
    setPending(false);
    start.current();
  }, [pending, ready, preparing, manifestReady, manifest, targetId, roomId, error]);
  return { pending, request: () => setPending(true), cancel: () => setPending(false) };
}
