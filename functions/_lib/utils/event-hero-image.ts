import { parseEventHeroImagePath } from "../../../assets/shared/event-hero-image-variants";

/** Only keys from this event's own image namespace may be deleted. */
export function eventHeroImageKey(eventId: string, slug: string, path: unknown): string | null {
  if (typeof path !== "string") return null;
  const image = parseEventHeroImagePath(path);
  return image?.slug === slug ? `event-images/${eventId}/${image.file}` : null;
}
