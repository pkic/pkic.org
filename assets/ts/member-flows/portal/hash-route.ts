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
import { mcpOauthRequestIdSchema } from "../../../shared/schemas/mcp-oauth";
import { portalReturnPathSchema } from "../../../shared/schemas/user-auth";
import { MEMBERSHIP_JOIN_PATH } from "../../../shared/membership-join-path";
import { parseEventFlowPath } from "../../../shared/event-flow-paths";

/** The route part of a hash location: `#/groups/cm?tab=x` → `/groups/cm`. */
export function portalHashPath(hash: string): string {
  return (hash.replace(/^#/, "").split("?", 1)[0] || "/").replace(/\/$/, "") || "/";
}

function hashQuery(hash: string): URLSearchParams {
  return new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");
}

/** One named query parameter of a hash location: `#/a?day=2026-12-01` → `2026-12-01`. */
export function portalHashParam(hash: string, name: string): string | null {
  return hashQuery(hash).get(name);
}

/** The sign-in token a verify link carries, when the location is one. */
export function portalMagicLinkToken(hash: string): string | null {
  if (portalHashPath(hash) !== "/verify") return null;
  return hashQuery(hash).get("token");
}

/** Emailed identity invitations use a public confirmation screen, not login. */
export function portalIdentityInvitationToken(hash: string): string | null {
  if (portalHashPath(hash) !== "/identity-invitations") return null;
  return hashQuery(hash).get("token");
}

/** Emailed address verification links use a public confirmation screen, not login. */
export function portalEmailVerificationToken(hash: string): string | null {
  if (portalHashPath(hash) !== "/email-verifications") return null;
  return hashQuery(hash).get("token");
}

/** The route a verify link asks to return to, when it names a valid one. */
export function portalMagicLinkReturnPath(hash: string): string | null {
  if (portalHashPath(hash) !== "/verify") return null;
  const next = hashQuery(hash).get("next");
  return next && portalReturnPathSchema.safeParse(next).success ? next : null;
}

/**
 * A sign-in link requested from a public form (registering, proposing,
 * joining) returns to that form on this site rather than to a portal route.
 * Only the platform's own flow pages qualify, so the link still cannot leave
 * the site.
 */
export function eventFlowReturnPath(next: string | null): string | null {
  if (!next) return null;
  const path = next.split("?", 1)[0];
  return parseEventFlowPath(path) || path === MEMBERSHIP_JOIN_PATH ? next : null;
}

/**
 * Where a sign-in started from, when that is somewhere worth going back to.
 * The portal's own entry points — home, the login and verify screens, the
 * invitation screens — are not; a pending OAuth request is a resumable destination.
 */
export function portalReturnPath(hash: string): string | undefined {
  const route = portalHashPath(hash);
  if (route === "/auth/oauth") {
    const request = hashQuery(hash).get("request");
    return mcpOauthRequestIdSchema.safeParse(request).success ? `/auth/oauth?request=${request}` : undefined;
  }
  if (
    route === "/" ||
    route === "/login" ||
    route === "/verify" ||
    route === "/identity-invitations" ||
    route === "/email-verifications"
  )
    return undefined;
  const path = hash.replace(/^#/, "");
  return portalReturnPathSchema.safeParse(path).success ? path : undefined;
}
