/** Build-time display hints only; the authenticated portal resolves live eligibility and capacity. */
export function eventParticipationLink(
  eventSlug: string,
  occurrenceId: string,
  policy: "preference" | "reservation" | "approval",
  access: "open" | "invitation" = "open",
) {
  return {
    url: `/portal/#/events/${encodeURIComponent(eventSlug)}/agenda?session=${encodeURIComponent(occurrenceId)}`,
    label:
      access === "invitation"
        ? "Invitation required"
        : policy === "approval"
          ? "Request approval"
          : policy === "reservation"
            ? "Save or reserve session"
            : "Save preference",
    message:
      access === "invitation"
        ? "Sign in to check your invitation and current session availability."
        : policy === "preference"
          ? "Saving interest does not reserve a place. Admission remains first come, first served."
          : "Sign in to check current availability and your session registration.",
  };
}
