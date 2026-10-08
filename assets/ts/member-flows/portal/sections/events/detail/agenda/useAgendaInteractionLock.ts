import { useEffect, useState } from "preact/hooks";

/** Editing is an explicit, temporary choice for the current event. */
export function useAgendaInteractionLock(eventSlug: string) {
  const [enabledSlug, setEnabledSlug] = useState<string | null>(null);
  useEffect(() => setEnabledSlug(null), [eventSlug]);
  const locked = enabledSlug !== eventSlug;
  return { locked, toggle: () => setEnabledSlug(locked ? eventSlug : null) };
}
