import type { ComponentChildren } from "preact";
import type { ContentAgendaAffiliation } from "../../shared/site-agenda";
import { affiliationLabel } from "../../shared/agenda-speaker-affiliations";
import { MAX_SESSION_AFFILIATIONS } from "../../shared/schemas/event-session-history";
import { formatNumber } from "../../shared/format-number";
import { Avatar } from "../ui/Avatar";
import "./AgendaAffiliationRotation.css";
import "./AgendaSpeaker.css";

type MarkSize = "card" | "preview" | "profile";

/**
 * Every capacity a speaker appeared in, as calm units of the same shape: the organization's mark
 * beside its text. A logo carries the organization's name as its text and
 * tooltip, so the unit reads just the title; an organization without a logo gets a neutral
 * text label and reads "Title · Organization".
 *
 * `list` sets every unit side by side, where there is room (the profile dialog and page).
 * `rotating` shows one unit at a time and crossfades to the next, for rows without room.
 */
export function AgendaSpeakerAffiliations({
  affiliations,
  layout = "list",
  size = "preview",
  showLogos = true,
}: {
  affiliations: readonly ContentAgendaAffiliation[] | undefined;
  layout?: "list" | "rotating" | "directory";
  size?: MarkSize;
  showLogos?: boolean;
}) {
  affiliations = affiliations?.filter(
    (affiliation) => affiliation.title?.trim() || affiliation.organization?.name?.trim(),
  );
  if (!affiliations?.length) return null;
  if (layout === "rotating")
    return (
      <AgendaAffiliationRotation labels={affiliations.map(affiliationLabel)}>
        {affiliations.map((affiliation, index) => (
          <span key={index}>
            {showLogos ? (
              <AffiliationMark affiliation={affiliation} size={size === "profile" ? "preview" : size} />
            ) : null}
            <span class="pk-agenda-speaker-affiliations__text">
              {showLogos ? affiliationText(affiliation) : affiliationLabel(affiliation)}
            </span>
          </span>
        ))}
      </AgendaAffiliationRotation>
    );
  return (
    <ul
      class={`pk-agenda-speaker-affiliations${layout === "directory" ? " pk-agenda-speaker-affiliations--directory" : ""}`}
    >
      {affiliations.map((affiliation, index) => {
        const organization = affiliation.organization;
        const mark =
          layout === "directory" || !showLogos ? null : <AffiliationMark affiliation={affiliation} size={size} />;
        return (
          <li key={index}>
            {showLogos && organization?.href && organization.logoSrc && layout !== "directory" ? (
              <a class="pk-agenda-speaker-affiliations__organization" href={organization.href}>
                {mark}
              </a>
            ) : (
              mark
            )}
            {layout === "directory" ? (
              <span class="pk-agenda-speaker-affiliations__text">
                {affiliation.title ? <span title={affiliation.title}>{affiliation.title}</span> : null}
                {organization ? <strong title={organization.name}>{organization.name}</strong> : null}
              </span>
            ) : (showLogos ? affiliationText(affiliation) : affiliationLabel(affiliation)) ? (
              <span class="pk-agenda-speaker-affiliations__text">
                {showLogos ? affiliationText(affiliation) : affiliationLabel(affiliation)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Organization marks stay separate from the person's title, affiliations and links. */
export function AgendaSpeakerLogos({
  affiliations,
  size = "preview",
}: {
  affiliations: readonly ContentAgendaAffiliation[] | undefined;
  size?: MarkSize;
}) {
  const organizations =
    affiliations?.flatMap(({ organization }) => (organization?.logoSrc ? [organization] : [])) ?? [];
  if (!organizations.length) return null;
  return (
    <span class="pk-agenda-speaker-logos">
      {organizations.map((organization) =>
        organization.href ? (
          <a href={organization.href}>
            <AgendaSpeakerOrganizationLogo organization={organization} size={size} />
          </a>
        ) : (
          <AgendaSpeakerOrganizationLogo organization={organization} size={size} />
        ),
      )}
    </span>
  );
}

/**
 * One unit at a time in a row without room: every unit shares one grid cell, so the row keeps the
 * widest unit's width (truncated by its container) and a fixed height while CSS keyframes crossfade
 * them in turn. Nothing needs scripts, and nothing announces the change: the units are hidden from
 * assistive technology, which reads every affiliation once from the text beside them. With reduced
 * motion the first unit stays, followed by how many more there are. Also used by the lower third.
 */
export function AgendaAffiliationRotation({
  labels,
  children,
}: {
  /** Every affiliation as plain text, in order, for assistive technology. */
  labels: readonly string[];
  /** One unit per affiliation, in the same order. */
  children: ComponentChildren[];
}) {
  const units = children.slice(0, MAX_SESSION_AFFILIATIONS);
  const more = units.length - 1;
  return (
    <span
      class={`pk-affiliation-rotation${units.length > 1 ? ` pk-affiliation-rotation--rotate-${units.length}` : ""}`}
    >
      <span class="pk-affiliation-rotation__units" aria-hidden="true">
        {units.map((unit, index) => (
          <span class="pk-affiliation-rotation__unit" key={index}>
            {unit}
          </span>
        ))}
        {more > 0 ? <span class="pk-affiliation-rotation__more">+{formatNumber(more)}</span> : null}
      </span>
      <span class="pk-sr-only">{labels.filter(Boolean).join("; ")}</span>
    </span>
  );
}

/** A logo says the organization's name itself; without one the unit names it in text. */
function affiliationText(affiliation: ContentAgendaAffiliation): string {
  return affiliation.organization?.logoSrc ? (affiliation.title ?? "") : affiliationLabel(affiliation);
}

/** The organization's logo, when available; otherwise the organization is named in text. */
function AffiliationMark({ affiliation, size }: { affiliation: ContentAgendaAffiliation; size: MarkSize }) {
  const organization = affiliation.organization;
  // A capacity without an organization ("Proposer") has nothing to mark; a tile of its initial would
  // only repeat the word beside it.
  if (!organization?.logoSrc) return null;
  return <AgendaSpeakerOrganizationLogo organization={organization} size={size} />;
}

/** An organization's logo contained in its fixed box; its name is the image's text and tooltip. */
export function AgendaSpeakerOrganizationLogo({
  organization,
  size,
}: {
  organization: NonNullable<ContentAgendaAffiliation["organization"]>;
  size: MarkSize;
}) {
  // Without a logo the organization is text beside the title; a tile of its initials would only repeat it.
  if (!organization.logoSrc) return null;
  return (
    <span
      class={`pk-agenda-speaker-organization pk-agenda-speaker-organization--${size}`}
      title={organization.name}
      role="img"
      aria-label={organization.name}
    >
      <Avatar
        key={organization.logoSrc ?? "missing"}
        name={organization.name}
        src={organization.logoSrc ?? undefined}
        shape="square"
        class="pk-agenda-speaker-organization__logo"
      />
    </span>
  );
}
