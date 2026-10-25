import type { BadgeDisplayRole, SocialBadgeRole } from "./schemas/participant-roles";

/** Shared role colors for physical badge bands and personal promotion artwork. */
export const BADGE_DISPLAY_ROLE_COLORS: Readonly<Record<BadgeDisplayRole, string>> = {
  attendee: "#0b0d0c",
  speaker: "#ed7d31",
  staff: "#198754",
  sponsor: "#5a9bd5",
};

export function personalPromotionRoleColors(role: SocialBadgeRole, eventColors: readonly string[]): string[] {
  const band: BadgeDisplayRole =
    role === "sponsor"
      ? "sponsor"
      : role === "organizer" || role === "staff"
        ? "staff"
        : role === "speaker" || role === "co_speaker" || role === "moderator" || role === "panelist"
          ? "speaker"
          : "attendee";
  if (band === "attendee") return [...eventColors];
  const color = BADGE_DISPLAY_ROLE_COLORS[band];
  const shade = (amount: number) =>
    "#" +
    [1, 3, 5]
      .map((offset) =>
        Math.round(parseInt(color.slice(offset, offset + 2), 16) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  return [eventColors[0]!, shade(0.38), shade(0.62), shade(0.85)];
}
