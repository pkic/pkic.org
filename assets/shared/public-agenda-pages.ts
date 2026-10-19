import { publicSessionTiming } from "./session-public-timing";
import type { AgendaOccurrence, AgendaSnapshot } from "./schemas/event-agenda";
import type { EventVisibility } from "./schemas/event-series";

/**
 * One page rule for the static site and every link to it. The build renders a
 * session page and a speaker profile only from the approved agenda revision of a
 * public event, and every agenda, session page, portal view and structured-data
 * graph links to a page only when this same rule says the build rendered it. A
 * person without an approved appearance has a profile page under the rule in
 * `person-profile-policy`, at the same address.
 */
export type PublicPagesAgenda = Pick<
  AgendaSnapshot,
  "eventSlug" | "approvedAt" | "revision" | "publishedRevision" | "publicPages" | "speakerProfileSlugs" | "sessionSlugs"
>;

/** Only a public event's approved agenda reaches the static site; other events stay inside the portal. */
export function eventPublishesPages(visibility: EventVisibility | string): boolean {
  return visibility === "public";
}

/** The approved revision itself, projected for an event the site publishes; drafts and portal-only events have no pages. */
export function agendaPublishesPages(agenda: PublicPagesAgenda): boolean {
  return Boolean(agenda.approvedAt) && agenda.publishedRevision === agenda.revision && agenda.publicPages === true;
}

/** A public, timed, substantive session: the content that earns its own page once its agenda is published. */
export function sessionHasPageContent(session: AgendaOccurrence): boolean {
  return (
    session.visibility === "public" &&
    session.kind !== "break" &&
    publicSessionTiming(session) !== undefined &&
    session.description.trim().length >= 40 &&
    !/^(tba|to be announced)$/iu.test(session.title.trim())
  );
}

/** A session page's address segment: its readable slug, or its ID until approval has issued one. */
export function sessionPageAddress(eventSlug: string, segment: string): string {
  return `/events/${encodeURIComponent(eventSlug)}/sessions/${encodeURIComponent(segment)}/`;
}

/** A qualifying session of a published agenda has its own page, at its current readable address. */
export function publishedSessionRoute(agenda: PublicPagesAgenda, session: AgendaOccurrence): string | undefined {
  if (!agendaPublishesPages(agenda) || !sessionHasPageContent(session)) return undefined;
  return sessionPageAddress(agenda.eventSlug, agenda.sessionSlugs?.[session.id] ?? session.id);
}

/** The long-lived public address of one person's profile. */
export function personProfileRoute(slug: string): string {
  return `/people/${encodeURIComponent(slug)}/`;
}

/**
 * A speaker has a profile only through an approved appearance, the speaker's own
 * approved representation, on a session that has its own page, and only once the
 * person holds a public profile address. Roster names and source credits never do.
 */
export function publishedSpeakerProfileRoute(
  agenda: PublicPagesAgenda,
  session: AgendaOccurrence,
  credit: object,
): string | undefined {
  if (!("userId" in credit) || typeof credit.userId !== "string") return undefined;
  const userId = credit.userId;
  if (!session.history?.appearances.some((appearance) => appearance.userId === userId)) return undefined;
  const slug = agenda.speakerProfileSlugs?.[userId];
  return slug && publishedSessionRoute(agenda, session) ? personProfileRoute(slug) : undefined;
}
