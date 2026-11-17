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
  return portal?.[1] ? decodeURIComponent(portal[1]) : null;
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
