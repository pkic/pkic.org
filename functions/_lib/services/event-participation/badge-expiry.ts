import { AppError } from "../../errors";

/** Indefinite events issue short-lived credentials; elapsed events need an explicit extension. */
export function resolveBadgeExpiry(now: string, eventEnd: string | null, explicit?: string): string {
  if (explicit) {
    if (Date.parse(explicit) <= Date.parse(now))
      throw new AppError(400, "BADGE_EXPIRY_INVALID", "Choose a future badge expiry.");
    return explicit;
  }
  if (eventEnd) {
    if (Date.parse(eventEnd) <= Date.parse(now))
      throw new AppError(
        409,
        "BADGE_EVENT_ENDED",
        "This event has ended. Choose an explicit future badge expiry to extend access.",
      );
    return new Date(eventEnd).toISOString();
  }
  return new Date(Date.parse(now) + 24 * 60 * 60_000).toISOString();
}
