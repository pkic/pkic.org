import type { ComponentChildren } from "preact";
import { getLinkLabel } from "../../../shared/schemas/links";
import type { PublicOrganizationPerson } from "../../../shared/schemas/public-person";
import { formatMonthYear } from "../../shared/ui";

export type PublicPerson = PublicOrganizationPerson;

export function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

export function PublicPersonOrgLink({
  person,
  className,
  children,
}: {
  person: PublicPerson;
  className: string;
  children: ComponentChildren;
}) {
  return person.organizationWebsite ? (
    <a
      href={person.organizationWebsite}
      target="_blank"
      rel="noopener noreferrer"
      title={person.organizationName ?? undefined}
      class={className}
    >
      {children}
    </a>
  ) : (
    <span class={className}>{children}</span>
  );
}

function FeaturedLinkBadge({ person }: { person: PublicPerson }) {
  if (!person.featuredLink) return null;
  const label = getLinkLabel(person.featuredLink);
  return (
    <a
      href={person.featuredLink}
      class="person-card-featured-link"
      target="_blank"
      rel="noopener noreferrer"
      // Named after the person, not after the site: a page of ten cards
      // otherwise offers ten links all carrying the same site label, which is
      // nothing to choose between when the links are read out on their own.
      aria-label={`${person.name} on ${label}`}
    >
      {label}
    </a>
  );
}

function OrganizationBlock({ person }: { person: PublicPerson }) {
  if (!person.organizationName) return null;
  return (
    <div class="person-card-org">
      {person.organizationLogoUrl ? (
        <PublicPersonOrgLink person={person} className="person-card-org-logo-wrap">
          <img
            src={person.organizationLogoUrl}
            alt={person.organizationName}
            class="person-card-org-logo"
            loading="lazy"
          />
        </PublicPersonOrgLink>
      ) : (
        <PublicPersonOrgLink person={person} className="person-card-org-name">
          {person.organizationName}
        </PublicPersonOrgLink>
      )}
    </div>
  );
}

export function PublicPersonCard({
  person,
  role,
  color,
  avatarSize = "default",
  from,
  till,
}: {
  person: PublicPerson;
  role: string;
  color: string;
  avatarSize?: "default" | "small";
  from?: string;
  till?: string | null;
}) {
  const past = Boolean(till);
  const frameClasses = [
    "person-card-avatar-frame",
    past ? "person-card-avatar-frame--past" : "",
    avatarSize === "small" ? "person-card-avatar-frame--small" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div class={`person-card${past ? " person-card--past" : ""}`}>
      <div class="person-card-main">
        <div class={frameClasses}>
          {person.photoUrl ? (
            // The name is the next thing in the card, so an alt repeating it
            // makes a screen reader say it twice. Same decision `ui/Avatar`
            // makes for the same reason.
            <img class="person-card-avatar" src={person.photoUrl} alt="" loading="lazy" />
          ) : (
            <div class={`person-card-avatar person-card-avatar--initials wg-${color}`}>{initialsFor(person.name)}</div>
          )}
          <span class={`person-card-role-arc${past ? " person-card-role-arc--past" : ""}`}>{role}</span>
        </div>
        <div class="person-card-body">
          <div class="person-card-name-row">
            <span class="person-card-name">{person.name}</span>
            <FeaturedLinkBadge person={person} />
          </div>
          {person.jobTitle && (
            <div class="person-card-jobtitle">
              {person.jobTitle}
              {person.organizationName && person.organizationName !== person.name && ` at ${person.organizationName}`}
            </div>
          )}
          <OrganizationBlock person={person} />
        </div>
      </div>
      {(from || till) && (
        <div class="person-card-footer">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="11"
            height="11"
            fill="currentColor"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path d="M11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm-3 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm-5 3a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm3 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5z" />
            <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z" />
          </svg>
          <span class="person-card-footer-label">{from && !till ? "In role since" : "In role"}</span>
          <span class="person-card-footer-dates">
            {from && !till && formatMonthYear(from)}
            {from && till && `${formatMonthYear(from)} – ${formatMonthYear(till)}`}
            {!from && till && `Until ${formatMonthYear(till)}`}
          </span>
        </div>
      )}
    </div>
  );
}
