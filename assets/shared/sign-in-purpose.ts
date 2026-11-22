/**
 * What a person signs in or starts an account for, read from where the link
 * returns them. The sign-in card words itself from it, and the email that
 * starts an account names the same purpose, so both say one thing.
 */
import { EVENT_FLOW_SUFFIXES, parseEventFlowPath } from "./event-flow-paths";
import { MEMBERSHIP_JOIN_PATH } from "./membership-join-path";

export type SignInEventFlow = "registration" | "proposal";

export type SignInPurpose = { flow: SignInEventFlow; eventSlug: string } | { flow: "join" };

/**
 * The event a return path's public flow page or portal route belongs to, for
 * the given flow. Both name the same flow: the public page on this site, and
 * the portal route for an event without one.
 */
export function signInEventSlug(returnPath: string, flow: SignInEventFlow): string | null {
  const path = returnPath.split("?", 1)[0] ?? "";
  const page = parseEventFlowPath(path);
  if (page) return page.flow === flow ? page.eventSlug : null;
  const portal = new RegExp(`^/events/([^/?]+)/${EVENT_FLOW_SUFFIXES[flow]}/?$`).exec(path);
  return portal?.[1] ? decodedSegment(portal[1]) : null;
}

/** A path segment as text, or null when its percent-encoding is malformed. */
function decodedSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * A return path that names a page on this site rather than a portal route: a
 * public event form or the membership join page. Public event pages are
 * year-scoped (`/events/2026/<slug>/register/`); a yearless
 * `/events/<slug>/register` is the portal's own route for an event without
 * public pages, so it stays in the portal.
 */
export function siteFlowReturnPath(returnPath: string | null | undefined): string | null {
  if (!returnPath) return null;
  const path = returnPath.split("?", 1)[0] ?? "";
  if (path === MEMBERSHIP_JOIN_PATH) return returnPath;
  const page = parseEventFlowPath(path);
  return page && page.eventBasePath !== `/events/${page.eventSlug}/` ? returnPath : null;
}

/** Where a return path lands, relative to the site origin: the site page it names, else that portal route. */
export function signInReturnHref(returnPath: string | undefined): string {
  if (!returnPath) return "/portal/";
  return siteFlowReturnPath(returnPath) ?? `/portal/#${returnPath}`;
}

/** The purpose a return path names, or null for a plain sign-in. */
export function signInPurpose(returnPath: string | undefined): SignInPurpose | null {
  if (!returnPath) return null;
  for (const flow of ["registration", "proposal"] as const) {
    const eventSlug = signInEventSlug(returnPath, flow);
    if (eventSlug) return { flow, eventSlug };
  }
  return returnPath.split("?", 1)[0] === MEMBERSHIP_JOIN_PATH ? { flow: "join" } : null;
}
