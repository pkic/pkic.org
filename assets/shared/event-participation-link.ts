import type { AgendaAdmissionPolicy } from "./schemas/event-agenda";
import type { ParticipationAvailability } from "./schemas/event-participation-availability";

/** The hash query flag (`?mine=1`) that opens the event app's agenda with only the reader's own sessions shown. */
const MY_AGENDA_PARAM = "mine";

export function isMyAgendaQuery(query: URLSearchParams): boolean {
  return query.get(MY_AGENDA_PARAM) === "1";
}

/**
 * The event app's agenda as a portal hash route: the whole program, or with
 * `mine` the same view pre-filtered to the reader's starred and booked sessions.
 */
export function eventAgendaRoute(eventSlug: string, { mine = false }: { mine?: boolean } = {}): string {
  return `/events/${encodeURIComponent(eventSlug)}/agenda${mine ? `?${MY_AGENDA_PARAM}=1` : ""}`;
}

/**
 * One session's details in the event app's agenda, as a portal hash route. With `mine` the details
 * open from My agenda, and closing them returns there.
 */
export function eventSessionRoute(
  eventSlug: string,
  occurrenceId: string,
  { mine = false }: { mine?: boolean } = {},
): string {
  return `${eventAgendaRoute(eventSlug, { mine })}${mine ? "&" : "?"}session=${encodeURIComponent(occurrenceId)}`;
}

/** The event app's virtual room, optionally opened on one location and the session that brought the reader. */
export function eventVirtualRoomRoute(
  eventSlug: string,
  { room, session }: { room?: string | null; session?: string | null } = {},
): string {
  const query = new URLSearchParams();
  if (room) query.set("room", room);
  if (session) query.set("session", session);
  const search = query.toString();
  return `/events/${encodeURIComponent(eventSlug)}/virtual${search ? `?${search}` : ""}`;
}

/** The attendee's own agenda in the portal, relative to the site origin. */
export function eventMyAgendaPath(eventSlug: string): string {
  return `/portal/#${eventAgendaRoute(eventSlug, { mine: true })}`;
}

export type SessionAccessPolicy = "open" | "invitation";

/**
 * The one line every agenda shows for how a session admits people: the public site, the
 * session details and the attendee's own agenda all read it from here.
 */
export function sessionAdmissionNote(policy: AgendaAdmissionPolicy, access: SessionAccessPolicy = "open"): string {
  if (access === "invitation") return "By invitation only";
  switch (policy) {
    case "optional_reservation":
      return "Reserve to guarantee a seat · remaining seats first come, first served";
    case "reservation":
      return "Registration required · registered attendees only";
    case "approval":
      return "Admission by approval";
    default:
      return "Open session · first come, first served";
  }
}

/** The action that takes a seat, named for what it does. */
export const SESSION_SEAT_ACTION_LABELS = {
  reserve: "Reserve a seat",
  request: "Request a seat",
  waitlist: "Join the waiting list",
} as const;

/** The one seat action a person can take now: the command it sends and what it is called. */
export interface SessionSeatAction {
  command: "reserve" | "request";
  label: (typeof SESSION_SEAT_ACTION_LABELS)[keyof typeof SESSION_SEAT_ACTION_LABELS];
  full: boolean;
}

/**
 * The seat a person can take now, if any, from the session's admission rule and their own
 * availability. An open session has only its star, and a person attending the day online needs no
 * seat: they join online. The agenda card and the session details both read it from here.
 */
export function sessionSeatAction(session: {
  admissionPolicy: AgendaAdmissionPolicy;
  availability: ParticipationAvailability | null;
}): SessionSeatAction | null {
  const availability = session.availability;
  if (session.admissionPolicy === "preference" || !availability?.bookingAction) return null;
  if (availability.attendanceMode === "remote") return null;
  const full = availability.state === "full";
  return {
    command: availability.bookingAction,
    label:
      availability.bookingAction === "request"
        ? SESSION_SEAT_ACTION_LABELS.request
        : full
          ? SESSION_SEAT_ACTION_LABELS.waitlist
          : SESSION_SEAT_ACTION_LABELS.reserve,
    full,
  };
}

/** What a held seat, request or waiting place is called, and the quiet action that gives it up. */
export const SESSION_HELD_LABELS = {
  reserved: { status: "Reserved", release: "Cancel reservation…" },
  approval_pending: { status: "Awaiting approval", release: "Withdraw request…" },
  waitlisted: { status: "On the waiting list", release: "Leave the waiting list…" },
} as const;

/** An invited person's standing before they take a seat. */
export const SESSION_INVITED_LABEL = "Invited";

/** Build-time display hints only; the authenticated portal resolves live eligibility and capacity. */
export function eventParticipationLink(
  eventSlug: string,
  occurrenceId: string,
  policy: AgendaAdmissionPolicy,
  access: SessionAccessPolicy = "open",
) {
  // A session deep link opens the whole program: the session need not be on the reader's agenda yet.
  const url = `/portal/#${eventSessionRoute(eventSlug, occurrenceId)}`;
  return {
    policyLabel: sessionAdmissionNote(policy, access),
    favorite: {
      url,
      label: "Save favorite",
      message: "A favorite shows interest. It does not register you, reserve a seat, or grant an invitation.",
    },
    url,
    preference: access === "open" && policy === "preference",
    label:
      access === "invitation"
        ? sessionAdmissionNote(policy, access)
        : policy === "approval"
          ? SESSION_SEAT_ACTION_LABELS.request
          : policy === "preference"
            ? "Save favorite"
            : SESSION_SEAT_ACTION_LABELS.reserve,
    message:
      access === "invitation"
        ? "Sign in to check your invitation and current session availability."
        : policy === "preference"
          ? "Saving interest does not reserve a seat. Admission remains first come, first served."
          : "Sign in to check current availability and your seat.",
  };
}
