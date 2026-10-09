import type { ContentAgendaSpeaker } from "../../shared/site-agenda";
import { SiteImage } from "./SiteImage";

/**
 * The credited organization as its logo, or as a small bordered name badge when it has none.
 * `size` follows the surface: directory cards, the hover preview, or the profile dialog.
 */
export function AgendaSpeakerOrganization({
  organization,
  size,
}: {
  organization: ContentAgendaSpeaker["organization"];
  size: "card" | "preview" | "profile";
}) {
  if (!organization) return null;
  const classes = `pk-agenda-speaker-organization pk-agenda-speaker-organization--${size}`;
  return organization.logoSrc ? (
    <span class={classes}>
      <SiteImage
        portrait
        class="pk-agenda-speaker-organization__logo"
        src={organization.logoSrc}
        alt={organization.name}
        loading="lazy"
        decoding="async"
      />
    </span>
  ) : (
    <span class={`${classes} pk-agenda-speaker-organization--name`}>{organization.name}</span>
  );
}
