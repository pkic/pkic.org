import type { AgendaAdmissionPolicy } from "./schemas/event-agenda";

/** Build-time display hints only; the authenticated portal resolves live eligibility and capacity. */
export function eventParticipationLink(
  eventSlug: string,
  occurrenceId: string,
  policy: AgendaAdmissionPolicy,
  access: "open" | "invitation" = "open",
) {
  const url = `/portal/#/events/${encodeURIComponent(eventSlug)}/agenda?session=${encodeURIComponent(occurrenceId)}`;
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
