import { publicSessionTiming } from "./session-public-timing";
import type { AgendaOccurrence } from "./schemas/event-agenda";

/** One discovery policy for static archives and their agenda links. */
export function publishedSessionRoute(eventSlug: string, session: AgendaOccurrence): string | undefined {
  if (
    session.visibility !== "public" ||
    session.kind === "break" ||
    !publicSessionTiming(session) ||
    session.description.trim().length < 40 ||
    /^(tba|to be announced)$/iu.test(session.title.trim())
  )
    return undefined;
  return `/events/${encodeURIComponent(eventSlug)}/sessions/${encodeURIComponent(session.id)}/`;
}
