import type { BadgeDisplayRole, SocialBadgeRole } from "./schemas/participant-roles";

/** Shared role colors for physical badge bands and personal promotion artwork. */
export const BADGE_DISPLAY_ROLE_COLORS: Readonly<Record<BadgeDisplayRole, string>> = {
  attendee: "#0b0d0c",
  speaker: "#ed7d31",
  staff: "#198754",
  sponsor: "#5a9bd5",
};

export function personalPromotionRoleStyle(role: SocialBadgeRole) {
  const speaking = ["speaker", "co_speaker", "moderator", "panelist"].includes(role);
  const team = role === "organizer" || role === "staff";
  const color = speaking
    ? BADGE_DISPLAY_ROLE_COLORS.speaker
    : team
      ? BADGE_DISPLAY_ROLE_COLORS.staff
      : role === "sponsor"
        ? BADGE_DISPLAY_ROLE_COLORS.sponsor
        : "#ffffff";
  const labels: Record<SocialBadgeRole, string> = {
    attendee: "Attending",
    speaker: "Speaker",
    co_speaker: "Speaker",
    moderator: "Moderator",
    panelist: "Panelist",
    sponsor: "Sponsor",
    organizer: "Organizer",
    staff: "Staff",
    proposer: "Proposal submitted",
  };
  return { color, ink: team ? "#ffffff" : "#0b0d0c", label: labels[role], speaking };
}
