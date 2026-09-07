import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { PublicOrganizationPerson } from "../../../shared/schemas/public-person";
import { LinkList } from "../../ui/LinkList";
import { EMPTY_DATE, formatMonthYear } from "../../shared/ui";

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

/**
 * The person's portrait, or their initials when there is no usable photograph.
 *
 * "No usable photograph" includes one the browser could not load. A stored
 * headshot whose object is missing left a broken `<img>` inside the ring,
 * which collapses to a few pixels tall and reads as the squashed oval issue
 * #25 reports — a ring with nothing in it is worse than initials, and the
 * reader cannot tell it is a failure rather than a design.
 */
export function PersonAvatar({
  person,
  color,
  imageClass,
  initialsClass,
}: {
  person: PublicPerson;
  color: string;
  imageClass: string;
  initialsClass: string;
}) {
  const [broken, setBroken] = useState(false);
  if (!person.photoUrl || broken) {
    return <div class={`${initialsClass} wg-${color}`}>{initialsFor(person.name)}</div>;
  }
  return (
    // The name is the next thing in the card, so an alt repeating it makes a
    // screen reader say it twice. Same decision `ui/Avatar` makes.
    <img class={imageClass} src={person.photoUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
  );
}

/**
 * The person's own profile links, in the same marked vocabulary every other
 * surface uses. This was a bare text link showing the site name and nothing
 * else — no styling of its own existed for the class it carried — which is
 * what issue #13 means by "should use the badge instead of text".
 */
export function PersonLinks({ person }: { person: PublicPerson }) {
  if (!person.featuredLink) return null;
  // Named after the person: a page of ten cards otherwise offers ten links
  // all carrying the same site label, which is nothing to choose between
  // when they are read out on their own.
  return <LinkList links={[person.featuredLink]} ownerName={person.name} />;
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
  /*
   * A term is shown only when at least one of its ends is a date that can
   * actually be written down. A start the formatter cannot parse otherwise
   * produced "In role since —", which says less than saying nothing.
   */
  const fromLabel = formatMonthYear(from);
  const tillLabel = formatMonthYear(till);
  const tenure = fromLabel !== EMPTY_DATE || tillLabel !== EMPTY_DATE;
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
          <PersonAvatar
            person={person}
            color={color}
            imageClass="person-card-avatar"
            initialsClass="person-card-avatar person-card-avatar--initials"
          />
          <span class={`person-card-role-arc${past ? " person-card-role-arc--past" : ""}`}>{role}</span>
        </div>
        <div class="person-card-body">
          <div class="person-card-name-row">
            <span class="person-card-name">{person.name}</span>
            <PersonLinks person={person} />
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
      {tenure && (
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
          <span class="person-card-footer-label">
            {fromLabel !== EMPTY_DATE && tillLabel === EMPTY_DATE ? "In role since" : "In role"}
          </span>
          <span class="person-card-footer-dates">
            {fromLabel !== EMPTY_DATE && tillLabel === EMPTY_DATE && fromLabel}
            {fromLabel !== EMPTY_DATE && tillLabel !== EMPTY_DATE && `${fromLabel} – ${tillLabel}`}
            {fromLabel === EMPTY_DATE && tillLabel !== EMPTY_DATE && `Until ${tillLabel}`}
          </span>
        </div>
      )}
    </div>
  );
}
