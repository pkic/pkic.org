/**
 * Whether this device has opened the portal for this person before.
 *
 * Home greets a returning person with "Welcome back"; saying it on somebody's
 * very first visit is a small untruth on the first screen they see. The
 * answer is per device and errs toward a plain "Welcome": a person on a new
 * laptop is greeted as new, which is harmless, while private browsing or
 * blocked storage never produces a false "back".
 */
const visitedKey = (userId: string) => `portal-visited:${userId}`;

/** Reads whether this device has seen the person, then records that it now has. */
export function takeReturningVisit(userId: string): boolean {
  try {
    const returning = localStorage.getItem(visitedKey(userId)) !== null;
    localStorage.setItem(visitedKey(userId), "1");
    return returning;
  } catch {
    return false;
  }
}
