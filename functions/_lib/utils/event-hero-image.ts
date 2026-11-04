/** Only keys from this event's own image namespace may be deleted. */
export function eventHeroImageKey(eventId: string, slug: string, path: unknown): string | null {
  if (typeof path !== "string") return null;
  if (!path.startsWith(`/api/v1/events/${encodeURIComponent(slug)}/images/`)) return null;
  const match = /^\/api\/v1\/events\/[^/]+\/images\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/.exec(path);
  return match ? `event-images/${eventId}/${match[1]}` : null;
}
