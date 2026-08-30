import type { ComponentChildren } from "preact";
import type { PublicOrganizationPerson } from "../../../shared/schemas/public-person";

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

function LinkedInBadge({ person }: { person: PublicPerson }) {
  if (!person.linkedin) return null;
  return (
    <a
      href={person.linkedin}
      class="person-card-linkedin"
      target="_blank"
      rel="noopener noreferrer"
      title={`${person.name} on LinkedIn`}
      aria-label="LinkedIn"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
        <path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854zm4.943 12.248V6.169H2.542v7.225zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248S2.4 3.226 2.4 3.934c0 .694.521 1.248 1.327 1.248zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225z" />
      </svg>
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

function monthYear(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
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
            <img class="person-card-avatar" src={person.photoUrl} alt={person.name} loading="lazy" />
          ) : (
            <div class={`person-card-avatar person-card-avatar--initials wg-${color}`}>{initialsFor(person.name)}</div>
          )}
          <span class={`person-card-role-arc${past ? " person-card-role-arc--past" : ""}`}>{role}</span>
        </div>
        <div class="person-card-body">
          <div class="person-card-name-row">
            <span class="person-card-name">{person.name}</span>
            <LinkedInBadge person={person} />
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
            {from && !till && monthYear(from)}
            {from && till && `${monthYear(from)} – ${monthYear(till)}`}
            {!from && till && `Until ${monthYear(till)}`}
          </span>
        </div>
      )}
    </div>
  );
}
