/**
 * The portal's hash location, read three ways.
 *
 * Every portal route lives after `#`, so the sign-in flow can carry a route
 * around as plain text: the verify link the email opens names the route to
 * return to, and the login screen names the route it interrupted. Both sides
 * accept only what `portalReturnPathSchema` accepts — a path under the
 * portal's own `#`, never a host — so a link can only ever land inside the
 * portal.
 */
import { portalReturnPathSchema } from "../../../shared/schemas/user-auth";

/** The route part of a hash location: `#/groups/cm?tab=x` → `/groups/cm`. */
export function portalHashPath(hash: string): string {
  return (hash.replace(/^#/, "").split("?", 1)[0] || "/").replace(/\/$/, "") || "/";
}

function hashQuery(hash: string): URLSearchParams {
  return new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");
}

/** The sign-in token a verify link carries, when the location is one. */
export function portalMagicLinkToken(hash: string): string | null {
  if (portalHashPath(hash) !== "/verify") return null;
  return hashQuery(hash).get("token");
}

/** The route a verify link asks to return to, when it names a valid one. */
export function portalMagicLinkReturnPath(hash: string): string | null {
  if (portalHashPath(hash) !== "/verify") return null;
  const next = hashQuery(hash).get("next");
  return next && portalReturnPathSchema.safeParse(next).success ? next : null;
}

/**
 * Where a sign-in started from, when that is somewhere worth going back to.
 * The portal's own entry points — home, the login and verify screens, the
 * OAuth hand-off — are not; a deep link such as a working group is.
 */
export function portalReturnPath(hash: string): string | undefined {
  const route = portalHashPath(hash);
  if (route === "/" || route === "/login" || route === "/verify" || route === "/auth/oauth") return undefined;
  const path = hash.replace(/^#/, "");
  return portalReturnPathSchema.safeParse(path).success ? path : undefined;
}
