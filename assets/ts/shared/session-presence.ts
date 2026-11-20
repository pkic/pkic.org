/**
 * Someone following a live room is there without touching the page: a talk
 * runs an hour with no click or key. A live connection reports each time it
 * hears from its room, and a signed-in page counts that as it counts a click.
 * A page that is signed in another way, such as a venue screen, has no
 * listener and nothing happens.
 */
const listeners = new Set<() => void>();

export function noteSessionPresence(): void {
  for (const listener of listeners) listener();
}

/** Returns the unsubscribe. */
export function onSessionPresence(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
