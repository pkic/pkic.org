import type { AgendaAdmissionPolicy } from "./schemas/event-agenda";

/** The hash query flag (`?mine=1`) that opens the event app's agenda with only the reader's own sessions shown. */
const MY_AGENDA_PARAM = "mine";

export function isMyAgendaQuery(query: URLSearchParams): boolean {
  return query.get(MY_AGENDA_PARAM) === "1";
}

/**
 * The event app's agenda as a portal hash route: the whole programme, or with
 * `mine` the same view pre-filtered to the reader's starred and booked sessions.
 */
export function eventAgendaRoute(eventSlug: string, { mine = false }: { mine?: boolean } = {}): string {
  return `/events/${encodeURIComponent(eventSlug)}/agenda${mine ? `?${MY_AGENDA_PARAM}=1` : ""}`;
}

/** The attendee's own agenda in the portal, relative to the site origin. */
export function eventMyAgendaPath(eventSlug: string): string {
  return `/portal/#${eventAgendaRoute(eventSlug, { mine: true })}`;
}

/** Build-time display hints only; the authenticated portal resolves live eligibility and capacity. */
export function eventParticipationLink(
  eventSlug: string,
  occurrenceId: string,
  policy: AgendaAdmissionPolicy,
  access: "open" | "invitation" = "open",
) {
  // A session deep link opens the whole programme: the session need not be on the reader's agenda yet.
  const url = `/portal/#${eventAgendaRoute(eventSlug)}?session=${encodeURIComponent(occurrenceId)}`;
  return {
    policyLabel:
      access === "invitation"
        ? "Invitation required"
        : policy === "approval"
          ? "Approval required"
          : policy === "reservation"
            ? "Registration required"
            : policy === "optional_reservation"
              ? "Registration optional"
              : "No session registration",
    favorite: {
      url,
      label: "Save favorite",
      message: "A favorite shows interest. It does not register you, reserve a place, or grant an invitation.",
    },
    url,
    preference: access === "open" && policy === "preference",
    label:
      access === "invitation"
        ? "Invitation required"
        : policy === "approval"
          ? "Request approval"
          : policy === "reservation"
            ? "Register for session"
            : policy === "optional_reservation"
              ? "Register if you wish"
              : "Save favorite",
    message:
      access === "invitation"
        ? "Sign in to check your invitation and current session availability."
        : policy === "preference"
          ? "Saving interest does not reserve a place. Admission remains first come, first served."
          : "Sign in to check current availability and your session registration.",
  };
}
