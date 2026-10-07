import { useEffect, useState } from "preact/hooks";

/** Prevent accidental calendar gestures without changing the organizer's editing permissions. */
export function useAgendaInteractionLock(eventSlug: string) {
  const key = `agenda.interactions.locked:${eventSlug}`;
  function read() {
    try {
      return localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  }
  const [locked, setLocked] = useState(read);
  useEffect(() => setLocked(read()), [eventSlug]);
  function toggle() {
    const next = !locked;
    setLocked(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      // The lock still applies to the mounted calendar if browser storage is unavailable.
    }
  }
  return { locked, toggle };
}
